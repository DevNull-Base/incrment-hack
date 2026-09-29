import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/notification.module.js';
import { MeetingsModule } from '../meetings/meetings.module.js';
import { PlannerController } from './planner.controller.js';
import { PlannerService } from './planner.service.js';
import { TaskReminderService } from './task-reminder.service.js';

/**
 * Календарь задач.
 *
 * Планировщик напоминаний здесь не регистрируется: он подключается только
 * в процессе worker (см. worker.module.ts), как и напоминания о зависших
 * заявках.
 */
@Module({
  imports: [NotificationModule, MeetingsModule],
  controllers: [PlannerController],
  providers: [PlannerService, TaskReminderService],
  exports: [TaskReminderService],
})
export class PlannerModule {}
