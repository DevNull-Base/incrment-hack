import { describe, expect, it } from 'vitest';
import { parseVendorSheet } from '../../src/modules/catalog/vendor-sheet.js';

/**
 * Таблица вендоров в том виде, в каком её ведёт заказчик: компания,
 * продукты перечислением в одной ячейке, контактное лицо, телефон числом
 * или строкой, способ связи свободным текстом. Контакты синтетические.
 */
function sheet(rows: unknown[][]) {
  return rows.map((values, index) => ({ number: index + 1, values }));
}

const HEADER = ['Компания', 'Продукт', 'ФИО', 'Телефон', 'Почта', 'Способ связи'];

describe('таблица вендоров', () => {
  it('сопоставляет колонки и разбирает строку заказчика', () => {
    const result = parseVendorSheet(
      sheet([
        HEADER,
        ['ООО «ТДата»', '«RT.DataLake», «RT.Warehouse»', 'смирнов пётр ильич', 79001234567, 'Smirnov.PI@Example.ru', 'Почта, Чат в ТГ'],
      ]),
    );

    expect(result.unmappedHeaders).toEqual([]);
    expect(result.mapping.vendorName).toBe('Компания');
    expect(result.rows[0]).toMatchObject({
      rowNumber: 2,
      vendorName: 'ООО «ТДата»',
      products: ['RT.DataLake', 'RT.Warehouse'],
      contact: {
        fullName: 'Смирнов Пётр Ильич',
        phone: '+79001234567',
        email: 'smirnov.pi@example.ru',
        channels: ['EMAIL', 'TELEGRAM'],
      },
      errors: [],
    });
  });

  it('заголовки с потерянными скобками и в другом порядке опознаются', () => {
    const result = parseVendorSheet(
      sheet([
        ['E-mail:', 'ФИО контактного лица', 'Вендор', 'Продукты', 'Номер телефона', 'Комментарий'],
        ['a@example.ru', 'Ким Анна', 'ПАО «Ростелеком»', 'RT.DataVision', '8 (900) 000-00-01', 'любой'],
      ]),
    );

    expect(result.mapping).toMatchObject({ email: 'E-mail:', contactName: 'ФИО контактного лица', vendorName: 'Вендор' });
    expect(result.unmappedHeaders).toEqual(['Комментарий']);
    expect(result.rows[0]?.contact?.phone).toBe('+79000000001');
  });

  it('пустые строки пропускаются, строка без компании отклоняется', () => {
    const result = parseVendorSheet(sheet([HEADER, [null, null, null], [null, 'Яга', 'Ким Анна']]));

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.errors).toContain('Не указана компания');
  });

  it('контакты без ФИО — отказ, неверный телефон — предупреждение', () => {
    const result = parseVendorSheet(
      sheet([
        HEADER,
        ['ООО «Базис»', 'Базис Dynamix', null, '+7 900 000-00-02', null, null],
        ['ООО «Базис»', 'Базис Dynamix', 'Ким Анна', '12-34', null, 'Голубиная почта'],
      ]),
    );

    expect(result.rows[0]?.errors.join(' ')).toContain('не указано ФИО');
    expect(result.rows[1]?.errors).toEqual([]);
    expect(result.rows[1]?.warnings.join(' ')).toContain('не распознан');
  });

  it('строка только с компанией и продуктами — без контакта и без ошибок', () => {
    const result = parseVendorSheet(sheet([HEADER, ['ООО «РТК ИТ»', 'Web3Gate, Аврора SDK, Нейрошлюз']]));

    expect(result.rows[0]).toMatchObject({
      contact: null,
      products: ['Web3Gate', 'Аврора SDK', 'Нейрошлюз'],
      errors: [],
    });
  });
});
