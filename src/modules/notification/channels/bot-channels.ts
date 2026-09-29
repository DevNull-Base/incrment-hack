import { PinoLogger } from 'nestjs-pino';
import { NotificationChannel } from '../../../generated/prisma/enums.js';
import {
  DeliveryResult,
  NotificationChannelTransport,
  OutgoingNotification,
  settingString,
} from './notification-channel.js';

/** Сколько ждать ответа мессенджера, прежде чем считать доставку неудавшейся. */
const SEND_TIMEOUT_MS = 10_000;

/**
 * Доставка через бота мессенджера.
 *
 * Telegram и MAX обслуживаются одним классом: у обоих бот принимает
 * отправку сообщения обычным HTTP-вызовом с токеном и идентификатором чата.
 * Разделять их означало бы дважды написать один и тот же код ради различий
 * в адресе.
 *
 * Система рассчитана на закрытый контур, где наружу разрешены только LMS
 * и сайт. Поэтому канал по умолчанию выключен, а при включённом канале без
 * настроенного адреса сообщение не теряется: оно остаётся в журнале
 * уведомлений с пояснением, почему доставки не было.
 */
export class BotNotificationChannel implements NotificationChannelTransport {
  constructor(
    readonly channel: NotificationChannel,
    private readonly defaultApiUrl: string,
    private readonly logger: PinoLogger,
  ) {}

  describeReadiness(settings: Record<string, unknown>): { ready: boolean; detail?: string } {
    const token = settingString(settings, 'botToken');
    const chatId = settingString(settings, 'chatId');

    if (!token || !chatId) {
      return {
        ready: false,
        detail:
          'Не заданы токен бота и идентификатор чата. Сообщения сохраняются ' +
          'в журнале уведомлений, но наружу не уходят.',
      };
    }

    return { ready: true };
  }

  async send(
    message: OutgoingNotification,
    settings: Record<string, unknown>,
  ): Promise<DeliveryResult> {
    const readiness = this.describeReadiness(settings);

    if (!readiness.ready) {
      return { delivered: false, detail: readiness.detail };
    }

    const token = settingString(settings, 'botToken') as string;
    const chatId = settingString(settings, 'chatId') as string;
    // Адрес — только из настроек развёртывания. Прежде его можно было
    // переопределить в настройках канала, и администратор интерфейса
    // (либо тот, кто завладел его сеансом) получал способ отправить
    // сохранённый токен бота на свой узел, хотя в ответах API токен скрыт.
    const apiUrl = this.defaultApiUrl;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, SEND_TIMEOUT_MS);

    try {
      const response = await fetch(`${apiUrl}/bot${token}/sendMessage`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: `${message.subject}\n\n${message.body}`,
        }),
      });

      if (!response.ok) {
        return {
          delivered: false,
          detail: `${this.channel}: сервис ответил кодом ${response.status}`,
        };
      }

      return { delivered: true };
    } catch (error: unknown) {
      // Недоступность мессенджера — ожидаемое состояние закрытого контура,
      // а не сбой системы: уровень предупреждения, а не ошибки.
      this.logger.warn(
        { err: error, channel: this.channel },
        'Не удалось доставить уведомление через мессенджер',
      );

      return {
        delivered: false,
        detail:
          error instanceof Error && error.name === 'AbortError'
            ? `${this.channel}: сервис не ответил за ${SEND_TIMEOUT_MS / 1000} с`
            : `${this.channel}: сервис недоступен`,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
