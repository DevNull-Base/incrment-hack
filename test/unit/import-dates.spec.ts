import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseCellDate } from '../../src/modules/import/import-fields.js';
import { XlsParserService } from '../../src/modules/import/xls-parser.service.js';

type LoggerArg = ConstructorParameters<typeof XlsParserService>[0];

const iso = (value: unknown) => parseCellDate(value)?.toISOString().slice(0, 10) ?? null;

/**
 * Даты из таблиц.
 *
 * Прежде несуществующая дата молча переносилась на другую («31.02.2026» →
 * 3 марта), а любая строка или число превращались в дату («3» → 2001 или
 * 1900 год). Такие значения попадали в договоры и лицензии без единой ошибки.
 */
describe('разбор даты из ячейки', () => {
  it('русский и ISO-формат, двузначный год, время после даты', () => {
    expect(iso('15.03.2025')).toBe('2025-03-15');
    expect(iso('15/03/2025')).toBe('2025-03-15');
    expect(iso('15.03.25')).toBe('2025-03-15');
    expect(iso('15.03.2025 00:00:00')).toBe('2025-03-15');
    expect(iso('2025-03-15')).toBe('2025-03-15');
    expect(iso('29.02.2024')).toBe('2024-02-29');
  });

  it('несуществующая дата не переносится на соседнюю', () => {
    expect(iso('31.02.2026')).toBeNull();
    expect(iso('15.13.2026')).toBeNull();
    expect(iso('29.02.2025')).toBeNull();
    expect(iso('2026-02-30')).toBeNull();
  });

  it('произвольный текст и случайное число — не дата', () => {
    expect(iso('3')).toBeNull();
    expect(iso('скоро')).toBeNull();
    expect(iso('March 5')).toBeNull();
    expect(iso(3)).toBeNull();
    expect(iso(45000)).toBe('2023-03-15');
  });
});

describe('нераспознанное значение в строке импорта', () => {
  it('становится ошибкой строки с колонкой и исходным текстом', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Лист1');
    sheet.addRow(['ВУЗ', 'Дата подписания', 'Срок действия', 'Статус передачи']);
    sheet.addRow(['Московский тестовый университет', '31.02.2026', '3 года', 'Передано']);
    sheet.addRow(['Казанский тестовый университет', '15.03.2025', 'три года', 'Передано']);
    sheet.addRow(['Томский тестовый университет', '15.03.2025', '2', 'Может быть']);
    sheet.addRow(['Новосибирский тестовый университет', '15.03.2025', '3 года', 'в работе']);

    const logger = { setContext: () => undefined, error: () => undefined } as unknown as LoggerArg;
    const result = await new XlsParserService(logger).parse(Buffer.from(await workbook.xlsx.writeBuffer()));

    expect(result.rows.map((row) => row.data.universityName)).toEqual(['Новосибирский тестовый университет']);
    expect(result.errors.map((error) => [error.rowNumber, error.columnName, error.message])).toEqual([
      [2, 'Дата подписания', expect.stringContaining('«31.02.2026» не распознано')],
      [3, 'Срок действия', expect.stringContaining('«три года» не распознано')],
      [4, 'Статус передачи', expect.stringContaining('«Может быть» не распознано')],
    ]);
  });
});
