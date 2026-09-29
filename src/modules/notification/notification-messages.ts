/**
 * Тексты уведомлений и ключи защиты от повторов.
 *
 * Собраны отдельно от сервиса и намеренно оставлены чистыми функциями:
 * от ключа зависит, придёт напоминание один раз или будет повторяться
 * при каждом прогоне планировщика, а это проверяется тестами без базы.
 */

/** Данные заявки, достаточные для текста уведомления. */
export interface EngagementSummary {
  id: string;
  /** Вуз либо лицо — то, что видит пользователь в списке. */
  counterpartyName: string;
  stateLabel: string;
}

export interface NotificationText {
  subject: string;
  body: string;
}

/** Склонение слова «день» под число. */
export function pluralizeDays(days: number): string {
  const tail = days % 100;
  if (tail >= 11 && tail <= 14) return 'дней';

  switch (days % 10) {
    case 1:
      return 'день';
    case 2:
    case 3:
    case 4:
      return 'дня';
    default:
      return 'дней';
  }
}

/** Напоминание ответственному о заявке, которая долго не двигается. */
export function buildEscalationText(
  engagement: EngagementSummary,
  days: number,
): NotificationText {
  return {
    subject: `Заявка без движения ${days} ${pluralizeDays(days)}`,
    body:
      `Взаимодействие с «${engagement.counterpartyName}» остаётся в статусе ` +
      `«${engagement.stateLabel}» дольше ${days} ${pluralizeDays(days)}. ` +
      'Проверьте, что работа не остановилась, и продвиньте заявку либо ' +
      'оставьте комментарий о причине задержки.',
  };
}

/**
 * То же напоминание, адресованное руководителю.
 *
 * Текст отличается не из вежливости: руководителю важно, за кем закреплена
 * заявка, — без этого уведомление заставляет его идти искать ответственного
 * в интерфейсе.
 */
export function buildEscalationForManagerText(
  engagement: EngagementSummary,
  days: number,
  ownerName: string,
): NotificationText {
  return {
    subject: `Заявка подчинённого без движения ${days} ${pluralizeDays(days)}`,
    body:
      `Взаимодействие с «${engagement.counterpartyName}» (ответственный — ${ownerName}) ` +
      `остаётся в статусе «${engagement.stateLabel}» дольше ${days} ${pluralizeDays(days)}. ` +
      'Стоит уточнить причину задержки.',
  };
}

/**
 * Заявка заблокированного сотрудника без движения. Уходит руководителю
 * либо администраторам: сам ответственный уведомлений больше не получает,
 * и без этого сообщения о заявке не узнал бы никто.
 */
export function buildOrphanedEscalationText(
  engagement: EngagementSummary,
  days: number,
  ownerName: string,
): NotificationText {
  return {
    subject: `Заявка заблокированного сотрудника без движения ${days} ${pluralizeDays(days)}`,
    body:
      `Взаимодействие с «${engagement.counterpartyName}» остаётся в статусе ` +
      `«${engagement.stateLabel}» дольше ${days} ${pluralizeDays(days)}, а ответственный — ` +
      `${ownerName} — заблокирован. Передайте заявку другому сотруднику.`,
  };
}

/** Сообщение о смене статуса заявки. */
export function buildTransitionText(
  counterpartyName: string,
  fromStateLabel: string | null,
  toStateLabel: string,
  actorName: string,
): NotificationText {
  const from = fromStateLabel ? `из «${fromStateLabel}» ` : '';

  return {
    subject: `Статус заявки изменён: ${toStateLabel}`,
    body:
      `Взаимодействие с «${counterpartyName}» переведено ${from}` +
      `в статус «${toStateLabel}». Изменение выполнил: ${actorName}.`,
  };
}

/**
 * Ключ напоминания о простое.
 *
 * В ключ входит момент входа в статус, а не только сам статус: если заявка
 * вернулась в тот же статус позже — а возвраты процессом предусмотрены, —
 * это новая ситуация, и напоминание должно прийти снова.
 *
 * Получатель тоже в ключе: одно и то же напоминание уходит и ответственному,
 * и его руководителю. Канал сюда НЕ входит — его добавляет служба отправки,
 * иначе общий ключ на все каналы подавил бы все доставки, кроме первой.
 */
export function escalationDedupeKey(params: {
  engagementId: string;
  stateKey: string;
  enteredAt: Date;
  userId: string;
  /** Вид напоминания: о заблокированном ответственном — отдельное сообщение. */
  kind?: 'orphaned';
}): string {
  return [
    params.kind === 'orphaned' ? 'sla-orphaned' : 'sla',
    params.engagementId,
    params.stateKey,
    params.enteredAt.toISOString(),
    params.userId,
  ].join(':');
}

/** Задача календаря — в объёме, нужном тексту уведомления. */
export interface TaskSummary {
  id: string;
  title: string;
  /** Дата задачи, YYYY-MM-DD. */
  dueDate: string;
  /** Время задачи по местному времени, HH:mm; null — на весь день. */
  dueTime: string | null;
  /** Заявка, к которой относится задача: вуз либо лицо. */
  counterpartyName: string | null;
}

/** 2026-09-30 и 15:00 → «30.09.2026 в 15:00»; без времени — «30.09.2026». */
export function formatTaskDue(task: Pick<TaskSummary, 'dueDate' | 'dueTime'>): string {
  const [year, month, day] = task.dueDate.split('-');
  const date = `${day}.${month}.${year}`;
  return task.dueTime ? `${date} в ${task.dueTime}` : date;
}

function taskContext(task: TaskSummary): string {
  return task.counterpartyName ? ` Заявка: «${task.counterpartyName}».` : '';
}

/** Напоминание о задаче в назначенный пользователем момент. */
export function buildTaskReminderText(task: TaskSummary): NotificationText {
  return {
    subject: `Напоминание: ${task.title}`,
    body: `Задача «${task.title}» — срок ${formatTaskDue(task)}.${taskContext(task)}`,
  };
}

/** Руководитель поставил задачу подчинённому. */
export function buildTaskAssignedText(task: TaskSummary, assignerName: string): NotificationText {
  return {
    subject: `Новая задача: ${task.title}`,
    body:
      `${assignerName} ставит задачу «${task.title}» со сроком ${formatTaskDue(task)}.` +
      taskContext(task),
  };
}

/** Исполнитель выполнил задачу, поставленную руководителем. */
export function buildTaskCompletedText(task: TaskSummary, performerName: string): NotificationText {
  return {
    subject: `Задача выполнена: ${task.title}`,
    body: `${performerName} отмечает задачу «${task.title}» выполненной.${taskContext(task)}`,
  };
}

/**
 * Ключ напоминания о задаче.
 *
 * Момент напоминания входит в ключ: если пользователь перенёс напоминание,
 * это новое напоминание и оно должно прийти, а повторный прогон планировщика
 * по тому же моменту — нет.
 */
export function taskReminderDedupeKey(taskId: string, remindAt: Date): string {
  return ['task-reminder', taskId, remindAt.toISOString()].join(':');
}
