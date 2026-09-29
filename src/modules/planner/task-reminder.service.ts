import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AppConfig } from '../../config/configuration.js';
import { NotificationService } from '../notification/notification.service.js';
import { buildTaskReminderText, taskReminderDedupeKey } from '../notification/notification-messages.js';
import { dateFromDb, timeInZone } from './planner-dates.js';

/** Сколько напоминаний отправляется за один прогон. */
const BATCH_LIMIT = 200;

/**
 * Напоминания о задачах календаря.
 *
 * Прогон находит задачи, момент напоминания которых наступил, отправляет
 * уведомление исполнителю и помечает напоминание отправленным. От повтора
 * защищают две вещи: отметка reminder_sent_at и ключ повторной отправки
 * уведомления — если процесс упадёт между отправкой и отметкой, следующий
 * прогон не пошлёт второе сообщение.
 */
@Injectable()
export class TaskReminderService {
  private readonly timeZone: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.timeZone = config.get('APP_TIMEZONE', { infer: true });
  }

  async run(now: Date = new Date()): Promise<{ due: number; notified: number }> {
    const due = await this.prisma.plannerTask.findMany({
      where: {
        remindAt: { lte: now },
        reminderSentAt: null,
        completedAt: null,
        deletedAt: null,
      },
      orderBy: { remindAt: 'asc' },
      take: BATCH_LIMIT,
      select: {
        id: true,
        ownerId: true,
        title: true,
        dueDate: true,
        dueAt: true,
        remindAt: true,
        engagement: {
          select: { counterpartyName: true, university: { select: { name: true } } },
        },
      },
    });

    let notified = 0;

    for (const task of due) {
      if (!task.remindAt) {
        continue;
      }

      const text = buildTaskReminderText({
        id: task.id,
        title: task.title,
        dueDate: dateFromDb(task.dueDate),
        dueTime: task.dueAt ? timeInZone(task.dueAt, this.timeZone) : null,
        counterpartyName: task.engagement
          ? (task.engagement.university?.name ?? task.engagement.counterpartyName ?? null)
          : null,
      });

      const result = await this.notifications.notify({
        userId: task.ownerId,
        subject: text.subject,
        body: text.body,
        entityType: 'Task',
        entityId: task.id,
        dedupeKey: taskReminderDedupeKey(task.id, task.remindAt),
      });

      notified += result.created;

      // Условие по моменту напоминания: если пользователь успел его
      // перенести, пока шла отправка, новое напоминание не должно
      // оказаться помеченным как отправленное.
      await this.prisma.plannerTask.updateMany({
        where: { id: task.id, remindAt: task.remindAt, reminderSentAt: null },
        data: { reminderSentAt: now },
      });
    }

    return { due: due.length, notified };
  }
}
