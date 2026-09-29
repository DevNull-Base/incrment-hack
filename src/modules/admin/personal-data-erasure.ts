import { Prisma } from '../../generated/prisma/client.js';

/** Чем заменяются обезличенные персональные данные. */
export const ERASED_PLACEHOLDER = 'Данные удалены по требованию';

/** Субъект, чьи данные обезличиваются, — в том виде, в каком они были. */
export interface ErasedPerson {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
}

/**
 * Обезличивает копии персональных данных субъекта за пределами реестра персон.
 *
 * Обезличивание одной строки person было неполным: ФИО физического лица,
 * обратившегося напрямую, хранится ещё и в самой заявке (counterparty_name —
 * так список заявок показывает контрагента без соединения таблиц), в текстах
 * уведомлений по этой заявке и в исходном сообщении внешней системы. После
 * «исполненного» требования субъекта имя оставалось в списке заявок.
 *
 * Вызывается в той же транзакции, что и обезличивание записи о персоне:
 * частично исполненное требование хуже неисполненного — оно выглядит
 * исполненным.
 */
export async function eraseCopiesOfPerson(tx: Prisma.TransactionClient, person: ErasedPerson): Promise<void> {
  const engagements = await tx.engagement.findMany({
    where: { counterpartyContactId: person.id, counterpartyType: 'PERSON' },
    select: { id: true },
  });

  if (engagements.length > 0) {
    await tx.engagement.updateMany({
      where: { id: { in: engagements.map((engagement) => engagement.id) } },
      data: { counterpartyName: ERASED_PLACEHOLDER },
    });

    // Уведомления по заявкам хранят имя контрагента в тексте: «Заявка
    // „Смирнов А. В.“ без движения 14 дней». Заменяется только имя —
    // сам факт уведомления остаётся.
    if (person.fullName !== ERASED_PLACEHOLDER) {
      await tx.$executeRaw`
        UPDATE notification
        SET subject = replace(subject, ${person.fullName}, ${ERASED_PLACEHOLDER}),
            body = replace(body, ${person.fullName}, ${ERASED_PLACEHOLDER})
        WHERE entity_type = 'Engagement'
          AND entity_id = ANY(${engagements.map((engagement) => engagement.id)}::text[])
      `;
    }
  }

  // Исходные сообщения внешних систем. Строка остаётся — по её ключу
  // отсекаются повторы того же события, — а содержимое стирается.
  // Оплаты с сайта сохраняются в том же виде (counterparty.name / email /
  // phone), поэтому стираются этим же запросом; телефон нужен для записей
  // без почты.
  const byEmail = person.email
    ? Prisma.sql`payload -> 'counterparty' ->> 'email' = ${person.email}`
    : Prisma.sql`false`;
  const byPhone = person.phone
    ? Prisma.sql`payload -> 'counterparty' ->> 'phone' = ${person.phone}`
    : Prisma.sql`false`;

  await tx.$executeRaw`
    UPDATE integration_staging_record
    SET payload = '{}'::jsonb
    WHERE ${byEmail}
       OR ${byPhone}
       OR payload -> 'counterparty' ->> 'name' = ${person.fullName}
  `;
}
