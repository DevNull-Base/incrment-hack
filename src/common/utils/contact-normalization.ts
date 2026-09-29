/**
 * Нормализация контактных данных из внешних источников.
 *
 * Данные приходят от сайта, из LMS и из таблиц, которые заполняют люди, и
 * каждое поле записано по-своему. В присланных заказчиком образцах один и тот
 * же телефон — строкой «7 (900) 111-22-33» в одном файле и числом 79001112233
 * в другом; почта с опечаткой; заголовки таблиц с потерянными скобками.
 * Без приведения к общему виду один человек становился бы двумя записями,
 * а сопоставить оплату с заявкой было бы нечем.
 *
 * Все функции здесь чистые и не бросают исключений: некорректное значение
 * возвращается как null, а решение — отклонить запись или принять её
 * с предупреждением — принимает вызывающий код.
 */

/** Способ связи с контактным лицом. */
export type ContactChannelValue = 'EMAIL' | 'PHONE' | 'TELEGRAM' | 'MAX';

/**
 * Телефон в международном виде: +7XXXXXXXXXX.
 *
 * Принимается всё, что встречается в выгрузках: строка с пробелами,
 * скобками и дефисами, число из ячейки Excel, запись через восьмёрку,
 * десять цифр без кода страны, добавочный номер после основного.
 * Номер другой длины считается некорректным: угадывать недостающие цифры
 * нельзя — это был бы чужой телефон.
 */
export function normalizePhone(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }

  let text: string;

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    // Ячейка Excel хранит номер числом; в строку — без экспоненты.
    text = Math.round(raw).toString();
  } else {
    text = String(raw);
  }

  // Добавочный номер отбрасывается: для сопоставления он не нужен,
  // а цифры из него испортили бы длину основного номера.
  const main = text.split(/доб|ext|#|,/i)[0] ?? '';

  let digits = '';
  for (const char of main) {
    if (char >= '0' && char <= '9') digits += char;
  }

  if (digits.length === 10 && digits.startsWith('9')) {
    digits = `7${digits}`;
  } else if (digits.length === 11 && digits.startsWith('8')) {
    digits = `7${digits.slice(1)}`;
  }

  return digits.length === 11 && digits.startsWith('7') ? `+${digits}` : null;
}

/** Телефон цифрами без плюса — так его ждут шаблоны загрузки LMS. */
export function phoneDigits(phone: string | null): string | null {
  return phone ? phone.replace('+', '') : null;
}

/**
 * Адрес почты: без пробелов, в нижнем регистре, с проверкой формата.
 * Снимаются типичные артефакты копирования: «mailto:», угловые скобки,
 * точка в конце строки.
 */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }

  let text = raw.trim().toLowerCase();

  if (text.startsWith('mailto:')) text = text.slice('mailto:'.length);
  while (text.endsWith('.')) text = text.slice(0, -1);
  if (text.startsWith('<') && text.endsWith('>')) text = text.slice(1, -1);

  text = text.replace(/\s+/g, '');

  return /^[^@\s]+@[^@\s]+\.[a-zа-я]{2,}$/i.test(text) ? text : null;
}

/**
 * Часть ФИО с правильным регистром: «сидоренко» и «СИДОРЕНКО» дают
 * «Сидоренко», двойная фамилия — «Римская-Корсакова». Запись в смешанном
 * регистре не трогается: «МакКензи» — не ошибка ввода.
 */
export function normalizeNamePart(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    return null;
  }

  const text = String(raw).trim().replace(/\s+/g, ' ');

  if (text.length === 0) {
    return null;
  }

  const isUniform = text === text.toLowerCase() || text === text.toUpperCase();

  if (!isUniform) {
    return text;
  }

  return text
    .toLowerCase()
    .split(/([\s-])/)
    .map((piece) => (piece.length > 0 && piece !== '-' && piece !== ' ' ? capitalize(piece) : piece))
    .join('');
}

/** ФИО из частей; отсутствующее отчество просто пропускается. */
export function joinFullName(parts: Array<string | null>): string {
  return parts.filter((part): part is string => Boolean(part)).join(' ');
}

/**
 * Ключ организации для сопоставления: без организационно-правовой формы,
 * кавычек и регистра. «ПАО «Ростелеком»», «Ростелеком» и «ПАО Ростелеком»
 * дают один ключ.
 */
