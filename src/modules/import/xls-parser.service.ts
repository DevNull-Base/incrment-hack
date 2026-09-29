import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import ExcelJS from 'exceljs';
import { assertSafeZip } from '../files/zip-guard.js';
import * as XLSX from 'xlsx';
import { AppException } from '../../common/errors/app-exception.js';
import {
  ColumnMapping,
  ImportRow,
  autoDetectMapping,
  importRowSchema,
  parseCellDate,
  parseCellInt,
  parseCellText,
  parseTransferStatus,
} from './import-fields.js';

/** Ошибка в конкретной строке файла. */
export interface RowError {
  rowNumber: number;
  columnName: string | null;
  errorCode: string;
  message: string;
  rawRow: Record<string, unknown>;
}

/** Строка листа в виде, не зависящем от формата книги. */
export interface SheetRow {
  /** Номер строки, как его видит пользователь в Excel. */
  number: number;
  values: unknown[];
}

export interface ParsedRow {
  rowNumber: number;
  data: ImportRow;
  raw: Record<string, unknown>;
}

export interface ParseResult {
  headers: string[];
  mapping: ColumnMapping;
  unmappedHeaders: string[];
  rows: ParsedRow[];
  errors: RowError[];
  totalRows: number;
}

/**
 * Предел строк за один импорт.
 * Защищает от файла, который выведет процесс за пределы памяти ещё
 * до того, как данные дойдут до базы.
 */
const MAX_ROWS = 100_000;

/** Сколько строк оставлять для предпросмотра. */
export const PREVIEW_ROWS = 20;

