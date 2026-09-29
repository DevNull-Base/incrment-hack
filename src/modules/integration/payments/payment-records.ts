import {
  headerKey,
  joinFullName,
  normalizeEmail,
  normalizeNamePart,
  normalizePhone,
} from '../../../common/utils/contact-normalization.js';

/** Оплата прямой продажи, приведённая к единому виду. */
export interface PaymentRecord {
  /** Номер записи в источнике: порядковый в JSON, номер строки в таблице. */
  position: number;
  /** Номер заявки (заказа) на сайте — ключ, по которому оплата сходится с заявкой CRM. */
  orderNumber: string;
  course: string;
  lastName: string;
  firstName: string;
  middleName: string | null;
  fullName: string;
  /** Телефон в виде +7XXXXXXXXXX либо null, если не распознан. */
  phone: string | null;
  email: string | null;
  /** Поток обучения; строкой — в источниках встречается и «2 поток». */
  stream: string | null;
  warnings: string[];
}

/** Запись, которую нельзя принять, — с причинами. */
export interface RejectedPayment {
  position: number;
  orderNumber: string | null;
  fullName: string | null;
  reasons: string[];
}

type Field =
  | 'orderNumber'
  | 'course'
  | 'lastName'
  | 'firstName'
  | 'middleName'
  | 'fullName'
  | 'phone'
  | 'email'
  | 'stream';

/**
 * Имена полей. Сайт отдаёт русские ключи («Номер заявки», «Фамилия»), но
 * при переработке систем они могут смениться — поддерживаются и латинские.
 * Сравнение по буквам и цифрам: «E-mail», «email» и «Email» — одно поле.
 */
const FIELD_ALIASES: Record<Field, string[]> = {
  orderNumber: ['номер заявки', 'номер заказа', 'заказ', 'заявка', 'order', 'order id', 'order number', 'id заказа'],
  course: ['курс', 'программа', 'курс обучения', 'название курса', 'course', 'program'],
  lastName: ['фамилия', 'last name', 'lastname', 'surname'],
  firstName: ['имя', 'first name', 'firstname'],
  middleName: ['отчество', 'отчество при наличии', 'middle name', 'patronymic'],
  fullName: ['фио', 'full name', 'fullname', 'name'],
  phone: ['телефон', 'номер телефона', 'phone', 'mobile'],
  email: ['email', 'e-mail', 'почта', 'электронная почта', 'адрес почты'],
  stream: ['номер потока', 'поток', 'stream', 'cohort', 'группа'],
};

const ALIAS_TO_FIELD = new Map<string, Field>(
  (Object.entries(FIELD_ALIASES) as Array<[Field, string[]]>).flatMap(([field, aliases]) =>
    aliases.map((alias) => [headerKey(alias), field] as [string, Field]),
  ),
);

/**
 * Разбирает оплаты в том виде, в каком их отдаёт сайт.
 *
 * Образец заказчика — массив записей с русскими ключами — содержит всё, что
 * встречается в живых выгрузках, и каждое учтено:
 *   • пустой элемент (null) посреди массива — отклоняется с причиной,
 *     остальные записи принимаются;
 *   • номер заказа с невозможной датой внутри («ORD-20261721…», 17-й месяц)
 *     и с лишней цифрой — номер остаётся идентификатором как есть, дата из
 *     него не извлекается, пользователь видит предупреждение;
 *   • телефон строкой со скобками — приводится к +7XXXXXXXXXX;
 *   • почта с опечаткой — принимается как есть: исправить её нечем, но
 *     человек сопоставится по телефону и ФИО;
 *   • ФИО тремя полями либо одной строкой, в любом регистре;
 *   • поток числом или текстом.
 *
 * Корневой элемент — массив, одна запись либо объект с массивом в поле
 * items, data, payments или records.
 */
export function parsePaymentRecords(
  raw: unknown,
  options: { positions?: number[] } = {},
): { records: PaymentRecord[]; rejected: RejectedPayment[]; total: number } {
  const items = unwrap(raw);
  const records: PaymentRecord[] = [];
  const rejected: RejectedPayment[] = [];
  const seenOrders = new Map<string, number>();

  items.forEach((item, index) => {
    const position = options.positions?.[index] ?? index + 1;

    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      rejected.push({ position, orderNumber: null, fullName: null, reasons: ['Пустая запись'] });
      return;
    }

    const fields = readFields(item as Record<string, unknown>);
    const result = parseRecord(position, fields);

    if ('reasons' in result) {
      rejected.push(result);
      return;
    }

    const firstSeen = seenOrders.get(result.orderNumber);

    if (firstSeen !== undefined) {
      rejected.push({
        position,
        orderNumber: result.orderNumber,
        fullName: result.fullName,
        reasons: [`Повтор заказа ${result.orderNumber}: он уже есть в записи №${firstSeen}`],
      });
      return;
    }

    seenOrders.set(result.orderNumber, position);
    records.push(result);
  });

  return { records, rejected, total: items.length };
}

