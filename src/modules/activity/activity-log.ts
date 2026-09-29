import { Prisma } from '../../generated/prisma/client.js';
import type { ActivitySource, ActivityType } from '../../generated/prisma/enums.js';

export type { ActivitySource, ActivityType };

/** Этап заявки, к которому относится действие. */
export interface ActivityStage {
  key: string;
  label: string;
}

/** Запись ленты действий. */
export interface ActivityInput {
  type: ActivityType;
  /** По умолчанию — действие человека. */
  source?: ActivitySource;
  /** Автор. Пусто только у действий внешней системы. */
  actorId: string | null;
  engagementId?: string | null;
  stage?: ActivityStage | null;
  noteId?: string | null;
  attachmentId?: string | null;
  taskId?: string | null;
  transitionId?: bigint | null;
  /**
   * Подробности: ключи и подписи статусов, значения оценки, идентификаторы.
   * Текст заметки, имя файла и название задачи сюда не кладутся — лента
   * берёт их из своих записей при чтении. Исключение — обоснование оценки
   * заинтересованности: в карточке оно перезаписывается.
   */
  details?: Record<string, unknown> | null;
  /** Момент действия, если он отличается от момента записи. */
  occurredAt?: Date;
}

/**
 * Записывает действие в ленту в той же транзакции, что и само изменение.
 *
 * Запись после фиксации терялась бы при падении процесса между операциями,
 * и лента разошлась бы с данными: переход есть, а в истории его нет. Внутри
 * транзакции откат изменения откатывает и запись о нём.
 *
 * Функция, а не сервис, — по той же причине, что и enqueueEngagementEvent:
 * её вызывают движок процессов, заявки, файлы, заметки и календарь, и ни
 * одному из них не нужна зависимость от модуля ленты ради одной вставки.
 */
export async function recordActivity(tx: Prisma.TransactionClient, input: ActivityInput): Promise<void> {
  await tx.activityEvent.create({ data: toCreateData(input) });
}

/** Пакетная запись — для массовых операций вроде публикации процесса. */
export async function recordActivities(
  tx: Prisma.TransactionClient,
  inputs: readonly ActivityInput[],
): Promise<void> {
  if (inputs.length === 0) {
    return;
  }

  await tx.activityEvent.createMany({ data: inputs.map(toCreateData) });
}

function toCreateData(input: ActivityInput): Prisma.ActivityEventCreateManyInput {
  return {
    type: input.type,
    source: input.source ?? 'USER',
    actorId: input.actorId,
    engagementId: input.engagementId ?? null,
    stateKey: input.stage?.key ?? null,
    stateLabel: input.stage?.label ?? null,
    noteId: input.noteId ?? null,
    attachmentId: input.attachmentId ?? null,
    taskId: input.taskId ?? null,
    transitionId: input.transitionId ?? null,
    details: (input.details ?? undefined) as Prisma.InputJsonValue | undefined,
    ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
  };
}
