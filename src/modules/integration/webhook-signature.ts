import type { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PinoLogger } from 'nestjs-pino';
import type { AppConfig } from '../../config/configuration.js';
import { AppException } from '../../common/errors/app-exception.js';

/**
 * Проверка подписи входящего вызова внешней системы.
 *
 * Общая для всех открытых маршрутов приёма: событий LMS и сайта, оплат.
 * Сравнение выполняется постоянным по времени сравнением: обычное
 * посимвольное сравнение раскрывает подпись по времени ответа.
 */
export function verifyWebhookSignature(
  config: ConfigService<AppConfig, true>,
  logger: PinoLogger,
  rawBody: string,
  signature: string | undefined,
): void {
  const secret = config.get('INTEGRATION_WEBHOOK_SECRET', { infer: true });

  if (secret.length === 0) {
    // В production без секрета приём закрыт: маршрут открыт в интернет,
    // и неподписанный вызов создал бы заявку и запись о человеке от имени
    // кого угодно. Прежде проверка пропускалась при любом режиме, кроме
    // live, а стенд из-за неполного docker-compose работал именно в stub.
    if (config.get('NODE_ENV', { infer: true }) === 'production') {
      throw new AppException('INTEGRATION_WEBHOOK_DISABLED');
    }

    logger.warn('Проверка подписи входящего вызова пропущена: секрет не задан');
    return;
  }

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const provided = signature ?? '';

  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(provided, 'utf8');

  if (
    expectedBuffer.length !== providedBuffer.length ||
    !timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    throw new AppException('FORBIDDEN', {
      detail: 'Подпись входящего вызова не совпадает.',
    });
  }
}
