import { describe, expect, it } from 'vitest';
import {
  headerKey,
  joinFullName,
  normalizeEmail,
  normalizeNamePart,
  normalizePhone,
  organizationKey,
  parseContactChannels,
  phoneDigits,
  splitNameList,
  titleKey,
} from '../../src/common/utils/contact-normalization.js';

/**
 * Нормализация контактных данных.
 *
 * Примеры взяты из образцов заказчика: один и тот же человек записан
 * в разных файлах по-разному, и сопоставить оплату со слушателем можно
 * только после приведения к общему виду.
 */

describe('телефон', () => {
  it('одинаков в любой записи из образцов заказчика', () => {
    // В оплатах — строкой со скобками, в шаблоне LMS — числом.
    expect(normalizePhone('7 (900) 111-22-33')).toBe('+79001112233');
    expect(normalizePhone(79001112233)).toBe('+79001112233');
  });

  it('понимает восьмёрку, плюс, десять цифр и добавочный', () => {
    expect(normalizePhone('8 900 111 22 33')).toBe('+79001112233');
    expect(normalizePhone('+7-900-111-22-33')).toBe('+79001112233');
    expect(normalizePhone('9001112233')).toBe('+79001112233');
    expect(normalizePhone('+7 (900) 111-22-33 доб. 123')).toBe('+79001112233');
  });

  it('номер неверной длины не угадывается, а отклоняется', () => {
    expect(normalizePhone('7 (900) 111-22')).toBeNull();
    expect(normalizePhone('+1 202 555 0147')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });

  it('для шаблона LMS — цифрами без плюса', () => {
    expect(phoneDigits('+79001112233')).toBe('79001112233');
    expect(phoneDigits(null)).toBeNull();
  });
});

describe('почта', () => {
  it('приводится к нижнему регистру без мусора копирования', () => {
    expect(normalizeEmail('  Sidorenko.OP@Example.ru ')).toBe('sidorenko.op@example.ru');
    expect(normalizeEmail('mailto:PETROVA_AA@example.ru')).toBe('petrova_aa@example.ru');
    expect(normalizeEmail('<orlov.vv@example.ru>.')).toBe('orlov.vv@example.ru');
  });

  it('некорректный адрес отклоняется', () => {
    expect(normalizeEmail('ivanov@')).toBeNull();
    expect(normalizeEmail('не указан')).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
  });
});

describe('ФИО', () => {
  it('регистр исправляется у записи целиком строчными или заглавными', () => {
    expect(normalizeNamePart('сидоренко')).toBe('Сидоренко');
    expect(normalizeNamePart('  ИВАНОВ  ')).toBe('Иванов');
    expect(normalizeNamePart('римская-корсакова')).toBe('Римская-Корсакова');
  });

  it('смешанный регистр не трогается', () => {
    expect(normalizeNamePart('МакКензи')).toBe('МакКензи');
  });

  it('пустая часть отбрасывается, отчество необязательно', () => {
    expect(normalizeNamePart('   ')).toBeNull();
    expect(joinFullName(['Сидоренко', 'Олег', null])).toBe('Сидоренко Олег');
  });
});

describe('организации и наименования', () => {
  it('организационно-правовая форма и кавычки не мешают сопоставлению', () => {
    expect(organizationKey('ПАО «Ростелеком»')).toBe(organizationKey('Ростелеком'));
    expect(organizationKey('ООО "РТК ИТ Плюс"')).toBe(organizationKey('РТК ИТ Плюс'));
    expect(organizationKey('ООО «РТК ИТ»')).not.toBe(organizationKey('ООО «РТК ИТ Плюс»'));
  });

  it('несколько продуктов в одной ячейке разделяются, кавычки снимаются', () => {
    expect(splitNameList('«RT.DataLake», «RT.Warehouse»')).toEqual(['RT.DataLake', 'RT.Warehouse']);
    expect(splitNameList('«Базис Dynamix»')).toEqual(['Базис Dynamix']);
    expect(splitNameList('«Продукт, версия 2»; Другой')).toEqual(['Продукт, версия 2', 'Другой']);
    expect(splitNameList('«A», «a»')).toEqual(['A']);
  });

  it('название курса сравнивается без кавычек и регистра', () => {
    expect(titleKey('Управление ИТ-проектами на базе программного продукта ПАО «Ростелеком»')).toBe(
      titleKey('управление ИТ-проектами на базе программного продукта ПАО "Ростелеком"'),
    );
  });
});

describe('способы связи', () => {
  it('распознаются записи из образца заказчика', () => {
    expect(parseContactChannels('Почта, Чат в ТГ')).toEqual({ channels: ['EMAIL', 'TELEGRAM'], unknown: [] });
    expect(parseContactChannels('Чат в ТГ').channels).toEqual(['TELEGRAM']);
  });

  it('прочие записи и нераспознанное', () => {
    expect(parseContactChannels('telegram; звонок; MAX').channels).toEqual(['TELEGRAM', 'PHONE', 'MAX']);
    expect(parseContactChannels('голубиная почта').channels).toEqual(['EMAIL']);
    expect(parseContactChannels('факс').unknown).toEqual(['факс']);
  });
});

describe('заголовки таблиц', () => {
  it('потерянные скобки не мешают сопоставлению', () => {
    // Так заголовок пришёл в шаблоне заказчика.
    expect(headerKey('Отчествопри наличии)')).toBe(headerKey('Отчество (при наличии)'));
    expect(headerKey('Имядательный падеж)')).toBe(headerKey('Имя (дательный падеж)'));
    expect(headerKey('E-mail')).toBe(headerKey('email'));
  });
});
