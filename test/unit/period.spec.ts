import { describe, expect, it } from 'vitest';
import { periodBounds } from '../../src/common/utils/period.js';

/**
 * Границы периода отчёта и списков.
 *
 * «По 31.12.2025» прежде означало «не позже 31.12.2025 00:00 UTC», и заявки,
 * заведённые в последний день периода, в отчёт не попадали.
 */
describe('границы периода', () => {
  it('последний день периода входит целиком — по московскому времени', () => {
    const bounds = periodBounds('2025-01-01', '2025-12-31', 'Europe/Moscow');

    expect(bounds.gte?.toISOString()).toBe('2024-12-31T21:00:00.000Z');
    expect(bounds.lt?.toISOString()).toBe('2025-12-31T21:00:00.000Z');
    expect(bounds.lte).toBeUndefined();
  });

  it('заявка, заведённая 31 декабря днём, в период попадает', () => {
    const bounds = periodBounds(undefined, '2025-12-31', 'Europe/Moscow');
    const createdAt = new Date('2025-12-31T12:00:00Z');

    expect(createdAt < (bounds.lt as Date)).toBe(true);
  });

  it('значение со временем берётся как есть', () => {
    const bounds = periodBounds('2025-01-01T10:00:00Z', '2025-01-02T10:00:00Z', 'Europe/Moscow');

    expect(bounds.gte?.toISOString()).toBe('2025-01-01T10:00:00.000Z');
    expect(bounds.lte?.toISOString()).toBe('2025-01-02T10:00:00.000Z');
    expect(bounds.lt).toBeUndefined();
  });

  it('пустые границы — пустой отбор', () => {
    expect(periodBounds(undefined, undefined, 'Europe/Moscow')).toEqual({});
  });
});
