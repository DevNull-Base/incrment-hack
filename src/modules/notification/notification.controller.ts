import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiPageResponse, PageDto } from '../../common/dto/pagination.dto.js';
import { Roles } from '../access/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { NotificationChannel } from '../../generated/prisma/enums.js';
import { NotificationService } from './notification.service.js';
import { EscalationService } from './escalation.service.js';
import {
  ChannelSettingsDto,
  NotificationDto,
  NotificationQueryDto,
  NotificationSettingsDto,
  UnreadCountDto,
  UpdateChannelDto,
  UpdatePolicyDto,
} from './dto/notification.dto.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';

/**
 * Уведомления.
 *
 * Свои уведомления доступны каждому пользователю, настройки каналов
 * и порога простоя — только администратору: правила общие для системы,
 * и менять их по своему усмотрению рядовой менеджер не должен.
 */
@ApiTags('Уведомления')
@ApiBearerAuth('keycloak')
@Controller({ path: 'notifications', version: '1' })
export class NotificationController {
  constructor(
    private readonly service: NotificationService,
    private readonly escalation: EscalationService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Мои уведомления',
    description:
      'По умолчанию отдаются уведомления внутри системы. Записи по внешним ' +
      'каналам — журнал доставки того же события, они доступны отбором по каналу.',
  })
  @ApiPageResponse(NotificationDto)
  list(
    @Query() query: NotificationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PageDto<NotificationDto>> {
    return this.service.list(user.id, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Число непрочитанных' })
  @ApiOkResponse({ type: UnreadCountDto })
  unreadCount(@CurrentUser() user: AuthenticatedUser): Promise<UnreadCountDto> {
    return this.service.unreadCount(user.id);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Отметить прочитанным' })
  @ApiParam({ name: 'id' })
  @ApiNoContentResponse({ description: 'Уведомление отмечено прочитанным' })
  markRead(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.service.markRead(user.id, id);
  }

  @Post('read-all')
  // Действие, а не создание ресурса: 200, а не 201 по умолчанию для POST.
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Отметить прочитанными все' })
  @ApiOkResponse({ schema: { properties: { updated: { type: 'number' } } } })
  markAllRead(@CurrentUser() user: AuthenticatedUser): Promise<{ updated: number }> {
    return this.service.markAllRead(user.id);
  }

  @Get('settings')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Правила уведомлений и состояние каналов',
    description: 'Значения секретов не возвращаются: вместо них подставляются точки.',
  })
  @ApiOkResponse({ type: NotificationSettingsDto })
  settings(): Promise<NotificationSettingsDto> {
    return this.service.getSettings();
  }

  @Put('settings')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Изменить правила уведомлений',
    description:
      'Порог простоя задаётся в днях: заказчик назвал ориентир «более одной ' +
      'или двух недель», точный срок остаётся за эксплуатацией.',
  })
  @ApiOkResponse({ type: NotificationSettingsDto })
  updatePolicy(
    @Body() dto: UpdatePolicyDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotificationSettingsDto> {
    return this.service.updatePolicy(dto, { id: user.id, email: user.email });
  }

  @Put('settings/channels/:channel')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Настроить канал доставки' })
  @ApiParam({ name: 'channel', enum: ['IN_APP', 'EMAIL', 'TELEGRAM', 'MAX'] })
  @ApiOkResponse({ type: ChannelSettingsDto })
  updateChannel(
    @Param('channel') channel: NotificationChannel,
    @Body() dto: UpdateChannelDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ChannelSettingsDto> {
    return this.service.updateChannel(channel, dto, { id: user.id, email: user.email });
  }

  /**
   * Прогон правила простоя прямо сейчас.
   *
   * Регламентная рассылка идёт раз в сутки, и ждать её, чтобы убедиться
   * в работе настройки, неудобно — особенно при демонстрации. Повторных
   * уведомлений прогон не создаёт: они отсекаются ключом повторной отправки.
   */
  @Post('escalation/run')
  // Действие, а не создание ресурса: 200, а не 201 по умолчанию для POST.
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Разослать напоминания о зависших заявках сейчас' })
  @ApiOkResponse({
    schema: { properties: { stale: { type: 'number' }, notified: { type: 'number' } } },
  })
  runEscalation(): Promise<{ stale: number; notified: number }> {
    return this.escalation.run();
  }

  @Post('settings/channels/:channel/test')
  // Действие, а не создание ресурса: 200, а не 201 по умолчанию для POST.
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Отправить проверочное сообщение',
    description:
      'Сообщение уходит настроенным каналом и сохраняется в журнале ' +
      'уведомлений вместе с результатом доставки.',
  })
  @ApiParam({ name: 'channel', enum: ['IN_APP', 'EMAIL', 'TELEGRAM', 'MAX'] })
  @ApiOkResponse({ type: ChannelSettingsDto })
  testChannel(
    @Param('channel') channel: NotificationChannel,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ChannelSettingsDto> {
    return this.service.sendTest(channel, {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
    });
  }
}
