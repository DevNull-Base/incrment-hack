import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { QUEUES } from '../../infrastructure/queue/queue.module.js';
import { ImportService } from './import.service.js';

interface ParseJobData {
  jobId: string;
  userId: string;
}

/**
 * Обработчик задач импорта.
 *
 * Регистрируется только в процессе worker (см. worker.module.ts): разбор
 * файла на десятки тысяч строк занимает процессор на секунды, и в
 * API-процессе он остановил бы обслуживание всех остальных запросов.
 */
@Processor(QUEUES.IMPORT, {
  // Разбор файла ограничен по памяти, поэтому параллельность держим
  // заметно ниже, чем у лёгких задач.
  concurrency: 2,
})
export class ImportProcessor extends WorkerHost {
  constructor(
    private readonly importService: ImportService,
    private readonly logger: PinoLogger,
  ) {
    super();
    this.logger.setContext(ImportProcessor.name);
  }

  async process(job: Job<ParseJobData>): Promise<void> {
    this.logger.info({ jobName: job.name, importJobId: job.data.jobId }, 'Начата обработка импорта');

    switch (job.name) {
      case 'parse':
        await this.importService.runDryRun(job.data.jobId);
        break;
      default:
        this.logger.warn({ jobName: job.name }, 'Неизвестный тип задачи импорта');
    }
  }
}
