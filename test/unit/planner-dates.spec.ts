import { describe, expect, it } from 'vitest';
import {
  addDays,
  dateFromDb,
  dateInZone,
  dateToDb,
  daysInclusive,
  isCalendarDate,
  isClockTime,
  isTaskOverdue,
  startOfDayUtc,
  timeInZone,
  zonedToUtc,
} from '../../src/modules/planner/planner-dates.js';

/**
 * Даты задач в часовом поясе организации.
 *
 * Ошибка здесь не падает, а сдвигает задачи: «звонок в 15:00» уезжает
 * на 18:00, задача на 30-е оказывается в календаре 29-го, а просрочка
 * наступает в три часа ночи вместо полуночи.
 */

const MOSCOW = 'Europe/Moscow';

describe('проверка ввода', () => {
  it('принимает существующие даты и отклоняет несуществующие', () => {
    expect(isCalendarDate('2026-09-30')).toBe(true);
    expect(isCalendarDate('2028-02-29')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(isCalendarDate('30.09.2026')).toBe(false);
  });

  it('принимает время в 24-часовом формате', () => {
    expect(isClockTime('00:00')).toBe(true);
    expect(isClockTime('23:59')).toBe(true);
    expect(isClockTime('24:00')).toBe(false);
    expect(isClockTime('9:00')).toBe(false);
  });
});

describe('перевод между местным временем и UTC', () => {
  it('15:00 по Москве — это 12:00 UTC', () => {
    expect(zonedToUtc('2026-09-30', '15:00', MOSCOW).toISOString()).toBe('2026-09-30T12:00:00.000Z');
  });

  it('раннее утро по Москве — ещё предыдущий день по UTC', () => {
    expect(zonedToUtc('2026-10-01', '01:30', MOSCOW).toISOString()).toBe('2026-09-30T22:30:00.000Z');
  });

  it('обратный перевод даёт тот же местный день и время', () => {
    const instant = zonedToUtc('2026-12-31', '23:45', MOSCOW);

    expect(dateInZone(instant, MOSCOW)).toBe('2026-12-31');
    expect(timeInZone(instant, MOSCOW)).toBe('23:45');
  });

  it('учитывает переход на летнее время там, где он есть', () => {
    // В Берлине 29 марта 2026 года часы переводятся вперёд: 10:00 уже летнее
    // время (UTC+2), а 28 марта — ещё зимнее (UTC+1).
    expect(zonedToUtc('2026-03-29', '10:00', 'Europe/Berlin').toISOString()).toBe('2026-03-29T08:00:00.000Z');
    expect(zonedToUtc('2026-03-28', '10:00', 'Europe/Berlin').toISOString()).toBe('2026-03-28T09:00:00.000Z');
  });

  it('начало местного дня', () => {
    expect(startOfDayUtc('2026-09-30', MOSCOW).toISOString()).toBe('2026-09-29T21:00:00.000Z');
  });

  it('календарный день определяется по местному времени, а не по UTC', () => {
    // 22:30 UTC 30 сентября — в Москве уже 1 октября.
    expect(dateInZone(new Date('2026-09-30T22:30:00Z'), MOSCOW)).toBe('2026-10-01');
  });
});

describe('арифметика дат', () => {
  it('сдвиг через границу месяца и года', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('число дней считается включительно', () => {
    expect(daysInclusive('2026-09-01', '2026-09-30')).toBe(30);
    expect(daysInclusive('2026-09-30', '2026-09-30')).toBe(1);
    expect(daysInclusive('2026-09-30', '2026-09-01')).toBeLessThan(1);
  });

  it('колонка DATE не сдвигает день', () => {
    expect(dateFromDb(dateToDb('2026-09-30'))).toBe('2026-09-30');
  });
});

describe('просрочка задачи', () => {
  const now = new Date('2026-09-30T20:30:00Z'); // 23:30 по Москве

  it('задача на весь день не просрочена до конца своего дня', () => {
    expect(isTaskOverdue({ dueDate: '2026-09-30', dueAt: null, completedAt: null }, now, MOSCOW)).toBe(false);
  });

  it('задача на весь день просрочена со следующего местного дня', () => {
    const afterMidnight = new Date('2026-09-30T21:30:00Z'); // 00:30 1 октября по Москве

    expect(
      isTaskOverdue({ dueDate: '2026-09-30', dueAt: null, completedAt: null }, afterMidnight, MOSCOW),
    ).toBe(true);
  });

  it('задача на время просрочена с наступлением этого момента', () => {
    const dueAt = zonedToUtc('2026-09-30', '15:00', MOSCOW);

    expect(isTaskOverdue({ dueDate: '2026-09-30', dueAt, completedAt: null }, now, MOSCOW)).toBe(true);
  });

  it('выполненная задача не просрочена никогда', () => {
    expect(
      isTaskOverdue({ dueDate: '2026-01-01', dueAt: null, completedAt: new Date('2026-01-05') }, now, MOSCOW),
    ).toBe(false);
  });
});
