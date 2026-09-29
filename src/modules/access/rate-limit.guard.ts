import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { AppConfig } from '../../config/configuration.js';
import { AppException } from '../../common/errors/app-exception.js';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module.js';
import {
  RATE_LIMIT_KEY,
  RATE_LIMIT_SKIP_KEY,
  type RateLimitOptions,
} from './rate-limit.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';

interface ThrottledRequest {
  ip?: string;
  method?: string;
  routeOptions?: { url?: string };
  url?: string;
  user?: AuthenticatedUser;
}

/**
 * Ограничение интенсивности обращений к API.
 *
 * Зачем это нужно. Разграничение доступа отвечает на вопрос «кому какие
 * данные видны», но не ограничивает объём: пользователь, которому по праву
 * доступны сто вузов, может за минуту выгрузить их все скриптом — включая
 * персональные данные контактных лиц. Ограничение частоты превращает такую
 * выгрузку из мгновенной в заметную, а заодно закрывает перебор
 * идентификаторов и лавину обращений к тяжёлым методам.
 *
 * Счётчики хранятся в Redis, а не в памяти процесса. Это принципиально:
 * при нескольких репликах API память каждой хранила бы свой счётчик,
 * и фактический лимит умножался бы на число реплик — то есть был бы
 * тем слабее, чем сильнее нагрузка.
 *
 * Применяется схема фиксированного окна. Скользящее окно точнее на границе,
 * но требует хранить отметки времени каждого запроса; для задачи «отсечь
 * автоматизированную выгрузку» разницы нет, а цена в памяти и командах
 * Redis отличается на порядок.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RateLimitGuard.name);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return true;
    }

    const skip = this.reflector.getAllAndOverride<boolean>(RATE_LIMIT_SKIP_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skip) {
      return true;
    }

    const options =
      this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? {};

    const http = context.switchToHttp();
    const request = http.getRequest<ThrottledRequest>();

    const ttlSec = options.ttlSec ?? this.config.get('THROTTLE_TTL_SEC', { infer: true });
    const limit =
      options.limit ??
      (options.export
        ? this.config.get('THROTTLE_EXPORT_LIMIT', { infer: true })
        : this.config.get('THROTTLE_LIMIT', { infer: true }));

    // Ключ строится по пользователю, а не по адресу: менеджеры Школы
    // работают из общей сети, и лимит на адрес делили бы все двадцать
    // человек разом. Для запросов без пользователя (открытые маршруты)
    // остаётся адрес — иного признака у них нет.
    const subject = request.user?.id ?? request.ip ?? 'unknown';
    const bucket = options.bucket ?? request.routeOptions?.url ?? request.url ?? 'default';
    const window = Math.floor(Date.now() / 1000 / ttlSec);
    const key = `rl:${bucket}:${subject}:${window}`;

    let used: number;

    try {
      used = await this.redis.incr(key);

      // Срок жизни ставится только при создании ключа: повторный EXPIRE
      // на каждом запросе продлевал бы окно до бесконечности при постоянном
      // потоке — то есть лимит никогда бы не сбрасывался.
      if (used === 1) {
        await this.redis.expire(key, ttlSec);
      }
    } catch (error) {
      // Недоступность Redis не должна останавливать работу системы:
      // ограничение частоты — защитная мера, а не условие корректности.
      // Событие пишется с уровнем warn, по нему настраивается оповещение.
      this.logger.warn(
        { err: error, bucket },
        'Кэш недоступен: ограничение частоты обращений временно не действует',
      );
      return true;
    }

    if (used > limit) {
      const response = http.getResponse<{ header?: (name: string, value: string) => unknown }>();
      const retryAfter = ttlSec - (Math.floor(Date.now() / 1000) % ttlSec);
      response.header?.('Retry-After', String(retryAfter));

      this.logger.warn(
        { subject, bucket, used, limit, userId: request.user?.id ?? null },
        'Превышено ограничение частоты обращений',
      );

      throw new AppException('RATE_LIMITED', {
        detail: `Допускается не более ${limit} обращений за ${ttlSec} с. Повторите через ${retryAfter} с.`,
        meta: { limit, windowSeconds: ttlSec, retryAfterSeconds: retryAfter },
      });
    }

    return true;
  }
}
