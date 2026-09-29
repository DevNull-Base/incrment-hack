import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { NotificationService } from './notification.service.js';
import {
  buildEscalationForManagerText,
  buildOrphanedEscalationText,
  buildEscalationText,
  escalationDedupeKey,
} from './notification-messages.js';

/** Сколько заявок читается из базы за одно обращение. */
const BATCH_LIMIT = 500;

const staleSelection = {
  id: true,
  counterpartyName: true,
  currentStateKey: true,
  currentStateLabel: true,
  ownerId: true,
  university: { select: { name: true } },
  owner: {
    select: { id: true, displayName: true, managerId: true, isActive: true },
  },
  workflowInstance: { select: { enteredAt: true } },
} as const;

type StaleEngagement = {
  id: string;
  counterpartyName: string | null;
  currentStateKey: string;
  currentStateLabel: string;
  ownerId: string;
  university: { name: string } | null;
  owner: { id: string; displayName: string; managerId: string | null; isActive: boolean };
  workflowInstance: { enteredAt: Date } | null;
};

/**
 * Поиск заявок, застрявших в одном статусе, и напоминания по ним.
 *
 * Требование с сессии вопросов и ответов: «если заявка висит в одном статусе
 * без изменения более одной или двух недель, приходит уведомление
 * ответственному лицу, например руководителю КАМа». Срок сделан настраиваемым:
 * точного значения заказчик не назвал.
 *
 * Это не то же самое, что норматив этапа (slaDays в описании процесса).
 * Норматив у каждого статуса свой и отмечает просрочку в отчётах; здесь же
 * единый порог простоя, по которому система сама напоминает о себе. Заявка
 * может укладываться в норматив длинного этапа и всё равно месяц не двигаться.
 *
 * Расчёт отделён от расписания намеренно: тот же проход запускается
 * администратором вручную, когда нужно проверить правило, не дожидаясь
 * ночного прогона.
 */
@Injectable()
export class EscalationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  /** Один проход. Вынесен из расписания, чтобы вызываться и вручную. */
  async run(): Promise<{ stale: number; notified: number }> {
    const policy = await this.notifications.ensurePolicy();
    const threshold = new Date(Date.now() - policy.escalationDays * 24 * 60 * 60 * 1000);

    // Заявки перебираются порциями по порядку идентификатора до конца.
    // Прежде бралась одна порция без порядка: уже напомненные заявки
    // попадали в неё при каждом прогоне и отсекались ключом повтора,
    // а всё, что не поместилось в первые 500, не получало напоминания никогда.
    const stale: StaleEngagement[] = [];
    let cursor: string | undefined;

    for (;;) {
      const batch: StaleEngagement[] = await this.prisma.engagement.findMany({
        where: {
          isArchived: false,
          workflowInstance: {
            // Завершённая заявка не «зависла»: работа по ней окончена.
            completedAt: null,
            enteredAt: { lte: threshold },
          },
        },
        orderBy: { id: 'asc' },
        take: BATCH_LIMIT,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: staleSelection,
      });

      stale.push(...batch);

      if (batch.length < BATCH_LIMIT) {
        break;
      }

      cursor = batch[batch.length - 1]?.id;
    }

    let notified = 0;

    // Администраторы — последний адресат для заявок заблокированных
    // сотрудников без руководителя. Список читается один раз на прогон.
    const adminIds = (
      await this.prisma.appUser.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } })
    ).map((admin) => admin.id);

    for (const engagement of stale) {
      const enteredAt = engagement.workflowInstance?.enteredAt;

      if (!enteredAt) {
        continue;
      }

      const summary = {
        id: engagement.id,
        counterpartyName: engagement.university?.name ?? engagement.counterpartyName ?? 'заявка',
        stateLabel: engagement.currentStateLabel,
      };

      const idleDays = Math.floor((Date.now() - enteredAt.getTime()) / (24 * 60 * 60 * 1000));

      const ownerText = buildEscalationText(summary, idleDays);
      const ownerResult = await this.notifications.notify({
        userId: engagement.ownerId,
        subject: ownerText.subject,
        body: ownerText.body,
        entityType: 'Engagement',
        entityId: engagement.id,
        dedupeKey: escalationDedupeKey({
          engagementId: engagement.id,
          stateKey: engagement.currentStateKey,
          enteredAt,
          userId: engagement.ownerId,
        }),
      });

      notified += ownerResult.created;

      const managerId = engagement.owner.managerId;

      // Ответственный заблокирован: ему уведомление не уйдёт, и заявка
      // зависает без хозяина. Руководитель узнаёт о ней независимо от
      // настройки «уведомлять руководителя», а без руководителя — все
      // администраторы. Прежде о таких заявках не узнавал никто.
      if (!engagement.owner.isActive) {
        const orphanText = buildOrphanedEscalationText(summary, idleDays, engagement.owner.displayName);
        const recipients = managerId && managerId !== engagement.ownerId ? [managerId] : adminIds;

        for (const recipientId of recipients) {
          const result = await this.notifications.notify({
            userId: recipientId,
            subject: orphanText.subject,
            body: orphanText.body,
            entityType: 'Engagement',
            entityId: engagement.id,
            // Свой ключ: руководитель мог уже получить обычное напоминание
            // по этой заявке, и под общим ключом новость о блокировке
            // ответственного сочлась бы повтором и не дошла.
            dedupeKey: escalationDedupeKey({
              engagementId: engagement.id,
              stateKey: engagement.currentStateKey,
              enteredAt,
              userId: recipientId,
              kind: 'orphaned',
            }),
          });

          notified += result.created;
        }

        continue;
      }

      if (policy.notifyManagerOnEscalation && managerId && managerId !== engagement.ownerId) {
        const managerText = buildEscalationForManagerText(
          summary,
          idleDays,
          engagement.owner.displayName,
        );

        const managerResult = await this.notifications.notify({
          userId: managerId,
          subject: managerText.subject,
          body: managerText.body,
          entityType: 'Engagement',
          entityId: engagement.id,
          dedupeKey: escalationDedupeKey({
            engagementId: engagement.id,
            stateKey: engagement.currentStateKey,
            enteredAt,
            userId: managerId,
          }),
        });

        notified += managerResult.created;
      }
    }

    return { stale: stale.length, notified };
  }
}
