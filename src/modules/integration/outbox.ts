import { Prisma } from '../../generated/prisma/client.js';

/** Тип исходящего события. Совпадает с полем event контракта engagement.v1. */
export type OutboxEventType = 'engagement.created' | 'engagement.state_changed';

export interface EngagementEventData {
  engagementId: string;
  /** Статус до перехода — нужен внешней системе, чтобы понять направление. */
  previousStatus?: { key: string; label: string } | null;
}

/**
 * Регистрирует исходящее событие в той же транзакции, что и само изменение.
 *
 * Это паттерн Outbox: отправить сообщение сразу нельзя — транзакция может
 * откатиться, и внешняя система узнала бы о переходе, которого не было.
 * Обратный порядок не лучше: отправка после фиксации теряется при падении
 * процесса между двумя операциями. Запись в ту же транзакцию исключает
 * оба расхождения, а доставку берёт на себя фоновый процесс.
 *
 * В событие кладётся только ссылка на заявку, а не её состояние целиком:
 * полный состав полей собирается в момент отправки по актуальным данным,
 * и горячий путь перехода остаётся дешёвым.
 */
export async function enqueueEngagementEvent(
  tx: Prisma.TransactionClient,
  eventType: OutboxEventType,
  data: EngagementEventData,
): Promise<void> {
  await tx.outboxEvent.create({
    data: {
      eventType,
      payload: {
        engagementId: data.engagementId,
        previousStatus: data.previousStatus ?? null,
      } as unknown as Prisma.InputJsonValue,
    },
  });
}
