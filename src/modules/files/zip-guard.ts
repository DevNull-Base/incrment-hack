import { inflateRawSync } from 'node:zlib';
import { AppException } from '../../common/errors/app-exception.js';

export interface ZipLimits {
  /** Сколько байт архив может занять после распаковки — суммарно. */
  maxTotalBytes: number;
  /** Сколько записей допускается в архиве. */
  maxEntries: number;
}

/**
 * Пределы для книг Excel. Лист в 100 тыс. строк — предел импорта — это
 * порядка сотни мегабайт XML; всё, что раскрывается больше, либо не пройдёт
 * импорт по числу строк, либо собрано нарочно.
 */
export const WORKBOOK_ZIP_LIMITS: ZipLimits = {
  maxTotalBytes: 200 * 1024 * 1024,
  maxEntries: 5_000,
};

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/**
 * Проверяет, что ZIP-архив (XLSX, DOCX) не раскрывается в неподъёмный объём.
 *
 * Книгу Excel разбирает ExcelJS, и распаковывает она её целиком в память.
 * Архив в пару мегабайт из повторяющихся байтов раскрывается в гигабайты
 * («ZIP-бомба»), и процесс падает по нехватке памяти — вместе со всеми, кто
 * в этот момент работает в системе. Антивирус такие файлы не отсекает:
 * вредоносного кода в них нет.
 *
 * Объявленным в архиве размерам верить нельзя — их пишет тот же, кто
 * собирал архив. Поэтому каждая запись действительно распаковывается, но
 * с потолком: zlib прерывает распаковку, как только результат превышает
 * оставшийся запас, и память под весь объём не выделяется.
 */
export function assertSafeZip(content: Buffer, limits: ZipLimits = WORKBOOK_ZIP_LIMITS): void {
  const entries = readCentralDirectory(content);

  if (entries.length > limits.maxEntries) {
    throw tooLarge(`В архиве книги ${entries.length} записей — больше допустимого`);
  }

  let remaining = limits.maxTotalBytes;

  for (const entry of entries) {
    const data = entryData(content, entry);
    let size: number;

    if (entry.method === 0) {
      size = data.length;
    } else if (entry.method === 8) {
      try {
        size = inflateRawSync(data, { maxOutputLength: remaining + 1 }).length;
      } catch (error: unknown) {
        if (error instanceof RangeError || (error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') {
          throw tooLarge('Книга раскрывается в слишком большой объём');
        }
        throw unreadable('Архив книги повреждён');
      }
    } else {
      throw unreadable(`Неизвестный способ сжатия в архиве книги (${entry.method})`);
    }

    remaining -= size;

    if (remaining < 0) {
      throw tooLarge('Книга раскрывается в слишком большой объём');
    }
  }
}

interface CentralEntry {
  method: number;
  compressedSize: number;
  localOffset: number;
}

function readCentralDirectory(content: Buffer): CentralEntry[] {
  const eocd = findEndOfCentralDirectory(content);
  const total = content.readUInt16LE(eocd + 10);
  const directoryOffset = content.readUInt32LE(eocd + 16);

  // Отметки ZIP64: для книги Excel такого объёма не бывает.
  if (total === 0xffff || directoryOffset === 0xffffffff) {
    throw tooLarge('Архив книги слишком велик');
  }

  const entries: CentralEntry[] = [];
  let offset = directoryOffset;

  for (let index = 0; index < total; index++) {
    if (offset + 46 > content.length || content.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw unreadable('Оглавление архива книги повреждено');
    }

    const compressedSize = content.readUInt32LE(offset + 20);
    const localOffset = content.readUInt32LE(offset + 42);

    if (compressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw tooLarge('Архив книги слишком велик');
    }

    entries.push({ method: content.readUInt16LE(offset + 10), compressedSize, localOffset });

    offset +=
      46 +
      content.readUInt16LE(offset + 28) +
      content.readUInt16LE(offset + 30) +
      content.readUInt16LE(offset + 32);
  }

  return entries;
}

function findEndOfCentralDirectory(content: Buffer): number {
  // Запись в конце архива; за ней может идти комментарий до 64 КБ.
  const lowest = Math.max(0, content.length - 22 - 0xffff);

  for (let offset = content.length - 22; offset >= lowest; offset--) {
    if (content.readUInt32LE(offset) === EOCD_SIGNATURE) {
      return offset;
    }
  }

  throw unreadable('Файл не является архивом книги Excel');
}

function entryData(content: Buffer, entry: CentralEntry): Buffer {
  const header = entry.localOffset;

  if (header + 30 > content.length || content.readUInt32LE(header) !== LOCAL_SIGNATURE) {
    throw unreadable('Запись архива книги повреждена');
  }

  const start = header + 30 + content.readUInt16LE(header + 26) + content.readUInt16LE(header + 28);
  const end = start + entry.compressedSize;

  if (end > content.length) {
    throw unreadable('Запись архива книги обрезана');
  }

  return content.subarray(start, end);
}

function tooLarge(detail: string): AppException {
  return new AppException('IMPORT_FILE_UNREADABLE', {
    detail: `${detail}. Сохраните таблицу заново или разделите её на части.`,
  });
}

function unreadable(detail: string): AppException {
  return new AppException('IMPORT_FILE_UNREADABLE', { detail: `${detail}.` });
}
