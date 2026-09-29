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
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyRequest } from 'fastify';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ApiPageResponse, PageDto, PageQueryDto } from '../../common/dto/pagination.dto.js';
import { PersonalData } from '../../common/decorators/personal-data.decorator.js';
import { AppConfig } from '../../config/configuration.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { RateLimit } from '../access/rate-limit.decorator.js';
import { readUploadedFile } from '../files/uploaded-file.js';
import { Roles } from '../access/roles.decorator.js';
import { Audited } from '../audit/audited.decorator.js';
import { AUDIT_ACTIONS } from '../audit/audit.service.js';
import { UniversityService } from './university.service.js';
import { UniversityDirectoryService } from './university-directory.service.js';
import {
  CreateUniversityContactDto,
  UniversityContactDto,
  UniversityContactResultDto,
  UniversityContractDto,
  UpdateUniversityContactDto,
} from './dto/university-contact.dto.js';
import { ReferenceService } from './reference.service.js';
import { UniversityNotesService } from './university-notes.service.js';
import { LearningStreamService } from './learning-stream.service.js';
import {
  CreateUniversityNoteDto,
  UniversityNoteDto,
  UpdateUniversityNoteDto,
} from './dto/university-note.dto.js';
import {
  CreateLearningStreamDto,
  LearningStreamDto,
  LearningStreamQueryDto,
  UpdateLearningStreamDto,
} from './dto/learning-stream.dto.js';
import { VendorDirectoryService } from './vendor-directory.service.js';
import {
  CreateVendorContactDto,
  UpdateVendorContactDto,
  VendorContactDto,
  VendorImportQueryDto,
  VendorImportResultDto,
} from './dto/vendor-contact.dto.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import {
  CreateItDirectionDto,
  CreateItProgramDto,
  CreateSoftwareProductDto,
  CreateUniversityDto,
  CreateVendorDto,
  ItDirectionDto,
  ItProgramDto,
  ItProgramQueryDto,
  SimilarUniversityDto,
  SoftwareProductDto,
  SoftwareProductQueryDto,
  UniversityDto,
  UniversityQueryDto,
  UpdateItDirectionDto,
  UpdateItProgramDto,
  UpdateSoftwareProductDto,
  UpdateUniversityDto,
  UpdateVendorDto,
  VendorDto,
} from './dto/catalog.dto.js';

/**
 * Каталог вузов.
 *
 * Чтение доступно любому аутентифицированному пользователю: каталог —
 * общий справочник, и КАМ должен видеть все вузы, даже те, за которые
 * не отвечает. Ограничение видимости применяется к взаимодействиям,
 * а не к самому справочнику.
 *
 * Изменение каталога — прерогатива руководителя и администратора:
 * бесконтрольное редактирование справочника рядовыми пользователями
 * быстро наполнило бы его дубликатами и разошедшимися формулировками.
 */
