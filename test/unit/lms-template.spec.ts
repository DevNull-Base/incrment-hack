import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  LMS_EDUCATION_LEVELS,
  LMS_TEMPLATE_HEADERS,
  buildLmsWorkbook,
  splitFullName,
} from '../../src/modules/integration/lms-export/lms-template.js';

/** Файл загрузки в LMS должен совпадать с шаблоном заказчика. */
describe('шаблон загрузки в LMS', () => {
  it('30 колонок, заголовки как в шаблоне заказчика — включая потерянные скобки', () => {
    expect(LMS_TEMPLATE_HEADERS).toHaveLength(30);
    expect(LMS_TEMPLATE_HEADERS.slice(0, 5)).toEqual([
      'Фамилия',
      'Имя',
      'Отчествопри наличии)',
      'Номер телефона',
      'Email',
    ]);
  });

  it('заполняет пять колонок, телефон числом, справочники на втором листе', async () => {
    const buffer = await buildLmsWorkbook([
      { lastName: 'Сидоренко', firstName: 'Олег', middleName: 'Павлович', phone: '+79005554433', email: 'so@example.ru' },
      { lastName: 'Орлова', firstName: 'Вера', middleName: null, phone: null, email: 'vo@example.ru' },
    ]);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

    const sheet = workbook.getWorksheet('Лист1');
    const dictionaries = workbook.getWorksheet('Лист2');

    expect(sheet?.getRow(1).getCell(3).value).toBe('Отчествопри наличии)');
    expect(sheet?.getRow(2).getCell(1).value).toBe('Сидоренко');
    expect(sheet?.getRow(2).getCell(4).value).toBe(79005554433);
    expect(sheet?.getRow(2).getCell(5).value).toBe('so@example.ru');
    expect(sheet?.getRow(2).getCell(6).value).toBeNull();
    expect(sheet?.getRow(3).getCell(3).value).toBe('');
    expect(sheet?.getRow(3).getCell(4).value).toBe('');

    expect(dictionaries?.getCell(2, 1).value).toBe('Ж');
    expect(dictionaries?.getCell(LMS_EDUCATION_LEVELS.length, 2).value).toBe(
      'Высшее образование – подготовка кадров высшей квалификации',
    );
    expect(sheet?.getCell(2, 12).dataValidation?.type).toBe('list');
  });
});

describe('ФИО по частям', () => {
  it('фамилия, имя и отчество — в том числе составное', () => {
    expect(splitFullName('Сидоренко Олег Павлович')).toEqual({
      lastName: 'Сидоренко',
      firstName: 'Олег',
      middleName: 'Павлович',
    });
    expect(splitFullName('Мамедов  Эльдар Рашид оглы')?.middleName).toBe('Рашид оглы');
    expect(splitFullName('Орлова Вера')?.middleName).toBeNull();
  });

  it('одно слово — не делится', () => {
    expect(splitFullName('Орлова')).toBeNull();
  });
});
