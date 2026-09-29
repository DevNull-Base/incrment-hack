import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PinoLogger } from 'nestjs-pino';
import { AppConfig } from '../../config/configuration.js';
import { PrismaClient } from '../../generated/prisma/client.js';

/**
 * Клиент PostgreSQL поверх Prisma.
 *
 * В Prisma 7 нет Rust-движка: запросы компилируются в JS, а соединение
 * обеспечивает драйверный адаптер (pg). Поэтому пул настраивается здесь,
 * а не через параметры строки подключения.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly logger: PinoLogger,
  ) {
    const adapter = new PrismaPg({
      connectionString: config.get('DATABASE_URL', { infer: true }),
      // Размер пула на процесс. Суммарно по всем репликам api и worker
      // не должен превышать max_connections сервера PostgreSQL.
      max: config.get('DB_POOL_MAX', { infer: true }),
      // Не держим простаивающие соединения дольше необходимого.
      idleTimeoutMillis: 30_000,
      // Быстро падаем, если БД недоступна, вместо «зависания» запроса.
      connectionTimeoutMillis: 5_000,
    });

    super({ adapter });

    this.logger.setContext(PrismaService.name);
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.info('Соединение с PostgreSQL установлено');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.info('Соединение с PostgreSQL закрыто');
  }

  /** Лёгкая проверка доступности БД для health-эндпоинта. */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
