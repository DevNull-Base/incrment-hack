import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { MeetingsService } from './meetings.service.js';
import { CreateMeetingDto, MeetingDto, UpdateMeetingDto } from './dto/meeting.dto.js';

/**
 * Встречи с представителями вуза по заявке.
 *
 * Удаления нет: несостоявшаяся встреча отменяется (status = CANCELLED)
 * и остаётся в истории работы с вузом.
 */
@ApiTags('Встречи')
@ApiBearerAuth('keycloak')
@Controller({ path: 'engagements/:engagementId/meetings', version: '1' })
export class MeetingsController {
  constructor(private readonly service: MeetingsService) {}

  @Get()
  @ApiOperation({ summary: 'Встречи заявки', description: 'По времени начала.' })
  @ApiParam({ name: 'engagementId', format: 'uuid' })
  @ApiOkResponse({ type: MeetingDto, isArray: true })
  list(
    @Param('engagementId', ParseUUIDPipe) engagementId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MeetingDto[]> {
    return this.service.list(engagementId, user);
  }

  @Post()
  @ApiOperation({
    summary: 'Назначить встречу',
    description:
      'Сотрудники не указаны — встречу проводит автор. Представители выбираются из ответственных ' +
      'вуза заявки. Встреча появляется в календаре участников и в истории заявки.',
  })
  @ApiParam({ name: 'engagementId', format: 'uuid' })
  @ApiCreatedResponse({ type: MeetingDto })
  create(
    @Param('engagementId', ParseUUIDPipe) engagementId: string,
    @Body() dto: CreateMeetingDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MeetingDto> {
    return this.service.create(engagementId, dto, user);
  }

  @Patch(':meetingId')
  @ApiOperation({
    summary: 'Изменить встречу',
    description:
      'Перенос, участники, итоги (protocol) и статус: проведена — COMPLETED, отменена — CANCELLED. ' +
      'Автору, ответственному по заявке, руководителю и администратору.',
  })
  @ApiParam({ name: 'engagementId', format: 'uuid' })
  @ApiParam({ name: 'meetingId', format: 'uuid' })
  @ApiOkResponse({ type: MeetingDto })
  update(
    @Param('engagementId', ParseUUIDPipe) engagementId: string,
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Body() dto: UpdateMeetingDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MeetingDto> {
    return this.service.update(engagementId, meetingId, dto, user);
  }
}
