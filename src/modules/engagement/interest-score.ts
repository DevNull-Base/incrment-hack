import type { InterestLevel } from '../../generated/prisma/enums.js';

/** Вес оценки в индексе заинтересованности. */
const LEVEL_WEIGHT: Record<InterestLevel, number> = {
  HIGH: 100,
  MEDIUM: 50,
  LOW: 0,
};

/** Строка группировки из базы: группа, оценка и число заявок. */
export interface InterestGroupCount {
  key: string | null;
  level: InterestLevel | null;
  count: number;
}

export interface InterestRow {
  id: string | null;
  name: string;
  total: number;
  rated: number;
  high: number;
  medium: number;
  low: number;
  unrated: number;
  score: number | null;
}

/**
 * Сводит оценки заинтересованности в рейтинг.
 *
 * Техническое задание требует ранжировать программы по востребованности,
 * а заказчик на сессии разрешил вместо формулы ручную оценку КАМа. Индекс —
 * средняя оценка по заявкам группы, где высокая заинтересованность стоит 100,
 * средняя 50, низкая 0. Формула намеренно простая: её можно объяснить
 * руководителю одной фразой и перепроверить в таблице.
 *
 * Заявки без оценки в индекс не входят, но показываются отдельным числом:
 * «высокий интерес у одного вуза из двадцати» и «у единственного
 * оценённого» — разные ситуации, и различать их должен читающий рейтинг.
 */
export function summarizeInterest(
  groups: readonly InterestGroupCount[],
  nameOf: (key: string | null) => string,
): InterestRow[] {
  const rows = new Map<string | null, InterestRow>();

  for (const group of groups) {
    const row = rows.get(group.key) ?? {
      id: group.key,
      name: nameOf(group.key),
      total: 0,
      rated: 0,
      high: 0,
      medium: 0,
      low: 0,
      unrated: 0,
      score: null,
    };

    row.total += group.count;

    switch (group.level) {
      case 'HIGH':
        row.high += group.count;
        break;
      case 'MEDIUM':
        row.medium += group.count;
        break;
      case 'LOW':
        row.low += group.count;
        break;
      default:
        row.unrated += group.count;
    }

    rows.set(group.key, row);
  }

  for (const row of rows.values()) {
    row.rated = row.high + row.medium + row.low;
    row.score =
      row.rated === 0
        ? null
        : Math.round(
            (row.high * LEVEL_WEIGHT.HIGH + row.medium * LEVEL_WEIGHT.MEDIUM + row.low * LEVEL_WEIGHT.LOW) /
              row.rated,
          );
  }

  return [...rows.values()].sort(compareRows);
}

/**
 * Порядок рейтинга: выше индекс — выше строка; при равном индексе выше та,
 * где больше заявок с высокой оценкой, затем больше заявок вообще. Группы
 * без оценок идут последними: поставить их выше оценённых значило бы
 * выдать отсутствие данных за результат.
 */
function compareRows(left: InterestRow, right: InterestRow): number {
  if (left.score === null && right.score !== null) return 1;
  if (left.score !== null && right.score === null) return -1;

  return (
    (right.score ?? 0) - (left.score ?? 0) ||
    right.high - left.high ||
    right.total - left.total ||
    left.name.localeCompare(right.name, 'ru')
  );
}
