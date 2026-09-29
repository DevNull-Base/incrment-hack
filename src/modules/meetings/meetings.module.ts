import { Module } from '@nestjs/common';
import { MeetingsController } from './meetings.controller.js';
import { MeetingsService } from './meetings.service.js';

/**
 * Встречи с представителями вуза. Сервис экспортируется для календаря:
 * встреча показывается в календаре каждого участника.
 */
@Module({
  controllers: [MeetingsController],
  providers: [MeetingsService],
  exports: [MeetingsService],
})
export class MeetingsModule {}
