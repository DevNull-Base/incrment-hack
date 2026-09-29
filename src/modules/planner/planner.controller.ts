import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiPageResponse, PageDto } from '../../common/dto/pagination.dto.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { PlannerService } from './planner.service.js';
import {
  CalendarDto,
  CalendarQueryDto,
  CreateTaskDto,
  TaskDto,
  TaskQueryDto,
  UpdateTaskDto,
} from './dto/planner.dto.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';

/**
 * Календарь задач.
 *
 * Задачи — дела с датой, свои и поставленные руководителем. В тот же
 * календарь ложатся сроки этапов заявок по нормативу процесса, чтобы
 * их не приходилось дублировать задачами вручную.
 */
@ApiTags('Календарь')
@ApiBearerAuth('keycloak')
@Controller({ path: 'calendar', version: '1' })
export class PlannerController {
  constructor(private readonly service: PlannerService) {}

  @Get()
  @ApiOperation({
    summary: 'Календарь за период',
    description:
      'Свои задачи и сроки этапов заявок (норматив процесса) за период до 92 дней. ' +
      'Дни считаются в часовом поясе организации — он приходит в поле timezone. ' +
      'Руководитель с team=true видит сроки этапов по заявкам подчинённых.',
  })
  @ApiOkResponse({ type: CalendarDto })
  calendar(@Query() query: CalendarQueryDto, @CurrentUser() user: AuthenticatedUser): Promise<CalendarDto> {
    return this.service.calendar(query, user);
  }

  @Get('tasks')
  @ApiOperation({
    summary: 'Задачи',
    description:
      'Мои задачи либо поставленные мной другим (assignedByMe=true). По умолчанию — ' +
      'невыполненные, по сроку. Отбор по дням, заявке и состоянию.',
  })
  @ApiPageResponse(TaskDto)
  list(@Query() query: TaskQueryDto, @CurrentUser() user: AuthenticatedUser): Promise<PageDto<TaskDto>> {
    return this.service.list(query, user);
  }

  @Post('tasks')
  @ApiOperation({
    summary: 'Поставить задачу',
    description:
      'Задача на день либо на время. Руководитель может поставить задачу подчинённому — ' +
      'тот получит уведомление, а постановщик узнает о выполнении.',
  })
  @ApiCreatedResponse({ type: TaskDto })
  create(@Body() dto: CreateTaskDto, @CurrentUser() user: AuthenticatedUser): Promise<TaskDto> {
    return this.service.create(dto, user);
  }

  @Get('tasks/:id')
  @ApiOperation({ summary: 'Задача' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: TaskDto })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser): Promise<TaskDto> {
    return this.service.findOne(id, user);
  }

  @Patch('tasks/:id')
  @ApiOperation({
    summary: 'Изменить задачу',
    description:
      'Текст, срок, напоминание, привязка к заявке. Задачу, поставленную руководителем, ' +
      'меняет только он: исполнитель получит CRM-ACL-0001.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: TaskDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TaskDto> {
    return this.service.update(id, dto, user);
  }

  @Post('tasks/:id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Отметить выполненной',
    description: 'Повторная отметка ничего не меняет. Доступно исполнителю и постановщику.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: TaskDto })
  complete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser): Promise<TaskDto> {
    return this.service.complete(id, user);
  }

  @Post('tasks/:id/reopen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Вернуть в работу' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: TaskDto })
  reopen(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser): Promise<TaskDto> {
    return this.service.reopen(id, user);
  }

  @Delete('tasks/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить задачу' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse()
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.service.remove(id, user);
  }
}
