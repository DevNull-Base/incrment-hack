import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ActivityController } from './activity.controller.js';
import { ActivityService } from './activity.service.js';
import { ActivityFeedController, EngagementTimelineController } from './activity-feed.controller.js';
import { ActivityFeedService } from './activity-feed.service.js';
import { IdempotencyInterceptor } from './idempotency.interceptor.js';

/**
 * Кэш действий пользователя (функц. требование ТЗ, п.13).
 *
 * Перехватчик идемпотентности регистрируется глобально: защита от дублей
 * нужна всем изменяющим методам, а не отдельно выбранным. Он не срабатывает,
 * если клиент не прислал заголовок Idempotency-Key, поэтому существующие
 * клиенты от его появления не страдают.
 *
 * Здесь же лента действий: записи в неё делают сами модули в своих
 * транзакциях (см. activity-log.ts), а этот модуль их только читает.
 */
@Module({
  controllers: [ActivityController, ActivityFeedController, EngagementTimelineController],
  providers: [
    ActivityService,
    ActivityFeedService,
    IdempotencyInterceptor,
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
  exports: [ActivityService],
})
export class ActivityModule {}
