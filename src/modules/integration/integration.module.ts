import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { IntegrationController } from './integration.controller.js';
import { IntegrationService } from './integration.service.js';
import { LmsExportController } from './lms-export/lms-export.controller.js';
import { LmsExportService } from './lms-export/lms-export.service.js';
import { PaymentIntakeController } from './payments/payment-intake.controller.js';
import { PaymentIntakeService } from './payments/payment-intake.service.js';

/**
 * Обмен с LMS и сайтом.
 *
 * Обработчик очереди и отправка исходящих событий здесь НЕ регистрируются:
 * они подключаются только в процессе worker (см. worker.module.ts). Модуль
 * содержит то, что нужно API-процессу: запуск синхронизации, приём вызовов
 * внешних систем, публикацию контракта, приём оплат с сайта и выгрузку
 * оплативших слушателей для загрузки в LMS.
 */
@Module({
  // Модуль файлов — ради антивирусной проверки загружаемых файлов оплат.
  imports: [WorkflowModule, FilesModule],
  controllers: [IntegrationController, PaymentIntakeController, LmsExportController],
  providers: [IntegrationService, PaymentIntakeService, LmsExportService],
  exports: [IntegrationService],
})
export class IntegrationModule {}