export function organizationKey(raw: string): string {
  const cleaned = stripQuotes(raw)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.,]/g, ' ');

  const tokens = cleaned
    .split(/\s+/)
    .filter((token) => token.length > 0 && !LEGAL_FORMS.has(token));

  return tokens.join(' ');
}

/**
 * Список наименований из одной ячейки: «RT.DataLake», «RT.Warehouse».
 *
 * Разделители — запятая, точка с запятой, перевод строки, но только вне
 * кавычек: запятая внутри «…» — часть названия. Кавычки вокруг элемента
 * снимаются, повторы убираются.
 */
export function splitNameList(raw: unknown): string[] {
  if (typeof raw !== 'string') {
    return [];
  }

  const items: string[] = [];
  let current = '';
  let depth = 0;

  for (const char of raw) {
    if (OPENING_QUOTES.has(char)) depth += 1;
    else if (CLOSING_QUOTES.has(char)) depth = Math.max(0, depth - 1);
    else if (char === '"') depth = depth > 0 ? depth - 1 : depth + 1;

    if (depth === 0 && (char === ',' || char === ';' || char === '\n')) {
      items.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  items.push(current);

  const result: string[] = [];

  for (const item of items) {
    const name = stripQuotes(item).replace(/\s+/g, ' ').trim();

    if (name.length > 0 && !result.some((existing) => existing.toLowerCase() === name.toLowerCase())) {
      result.push(name);
    }
  }

  return result;
}

/**
 * Способы связи из свободной записи: «Почта, Чат в ТГ», «telegram»,
 * «звонок». Нераспознанное возвращается отдельно — это не повод отклонять
 * строку, но показать его пользователю нужно.
 */
export function parseContactChannels(raw: unknown): {
  channels: ContactChannelValue[];
  unknown: string[];
} {
  const channels: ContactChannelValue[] = [];
  const unknown: string[] = [];

  if (typeof raw !== 'string') {
    return { channels, unknown };
  }

  for (const token of raw.split(/[,;/\n]| и /)) {
    const text = token.trim().toLowerCase();

    if (text.length === 0) continue;

    const channel = CHANNEL_PATTERNS.find(([pattern]) => pattern.test(text))?.[1];

    if (!channel) {
      unknown.push(token.trim());
    } else if (!channels.includes(channel)) {
      channels.push(channel);
    }
  }

  return { channels, unknown };
}

/**
 * Заголовок колонки для сопоставления: без регистра, скобок, знаков
 * и лишних пробелов.
 *
 * В присланном заказчиком шаблоне скобки в заголовках потеряны наполовину —
 * «Отчествопри наличии)» вместо «Отчество (при наличии)». Сравнение по
 * буквам и цифрам делает оба варианта одинаковыми.
 */
export function headerKey(raw: unknown): string {
  if (raw === null || raw === undefined) {
    return '';
  }

  let key = '';

  for (const char of String(raw).toLowerCase().replace(/ё/g, 'е')) {
    if ((char >= 'a' && char <= 'z') || (char >= 'а' && char <= 'я') || (char >= '0' && char <= '9')) {
      key += char;
    }
  }

  return key;
}

/** Ключ названия для сопоставления: курс, программа, продукт. */
export function titleKey(raw: string): string {
  return stripQuotes(raw)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'“”„.,:;!?()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const LEGAL_FORMS = new Set(['ооо', 'пао', 'оао', 'зао', 'ао', 'нао', 'ип', 'ано', 'фгуп', 'гуп', 'муп']);

const OPENING_QUOTES = new Set(['«', '“', '„']);
const CLOSING_QUOTES = new Set(['»', '”']);

/**
 * Границы слова заданы явно: \b в регулярных выражениях JavaScript знает
 * только латиницу, и «чат в тг» с ним не распознавался бы.
 */
const WORD_START = '(?:^|[^a-zа-я])';
const WORD_END = '(?:$|[^a-zа-я])';

const CHANNEL_PATTERNS: Array<[RegExp, ContactChannelValue]> = [
  [/почт|e-?mail|емейл|имейл/, 'EMAIL'],
  [new RegExp(`${WORD_START}(?:тг|tg)${WORD_END}|телеграм|telegram`), 'TELEGRAM'],
  [new RegExp(`${WORD_START}(?:max|макс)${WORD_END}`), 'MAX'],
  [/телефон|звон|phone|моб/, 'PHONE'],
];

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function stripQuotes(raw: string): string {
  return raw.replace(/[«»"“”„]/g, '').trim();
}
