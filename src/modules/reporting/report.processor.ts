import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { QUEUES } from '../../infrastructure/queue/queue.module.js';
import { ReportService } from './report.service.js';

interface GenerateJobData {
  reportJobId: string;
  userId: string;
}

/**
 * Обработчик формирования отчётов.
 *
 * Параллельность задаётся настройкой WORKER_CONCURRENCY. Требование ТЗ —
 * не менее десяти одновременных отчётов; при значении по умолчанию 4
 * это достигается тремя репликами worker:
 *   docker compose up -d --scale worker=3
 */
@Processor(QUEUES.REPORTS, {
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4),
})
export class ReportProcessor extends WorkerHost {
  constructor(
    private readonly reports: ReportService,
    private readonly logger: PinoLogger,
  ) {
    super();
    this.logger.setContext(ReportProcessor.name);
  }

  async process(job: Job<GenerateJobData>): Promise<void> {
    this.logger.info({ reportJobId: job.data.reportJobId }, 'Начато формирование отчёта');
    await this.reports.generate(job.data.reportJobId);
  }
}