@Injectable()
export class XlsParserService {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(XlsParserService.name);
  }

  /**
   * Разбирает файл XLS/XLSX.
   *
   * Поддерживаются оба формата, и выбор делается по сигнатуре файла,
   * а не по расширению: современная книга Office Open XML читается ExcelJS,
   * книга Excel 97-2003 — отдельным разборщиком BIFF8. Расширение при этом
   * ни на что не влияет — выгрузки из старых систем регулярно приезжают
   * с чужим именем.
   *
   * Чтение выполняется из буфера, а НЕ потоковым читателем ExcelJS,
   * и это вынужденное решение.
   *
   * Потоковый читатель (`stream.xlsx.WorkbookReader`) предполагает, что
   * внутри ZIP-архива запись `xl/workbook.xml` встретится РАНЬШЕ листов:
   * при разборе листа он обращается к модели книги. Порядок записей
   * форматом не регламентирован, и на практике нарушается — файл,
   * записанный самой ExcelJS, содержит `xl/workbook.xml` последней
   * записью, а лист восьмой. Читатель падает с
   * «Cannot read properties of undefined (reading 'sheets')» ещё до
   * первой строки данных, и никакие параметры это не меняют.
   *
   * Плата — файл целиком находится в памяти, поэтому его размер ограничен
   * отдельной, более строгой настройкой IMPORT_MAX_FILE_SIZE_MB.
   * Для генерации отчётов потоковая ЗАПИСЬ используется как и прежде:
   * она работает исправно, и именно там возникают большие объёмы.
   */
  async parse(content: Buffer, explicitMapping?: ColumnMapping): Promise<ParseResult> {
    let headers: string[] = [];
    let mapping: ColumnMapping = explicitMapping ?? {};
    let unmappedHeaders: string[] = [];
    const rows: ParsedRow[] = [];
    const errors: RowError[] = [];
    let totalRows = 0;

    try {
      const sheetRows = isLegacyWorkbook(content)
        ? readLegacyRows(content)
        : await readOoxmlRows(content);

      for (const row of sheetRows) {
        const values = row.values;

        // Первая непустая строка — заголовки.
        if (headers.length === 0) {
          headers = values.map((value) => parseCellText(value) ?? '');
          if (headers.every((header) => header.length === 0)) {
            headers = [];
            continue;
          }

          if (!explicitMapping || Object.keys(explicitMapping).length === 0) {
            const detected = autoDetectMapping(headers);
            mapping = detected.mapping;
            unmappedHeaders = detected.unmapped;
          } else {
            const mappedHeaders = new Set(Object.keys(explicitMapping));
            unmappedHeaders = headers.filter(
              (header) => header.length > 0 && !mappedHeaders.has(header),
            );
          }
          continue;
        }

        // Полностью пустые строки пропускаем молча: в выгрузках из Excel
        // они встречаются постоянно и ошибкой не являются.
        if (values.every((value) => parseCellText(value) === null)) {
          continue;
        }

        totalRows++;

        if (totalRows > MAX_ROWS) {
          throw new AppException('IMPORT_FILE_UNREADABLE', {
            detail: `Файл содержит более ${MAX_ROWS} строк. Разделите его на части.`,
            meta: { maxRows: MAX_ROWS },
          });
        }

        const raw = buildRawRecord(headers, values);
        const outcome = this.buildRow(row.number, headers, values, mapping, raw);

        if ('error' in outcome) {
          errors.push(outcome.error);
        } else {
          rows.push(outcome.row);
        }
      }
    } catch (error) {
      if (error instanceof AppException) throw error;

      this.logger.error({ err: error }, 'Не удалось разобрать файл импорта');
      throw new AppException('IMPORT_FILE_UNREADABLE', {
        detail:
          'Не удалось прочитать файл как таблицу XLS/XLSX. ' +
          'Возможно, он повреждён, защищён паролем или имеет иной формат.',
        cause: error,
      });
    }

    if (headers.length === 0) {
      throw new AppException('IMPORT_FILE_UNREADABLE', {
        detail: 'В файле не найдено строки заголовков.',
      });
    }

    return { headers, mapping, unmappedHeaders, rows, errors, totalRows };
  }

  /** Преобразует значения строки в доменный объект с проверкой схемой. */
  private buildRow(
    rowNumber: number,
    headers: string[],
    values: unknown[],
    mapping: ColumnMapping,
    raw: Record<string, unknown>,
  ): { row: ParsedRow } | { error: RowError } {
    const pick = (field: string): unknown => {
      const header = Object.keys(mapping).find((key) => mapping[key] === field);
      if (!header) return null;
      const index = headers.indexOf(header);
      return index >= 0 ? values[index] : null;
    };

    const candidate = {
      universityName: parseCellText(pick('universityName')) ?? '',
      vendorName: parseCellText(pick('vendorName')),
      productName: parseCellText(pick('productName')),
      contractNumber: parseCellText(pick('contractNumber')),
      licenseSignedAt: parseCellDate(pick('licenseSignedAt')),
      licenseValidYears: parseCellInt(pick('licenseValidYears')),
      transferStatus: parseTransferStatus(pick('transferStatus')),
      managerFullName: parseCellText(pick('managerFullName')),
      directionName: parseCellText(pick('directionName')),
      universityContacts: parseCellText(pick('universityContacts')),
      comment: parseCellText(pick('comment')),
    };

    // Непустая ячейка, которую не удалось разобрать, — ошибка строки, а не
    // пустое поле. Прежде «31.02.2026», «три года» или незнакомый статус
    // молча превращались в пустое значение, строка импортировалась, и никто
    // не узнавал, что данные потерялись.
    const unreadable = (
      [
        ['licenseSignedAt', candidate.licenseSignedAt, 'ожидается дата ДД.ММ.ГГГГ'],
        ['licenseValidYears', candidate.licenseValidYears, 'ожидается число лет'],
        ['transferStatus', candidate.transferStatus, 'допустимо: не начата, в работе, передано, отказ'],
      ] as const
    ).find(([field, parsed]) => parsed === null && parseCellText(pick(field)) !== null);

    if (unreadable) {
      const [field, , expected] = unreadable;
      const columnName = Object.keys(mapping).find((key) => mapping[key] === field) ?? field;

      return {
        error: {
          rowNumber,
          columnName,
          errorCode: 'CRM-IMP-0002',
          message: `Значение «${parseCellText(pick(field))}» не распознано: ${expected}`,
          rawRow: raw,
        },
      };
    }

    const result = importRowSchema.safeParse(candidate);

    if (!result.success) {
      const issue = result.error.issues[0];
      const fieldKey = issue?.path[0];
      const columnName =
        Object.keys(mapping).find((key) => mapping[key] === fieldKey) ?? String(fieldKey ?? '');

      return {
        error: {
          rowNumber,
          columnName: columnName || null,
          errorCode: 'CRM-IMP-0002',
          message: issue?.message ?? 'Строка не прошла проверку',
          rawRow: raw,
        },
      };
    }

    return { row: { rowNumber, data: result.data, raw } };
  }
}

/**
 * Перебирает строки листа.
 *
 * eachRow пропускает пустые строки и не позволяет прервать обход,
 * поэтому обходим по номерам: так сохраняется контроль над лимитом строк
 * и корректно учитывается нумерация при выдаче ошибок пользователю.
 */
