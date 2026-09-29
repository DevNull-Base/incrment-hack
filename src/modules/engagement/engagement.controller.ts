import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { ApiPageResponse, PageDto } from '../../common/dto/pagination.dto.js';
import { AppException } from '../../common/errors/app-exception.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../access/roles.decorator.js';
import { WorkflowService } from '../workflow/workflow.service.js';
import { EngagementService } from './engagement.service.js';
import { PersonalData } from '../../common/decorators/personal-data.decorator.js';
import { EngagementContactDto, FillEngagementContactDto } from './dto/engagement-contact.dto.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import {
  ArchiveEngagementDto,
  CreateEngagementDto,
  EngagementDetailDto,
  EngagementListItemDto,
  EngagementQueryDto,
  InterestSummaryDto,
  InterestSummaryQueryDto,
  PerformTransitionDto,
  ReassignEngagementDto,
  UpdateEngagementDto,
} from './dto/engagement.dto.js';

/**
 * Взаимодействия с вузами — центральная сущность системы.
 *
 * Каждый метод работает в границах области видимости пользователя:
 * КАМ получает только свои записи, руководитель — записи подчинённых,
 * администратор — все.
 */
@ApiTags('Взаимодействия')
@ApiBearerAuth('keycloak')
@Controller({ path: 'engagements', version: '1' })
export class EngagementController {
  constructor(
    private readonly service: EngagementService,
    private readonly workflow: WorkflowService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Список взаимодействий',
    description:
      'Фильтрация по вузу, направлению, продукту, ответственному, статусу и периоду. ' +
      'Выборка автоматически ограничена областью видимости текущего пользователя.',
  })
  @ApiPageResponse(EngagementListItemDto)
  findAll(
    @Query() query: EngagementQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PageDto<EngagementListItemDto>> {
    return this.service.findAll(query, user);
  }

  /**
   * Рейтинг заинтересованности.
   *
   * Техническое задание требует ранжировать программы по востребованности;
   * заказчик разрешил вместо формулы ручную оценку КАМов. Здесь эти оценки
   * сводятся по выбранному разрезу в индекс 0–100.
   *
   * Маршрут объявлен раньше карточки: статический сегмент пути должен
   * сопоставляться до параметра :id.
   */
  @Get('interest-summary')
  @ApiOperation({
    summary: 'Рейтинг заинтересованности',
    description:
      'Сводит оценки заинтересованности по ИТ-направлениям, продуктам, программам или вузам: ' +
      'сколько заявок с высокой, средней и низкой оценкой и индекс 0–100 ' +
      '(HIGH = 100, MEDIUM = 50, LOW = 0, среднее по оценённым заявкам). ' +
      'Учитываются только заявки в области видимости пользователя.',
  })
  @ApiOkResponse({ type: InterestSummaryDto })
  interestSummary(
    @Query() query: InterestSummaryQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<InterestSummaryDto> {
    return this.service.interestSummary(query, user);
  }

  /**
   * Карточка взаимодействия.
   *
   * В заголовке ETag возвращается версия записи. Передайте её в If-Match
   * при смене статуса — это защищает от молчаливой перезаписи изменений,
   * сделанных другим пользователем.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Карточка взаимодействия' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: EngagementDetailDto })
  @ApiResponse({
    status: 200,
    headers: {
      ETag: {
        description: 'Версия записи. Передаётся в If-Match при изменении статуса.',
        schema: { type: 'string', example: 'W/"7"' },
      },
    },
  })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<EngagementDetailDto> {
    const engagement = await this.service.findOne(id, user);
    reply.header('ETag', `W/"${engagement.version}"`);
    return engagement;
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Отправить заявку в архив',
    description:
      'Архивная заявка доступна только для чтения. Завершённую убирает в архив и её ответственный; ' +
      'незавершённую — руководитель или администратор, с причиной. Повторный вызов ничего не меняет.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: ArchiveEngagementDto })
  @ApiOkResponse({ type: EngagementDetailDto })
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ArchiveEngagementDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EngagementDetailDto> {
    return this.service.archive(id, dto, user);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Вернуть заявку из архива', description: 'Доступно всем, кому видна заявка.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: EngagementDetailDto })
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EngagementDetailDto> {
    return this.service.restore(id, user);
  }

  @Get(':id/contact')
  @PersonalData('Person')
  @ApiOperation({
    summary: 'Контактное лицо заявки',
    description:
      'ФИО, почта и телефон человека, указанного контактом заявки прямой продажи. ' +
      'Обращение учитывается как доступ к персональным данным.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: EngagementContactDto })
  contact(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EngagementContactDto> {
    return this.service.getContact(id, user);
  }

  @Patch(':id/contact')
  @PersonalData('Person')
  @ApiOperation({
    summary: 'Дописать почту или телефон контакта',
    description:
      'Заполняются только пустые поля — например, почта слушателя, без которой его нельзя ' +
      'выгрузить в LMS. Изменить уже сохранённое значение может администратор (PATCH /persons/{id}).',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: FillEngagementContactDto })
  @ApiOkResponse({ type: EngagementContactDto })
  fillContact(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FillEngagementContactDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EngagementContactDto> {
    return this.service.fillContact(id, dto, user);
  }

  @Post()
  @ApiOperation({
    summary: 'Создать взаимодействие',
    description:
      'Новое взаимодействие автоматически ставится в начальное состояние активного шаблона процесса.',
  })
  @ApiCreatedResponse({ type: EngagementDetailDto })
  create(
    @Body() dto: CreateEngagementDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EngagementDetailDto> {
    return this.service.create(dto, user);
  }

  /**
   * Правка карточки: название, программа, заинтересованность.
   *
   * Передаются только изменяемые поля; null очищает значение. Статус и
   * ответственный здесь не меняются — для них есть переход и переназначение.
   */
  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Изменить карточку',
    description:
      'Название, ИТ-программа и оценка заинтересованности. Смена оценки попадает ' +
      'в ленту действий вместе с прежним значением и обоснованием.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiHeader({
    name: 'If-Match',
    required: false,
    description:
      'Значение ETag из карточки. При расхождении версий возвращается CRM-COM-0005: ' +
      'карточку успел изменить другой пользователь.',
    schema: { type: 'string', example: 'W/"7"' },
  })
  @ApiBody({ type: UpdateEngagementDto })
  @ApiOkResponse({ type: EngagementDetailDto })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEngagementDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<EngagementDetailDto> {
    const engagement = await this.service.update(id, dto, user, parseIfMatch(ifMatch));
    reply.header('ETag', `W/"${engagement.version}"`);
    return engagement;
  }

  /**
   * Переход в следующий статус.
   *
   * Заголовок If-Match со значением ETag из карточки не обязателен, но
   * настоятельно рекомендуется: без него два менеджера, открывшие карточку
   * одновременно, затрут действия друг друга, и история покажет переход,
   * которого пользователь не совершал.
   */
  @Post(':id/transition')
  // Действие, а не создание ресурса: 200, а не 201 по умолчанию для POST.
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Перевести взаимодействие в другой статус' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiHeader({
    name: 'If-Match',
    required: false,
    description:
      'Значение ETag, полученное при чтении карточки. При расхождении версий возвращается CRM-WFL-0005.',
    schema: { type: 'string', example: 'W/"7"' },
  })
  @ApiBody({ type: PerformTransitionDto })
  @ApiOkResponse({ type: EngagementDetailDto })
  async transition(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PerformTransitionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<EngagementDetailDto> {
    const expectedVersion = parseIfMatch(ifMatch);

    const result = await this.workflow.performTransition(
      id,
      dto.toStateKey,
      dto.comment,
      user,
      expectedVersion,
    );

    reply.header('ETag', `W/"${result.version}"`);
    return this.service.findOne(id, user);
  }

  @Post(':id/reassign')
  // Действие, а не создание ресурса: 200, а не 201 по умолчанию для POST.
  @HttpCode(HttpStatus.OK)
  @Roles('MANAGER', 'ADMIN')
  @ApiOperation({
    summary: 'Переназначить ответственного',
    description: 'Доступно руководителю и администратору. Изменение протоколируется.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: EngagementDetailDto })
  reassign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReassignEngagementDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EngagementDetailDto> {
    return this.service.reassign(id, dto, user);
  }
}

/**
 * Извлекает версию из заголовка If-Match.
 *
 * Поддерживаются формы `W/"7"`, `"7"` и `7`. Значение `*` означает
 * «любая версия» и равнозначно отсутствию заголовка.
 */
function parseIfMatch(raw: string | undefined): number | null {
  if (!raw || raw.trim() === '*') {
    return null;
  }

  const match = raw.trim().match(/^(?:W\/)?"?(\d+)"?$/);

  if (!match) {
    throw new AppException('PRECONDITION_FAILED', {
      detail: 'Некорректный формат заголовка If-Match. Ожидается значение ETag вида W/"7".',
      meta: { received: raw },
    });
  }

  return Number(match[1]);
}
