import { addDays, startOfDayUtc } from '../../modules/planner/planner-dates.js';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Границы периода «с — по» для отбора по дате.
 *
 * Интерфейс передаёт даты из календаря — без времени. Прежде «по 31.12.2025»
 * превращалось в «не позже 31.12.2025 00:00 UTC», и последний день периода
 * выпадал почти целиком: заявка, заведённая 31 декабря днём, в отчёт за год
 * не попадала. К тому же граница считалась по UTC, а рабочий день
 * организации — московский, и три часа утра уходили в соседние сутки.
 *
 * Дата без времени — это календарный день в часовом поясе организации:
 * «с» — от его начала, «по» — до начала следующего дня (не включая).
 * Значение со временем берётся как есть.
 */
export function periodBounds(
  from: string | undefined,
  to: string | undefined,
  timeZone: string,
): { gte?: Date; lt?: Date; lte?: Date } {
  const bounds: { gte?: Date; lt?: Date; lte?: Date } = {};

  if (from) {
    bounds.gte = DATE_ONLY.test(from) ? startOfDayUtc(from, timeZone) : new Date(from);
  }

  if (to) {
    if (DATE_ONLY.test(to)) {
      bounds.lt = startOfDayUtc(addDays(to, 1), timeZone);
    } else {
      bounds.lte = new Date(to);
    }
  }

  return bounds;
}
