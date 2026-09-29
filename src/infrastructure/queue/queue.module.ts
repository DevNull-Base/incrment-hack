import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration.js';

/** Имена очередей. Вынесены в константы, чтобы опечатка не создала «пустую» очередь. */
export const QUEUES = {
  /** Формирование отчётов: самые тяжёлые задачи. */
  REPORTS: 'reports',
  /** Разбор и применение импортируемых файлов. */
  IMPORT: 'import',
  /** Синхронизация с внешними системами. */
  INTEGRATION: 'integration',
  /** Регламентные работы: очистка истёкших файлов, проверка нормативов. */
  MAINTENANCE: 'maintenance',
} as const;

/**
 * Очереди фоновых задач.
 *
 * Регистрируются в обоих процессах, но с разным назначением: процесс api
 * только ставит задачи, обработчики живут в процессе worker. Такое
 * разделение — основа выполнения требования по времени отклика: рендеринг
 * XLSX или PDF занимает процессор на секунды и в API-процессе заблокировал
 * бы обслуживание всех остальных запросов.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const url = new URL(config.get('REDIS_URL', { infer: true }));

        return {
          connection: {
            host: url.hostname,
            port: Number(url.port || 6379),
            username: url.username || undefined,
            password: url.password || undefined,
            // Номер базы из адреса (redis://host:6379/1) обязателен: без него
            // очереди уходили в базу 0, пока кэш работал в указанной, и два
            // экземпляра на общем Redis разбирали задачи друг друга.
            db: Number(url.pathname.replace('/', '') || 0),
            // BullMQ требует null: иначе блокирующее чтение из очереди
            // прерывается по достижении лимита повторов, и обработчик
            // перестаёт получать задачи.
            maxRetriesPerRequest: null,
          },
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            // Успешные задачи храним ограниченно: очередь не должна
            // превращаться в неуправляемо растущий журнал.
            removeOnComplete: { age: 3600, count: 1000 },
            // Неуспешные держим дольше — они нужны для разбора инцидентов.
            removeOnFail: { age: 24 * 3600 },
          },
        };
      },
    }),

    BullModule.registerQueue(
      { name: QUEUES.REPORTS },
      { name: QUEUES.IMPORT },
      { name: QUEUES.INTEGRATION },
      { name: QUEUES.MAINTENANCE },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
