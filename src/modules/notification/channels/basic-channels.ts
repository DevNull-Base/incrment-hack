import { PinoLogger } from 'nestjs-pino';
import { NotificationChannel } from '../../../generated/prisma/enums.js';
import {
  DeliveryResult,
  NotificationChannelTransport,
  OutgoingNotification,
  settingString,
} from './notification-channel.js';

/**
 * Уведомление внутри системы.
 *
 * Доставки как таковой здесь нет: запись уведомления в базу — уже доставка,
 * пользователь видит её в интерфейсе, а канал реального времени показывает
 * сразу, без перезагрузки страницы. Этот канал единственный, который
 * работает в закрытом контуре без каких-либо внешних подключений, поэтому
 * он включён всегда и настроек не имеет.
 */
export class InAppNotificationChannel implements NotificationChannelTransport {
  readonly channel: NotificationChannel = 'IN_APP';

  describeReadiness(): { ready: boolean; detail?: string } {
    return { ready: true };
  }

  send(): Promise<DeliveryResult> {
    return Promise.resolve({ delivered: true });
  }
}

/**
 * Доставка почтой.
 *
 * Отправку выполняет почтовый узел организации, и подключать к прототипу
 * SMTP-клиент, которому в закрытом контуре некуда обращаться, смысла нет:
 * на сессии вопросов и ответов заказчик прямо сказал, что достаточно
 * предусмотреть возможность подключения и настройки.
 *
 * Поэтому канал хранит параметры узла и проверяет их полноту, а сообщение
 * остаётся в журнале уведомлений с пояснением, что почтовый транспорт
 * не подключён. Так поведение честное: в интерфейсе видно и само сообщение,
 * и причину, по которой оно не ушло письмом.
 */
export class EmailNotificationChannel implements NotificationChannelTransport {
  readonly channel: NotificationChannel = 'EMAIL';

  constructor(private readonly logger: PinoLogger) {}

  describeReadiness(settings: Record<string, unknown>): { ready: boolean; detail?: string } {
    const host = settingString(settings, 'host');
    const from = settingString(settings, 'from');

    if (!host || !from) {
      return {
        ready: false,
        detail: 'Не заданы узел SMTP и адрес отправителя.',
      };
    }

    return {
      ready: true,
      detail:
        'Параметры заданы. Отправка писем выполняется почтовым узлом ' +
        'организации; в поставке транспорт не подключён.',
    };
  }

  send(
    message: OutgoingNotification,
    settings: Record<string, unknown>,
  ): Promise<DeliveryResult> {
    const readiness = this.describeReadiness(settings);

    this.logger.info(
      {
        channel: this.channel,
        // В журнал идёт идентификатор получателя, а не его адрес:
        // почта — персональные данные.
        recipientId: message.recipient.id,
        subject: message.subject,
        ready: readiness.ready,
      },
      'Уведомление подготовлено к отправке почтой',
    );

    return Promise.resolve({
      delivered: false,
      detail: readiness.ready
        ? 'Почтовый транспорт не подключён: сообщение сохранено в журнале уведомлений.'
        : readiness.detail,
    });
  }
}
