import { describe, expect, it } from 'vitest';
import {
  resolveFileType,
  resolveSpreadsheetType,
  sanitizeFileName,
} from '../../src/modules/files/file-validation.js';
import { AppException } from '../../src/common/errors/app-exception.js';

/**
 * Проверка загружаемых файлов.
 *
 * Ключевое свойство: решение принимается по сигнатуре содержимого,
 * а не по имени файла и не по заголовку Content-Type — и то, и другое
 * задаёт клиент.
 */
describe('определение типа файла', () => {
  it('принимает PDF, распознанный по сигнатуре', () => {
    const result = resolveFileType({ ext: 'pdf', mime: 'application/pdf' }, 'договор.pdf');

    expect(result).toEqual({ extension: 'pdf', mimeType: 'application/pdf' });
  });

  it('отвергает исполняемый файл, переименованный в разрешённое расширение', () => {
    // Классическая подмена: содержимое — исполняемый файл Windows,
    // имя — «отчёт.pdf». Проверка по расширению пропустила бы его.
    expect(() =>
      resolveFileType({ ext: 'exe', mime: 'application/x-msdownload' }, 'отчёт.pdf'),
    ).toThrow(AppException);
  });

  it('отвергает файл с неопознанной сигнатурой', () => {
    expect(() => resolveFileType(undefined, 'что-то.pdf')).toThrow(AppException);
  });

  it('уточняет формат контейнера OLE2 по расширению', () => {
    // .doc и .xls неразличимы по сигнатуре — оба являются контейнерами CFB.
    expect(resolveFileType({ ext: 'cfb', mime: 'application/x-cfb' }, 'акт.doc')).toEqual({
      extension: 'doc',
      mimeType: 'application/msword',
    });

    expect(resolveFileType({ ext: 'cfb', mime: 'application/x-cfb' }, 'реестр.xls')).toEqual({
      extension: 'xls',
      mimeType: 'application/vnd.ms-excel',
    });
  });

  it('не позволяет выдать контейнер OLE2 за другой формат', () => {
    expect(() =>
      resolveFileType({ ext: 'cfb', mime: 'application/x-cfb' }, 'картинка.png'),
    ).toThrow(AppException);
  });

  it('считает .jpeg равнозначным .jpg', () => {
    const result = resolveFileType({ ext: 'jpg', mime: 'image/jpeg' }, 'скан.jpeg');

    expect(result.extension).toBe('jpeg');
    expect(result.mimeType).toBe('image/jpeg');
  });
});

describe('проверка файла импорта', () => {
  it('принимает XLSX', () => {
    const result = resolveSpreadsheetType(
      { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      'вузы.xlsx',
    );

    expect(result.extension).toBe('xlsx');
  });

  it('принимает XLS как контейнер OLE2 с соответствующим расширением', () => {
    expect(
      resolveSpreadsheetType({ ext: 'cfb', mime: 'application/x-cfb' }, 'вузы.xls').extension,
    ).toBe('xls');
  });

  it('отвергает разрешённый для вложений, но не табличный формат', () => {
    // PDF допустим как вложение, но импорт разбирает только таблицы:
    // канал импорта у́же канала вложений, и это различие проверяется.
    expect(() =>
      resolveSpreadsheetType({ ext: 'pdf', mime: 'application/pdf' }, 'вузы.pdf'),
    ).toThrow(AppException);
  });

  it('отвергает архив, переименованный в .xlsx', () => {
    // XLSX сам является ZIP-архивом, поэтому проверка обязана опираться
    // на уточнённый тип, а не на принадлежность к семейству ZIP.
    expect(() =>
      resolveSpreadsheetType({ ext: 'zip', mime: 'application/zip' }, 'вузы.xlsx'),
    ).toThrow(AppException);
  });
});

describe('обеззараживание имени файла', () => {
  it('убирает элементы пути', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\Windows\\system32\\drivers\\etc\\hosts')).toBe('hosts');
  });

  it('убирает управляющие символы и кавычки, ломающие заголовок ответа', () => {
    const result = sanitizeFileName('отчёт"\r\nContent-Length: 0.pdf');

    expect(result).not.toContain('"');
    expect(result).not.toContain('\r');
    expect(result).not.toContain('\n');
  });

  it('подставляет имя по умолчанию, если после очистки ничего не осталось', () => {
    expect(sanitizeFileName('   ')).toBe('file');
  });

  it('ограничивает длину имени', () => {
    expect(sanitizeFileName('a'.repeat(400)).length).toBe(255);
  });
});
