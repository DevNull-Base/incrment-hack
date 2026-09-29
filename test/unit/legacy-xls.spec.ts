import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import {
  XlsParserService,
  isLegacyWorkbook,
} from '../../src/modules/import/xls-parser.service.js';

/**
 * Поддержка книг Excel 97-2003.
 *
 * Заказчик подтвердил на сессии вопросов и ответов, что файлы приходят
 * и в старом формате, и отдельно подсветил случай, когда «кодировка слетает».
 * Поэтому проверяется не только сам факт чтения, но и сохранность кириллицы
 * с датами: именно на них рассыпаются выгрузки из систем 2003 года.
 */

/** Журнал-заглушка: разборщику нужен только контекст и методы записи. */
const logger = {
  setContext: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as unknown as ConstructorParameters<typeof XlsParserService>[0];

const HEADERS = [
  'Название ВУЗа',
  'Вендор',
  'ПО',
  'Номер договора',
  'Подписание лицензии',
  'Срок действия лицензии (год)',
  'Статус по передаче',
  'ФИО Менеджера',
  'Ответственные от ВУЗа',
  'Комментарий',
];

const ROWS = [
  [
    'Московский государственный технический университет имени Н.Э. Баумана',
    'Ростелеком',
    'РТК Облако',
    'РТК-6101/2026',
    new Date(Date.UTC(2026, 0, 12)),
    3,
    'Передано',
    'Иванова Анна',
    'Смирнов Алексей Викторович',
    'Пилот на кафедре ИУ-5',
  ],
  [
    'Университет ИТМО',
    'Postgres Professional',
    'Postgres Pro Enterprise',
    'РТК-6109/2026',
    new Date(Date.UTC(2026, 2, 3)),
    2,
    'В работе',
    'Орлов Дмитрий',
    'Лебедев Максим Олегович',
    'Программа «СУБД и хранилища данных»',
  ],
];

/** Книга Excel 97-2003 в памяти. */
function buildLegacyWorkbook(): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([HEADERS, ...ROWS]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Взаимодействия');

  return XLSX.write(book, { type: 'buffer', bookType: 'biff8' }) as Buffer;
}

/** Та же таблица в современном формате. */
async function buildModernWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Взаимодействия');
  sheet.addRow(HEADERS);
  for (const row of ROWS) {
    sheet.addRow(row);
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('распознавание формата книги', () => {
  it('книга 97-2003 опознаётся по сигнатуре составного документа', () => {
    expect(isLegacyWorkbook(buildLegacyWorkbook())).toBe(true);
  });

  it('современная книга опознаётся как не-BIFF8', async () => {
    expect(isLegacyWorkbook(await buildModernWorkbook())).toBe(false);
  });

  it('обрывок файла не принимается за книгу 97-2003', () => {
    // Короткий буфер не должен приводить к чтению за границей массива.
    expect(isLegacyWorkbook(Buffer.from([0xd0, 0xcf]))).toBe(false);
  });
});

describe('чтение книги Excel 97-2003', () => {
  const parser = new XlsParserService(logger);

  it('разбирает файл, который раньше отклонялся целиком', async () => {
    const result = await parser.parse(buildLegacyWorkbook());

    expect(result.totalRows).toBe(2);
    expect(result.errors).toHaveLength(0);
    expect(Object.keys(result.mapping)).toHaveLength(HEADERS.length);
  });

  it('кириллица не рассыпается', async () => {
    // Строки BIFF8 хранятся либо в UTF-16, либо в однобайтовой кодовой
    // странице из записи CODEPAGE. Именно здесь выгрузки 2003 года
    // и превращаются в «крякозябры», о которых говорил заказчик.
    const result = await parser.parse(buildLegacyWorkbook());
    const first = result.rows[0]?.data;

    expect(first?.universityName).toBe(
      'Московский государственный технический университет имени Н.Э. Баумана',
    );
    expect(result.rows[1]?.data.comment).toBe('Программа «СУБД и хранилища данных»');
  });

  it('даты и числа приходят значениями, а не текстом', async () => {
    const result = await parser.parse(buildLegacyWorkbook());
    const first = result.rows[0]?.data;

    expect(first?.licenseSignedAt?.toISOString().slice(0, 10)).toBe('2026-01-12');
    expect(first?.licenseValidYears).toBe(3);
  });

  it('статус передачи распознаётся так же, как в современном формате', async () => {
    const legacy = await parser.parse(buildLegacyWorkbook());
    const modern = await parser.parse(await buildModernWorkbook());

    expect(legacy.rows.map((row) => row.data.transferStatus)).toEqual(['TRANSFERRED', 'IN_PROGRESS']);
    expect(legacy.rows.map((row) => row.data.transferStatus)).toEqual(
      modern.rows.map((row) => row.data.transferStatus),
    );
  });

  it('оба формата дают одинаковый результат разбора', async () => {
    // Это и есть суть требования: для пользователя формат файла не значит
    // ничего, данные попадают в систему одинаково.
    const legacy = await parser.parse(buildLegacyWorkbook());
    const modern = await parser.parse(await buildModernWorkbook());

    expect(legacy.rows.map((row) => row.data)).toEqual(modern.rows.map((row) => row.data));
  });

  it('повреждённый файл отклоняется понятной ошибкой', async () => {
    const broken = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x01]);

    // Наружу отдаётся стабильный код ответа, а не имя внутренней константы:
    // именно на него реагирует клиент.
    await expect(parser.parse(broken)).rejects.toMatchObject({
      definition: { code: 'CRM-IMP-0001' },
    });
  });
});
