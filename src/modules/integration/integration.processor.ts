import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Job } from 'bullmq';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { QUEUES } from '../../infrastructure/queue/queue.module.js';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module.js';
import { acquireRedisLock } from '../../infrastructure/redis/redis-lock.js';
import { AppConfig } from '../../config/configuration.js';
import { IntegrationService } from './integration.service.js';

interface SyncJobData {
  runId: string;
  sourceId: string;
}

/**
 * Обработчик задач обмена с внешними системами.
 *
 * Регистрируется только в процессе worker: обращение к внешней системе
 * ограничено тайм-аутом, но всё равно занимает секунды, и в API-процессе
 * это отражалось бы на времени отклика интерфейса.
 */
@Processor(QUEUES.INTEGRATION, { concurrency: 2 })
export class IntegrationProcessor extends WorkerHost {
  constructor(
    private readonly integration: IntegrationService,
    private readonly logger: PinoLogger,
  ) {
    super();
    this.logger.setContext(IntegrationProcessor.name);
  }

  async process(job: Job<SyncJobData>): Promise<void> {
    switch (job.name) {
      case 'sync':
        await this.integration.runSync(job.data.runId, job.data.sourceId);
        break;
      default:
        this.logger.warn({ jobName: job.name }, 'Неизвестный тип задачи интеграции');
    }
  }
}

/** Ключ блокировки отправки: очередь исходящих одна на весь стенд. */
const OUTBOX_LOCK_KEY = 'integration:outbox:lock';

/** Сколько внешних систем получает каждое событие: LMS и сайт. */
const OUTBOX_TARGETS = 2;

/** Расписание отправки по умолчанию: каждые 30 секунд. */
const OUTBOX_CRON_DEFAULT = '*/30 * * * * *';

/**
 * Регламентная отправка накопленных исходящих событий.
 *
 * Вынесена в отдельный провайдер, а не в обработчик очереди: событиям
 * не нужна очередь — они уже сохранены в журнале исходящих, и достаточно
 * периодически его разбирать.
 *
 * Блокировка обязательна при нескольких репликах worker: без неё каждая
 * отправила бы одни и те же события, и внешняя система получила бы дубли.
 */
@Injectable()
export class OutboxDispatcher {
  constructor(
    private readonly integration: IntegrationService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutboxDispatcher.name);
    this.logger.info(
      { schedule: process.env.INTEGRATION_OUTBOX_CRON ?? OUTBOX_CRON_DEFAULT },
      'Отправка исходящих событий запланирована',
    );
  }

  @Cron(process.env.INTEGRATION_OUTBOX_CRON ?? OUTBOX_CRON_DEFAULT, { name: 'integration-outbox' })
  async dispatch(): Promise<void> {
    // Срок блокировки считается от тайм-аута обращения: одно событие уходит
    // в две системы, и каждая может молчать до тайм-аута. Новое событие
    // берётся, только если его отправка заведомо успеет до истечения
    // блокировки, — иначе следующий запуск взял бы те же события и они
    // ушли бы во внешние системы дважды.
    const timeoutSec = Math.ceil(this.config.get('INTEGRATION_HTTP_TIMEOUT_MS', { infer: true }) / 1000);
    const perEventSec = OUTBOX_TARGETS * timeoutSec + 10;
    const ttlSec = Math.max(120, perEventSec * 3);
    const lock = await acquireRedisLock(this.redis, OUTBOX_LOCK_KEY, ttlSec);

    if (!lock) {
      return;
    }

    try {
      await this.integration.drainOutbox({ deadline: Date.now() + (ttlSec - perEventSec) * 1000 });
    } catch (error: unknown) {
      this.logger.error({ err: error }, 'Сбой отправки исходящих событий');
    } finally {
      await lock.release();
    }
  }
}
