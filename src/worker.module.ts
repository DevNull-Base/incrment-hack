import { Module } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { ImportModule } from './modules/import/import.module.js';
import { ImportProcessor } from './modules/import/import.processor.js';
import { IntegrationModule } from './modules/integration/integration.module.js';
import {
  IntegrationProcessor,
  OutboxDispatcher,
} from './modules/integration/integration.processor.js';
import { NotificationModule } from './modules/notification/notification.module.js';
import { EscalationScheduler } from './modules/notification/escalation.scheduler.js';
import { PlannerModule } from './modules/planner/planner.module.js';
import { TaskReminderScheduler } from './modules/planner/task-reminder.scheduler.js';
import { ReportingModule } from './modules/reporting/reporting.module.js';
import { ReportProcessor } from './modules/reporting/report.processor.js';
import { RetentionModule } from './modules/retention/retention.module.js';

/**
 * Модуль процесса worker.
 *
 * Содержит то же приложение, что и процесс api, плюс ОБРАБОТЧИКИ очередей.
 * Разделение сделано явными модулями, а не проверкой переменной окружения
 * внутри общего модуля: топология процессов видна из кода, и невозможно
 * случайно запустить обработчики в API, где тяжёлая задача заблокировала бы
 * обслуживание запросов.
 *
 * Точка входа: worker.ts
 */
@Module({
  // RetentionModule подключён только здесь: регламентная очистка должна
  // выполняться фоновым процессом, а не каждой репликой API.
  imports: [
    AppModule,
    ImportModule,
    ReportingModule,
    RetentionModule,
    IntegrationModule,
    NotificationModule,
    PlannerModule,
  ],
  // OutboxDispatcher живёт здесь же: отправка накопленных событий — такая же
  // фоновая работа, и в API-процессе ей делать нечего.
  providers: [
    ImportProcessor,
    ReportProcessor,
    IntegrationProcessor,
    OutboxDispatcher,
    EscalationScheduler,
    TaskReminderScheduler,
  ],
})
export class WorkerModule {}
