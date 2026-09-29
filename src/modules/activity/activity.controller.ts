import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ActivityService } from './activity.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';

class SaveStateDto {
  @ApiProperty({
    description:
      'Произвольное состояние экрана: выбранные фильтры, колонки, сортировка, ' +
      'номер страницы, открытые вкладки. Структуру определяет фронтенд.',
    type: 'object',
    additionalProperties: true,
    example: {
      filters: { directionIds: ['...'], periodFrom: '2025-01-01' },
      columns: ['universityName', 'stateLabel'],
      sort: { by: 'updatedAt', order: 'desc' },
      page: 3,
    },
  })
  @IsObject()
  state!: Record<string, unknown>;
}

class SaveDraftDto {
  @ApiProperty({
    description: 'Содержимое незавершённого ввода',
    type: 'object',
    additionalProperties: true,
    example: { comment: 'Согласовали состав пилота, ожидаем...' },
  })
  @IsObject()
  payload!: Record<string, unknown>;
}

class TrackVisitDto {
  @ApiProperty({ description: 'Название объекта для отображения в списке недавних' })
  @IsString()
  @MaxLength(300)
  title!: string;
}

class WorkspaceStateDto {
  @ApiProperty({ description: 'Ключ экрана', example: 'engagements.list' })
  scopeKey!: string;

  @ApiProperty({ description: 'Сохранённое состояние', type: 'object', additionalProperties: true })
  state!: Record<string, unknown>;

  @ApiProperty({ description: 'Когда сохранено', nullable: true })
  updatedAt!: Date | null;
}

class RecentItemDto {
  @ApiProperty({ example: 'ENGAGEMENT' })
  entityType!: string;

  @ApiProperty({ format: 'uuid' })
  entityId!: string;

  @ApiProperty({ description: 'Название объекта' })
  title!: string;

  @ApiProperty()
  visitedAt!: Date;
}

/**
 * Рабочий контекст пользователя — функциональное требование ТЗ (п.13).
 *
 * Назначение подсистемы: пользователь не должен терять результат своей
 * работы при перезагрузке страницы, потере связи или переходе на другое
 * устройство. Настроенные фильтры, выбранные колонки и недописанный
 * комментарий сохраняются на сервере и восстанавливаются при возвращении.
 *
 * Это же требование объясняет, почему интерфейс не обязан перезагружаться
 * при манипуляциях с данными: состояние экрана известно серверу, и после
 * любого обновления его можно восстановить точно в том виде, в каком
 * пользователь его оставил.
 */
@ApiTags('Рабочий контекст')
@ApiBearerAuth('keycloak')
@Controller({ path: 'activity', version: '1' })
export class ActivityController {
  constructor(private readonly service: ActivityService) {}

  /** Сводка контекста — запрашивается интерфейсом сразу после входа. */
  @Get('snapshot')
  @ApiOperation({
    summary: 'Сводка рабочего контекста',
    description:
      'Недавно просмотренные объекты, незавершённые черновики и перечень экранов ' +
      'с сохранённым состоянием. Позволяет предложить пользователю продолжить с того места, ' +
      'где он остановился.',
  })
  snapshot(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getSnapshot(user);
  }

  @Get('workspace/:scopeKey')
  @ApiOperation({ summary: 'Состояние экрана' })
  @ApiParam({
    name: 'scopeKey',
    description: 'Идентификатор экрана',
    example: 'engagements.list',
  })
  @ApiOkResponse({ type: WorkspaceStateDto })
  getWorkspace(
    @Param('scopeKey') scopeKey: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WorkspaceStateDto> {
    return this.service.getWorkspace(user.id, scopeKey);
  }

  @Put('workspace/:scopeKey')
  @ApiOperation({
    summary: 'Сохранить состояние экрана',
    description:
      'Вызывается при изменении фильтров, состава колонок или сортировки. ' +
      'Состояние восстанавливается при следующем открытии экрана, в том числе с другого устройства.',
  })
  @ApiParam({ name: 'scopeKey', example: 'engagements.list' })
  @ApiOkResponse({ type: WorkspaceStateDto })
  saveWorkspace(
    @Param('scopeKey') scopeKey: string,
    @Body() dto: SaveStateDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WorkspaceStateDto> {
    return this.service.saveWorkspace(user.id, scopeKey, dto.state);
  }

  @Delete('workspace/:scopeKey')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Сбросить состояние экрана' })
  @ApiParam({ name: 'scopeKey', example: 'engagements.list' })
  @ApiNoContentResponse()
  clearWorkspace(
    @Param('scopeKey') scopeKey: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.service.clearWorkspace(user.id, scopeKey);
  }

  /**
   * Черновик незавершённого ввода.
   *
   * Вызывается периодически во время набора текста. Сохранённый черновик
   * подставляется при повторном открытии формы — недописанный комментарий
   * к переходу не пропадает при закрытии вкладки.
   */
  @Put('drafts/:entityType')
  @ApiOperation({ summary: 'Сохранить черновик' })
  @ApiParam({ name: 'entityType', example: 'engagement.transition' })
  @ApiQuery({ name: 'entityId', required: false, description: 'Объект, к которому относится ввод' })
  saveDraft(
    @Param('entityType') entityType: string,
    @Query('entityId') entityId: string | undefined,
    @Body() dto: SaveDraftDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.saveDraft(user.id, entityType, entityId ?? null, dto.payload);
  }

  @Get('drafts/:entityType')
  @ApiOperation({ summary: 'Получить черновик' })
  @ApiParam({ name: 'entityType', example: 'engagement.transition' })
  @ApiQuery({ name: 'entityId', required: false })
  getDraft(
    @Param('entityType') entityType: string,
    @Query('entityId') entityId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getDraft(user.id, entityType, entityId ?? null);
  }

  @Delete('drafts/:entityType')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Удалить черновик',
    description:
      'Вызывается после успешной отправки формы: иначе при следующем открытии ' +
      'подставился бы уже отправленный текст.',
  })
  @ApiParam({ name: 'entityType', example: 'engagement.transition' })
  @ApiQuery({ name: 'entityId', required: false })
  @ApiNoContentResponse()
  discardDraft(
    @Param('entityType') entityType: string,
    @Query('entityId') entityId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.service.discardDraft(user.id, entityType, entityId ?? null);
  }

  @Get('recent')
  @ApiOperation({ summary: 'Недавно просмотренные объекты' })
  @ApiOkResponse({ type: RecentItemDto, isArray: true })
  recent(@CurrentUser() user: AuthenticatedUser): Promise<RecentItemDto[]> {
    return this.service.listRecent(user.id);
  }

  @Put('recent/:entityType/:entityId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Отметить объект просмотренным' })
  @ApiParam({ name: 'entityType', example: 'ENGAGEMENT' })
  @ApiParam({ name: 'entityId', format: 'uuid' })
  @ApiNoContentResponse()
  trackVisit(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Body() dto: TrackVisitDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.service.trackVisit(user.id, entityType, entityId, dto.title);
  }
}

/** Необязательное поле фильтра — вынесено для наглядности схемы Swagger. */
export class ActivityQueryDto {
  @ApiPropertyOptional({ description: 'Идентификатор объекта' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  entityId?: string;
}
