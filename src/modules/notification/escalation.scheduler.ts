import { Inject, Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module.js';
import { acquireRedisLock } from '../../infrastructure/redis/redis-lock.js';
import { EscalationService } from './escalation.service.js';

/** Ключ блокировки прогона: напоминания рассылает одна реплика worker. */
const LOCK_KEY = 'notifications:escalation:lock';

/** Расписание по умолчанию: ежедневно в 09:00, к началу рабочего дня. */
const ESCALATION_CRON_DEFAULT = '0 0 9 * * *';

/**
 * Регламентная рассылка напоминаний о зависших заявках.
 *
 * Здесь только расписание и блокировка: сам отбор заявок живёт
 * в EscalationService, поскольку тот же проход вызывается администратором
 * вручную из API, где расписание ни при чём.
 *
 * Блокировка обязательна при нескольких репликах worker: без неё каждая
 * разослала бы свой комплект напоминаний. Ключ повторной отправки защитил бы
 * от дублей и без этого, но платой были бы лишние обращения к мессенджерам.
 */
@Injectable()
export class EscalationScheduler {
  constructor(
    private readonly escalation: EscalationService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(EscalationScheduler.name);
  }

  @Cron(process.env.ESCALATION_CRON ?? ESCALATION_CRON_DEFAULT, { name: 'sla-escalation' })
  async runScheduled(): Promise<void> {
    const lock = await acquireRedisLock(this.redis, LOCK_KEY, 600);

    if (!lock) {
      return;
    }

    try {
      const summary = await this.escalation.run();

      if (summary.stale > 0) {
        this.logger.info({ ...summary }, 'Разосланы напоминания о зависших заявках');
      }
    } catch (error: unknown) {
      this.logger.error({ err: error }, 'Сбой рассылки напоминаний');
    } finally {
      await lock.release();
    }
  }
}
