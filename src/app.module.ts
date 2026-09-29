import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppConfigModule } from './config/config.module.js';
import { AppLoggingModule } from './common/logging/logging.module.js';
import { MetricsModule } from './common/metrics/metrics.module.js';
import { MetricsInterceptor } from './common/metrics/metrics.interceptor.js';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter.js';
import { PrismaModule } from './infrastructure/prisma/prisma.module.js';
import { RedisModule } from './infrastructure/redis/redis.module.js';
import { StorageModule } from './infrastructure/storage/storage.module.js';
import { QueueModule } from './infrastructure/queue/queue.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { AccessModule } from './modules/access/access.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { WorkflowModule } from './modules/workflow/workflow.module.js';
import { EngagementModule } from './modules/engagement/engagement.module.js';
import { FilesModule } from './modules/files/files.module.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';
import { ImportModule } from './modules/import/import.module.js';
import { ReportingModule } from './modules/reporting/reporting.module.js';
import { ActivityModule } from './modules/activity/activity.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { IntegrationModule } from './modules/integration/integration.module.js';
import { NotificationModule } from './modules/notification/notification.module.js';
import { GuidesModule } from './modules/guides/guides.module.js';
import { NotesModule } from './modules/notes/notes.module.js';
import { PlannerModule } from './modules/planner/planner.module.js';
import { MeetingsModule } from './modules/meetings/meetings.module.js';

/**
 * Корневой модуль приложения.
 *
 * Один и тот же набор модулей поднимают оба процесса — api и worker.
 * Различие в точках входа (main.ts / worker.ts): api открывает HTTP-порт,
 * worker работает без него и обрабатывает очереди. Такой подход даёт
 * независимое масштабирование при единой кодовой базе и одном Docker-образе.
 */
@Module({
  imports: [
    AppConfigModule,
    AppLoggingModule,
    MetricsModule,
    PrismaModule,
    RedisModule,
    StorageModule,
    QueueModule,

    // Внутренняя шина доменных событий (аудит, инвалидация кэша, уведомления).
    EventEmitterModule.forRoot({ global: true, delimiter: '.' }),

    // Планировщик: SLA-проверки, очистка истёкших отчётов и ключей идемпотентности.
    ScheduleModule.forRoot(),

    // AccessModule раньше AuthModule: глобальные guard'ы аутентификации
    // используют RolesGuard из модуля доступа.
    AccessModule,
    AuthModule,

    AuditModule,

    HealthModule,
    CatalogModule,
    WorkflowModule,
    EngagementModule,
    FilesModule,
    RealtimeModule,
    ImportModule,
    ReportingModule,
    ActivityModule,
    AdminModule,
    IntegrationModule,
    NotificationModule,
    GuidesModule,
    NotesModule,
    PlannerModule,
    MeetingsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
  ],
})
export class AppModule {}
