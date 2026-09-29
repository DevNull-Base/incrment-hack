import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../access/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { WorkflowTemplateService } from './workflow-template.service.js';
import {
  CreateWorkflowTemplateDto,
  PublishWorkflowTemplateDto,
  UpdateWorkflowTemplateDto,
  WorkflowPublishPreviewDto,
  WorkflowPublishResultDto,
  WorkflowTemplateDetailDto,
  WorkflowTemplateQueryDto,
  WorkflowTemplateSummaryDto,
} from './dto/workflow.dto.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';

/**
 * Редактор процессов взаимодействия.
 *
 * Чтение открыто всем аутентифицированным: схему процесса видит каждый
 * пользователь — по ней строится диаграмма пути в карточке заявки.
 * Любое изменение доступно только администратору: процесс един для всех
 * сегмента, и его правка затрагивает работу всех менеджеров сразу.
 *
 * Порядок работы: черновик → предварительный просмотр → публикация.
 * Публикация переводит на новую редакцию все текущие заявки, поэтому
 * выполняется только с явным подтверждением и с указанием, куда
 * переносятся заявки из удаляемых статусов.
 */
@ApiTags('Процессы')
@ApiBearerAuth('keycloak')
@Controller({ path: 'workflow/templates', version: '1' })
export class WorkflowController {
  constructor(private readonly service: WorkflowTemplateService) {}

  @Get()
  @ApiOperation({
    summary: 'Редакции процессов',
    description:
      'По умолчанию отдаются только действующие редакции — по одной на сегмент. ' +
      'Признак includeInactive добавляет черновики и прошлые редакции: они ' +
      'сохраняются как журнал изменений схемы.',
  })
  @ApiOkResponse({ type: [WorkflowTemplateSummaryDto] })
  list(@Query() query: WorkflowTemplateQueryDto): Promise<WorkflowTemplateSummaryDto[]> {
    return this.service.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Редакция процесса с определением' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: WorkflowTemplateDetailDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<WorkflowTemplateDetailDto> {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Создать черновик редакции',
    description:
      'Черновик не действует ни на одну заявку. Определение проверяется сразу: ' +
      'ровно одно начальное состояние, хотя бы одно завершающее, все состояния ' +
      'достижимы, из завершающих переходов нет.',
  })
  @ApiCreatedResponse({ type: WorkflowTemplateDetailDto })
  create(
    @Body() dto: CreateWorkflowTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WorkflowTemplateDetailDto> {
    return this.service.createDraft(dto, user);
  }

  @Put(':id')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Изменить черновик',
    description:
      'Действующая редакция неизменна: по ней ведутся текущие заявки. ' +
      'Правки вносятся в черновик следующей редакции.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: WorkflowTemplateDetailDto })
  @ApiResponse({ status: 409, description: 'Редакция действует и не редактируется' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkflowTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WorkflowTemplateDetailDto> {
    return this.service.updateDraft(id, dto, user);
  }

  /**
   * Данные для диалога подтверждения: что изменится и кого это затронет.
   *
   * Метод GET: расчёт ничего не меняет, тела у запроса нет и быть не должно.
   * Изначально маршрут был сделан POST «для единообразия» с публикацией —
   * и сразу же отклонял обычный вызов клиента, который проставляет
   * `Content-Type: application/json` всем POST-запросам подряд.
   */
  @Get(':id/publish/preview')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Предварительный просмотр публикации',
    description:
      'Показывает добавленные, переименованные и удаляемые статусы, число ' +
      'заявок в каждом удаляемом статусе и предлагаемую цель переноса — ' +
      'соседний статус процесса. Ничего не меняет.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: WorkflowPublishPreviewDto })
  preview(@Param('id', ParseUUIDPipe) id: string): Promise<WorkflowPublishPreviewDto> {
    return this.service.previewPublish(id);
  }

  @Post(':id/publish')
  // Действие, а не создание ресурса: 200, а не 201 по умолчанию для POST.
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Опубликовать редакцию',
    description:
      'Переводит на новую редакцию ВСЕ текущие заявки сегмента: процесс един ' +
      'для всех, редакции не сосуществуют. Заявки из удалённых статусов ' +
      'переносятся согласно stateMapping, и каждый перенос попадает в журнал ' +
      'переходов заявки. Без признака confirm операция отклоняется.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: WorkflowPublishResultDto })
  @ApiResponse({ status: 400, description: 'Не указано, куда переносить заявки' })
  @ApiResponse({ status: 428, description: 'Публикация не подтверждена' })
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublishWorkflowTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WorkflowPublishResultDto> {
    return this.service.publish(id, dto, user);
  }
}
