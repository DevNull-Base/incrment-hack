import { Module } from '@nestjs/common';
import { ReportController } from './report.controller.js';
import { ReportService } from './report.service.js';
import { ReportQueryBuilder } from './report-query.builder.js';
import { ReportRendererService } from './report-renderer.service.js';

/**
 * Формирование отчётов.
 *
 * Обработчик очереди в модуль не входит: он подключается отдельно
 * в процессе worker, поэтому процесс api умеет ставить задачи,
 * но никогда не выполняет рендеринг документов.
 */
@Module({
  controllers: [ReportController],
  providers: [ReportService, ReportQueryBuilder, ReportRendererService],
  exports: [ReportService],
})
export class ReportingModule {}
