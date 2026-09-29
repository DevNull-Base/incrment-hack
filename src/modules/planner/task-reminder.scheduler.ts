import { Inject, Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module.js';
import { acquireRedisLock } from '../../infrastructure/redis/redis-lock.js';
import { TaskReminderService } from './task-reminder.service.js';

/** Ключ блокировки прогона: напоминания рассылает одна реплика worker. */
const LOCK_KEY = 'planner:reminders:lock';

/** Раз в минуту: напоминание «в 9:00» не должно приходить в 9:15. */
const TASK_REMINDER_CRON_DEFAULT = '0 * * * * *';

/**
 * Расписание напоминаний календаря.
 *
 * Подключается только в процессе worker (см. worker.module.ts): каждая
 * реплика API иначе запускала бы свой прогон. Блокировка нужна при
 * нескольких репликах worker — по той же причине, что и у напоминаний
 * о зависших заявках.
 */
@Injectable()
export class TaskReminderScheduler {
  constructor(
    private readonly reminders: TaskReminderService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TaskReminderScheduler.name);
  }

  @Cron(process.env.TASK_REMINDER_CRON ?? TASK_REMINDER_CRON_DEFAULT, { name: 'task-reminders' })
  async runScheduled(): Promise<void> {
    const lock = await acquireRedisLock(this.redis, LOCK_KEY, 55);

    if (!lock) {
      return;
    }

    try {
      const summary = await this.reminders.run();

      if (summary.due > 0) {
        this.logger.info({ ...summary }, 'Отправлены напоминания о задачах');
      }
    } catch (error: unknown) {
      this.logger.error({ err: error }, 'Сбой рассылки напоминаний о задачах');
    } finally {
      await lock.release();
    }
  }
}
