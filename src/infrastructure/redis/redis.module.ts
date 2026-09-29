import { Global, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
// Именованный импорт обязателен: под ESM default-экспорт CommonJS-пакета
// ioredis разрешается в пространство имён модуля, а не в класс.
import { Redis, type RedisOptions } from 'ioredis';
import { AppConfig } from '../../config/configuration.js';

/** Основной клиент: кэш, состояние, блокировки. */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
/** Отдельный клиент для BullMQ — у очередей свои требования к настройкам. */
export const REDIS_QUEUE_CLIENT = Symbol('REDIS_QUEUE_CLIENT');

function createRedis(url: string, options: Pick<RedisOptions, 'maxRetriesPerRequest'>): Redis {
  return new Redis(url, {
    // Не копим бесконечную очередь команд, если Redis недоступен:
    // лучше быстро отдать ошибку, чем незаметно расти в памяти.
    ...options,
    enableReadyCheck: true,
    // Экспоненциальная задержка переподключения с потолком.
    retryStrategy: (times: number) => Math.min(times * 200, 5_000),
    lazyConnect: false,
  });
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) =>
        createRedis(config.get('REDIS_URL', { infer: true }), { maxRetriesPerRequest: 3 }),
    },
    {
      provide: REDIS_QUEUE_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) =>
        // BullMQ требует maxRetriesPerRequest: null — иначе блокирующие
        // операции чтения из очереди прерываются по таймауту.
        createRedis(config.get('REDIS_URL', { infer: true }), { maxRetriesPerRequest: null }),
    },
  ],
  exports: [REDIS_CLIENT, REDIS_QUEUE_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(private readonly moduleRef: ModuleRef) {}

  /** Корректно закрываем соединения при остановке процесса (graceful shutdown). */
  async onApplicationShutdown(): Promise<void> {
    for (const token of [REDIS_CLIENT, REDIS_QUEUE_CLIENT]) {
      const client = this.moduleRef.get<Redis>(token, { strict: false });
      if (client && client.status !== 'end') {
        await client.quit().catch(() => client.disconnect());
      }
    }
  }
}