function* iterateRows(worksheet: ExcelJS.Worksheet): Generator<ExcelJS.Row> {
  const lastRow = worksheet.rowCount;

  for (let rowNumber = 1; rowNumber <= lastRow; rowNumber++) {
    yield worksheet.getRow(rowNumber);
  }
}

/** Извлекает значения ячеек строки в виде плотного массива. */
function extractRowValues(row: ExcelJS.Row): unknown[] {
  const values = row.values;

  if (Array.isArray(values)) {
    // ExcelJS нумерует колонки с единицы, поэтому нулевой элемент пуст.
    return values.slice(1);
  }

  return [];
}

/**
 * Формат распознаётся по сигнатуре файла, а не по расширению.
 *
 * Расширение — это пожелание отправителя: выгрузка из старой системы
 * регулярно приезжает как .xlsx, а современная книга — как .xls. Сигнатура
 * говорит о содержимом: D0 CF 11 E0 — составной документ OLE2, в котором
 * и лежит книга Excel 97-2003, а PK — обычный ZIP, то есть Office Open XML.
 */
export function isLegacyWorkbook(content: Buffer): boolean {
  const OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

  if (content.length < OLE2_SIGNATURE.length) {
    return false;
  }

  return OLE2_SIGNATURE.every((byte, index) => content[index] === byte);
}

/**
 * Строки книги Excel 97-2003 (BIFF8).
 *
 * Требование заказчика прозвучало прямо: файлы приходят и в старом формате,
 * «приходить оно может и так, и так». ExcelJS работает только с Office Open
 * XML и такой файл не открывает вовсе, поэтому для него взят отдельный
 * разборщик.
 *
 * Кодировка в BIFF8 хранится внутри самого файла: строки записаны либо
 * UTF-16, либо однобайтовой кодовой страницей, указанной в записи CODEPAGE.
 * Разбор опирается на неё, поэтому кириллица из выгрузок 2003 года читается
 * без догадок о кодировке и без «крякозябр», о которых говорил заказчик.
 */
function readLegacyRows(content: Buffer): SheetRow[] {
  const workbook = XLSX.read(content, {
    type: 'buffer',
    // Даты возвращаются объектами Date, а не серийными номерами: дальше
    // они попадают в общий разбор значений вместе с датами из xlsx.
    cellDates: true,
    // Форматирование и формулы не нужны: импортируются значения.
    cellNF: false,
    cellFormula: false,
    cellHTML: false,
  });

  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;

  if (!sheet) {
    return [];
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    // Пустые строки сохраняются: нумерация строк должна совпадать с той,
    // что видит пользователь в Excel, иначе отчёт об ошибках указывает
    // не на ту строку.
    blankrows: true,
    defval: null,
  });

  return rows.map((values, index) => ({
    number: index + 1,
    values: Array.isArray(values) ? values : [],
  }));
}

/** Строки книги Office Open XML. */
async function readOoxmlRows(content: Buffer): Promise<SheetRow[]> {
  // До ExcelJS: она распаковывает архив целиком, и ZIP-бомба в пару
  // мегабайт уронила бы процесс по памяти раньше любой проверки строк.
  assertSafeZip(content);

  const workbook = new ExcelJS.Workbook();
  // Приведение необходимо: типы ExcelJS объявляют параметр как Buffer
  // с иным тегом, чем Buffer из типов Node 24.
  await workbook.xlsx.load(content as unknown as ArrayBuffer);

  // Обрабатывается только первый лист: в файлах заказчика данные
  // лежат на первом, а остальные содержат справочники и пояснения.
  const worksheet = workbook.worksheets[0];

  if (!worksheet) {
    return [];
  }

  const rows: SheetRow[] = [];

  for (const row of iterateRows(worksheet)) {
    rows.push({ number: row.number, values: extractRowValues(row) });
  }

  return rows;
}

/**
 * Строки первого листа книги в любом из двух форматов — для загрузчиков
 * со своим составом колонок (каталог вендоров). Формат определяется
 * по сигнатуре, как и в мастере импорта.
 */
export async function readSheetRows(content: Buffer): Promise<SheetRow[]> {
  return isLegacyWorkbook(content) ? readLegacyRows(content) : readOoxmlRows(content);
}

/** Исходные значения строки — попадают в отчёт об ошибках. */
function buildRawRecord(headers: string[], values: unknown[]): Record<string, unknown> {
  const record: Record<string, unknown> = {};

  headers.forEach((header, index) => {
    if (header.length > 0) {
      record[header] = parseCellText(values[index]);
    }
  });

  return record;
}
