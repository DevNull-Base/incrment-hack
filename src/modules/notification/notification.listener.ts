import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PinoLogger } from 'nestjs-pino';
import { NotificationService } from './notification.service.js';
import { buildTransitionText } from './notification-messages.js';
import type { EngagementUpdatedEvent } from '../realtime/realtime.gateway.js';

/**
 * Уведомления о смене статуса заявки.
 *
 * Подписка на доменное событие, а не вызов из движка процессов: движок
 * не должен знать, кого и чем уведомляют, иначе к нему прирастут почта,
 * мессенджеры и правила рассылки.
 *
 * Уведомление адресуется ответственному и только ему: руководитель узнаёт
 * о задержках из напоминаний, а сообщение о каждом переходе подчинённых
 * быстро превратилось бы в шум, который перестают читать.
 */
@Injectable()
export class NotificationListener {
  constructor(
    private readonly notifications: NotificationService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(NotificationListener.name);
  }

  @OnEvent('engagement.updated', { async: true })
  async onEngagementUpdated(event: EngagementUpdatedEvent): Promise<void> {
    // Собственное действие не уведомляют: пользователь только что нажал
    // кнопку и видел результат.
    if (!event.ownerId || event.ownerId === event.actorId) {
      return;
    }

    try {
      const policy = await this.notifications.ensurePolicy();

      if (!policy.notifyOwnerOnTransition) {
        return;
      }

      const text = buildTransitionText(
        event.counterpartyName ?? 'заявка',
        null,
        event.toStateLabel,
        event.actorName,
      );

      await this.notifications.notify({
        userId: event.ownerId,
        subject: text.subject,
        body: text.body,
        entityType: 'Engagement',
        entityId: event.engagementId,
      });
    } catch (error: unknown) {
      // Сбой уведомления не должен отражаться на переходе: он уже выполнен
      // и зафиксирован, а обработчик события работает вне его транзакции.
      this.logger.error(
        { err: error, engagementId: event.engagementId },
        'Не удалось отправить уведомление о смене статуса',
      );
    }
  }
}