@ApiTags('Каталоги')
@ApiBearerAuth('keycloak')
@Controller({ path: 'catalog/universities', version: '1' })
export class UniversityController {
  constructor(
    private readonly service: UniversityService,
    private readonly directory: UniversityDirectoryService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список вузов' })
  @ApiPageResponse(UniversityDto, 'Постраничный список вузов')
  findAll(@Query() query: UniversityQueryDto): Promise<PageDto<UniversityDto>> {
    return this.service.findAll(query);
  }

  /**
   * Поиск вузов, похожих на переданное наименование.
   *
   * Вызывается формой создания вуза и мастером импорта XLS до сохранения,
   * чтобы предложить существующую запись вместо создания дубликата.
   */
  @Get('similar')
  @ApiOperation({ summary: 'Поиск похожих вузов (проверка на дубликаты)' })
  @ApiQuery({ name: 'name', description: 'Проверяемое наименование', example: 'МГТУ им. Баумана' })
  @ApiOkResponse({ type: SimilarUniversityDto, isArray: true })
  findSimilar(@Query('name') name: string): Promise<SimilarUniversityDto[]> {
    return this.service.findSimilar(name ?? '');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Карточка вуза' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: UniversityDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<UniversityDto> {
    return this.service.findOne(id);
  }

  @Get(':id/contacts')
  @PersonalData('UniversityContact')
  @ApiOperation({
    summary: 'Ответственные от вуза',
    description:
      'Основной контакт первым. Вуз, закрытый ограничением видимости, недоступен (404). ' +
      'Обращение фиксируется как доступ к персональным данным.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: UniversityContactDto, isArray: true })
  contacts(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UniversityContactDto[]> {
    return this.directory.listContacts(id, user);
  }

  @Post(':id/contacts')
  @PersonalData('UniversityContact')
  @ApiOperation({
    summary: 'Добавить ответственного от вуза',
    description:
      'Руководителю и администратору — для любого доступного вуза, пользователю — для вуза, ' +
      'с которым у него есть открытая заявка. Телефон и почта приводятся к единому виду. ' +
      'Человек, уже указанный у вуза (в том числе заведённый загрузкой одним ФИО), не ' +
      'дублируется: недостающие почта и телефон дописываются в его запись. Почта, занятая ' +
      'другим человеком реестра, — отказ.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: CreateUniversityContactDto })
  @ApiCreatedResponse({ type: UniversityContactResultDto })
  createContact(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateUniversityContactDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UniversityContactResultDto> {
    return this.directory.createContact(id, dto, user);
  }

  @Patch(':id/contacts/:contactId')
  @PersonalData('UniversityContact')
  @ApiOperation({
    summary: 'Изменить ответственного от вуза',
    description:
      'Руководитель и администратор правят всё. Пользователь с открытой заявкой по вузу ' +
      'дописывает недостающие почту и телефон, меняет должность, роль и основной контакт; ' +
      'сохранённые ФИО, почту и телефон он не переписывает.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'contactId', format: 'uuid' })
  @ApiBody({ type: UpdateUniversityContactDto })
  @ApiOkResponse({ type: UniversityContactDto })
  updateContact(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Body() dto: UpdateUniversityContactDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UniversityContactDto> {
    return this.directory.updateContact(id, contactId, dto, user);
  }

  @Delete(':id/contacts/:contactId')
  @Roles('MANAGER', 'ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Убрать ответственного у вуза',
    description:
      'Запись о человеке остаётся в реестре персональных данных. Если убран основной ' +
      'контакт, основным становится следующий по давности.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'contactId', format: 'uuid' })
  @ApiNoContentResponse()
  removeContact(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.directory.removeContact(id, contactId, user);
  }

  @Get(':id/contracts')
  @ApiOperation({
    summary: 'Договоры вуза с лицензиями',
    description:
      'Новые договоры первыми. По каждой лицензии — продукт, вендор, даты, срок, действует ли ' +
      'она сегодня и статус передачи. При ограничении видимости по продуктам показываются ' +
      'лицензии только на доступные продукты.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: UniversityContractDto, isArray: true })
  contracts(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UniversityContractDto[]> {
    return this.directory.listContracts(id, user);
  }

  @Post()
  @Audited({ action: AUDIT_ACTIONS.CATALOG_CREATE, entityType: 'University' })
  @Roles('MANAGER', 'ADMIN')
  @ApiOperation({ summary: 'Создать вуз' })
  @ApiCreatedResponse({ type: UniversityDto })
  create(@Body() dto: CreateUniversityDto): Promise<UniversityDto> {
    return this.service.create(dto);
  }

  @Put(':id')
  @Audited({ action: AUDIT_ACTIONS.CATALOG_UPDATE, entityType: 'University' })
  @Roles('MANAGER', 'ADMIN')
  @ApiOperation({ summary: 'Изменить вуз' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: UniversityDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUniversityDto,
  ): Promise<UniversityDto> {
    return this.service.update(id, dto);
  }

  /**
   * Деактивация вуза. Физического удаления не предусмотрено:
   * на запись ссылаются взаимодействия, договоры и выпущенные отчёты.
   */
  @Delete(':id')
  @Audited({ action: AUDIT_ACTIONS.CATALOG_DEACTIVATE, entityType: 'University' })
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Деактивировать вуз' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Вуз переведён в неактивные' })
  deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.service.deactivate(id);
  }
}

@ApiTags('Каталоги')
@ApiBearerAuth('keycloak')
@Controller({ path: 'catalog/vendors', version: '1' })
export class VendorController {
  constructor(
    private readonly service: ReferenceService,
    private readonly directory: VendorDirectoryService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /**
   * Загрузка каталога вендоров из таблицы: компания, продукты, контактное
   * лицо, телефон, почта, способ связи. По умолчанию — предварительный
   * просмотр; записать данные можно только явным dryRun=false.
   */
  @Post('import')
  @Roles('MANAGER', 'ADMIN')
  @RateLimit({ export: true, bucket: 'import' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Загрузить каталог вендоров из таблицы',
    description:
      'XLSX или XLS. Колонки сопоставляются по заголовкам («Компания», «Продукт», «ФИО», ' +
      '«Телефон», «Почта», «Способ связи» и их синонимам). Несколько продуктов в одной ячейке ' +
      'разделяются, телефоны и почта приводятся к единому виду, компания опознаётся без ' +
      'организационно-правовой формы. По каждой строке — итог, предупреждения и причины отказа.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiOkResponse({ type: VendorImportResultDto })
  async importSheet(
    @Req() request: FastifyRequest,
    @Query() query: VendorImportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<VendorImportResultDto> {
    const file = await readUploadedFile(
      request,
      this.config.get('IMPORT_MAX_FILE_SIZE_MB', { infer: true }) * 1024 * 1024,
    );

    return this.directory.importSheet(file.fileName, file.content, query.dryRun ?? true, user);
  }

  @Get(':id/contacts')
  @PersonalData('VendorContact')
  @ApiOperation({
    summary: 'Контактные лица вендора',
    description: 'Основной контакт первым. Обращение к списку фиксируется как доступ к персональным данным.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: VendorContactDto, isArray: true })
  contacts(@Param('id', ParseUUIDPipe) id: string): Promise<VendorContactDto[]> {
    return this.directory.listContacts(id);
  }

  @Post(':id/contacts')
  @Roles('MANAGER', 'ADMIN')
  @PersonalData('VendorContact')
  @ApiOperation({
    summary: 'Добавить контактное лицо',
    description:
      'Телефон и почта приводятся к единому виду. Если человек уже есть в реестре ' +
      '(совпала почта либо телефон вместе с ФИО), используется существующая запись.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiCreatedResponse({ type: VendorContactDto })
  createContact(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateVendorContactDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<VendorContactDto> {
    return this.directory.createContact(id, dto, user);
  }

  @Patch(':id/contacts/:contactId')
  @Roles('MANAGER', 'ADMIN')
  @PersonalData('VendorContact')
  @ApiOperation({ summary: 'Изменить контактное лицо' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'contactId', format: 'uuid' })
  @ApiOkResponse({ type: VendorContactDto })
  updateContact(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Body() dto: UpdateVendorContactDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<VendorContactDto> {
    return this.directory.updateContact(id, contactId, dto, user);
  }

  @Delete(':id/contacts/:contactId')
  @Roles('MANAGER', 'ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Убрать контакт у вендора',
    description: 'Запись о человеке остаётся в реестре персональных данных.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'contactId', format: 'uuid' })
  @ApiNoContentResponse()
  removeContact(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.directory.removeContact(id, contactId, user);
  }

  @Get()
  @ApiOperation({ summary: 'Список вендоров' })
  @ApiPageResponse(VendorDto)
  findAll(@Query() query: PageQueryDto): Promise<PageDto<VendorDto>> {
    return this.service.findVendors(query);
  }

  @Post()
  @Roles('MANAGER', 'ADMIN')
  @Audited({ action: AUDIT_ACTIONS.CATALOG_CREATE, entityType: 'Vendor' })
  @ApiOperation({ summary: 'Создать вендора' })
  @ApiCreatedResponse({ type: VendorDto })
  create(@Body() dto: CreateVendorDto): Promise<VendorDto> {
    return this.service.createVendor(dto);
  }

  @Put(':id')
  @Roles('MANAGER', 'ADMIN')
  @Audited({ action: AUDIT_ACTIONS.CATALOG_UPDATE, entityType: 'Vendor' })
  @ApiOperation({ summary: 'Изменить вендора' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: VendorDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVendorDto): Promise<VendorDto> {
    return this.service.updateVendor(id, dto);
  }
}

@ApiTags('Каталоги')
@ApiBearerAuth('keycloak')
@Controller({ path: 'catalog/products', version: '1' })
export class SoftwareProductController {
  constructor(private readonly service: ReferenceService) {}

  @Get()
  @ApiOperation({ summary: 'Список ИТ-продуктов' })
  @ApiPageResponse(SoftwareProductDto)
  findAll(@Query() query: SoftwareProductQueryDto): Promise<PageDto<SoftwareProductDto>> {
    return this.service.findProducts(query);
  }

  @Post()
  @Roles('MANAGER', 'ADMIN')
  @Audited({ action: AUDIT_ACTIONS.CATALOG_CREATE, entityType: 'SoftwareProduct' })
  @ApiOperation({ summary: 'Создать ИТ-продукт' })
  @ApiCreatedResponse({ type: SoftwareProductDto })
  create(@Body() dto: CreateSoftwareProductDto): Promise<SoftwareProductDto> {
    return this.service.createProduct(dto);
  }

  @Put(':id')
  @Roles('MANAGER', 'ADMIN')
  @Audited({ action: AUDIT_ACTIONS.CATALOG_UPDATE, entityType: 'SoftwareProduct' })
  @ApiOperation({ summary: 'Изменить ИТ-продукт' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: SoftwareProductDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSoftwareProductDto,
  ): Promise<SoftwareProductDto> {
    return this.service.updateProduct(id, dto);
  }
}

@ApiTags('Каталоги')
@ApiBearerAuth('keycloak')
@Controller({ path: 'catalog/directions', version: '1' })
export class ItDirectionController {
  constructor(private readonly service: ReferenceService) {}

  @Get()
  @ApiOperation({ summary: 'Список ИТ-направлений' })
  @ApiPageResponse(ItDirectionDto)
  findAll(@Query() query: PageQueryDto): Promise<PageDto<ItDirectionDto>> {
    return this.service.findDirections(query);
  }

  @Post()
  @Roles('MANAGER', 'ADMIN')
  @Audited({ action: AUDIT_ACTIONS.CATALOG_CREATE, entityType: 'ItDirection' })
  @ApiOperation({ summary: 'Создать ИТ-направление' })
  @ApiCreatedResponse({ type: ItDirectionDto })
  create(@Body() dto: CreateItDirectionDto): Promise<ItDirectionDto> {
    return this.service.createDirection(dto);
  }

  @Put(':id')
  @Roles('MANAGER', 'ADMIN')
  @Audited({ action: AUDIT_ACTIONS.CATALOG_UPDATE, entityType: 'ItDirection' })
  @ApiOperation({ summary: 'Изменить ИТ-направление' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ItDirectionDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateItDirectionDto,
  ): Promise<ItDirectionDto> {
    return this.service.updateDirection(id, dto);
  }
}

@ApiTags('Каталоги')
@ApiBearerAuth('keycloak')
@Controller({ path: 'catalog/programs', version: '1' })
export class ItProgramController {
  constructor(private readonly service: ReferenceService) {}

  @Get()
  @ApiOperation({ summary: 'Список ИТ-программ' })
  @ApiPageResponse(ItProgramDto)
  findAll(@Query() query: ItProgramQueryDto): Promise<PageDto<ItProgramDto>> {
    return this.service.findPrograms(query);
  }

  @Post()
  @Roles('MANAGER', 'ADMIN')
  @Audited({ action: AUDIT_ACTIONS.CATALOG_CREATE, entityType: 'ItProgram' })
  @ApiOperation({ summary: 'Создать ИТ-программу' })
  @ApiCreatedResponse({ type: ItProgramDto })
  create(@Body() dto: CreateItProgramDto): Promise<ItProgramDto> {
    return this.service.createProgram(dto);
  }

  @Put(':id')
  @Roles('MANAGER', 'ADMIN')
  @Audited({ action: AUDIT_ACTIONS.CATALOG_UPDATE, entityType: 'ItProgram' })
  @ApiOperation({ summary: 'Изменить ИТ-программу' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ItProgramDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateItProgramDto,
  ): Promise<ItProgramDto> {
    return this.service.updateProgram(id, dto);
  }
}

/**
 * Заметки по вузу целиком — то, что не относится ни к одной заявке.
 * Доступны всем, кому вуз не закрыт ограничением видимости.
 */
@ApiTags('Заметки')
@ApiBearerAuth('keycloak')
@Controller({ path: 'catalog/universities/:universityId/notes', version: '1' })
export class UniversityNotesController {
  constructor(private readonly service: UniversityNotesService) {}

  @Get()
  @ApiOperation({ summary: 'Заметки по вузу', description: 'Закреплённые первыми, затем новые сверху.' })
  @ApiParam({ name: 'universityId', format: 'uuid' })
  @ApiOkResponse({ type: UniversityNoteDto, isArray: true })
  list(
    @Param('universityId', ParseUUIDPipe) universityId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UniversityNoteDto[]> {
    return this.service.list(universityId, user);
  }

  @Post()
  @ApiOperation({ summary: 'Оставить заметку по вузу' })
  @ApiParam({ name: 'universityId', format: 'uuid' })
  @ApiCreatedResponse({ type: UniversityNoteDto })
  create(
    @Param('universityId', ParseUUIDPipe) universityId: string,
    @Body() dto: CreateUniversityNoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UniversityNoteDto> {
    return this.service.create(universityId, dto, user);
  }

  @Patch(':noteId')
  @ApiOperation({
    summary: 'Изменить заметку по вузу',
    description: 'Текст меняет только автор; закрепить или открепить может любой, кто видит вуз.',
  })
  @ApiParam({ name: 'universityId', format: 'uuid' })
  @ApiParam({ name: 'noteId', format: 'uuid' })
  @ApiOkResponse({ type: UniversityNoteDto })
  update(
    @Param('universityId', ParseUUIDPipe) universityId: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body() dto: UpdateUniversityNoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UniversityNoteDto> {
    return this.service.update(universityId, noteId, dto, user);
  }

  @Delete(':noteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить заметку по вузу', description: 'Автору и администратору.' })
  @ApiParam({ name: 'universityId', format: 'uuid' })
  @ApiParam({ name: 'noteId', format: 'uuid' })
  @ApiNoContentResponse()
  remove(
    @Param('universityId', ParseUUIDPipe) universityId: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.service.remove(universityId, noteId, user);
  }
}

/**
 * Учебные потоки программ. По ним ТЗ ранжирует программы: число
 * обучающихся и число параллельных потоков.
 */
@ApiTags('Каталоги')
@ApiBearerAuth('keycloak')
@Controller({ path: 'catalog/streams', version: '1' })
export class LearningStreamController {
  constructor(private readonly service: LearningStreamService) {}

  @Get()
  @ApiOperation({
    summary: 'Учебные потоки',
    description:
      'Новые первыми (sortOrder=asc — старые первыми). Потоки при вузе, закрытом ограничением ' +
      'видимости, не показываются; наборы прямых продаж (без вуза) видны всем.',
  })
  @ApiPageResponse(LearningStreamDto)
  list(
    @Query() query: LearningStreamQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PageDto<LearningStreamDto>> {
    return this.service.list(query, user);
  }

  @Post()
  @Roles('MANAGER', 'ADMIN')
  @Audited({ action: AUDIT_ACTIONS.CATALOG_CREATE, entityType: 'LearningStream' })
  @ApiOperation({ summary: 'Завести учебный поток' })
  @ApiCreatedResponse({ type: LearningStreamDto })
  create(
    @Body() dto: CreateLearningStreamDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LearningStreamDto> {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @Roles('MANAGER', 'ADMIN')
  @Audited({ action: AUDIT_ACTIONS.CATALOG_UPDATE, entityType: 'LearningStream' })
  @ApiOperation({ summary: 'Изменить учебный поток' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: LearningStreamDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLearningStreamDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LearningStreamDto> {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @Roles('MANAGER', 'ADMIN')
  @Audited({ action: AUDIT_ACTIONS.CATALOG_DEACTIVATE, entityType: 'LearningStream' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить учебный поток, заведённый по ошибке' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse()
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.service.remove(id, user);
  }
}
