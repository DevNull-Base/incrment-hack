import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mask } from '../../src/modules/audit/audit.service.js';

const KEY = 'test-audit-mask-key-0123456789abcdef';

/**
 * Маскирование персональных данных в журнале аудита.
 *
 * Проверяется прежде всего обход массивов: именно в таком виде персональные
 * данные попадают в журнал чаще всего — список ответственных от вуза
 * приходит массивом объектов, и рекурсия, пропускающая массивы, оставляла бы
 * весь список в открытом виде.
 */
describe('маскирование персональных данных', () => {
  it('скрывает значение поля верхнего уровня', () => {
    const result = mask({ fullName: 'Иванов Иван Иванович' }, KEY);

    expect(result?.fullName).not.toContain('Иванов');
    expect(String(result?.fullName)).toMatch(/^\[скрыто:[0-9a-f]{8}\]$/);
  });

  it('скрывает персональные данные внутри массива объектов', () => {
    const result = mask({
      contacts: [
        { fullName: 'Петров Пётр', email: 'petrov@vuz.ru' },
        { fullName: 'Сидорова Анна', email: 'sidorova@vuz.ru' },
      ],
    }, KEY);

    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('Петров');
    expect(serialized).not.toContain('Сидорова');
    expect(serialized).not.toContain('@vuz.ru');
  });

  it('скрывает массив скалярных значений персонального поля', () => {
    const result = mask({ fullName: ['Иванов Иван', 'Петров Пётр'] }, KEY);

    expect(JSON.stringify(result)).not.toContain('Иванов');
    expect(JSON.stringify(result)).not.toContain('Петров');
  });

  it('скрывает данные на произвольной глубине вложенности', () => {
    const result = mask({
      engagement: { university: { contact: { phone: '+7 900 000-00-00' } } },
    }, KEY);

    expect(JSON.stringify(result)).not.toContain('900');
  });

  it('сохраняет непереслонные поля без изменений', () => {
    const result = mask({ universityId: 'u-1', rowCount: 42, isActive: true }, KEY);

    expect(result).toEqual({ universityId: 'u-1', rowCount: 42, isActive: true });
  });

  it('даёт одинаковый отпечаток для одинаковых значений', () => {
    // Свойство, ради которого используется хэш, а не постоянная заглушка:
    // по журналу видно, изменилось значение или осталось прежним,
    // а восстановить его нельзя.
    const first = mask({ email: 'a@b.ru' }, KEY);
    const second = mask({ email: 'a@b.ru' }, KEY);
    const third = mask({ email: 'c@d.ru' }, KEY);

    expect(first?.email).toBe(second?.email);
    expect(first?.email).not.toBe(third?.email);
  });

  it('отпечаток не подбирается по словарю без ключа', () => {
    // Прежде отпечаток был началом обычного SHA-256: любой, кто прочитал
    // журнал, вычислял его для словаря имён и находил совпадение.
    const name = 'Иванов Иван Иванович';
    const plain = createHash('sha256').update(name).digest('hex').slice(0, 8);

    expect(mask({ fullName: name }, KEY)?.fullName).not.toBe(`[скрыто:${plain}]`);
    expect(mask({ fullName: name }, KEY)?.fullName).not.toBe(mask({ fullName: name }, 'другой-ключ')?.fullName);
  });

  it('скрывает строку поиска в журнале доступа к ПДн', () => {
    const result = mask({ method: 'GET', query: { search: 'Петров', limit: '20' } }, KEY);

    expect(JSON.stringify(result)).not.toContain('Петров');
    expect((result?.query as Record<string, unknown>).limit).toBe('20');
  });

  it('обрабатывает отсутствующее состояние', () => {
    expect(mask(null, KEY)).toBeNull();
    expect(mask(undefined, KEY)).toBeNull();
  });
});
