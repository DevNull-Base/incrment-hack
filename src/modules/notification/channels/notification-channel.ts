import { NotificationChannel } from '../../../generated/prisma/enums.js';

/** Сообщение, подготовленное к доставке. */
export interface OutgoingNotification {
  subject: string;
  body: string;
  /** Кому адресовано — для каналов, где адрес берётся из профиля. */
  recipient: { id: string; displayName: string; email: string };
  /** Объект, к которому относится уведомление. */
  entityType?: string | null;
  entityId?: string | null;
}

/** Итог попытки доставки. */
export interface DeliveryResult {
  delivered: boolean;
  /**
   * Пояснение, когда доставки не произошло. Пустое значение при
   * delivered = false недопустимо: непрояснённый отказ в журнале
   * ничем не лучше отсутствия записи.
   */
  detail?: string;
}

/**
 * Канал доставки уведомлений.
 *
 * Каналы намеренно не знают, почему их вызвали: и напоминание о зависшей
 * заявке, и сообщение о смене статуса приходят одним и тем же способом.
 * Различие живёт в тексте сообщения, а не в транспорте.
 */
export interface NotificationChannelTransport {
  readonly channel: NotificationChannel;

  /**
   * Готов ли канал к работе с такими настройками.
   *
   * Проверяется до попытки доставки: включённый канал без обязательных
   * параметров должен объясняться администратору сразу, а не превращаться
   * в поток ошибок доставки.
   */
  describeReadiness(settings: Record<string, unknown>): { ready: boolean; detail?: string };

  send(
    message: OutgoingNotification,
    settings: Record<string, unknown>,
  ): Promise<DeliveryResult>;
}

/** Значение настройки как непустая строка, иначе null. */
export function settingString(
  settings: Record<string, unknown>,
  key: string,
): string | null {
  const value = settings[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
