import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ApiPageResponse, PageDto } from '../../common/dto/pagination.dto.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ActivityFeedService } from './activity-feed.service.js';
import {
  ActivityFeedQueryDto,
  ActivityItemDto,
  EngagementTimelineQueryDto,
  RecentEngagementDto,
  RecentEngagementsQueryDto,
} from './dto/activity-feed.dto.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';

/**
 * Лента действий пользователя.
 *
 * Менеджер возвращается к вузу спустя недели и должен восстановить ход
 * работы: что он сам менял, на каком этапе остановился, что обещал.
 * Журнал аудита на этот вопрос не отвечает — он доступен только
 * администратору и служит безопасности, а не работе.
 */
@ApiTags('Лента действий')
@ApiBearerAuth('keycloak')
@Controller({ path: 'activity', version: '1' })
export class ActivityFeedController {
  constructor(private readonly service: ActivityFeedService) {}

  @Get('feed')
  @ApiOperation({
    summary: 'Мои действия',
    description:
      'Что пользователь делал сам: смены статусов, заметки, файлы, оценки ' +
      'заинтересованности, задачи. Новые сверху. События по заявкам, которые больше ' +
      'не входят в область видимости пользователя, не показываются.',
  })
  @ApiPageResponse(ActivityItemDto)
  feed(
    @Query() query: ActivityFeedQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PageDto<ActivityItemDto>> {
    return this.service.myFeed(query, user);
  }

  @Get('engagements')
  @ApiOperation({
    summary: 'Мои заявки за последние дни',
    description:
      'Заявки, по которым пользователь что-то делал за указанное число дней (по умолчанию 14), ' +
      'в порядке последнего действия. Для главного экрана: карточка заявки в том же виде, ' +
      'что и в списке, последнее действие по ней и число действий за период.',
  })
  @ApiOkResponse({ type: RecentEngagementDto, isArray: true })
  recentEngagements(
    @Query() query: RecentEngagementsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<RecentEngagementDto[]> {
    return this.service.recentEngagements(query, user);
  }
}

/**
 * История заявки целиком.
 *
 * В карточке уже есть журнал переходов, но он отвечает только на вопрос
 * «когда менялся статус». Здесь — всё остальное: заметки, файлы, оценки,
 * смена ответственного, задачи, переносы при изменении процесса.
 */
@ApiTags('Лента действий')
@ApiBearerAuth('keycloak')
@Controller({ path: 'engagements/:engagementId/timeline', version: '1' })
export class EngagementTimelineController {
  constructor(private readonly service: ActivityFeedService) {}

  @Get()
  @ApiOperation({
    summary: 'История заявки',
    description: 'Все действия по заявке, кто бы их ни совершал. Новые сверху.',
  })
  @ApiParam({ name: 'engagementId', format: 'uuid' })
  @ApiPageResponse(ActivityItemDto)
  timeline(
    @Param('engagementId', ParseUUIDPipe) engagementId: string,
    @Query() query: EngagementTimelineQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PageDto<ActivityItemDto>> {
    return this.service.engagementTimeline(engagementId, query, user);
  }
}
