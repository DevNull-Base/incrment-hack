import { AppException } from '../../../common/errors/app-exception.js';
import { parseCellText } from '../../import/import-fields.js';
import { readSheetRows } from '../../import/xls-parser.service.js';
import { resolveSpreadsheetType } from '../../files/file-validation.js';

/**
 * Читает файл оплат, загруженный вручную, и отдаёт записи в том виде,
 * в каком их принимает разбор оплат: массив объектов «поле — значение».
 *
 * Принимаются два вида файлов:
 *   • JSON — выгрузка сайта как есть (образец заказчика именно такой);
 *   • таблица XLSX/XLS с теми же полями в заголовке — оплаты нередко
 *     сводят в Excel перед передачей, и заставлять перекладывать их
 *     обратно в JSON незачем.
 */
export async function readPaymentFile(
  fileName: string,
  content: Buffer,
): Promise<{ raw: unknown; positions?: number[] }> {
  const text = decodeText(content);

  if (text !== null) {
    const trimmed = text.trimStart();

    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      return { raw: parseJson(trimmed) };
    }
  }

  const { fileTypeFromBuffer } = await import('file-type');
  const detected = await fileTypeFromBuffer(content);

  if (!detected && /\.json$/i.test(fileName)) {
    throw new AppException('MALFORMED_JSON', {
      detail: 'Файл назван .json, но не начинается с «[» или «{» — это не выгрузка оплат.',
    });
  }

  if (!detected && !/\.xlsx?$/i.test(fileName)) {
    throw new AppException('FILE_TYPE_NOT_ALLOWED', {
      detail: 'Оплаты принимаются файлом JSON (выгрузка сайта) либо таблицей XLSX/XLS.',
    });
  }

  resolveSpreadsheetType(detected, fileName);
  const rows = await sheetToRecords(content);

  // Для таблицы запись в отчёте называется номером строки Excel —
  // по нему её и будут искать в файле.
  return { raw: rows.map((row) => row.record), positions: rows.map((row) => row.rowNumber) };
}

/**
 * Текст файла, если это текст. Двоичные таблицы сюда не проходят:
 * нулевой байт в начале файла текстом не бывает.
 */
function decodeText(content: Buffer): string | null {
  const head = content.subarray(0, Math.min(content.length, 512));

  if (head.includes(0)) {
    return null;
  }

  // Метка порядка байтов — частый спутник выгрузок из Windows-программ;
  // JSON.parse на ней падает.
  return content.toString('utf8').replace(/^\uFEFF/, '');
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : 'ошибка разбора';

    throw new AppException('MALFORMED_JSON', {
      detail: `Файл оплат не является корректным JSON: ${reason}.`,
    });
  }
}

/**
 * Таблица → записи. Заголовок — первая непустая строка; пустые строки
 * пропускаются, а не превращаются в пустые записи: в таблицах их
 * оставляют для наглядности, и это не ошибка источника.
 */
async function sheetToRecords(
  content: Buffer,
): Promise<Array<{ rowNumber: number; record: Record<string, unknown> }>> {
  let rows;

  try {
    rows = await readSheetRows(content);
  } catch (error: unknown) {
    // Своё объяснение (например, о слишком большом архиве) не подменяется
    // общим «файл не читается».
    if (error instanceof AppException) throw error;
    throw new AppException('IMPORT_FILE_UNREADABLE');
  }

  const headerRow = rows.find((row) => row.values.some((value) => parseCellText(value) !== null));

  if (!headerRow) {
    return [];
  }

  const headers = headerRow.values.map((value) => parseCellText(value) ?? '');

  return rows
    .filter((row) => row.number > headerRow.number)
    .filter((row) => row.values.some((value) => parseCellText(value) !== null))
    .map((row) => {
      const record: Record<string, unknown> = {};

      headers.forEach((header, index) => {
        if (header.length > 0) {
          const value = row.values[index];
          // Числа сохраняются числами: телефон из Excel приходит именно так,
          // и разбор оплат умеет его принять.
          record[header] = typeof value === 'number' ? value : parseCellText(value);
        }
      });

      return { rowNumber: row.number, record };
    });
}