function unwrap(raw: unknown): unknown[] {
  if (Array.isArray(raw)) {
    return raw;
  }

  if (raw !== null && typeof raw === 'object') {
    for (const key of ['items', 'data', 'payments', 'records', 'orders']) {
      const nested = (raw as Record<string, unknown>)[key];

      if (Array.isArray(nested)) {
        return nested;
      }
    }

    return [raw];
  }

  return [];
}

function readFields(item: Record<string, unknown>): Partial<Record<Field, unknown>> {
  const fields: Partial<Record<Field, unknown>> = {};

  for (const [key, value] of Object.entries(item)) {
    const field = ALIAS_TO_FIELD.get(headerKey(key));

    if (field && fields[field] === undefined) {
      fields[field] = value;
    }
  }

  return fields;
}

function parseRecord(
  position: number,
  fields: Partial<Record<Field, unknown>>,
): PaymentRecord | RejectedPayment {
  const reasons: string[] = [];
  const warnings: string[] = [];

  const orderNumber = text(fields.orderNumber)?.replace(/\s+/g, '') ?? null;
  const course = text(fields.course)?.replace(/\s+/g, ' ') ?? null;

  let lastName = normalizeNamePart(fields.lastName);
  let firstName = normalizeNamePart(fields.firstName);
  let middleName = normalizeNamePart(fields.middleName);

  // ФИО одной строкой — когда сайт не делит его на части.
  if ((!lastName || !firstName) && typeof fields.fullName === 'string') {
    const parts = fields.fullName.trim().split(/\s+/);
    lastName = lastName ?? normalizeNamePart(parts[0]);
    firstName = firstName ?? normalizeNamePart(parts[1]);
    middleName = middleName ?? normalizeNamePart(parts.slice(2).join(' ') || null);
  }

  const fullName = joinFullName([lastName, firstName, middleName]);

  if (!orderNumber) reasons.push('Не указан номер заявки');
  if (!course) reasons.push('Не указан курс');
  if (!lastName || !firstName) reasons.push('Не указаны фамилия и имя');

  const rawPhone = fields.phone;
  const rawEmail = text(fields.email);
  const phone = normalizePhone(rawPhone);
  const email = normalizeEmail(rawEmail);

  if (text(rawPhone) && !phone) {
    warnings.push(`Телефон «${text(rawPhone)}» не распознан`);
  }

  if (rawEmail && !email) {
    warnings.push(`Почта «${rawEmail}» не распознана`);
  }

  if (!phone && !email) {
    reasons.push('Нет ни телефона, ни почты — слушателя не опознать и не зарегистрировать в LMS');
  } else if (!email) {
    warnings.push('Нет почты: для учётной записи LMS её придётся уточнить');
  }

  if (orderNumber) {
    const dateWarning = checkOrderDate(orderNumber);
    if (dateWarning) warnings.push(dateWarning);
  }

  if (reasons.length > 0 || !orderNumber || !course || !lastName || !firstName) {
    return { position, orderNumber, fullName: fullName || null, reasons };
  }

  return {
    position,
    orderNumber,
    course,
    lastName,
    firstName,
    middleName,
    fullName,
    phone,
    email,
    stream: parseStream(fields.stream),
    warnings,
  };
}

/**
 * Проверка даты, зашитой в номер заказа вида ORD-ГГГГММДДччммсс-XXXXXX.
 *
 * Номер остаётся идентификатором в любом случае: сопоставление с заявкой
 * идёт по нему целиком, а дату из него система не берёт. Предупреждение
 * нужно, чтобы расхождение заметили на стороне сайта. В образце заказчика
 * оба случая есть: 17-й месяц и лишняя цифра во времени.
 */
export function checkOrderDate(orderNumber: string, now: Date = new Date()): string | null {
  const match = /^ORD-(\d{4})(\d{2})(\d{2})(\d*)-/i.exec(orderNumber);

  if (!match) {
    return null;
  }

  const [, year, month, day, time] = match as unknown as [string, string, string, string, string];
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const valid =
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day);

  if (!valid) {
    return `В номере заказа некорректная дата (${day}.${month}.${year}) — номер принят как идентификатор`;
  }

  // Формат сайта — дата и время: 8 + 6 цифр.
  if (time.length !== 6) {
    return 'Номер заказа нестандартной длины — принят как идентификатор';
  }

  const [hours, minutes, seconds] = [time.slice(0, 2), time.slice(2, 4), time.slice(4, 6)].map(Number) as [
    number,
    number,
    number,
  ];

  if (hours > 23 || minutes > 59 || seconds > 59) {
    return `В номере заказа некорректное время (${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}) — номер принят как идентификатор`;
  }

  // Сутки запаса — на часовые пояса сайта и CRM.
  if (date.getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
    return `Дата в номере заказа (${day}.${month}.${year}) ещё не наступила — номер принят как идентификатор`;
  }

  return null;
}

/** Поток: число, «2», «2 поток», «Поток №3». */
export function parseStream(raw: unknown): string | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return String(Math.trunc(raw));
  }

  const value = text(raw);

  if (!value) {
    return null;
  }

  const digits = /\d+/.exec(value);
  return digits ? String(Number(digits[0])) : value;
}

function text(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const value = String(raw).trim();
  return value.length > 0 ? value : null;
}
