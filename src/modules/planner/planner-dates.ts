/**
 * Календарные даты в часовом поясе организации.
 *
 * Задача привязана к дню, а день — понятие местное: в полночь по UTC
 * в Москве уже три часа утра, а во Владивостоке десять. Поэтому дата
 * задачи хранится календарным днём без времени, точное время — моментом
 * в UTC, а переводы между ними выполняются здесь, в одном месте.
 *
 * Сторонней библиотеки часовых поясов в проекте нет, и она не нужна:
 * база IANA встроена в Node.js и доступна через Intl.
 */

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Проверяет, что строка — существующая дата YYYY-MM-DD (не 2026-02-30). */
export function isCalendarDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);

  if (!match) {
    return false;
  }

  const [, year, month, day] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Проверяет время HH:mm в 24-часовом формате. */
export function isClockTime(value: string): boolean {
  return TIME_PATTERN.test(value);
}

/** Календарный день момента времени в часовом поясе: YYYY-MM-DD. */
export function dateInZone(instant: Date, timeZone: string): string {
  const parts = zonedParts(instant, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** Время момента в часовом поясе: HH:mm. */
export function timeInZone(instant: Date, timeZone: string): string {
  const parts = zonedParts(instant, timeZone);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

/**
 * Момент в UTC, соответствующий местным дате и времени.
 *
 * Смещение пояса считается дважды: первое приближение берёт смещение
 * в момент, отличающийся от искомого на само смещение, и возле перехода
 * на летнее время может ошибиться на час. Второй проход это исправляет.
 */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];

  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const firstGuess = naive - offsetMs(new Date(naive), timeZone);

  return new Date(naive - offsetMs(new Date(firstGuess), timeZone));
}

/** Начало местного дня в UTC. */
export function startOfDayUtc(date: string, timeZone: string): Date {
  return zonedToUtc(date, '00:00', timeZone);
}

/** Сдвиг календарной даты на число дней. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

/** Число дней от первой даты до второй включительно. */
export function daysInclusive(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / (24 * 60 * 60 * 1000)) + 1;
}

/**
 * Календарная дата в представлении колонки DATE.
 *
 * Драйвер отдаёт и принимает DATE как полночь UTC: в UTC и формируем,
 * чтобы 30 сентября не превратилось в 29-е на сервере с другим поясом.
 */
export function dateToDb(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/** Обратное преобразование колонки DATE в YYYY-MM-DD. */
export function dateFromDb(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * Просрочена ли задача.
 *
 * Задача на время просрочена, когда наступил этот момент; задача на весь
 * день — когда день прошёл, то есть с полуночи следующего по местному
 * времени. Выполненная задача не просрочена никогда.
 */
export function isTaskOverdue(
  task: { dueDate: string; dueAt: Date | null; completedAt: Date | null },
  now: Date,
  timeZone: string,
): boolean {
  if (task.completedAt) {
    return false;
  }

  if (task.dueAt) {
    return task.dueAt.getTime() < now.getTime();
  }

  return task.dueDate < dateInZone(now, timeZone);
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);

  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }

  return formatter;
}

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const values: Record<string, number> = {};

  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type !== 'literal') {
      values[part.type] = Number(part.value);
    }
  }

  return {
    year: values.year ?? 1970,
    month: values.month ?? 1,
    day: values.day ?? 1,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  };
}

/** Смещение пояса относительно UTC в данный момент, мс. */
function offsetMs(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
