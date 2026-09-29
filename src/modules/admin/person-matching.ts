import { Prisma } from '../../generated/prisma/client.js';
import type { PdLawfulBasis } from '../../generated/prisma/enums.js';
import { AppException } from '../../common/errors/app-exception.js';

/** Сведения о человеке из внешнего источника — уже нормализованные. */
export interface IncomingPerson {
  fullName: string;
  email: string | null;
  phone: string | null;
  position?: string | null;
  lawfulBasis: PdLawfulBasis;
}

export interface MatchedPerson {
  id: string;
  fullName: string;
  created: boolean;
  /** Расхождения с уже сохранённой записью — их показывают пользователю. */
  warnings: string[];
}

/**
 * Находит человека среди уже известных либо заводит новую запись.
 *
 * Порядок сопоставления:
 *   1. по адресу почты — он уникален для человека;
 *   2. по телефону вместе с ФИО — телефон бывает общим (рабочий номер
 *      отдела, номер родителя), и сопоставление по нему одному склеило бы
 *      разных людей. Этот шаг ловит опечатку в почте — в образцах заказчика она
 *      встречается: почта не совпадёт, а телефон и ФИО совпадут.
 *
 * Обезличенные записи в сопоставлении не участвуют: их данные удалены
 * по требованию, и «воскрешать» человека нельзя.
 *
 * Сохранённые значения не перезаписываются: пустые поля дополняются,
 * а расхождения возвращаются предупреждениями. Молча заменить почту из
 * реестра на пришедшую из таблицы значило бы потерять правильную.
 */
export async function findOrCreatePerson(
  tx: Prisma.TransactionClient,
  incoming: IncomingPerson,
): Promise<MatchedPerson> {
  const existing = await findKnownPerson(tx, incoming);

  if (!existing) {
    const created = await tx.person.create({
      data: {
        fullName: incoming.fullName,
        email: incoming.email,
        phone: incoming.phone,
        position: incoming.position ?? null,
        lawfulBasis: incoming.lawfulBasis,
      },
      select: { id: true, fullName: true },
    });

    return { id: created.id, fullName: created.fullName, created: true, warnings: [] };
  }

  const warnings = await mergeIntoPerson(tx, existing, incoming);
  return { id: existing.id, fullName: existing.fullName, created: false, warnings };
}

/**
 * Человек, введённый вручную в карточке каталога, — среди уже известных
 * либо новой записью.
 *
 * В отличие от загрузки таблицы, здесь почта, совпавшая с записью другого
 * человека, — отказ, а не предупреждение «оставлено имя из реестра».
 * Предупреждение называло бы сохранённое ФИО, а ответ — сохранённый
 * телефон: зная чужую почту, пользователь без доступа к реестру узнал бы,
 * чья она и как этому человеку позвонить. Отказ сообщает лишь, что адрес
 * занят, — и не даёт завести второго человека с той же почтой.
 */
export async function resolveEnteredPerson(
  tx: Prisma.TransactionClient,
  incoming: IncomingPerson,
): Promise<MatchedPerson & { filled: boolean }> {
  const known = await findKnownPerson(tx, incoming);

  if (known && !sameName(known.fullName, incoming.fullName)) {
    throw new AppException('VALIDATION_FAILED', {
      detail: 'Эта почта в реестре указана у другого человека. Проверьте адрес или обратитесь к администратору.',
      issues: [{ field: 'email', message: 'Почта принадлежит другому человеку' }],
    });
  }

  if (!known) {
    const created = await tx.person.create({
      data: {
        fullName: incoming.fullName,
        email: incoming.email,
        phone: incoming.phone,
        position: incoming.position ?? null,
        lawfulBasis: incoming.lawfulBasis,
      },
      select: { id: true, fullName: true },
    });

    return { id: created.id, fullName: created.fullName, created: true, warnings: [], filled: false };
  }

  const filled =
    (incoming.phone != null && !known.phone) ||
    (incoming.email != null && !known.email) ||
    (incoming.position != null && incoming.position !== '' && !known.position);
  const warnings = await mergeIntoPerson(tx, known, incoming);

  return { id: known.id, fullName: known.fullName, created: false, warnings, filled };
}

/**
 * Почта одного человека — у одной записи реестра: иначе оплаты и загрузки
 * находили бы по ней то одного, то другого.
 */
export async function assertEmailFree(tx: Prisma.TransactionClient, email: string, personId: string): Promise<void> {
  const owner = await tx.person.findFirst({
    where: { id: { not: personId }, erasedAt: null, email: { equals: email, mode: 'insensitive' } },
    select: { id: true },
  });

  if (owner) {
    throw new AppException('VALIDATION_FAILED', {
      detail: 'Эта почта в реестре указана у другого человека. Проверьте адрес или обратитесь к администратору.',
      issues: [{ field: 'email', message: 'Почта принадлежит другому человеку' }],
    });
  }
}

/** Поиск уже известного человека — без создания записи. */
export async function findKnownPerson(
  tx: Prisma.TransactionClient,
  incoming: Pick<IncomingPerson, 'fullName' | 'email' | 'phone'>,
): Promise<KnownPerson | null> {
  const byEmail = incoming.email
    ? await tx.person.findFirst({
        where: { erasedAt: null, email: { equals: incoming.email, mode: 'insensitive' } },
        select: personSelection,
      })
    : null;

  if (byEmail) {
    return byEmail;
  }

  if (!incoming.phone) {
    return null;
  }

  const byPhone = await tx.person.findMany({
    where: { erasedAt: null, phone: incoming.phone },
    select: personSelection,
    take: 20,
  });

  return byPhone.find((person) => sameName(person.fullName, incoming.fullName)) ?? null;
}

/**
 * Дополняет запись о человеке сведениями из источника.
 *
 * Пустые поля заполняются, заполненные не меняются; расхождения
 * возвращаются предупреждениями для отчёта.
 */
export async function mergeIntoPerson(
  tx: Prisma.TransactionClient,
  existing: KnownPerson,
  incoming: Omit<IncomingPerson, 'lawfulBasis'>,
): Promise<string[]> {
  const warnings: string[] = [];
  const data: Prisma.PersonUpdateInput = {};

  if (!sameName(existing.fullName, incoming.fullName)) {
    warnings.push(
      `Контакт совпал с записью «${existing.fullName}», а в источнике указано «${incoming.fullName}» — оставлено имя из реестра`,
    );
  }

  if (incoming.phone && !existing.phone) data.phone = incoming.phone;
  if (incoming.email && !existing.email) data.email = incoming.email;
  if (incoming.position && !existing.position) data.position = incoming.position;

  if (incoming.phone && existing.phone && incoming.phone !== existing.phone) {
    warnings.push('Телефон отличается от сохранённого — сохранённый не изменён');
  }

  if (incoming.email && existing.email && incoming.email.toLowerCase() !== existing.email.toLowerCase()) {
    warnings.push(`Почта в источнике (${incoming.email}) отличается от сохранённой — сохранённая не изменена`);
  }

  if (Object.keys(data).length > 0) {
    await tx.person.update({ where: { id: existing.id }, data });
  }

  return warnings;
}

export const personSelection = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  position: true,
} satisfies Prisma.PersonSelect;

export type KnownPerson = Prisma.PersonGetPayload<{ select: typeof personSelection }>;

/** ФИО совпадают без учёта регистра, ё и лишних пробелов. */
export function sameName(left: string, right: string): boolean {
  const key = (value: string) => value.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  return key(left) === key(right);
}
