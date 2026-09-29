import { describe, expect, it } from 'vitest';
import { summarizeInterest } from '../../src/modules/engagement/interest-score.js';

/**
 * Рейтинг заинтересованности.
 *
 * По нему руководитель решает, в какие программы вкладываться дальше, —
 * ошибка в порядке строк означала бы неверный вывод при правильных данных.
 */

const names: Record<string, string> = { devops: 'DevOps', qa: 'QA', data: 'Аналитика данных' };
const nameOf = (key: string | null) => (key === null ? 'Не указано' : (names[key] ?? key));

describe('индекс заинтересованности', () => {
  it('считается средним по оценённым заявкам: высокая 100, средняя 50, низкая 0', () => {
    const [row] = summarizeInterest(
      [
        { key: 'devops', level: 'HIGH', count: 2 },
        { key: 'devops', level: 'MEDIUM', count: 1 },
        { key: 'devops', level: 'LOW', count: 1 },
      ],
      nameOf,
    );

    expect(row).toMatchObject({ name: 'DevOps', total: 4, rated: 4, high: 2, medium: 1, low: 1, score: 63 });
  });

  it('заявки без оценки не тянут индекс вниз, но учитываются отдельно', () => {
    const [row] = summarizeInterest(
      [
        { key: 'qa', level: 'HIGH', count: 1 },
        { key: 'qa', level: null, count: 19 },
      ],
      nameOf,
    );

    expect(row).toMatchObject({ total: 20, rated: 1, unrated: 19, score: 100 });
  });

  it('группа без единой оценки получает пустой индекс, а не ноль', () => {
    const [row] = summarizeInterest([{ key: 'data', level: null, count: 5 }], nameOf);

    expect(row?.score).toBeNull();
  });
});

describe('порядок рейтинга', () => {
  it('выше индекс — выше строка; группы без оценок — последними', () => {
    const rows = summarizeInterest(
      [
        { key: 'data', level: null, count: 30 },
        { key: 'qa', level: 'MEDIUM', count: 3 },
        { key: 'devops', level: 'HIGH', count: 1 },
      ],
      nameOf,
    );

    expect(rows.map((row) => row.id)).toEqual(['devops', 'qa', 'data']);
  });

  it('при равном индексе выше та группа, где больше высоких оценок', () => {
    const rows = summarizeInterest(
      [
        { key: 'qa', level: 'HIGH', count: 1 },
        { key: 'devops', level: 'HIGH', count: 4 },
      ],
      nameOf,
    );

    expect(rows.map((row) => row.id)).toEqual(['devops', 'qa']);
  });

  it('заявки без значения разреза собираются в одну группу с понятной подписью', () => {
    const rows = summarizeInterest(
      [
        { key: null, level: 'LOW', count: 2 },
        { key: null, level: null, count: 1 },
      ],
      nameOf,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: null, name: 'Не указано', total: 3, score: 0 });
  });
});
