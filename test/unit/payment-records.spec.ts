import { describe, expect, it } from 'vitest';
import {
  checkOrderDate,
  parsePaymentRecords,
  parseStream,
} from '../../src/modules/integration/payments/payment-records.js';

/**
 * Разбор оплат с сайта.
 *
 * Записи синтетические, но устроены так же, как образец заказчика: русские
 * ключи, пустой элемент в начале массива, телефон строкой со скобками,
 * поток числом, номера заказов с невозможной датой и с лишней цифрой.
 */

const NOW = new Date('2026-09-25T12:00:00Z');

function payment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    'Номер заявки': 'ORD-20260512093015-QWERTY',
    Курс: 'Инженер-тестировщик',
    Фамилия: 'Сидоренко',
    Имя: 'Олег',
    Отчество: 'Павлович',
    Телефон: '7 (900) 555-44-33',
    Email: 'sidorenko.op@example.ru',
    'Номер потока': 2,
    ...overrides,
  };
}

describe('разбор оплат', () => {
  it('принимает запись в формате сайта и приводит контакты к единому виду', () => {
    const { records, rejected } = parsePaymentRecords([payment()]);

    expect(rejected).toEqual([]);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      position: 1,
      orderNumber: 'ORD-20260512093015-QWERTY',
      course: 'Инженер-тестировщик',
      fullName: 'Сидоренко Олег Павлович',
      phone: '+79005554433',
      email: 'sidorenko.op@example.ru',
      stream: '2',
    });
  });

  it('пустой элемент отклоняется, остальные записи принимаются', () => {
    const { records, rejected, total } = parsePaymentRecords([null, payment()]);

    expect(total).toBe(2);
    expect(records).toHaveLength(1);
    expect(records[0]?.position).toBe(2);
    expect(rejected).toEqual([{ position: 1, orderNumber: null, fullName: null, reasons: ['Пустая запись'] }]);
  });

  it('номер с невозможной датой и с лишней цифрой принимается с предупреждением', () => {
    const { records } = parsePaymentRecords([
      payment({ 'Номер заявки': 'ORD-20261721184559-ABCDEF' }),
      payment({ 'Номер заявки': 'ORD-202605130654453-GHIJKL', Email: 'other@example.ru' }),
    ]);

    expect(records).toHaveLength(2);
    expect(records[0]?.orderNumber).toBe('ORD-20261721184559-ABCDEF');
    expect(records[0]?.warnings.join(' ')).toContain('некорректная дата');
    expect(records[1]?.warnings.join(' ')).toContain('нестандартной длины');
  });

  it('ФИО в любом регистре и одной строкой', () => {
    const { records } = parsePaymentRecords([
      { 'Номер заявки': 'A-1', Курс: 'Курс', Фамилия: 'ИВАНОВА', Имя: 'мария', Телефон: '89001112233' },
      { order: 'A-2', course: 'Курс', 'Full name': 'петров-водкин кузьма сергеевич', email: 'KPV@Example.RU' },
    ]);

    expect(records[0]?.fullName).toBe('Иванова Мария');
    expect(records[0]?.middleName).toBeNull();
    expect(records[1]?.fullName).toBe('Петров-Водкин Кузьма Сергеевич');
    expect(records[1]?.email).toBe('kpv@example.ru');
  });

  it('ключи с другим регистром, пробелами и дефисами опознаются', () => {
    const { records } = parsePaymentRecords([
      { ' номер  заявки ': 'B-1', 'КУРС': 'Курс', 'фамилия': 'Орлова', 'имя': 'Вера', 'E-mail': 'orlova@example.ru' },
    ]);

    expect(records[0]).toMatchObject({ orderNumber: 'B-1', email: 'orlova@example.ru' });
  });

  it('без почты — принимается с предупреждением, без почты и телефона — отклоняется', () => {
    const { records, rejected } = parsePaymentRecords([
      payment({ Email: null }),
      payment({ 'Номер заявки': 'ORD-2', Email: '', Телефон: 'нет' }),
    ]);

    expect(records).toHaveLength(1);
    expect(records[0]?.warnings.join(' ')).toContain('Нет почты');
    expect(rejected[0]?.reasons.join(' ')).toContain('Нет ни телефона, ни почты');
  });

  it('повтор заказа в одной пачке отклоняется со ссылкой на первую запись', () => {
    const { records, rejected } = parsePaymentRecords([payment(), payment()]);

    expect(records).toHaveLength(1);
    expect(rejected[0]?.reasons[0]).toContain('уже есть в записи №1');
  });

  it('без номера, курса или фамилии — отказ с перечнем причин', () => {
    const { rejected } = parsePaymentRecords([{ Телефон: '+7 900 000-00-00' }]);

    expect(rejected[0]?.reasons).toEqual([
      'Не указан номер заявки',
      'Не указан курс',
      'Не указаны фамилия и имя',
    ]);
  });

  it('принимает одну запись и обёртку с массивом', () => {
    expect(parsePaymentRecords(payment()).records).toHaveLength(1);
    expect(parsePaymentRecords({ data: [payment()] }).records).toHaveLength(1);
    expect(parsePaymentRecords({ payments: [payment(), null] }).total).toBe(2);
    expect(parsePaymentRecords('мусор').total).toBe(0);
  });

  it('номер строки таблицы вместо порядкового номера', () => {
    const { records } = parsePaymentRecords([payment()], { positions: [7] });
    expect(records[0]?.position).toBe(7);
  });
});

describe('дата в номере заказа', () => {
  it('корректный номер — без замечаний', () => {
    expect(checkOrderDate('ORD-20260512093015-QWERTY', NOW)).toBeNull();
  });

  it('невозможные месяц, день и время', () => {
    expect(checkOrderDate('ORD-20261721184559-X', NOW)).toContain('некорректная дата');
    expect(checkOrderDate('ORD-20260231120000-X', NOW)).toContain('некорректная дата');
    expect(checkOrderDate('ORD-20260512256000-X', NOW)).toContain('некорректное время');
  });

  it('дата из будущего', () => {
    expect(checkOrderDate('ORD-20270101120000-X', NOW)).toContain('ещё не наступила');
  });

  it('номер другого вида не проверяется', () => {
    expect(checkOrderDate('12345', NOW)).toBeNull();
  });
});

describe('поток', () => {
  it('числом, строкой и с подписью', () => {
    expect(parseStream(3)).toBe('3');
    expect(parseStream('03')).toBe('3');
    expect(parseStream('Поток №4')).toBe('4');
    expect(parseStream('весенний')).toBe('весенний');
    expect(parseStream(null)).toBeNull();
  });
});
