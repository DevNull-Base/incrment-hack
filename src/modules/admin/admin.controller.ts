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
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiPageResponse, PageDto } from '../../common/dto/pagination.dto.js';
import { PersonalData } from '../../common/decorators/personal-data.decorator.js';
import { ScopeDimension } from '../../generated/prisma/enums.js';
import { Roles } from '../access/roles.decorator.js';
import { RateLimit } from '../access/rate-limit.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { UserAdminService } from './user-admin.service.js';
import { PersonService } from './person.service.js';
import {
  AdminUserDto,
  ChangeManagerDto,
  ChangeRoleDto,
  ChangeStatusDto,
  ErasePersonDto,
  PersonDto,
  PersonQueryDto,
  SetScopeRuleDto,
  UpdatePersonDto,
  UserQueryDto,
} from './dto/admin.dto.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';

/**
 * Управление пользователями и правами.
 *
 * Доступно только администратору платформы. Каждое изменение прав попадает
 * в журнал аудита: кто именно расширил или сузил чьи-то полномочия —
 * сведение, которое требуется при разборе любого инцидента.
 */
@ApiTags('Администрирование')
@ApiBearerAuth('keycloak')
@Roles('ADMIN')
@Controller({ path: 'admin/users', version: '1' })
export class UserAdminController {
  constructor(private readonly service: UserAdminService) {}

  @Get()
  @ApiOperation({ summary: 'Список учётных записей' })
  @ApiPageResponse(AdminUserDto, 'Постраничный список пользователей системы')
  findAll(@Query() query: UserQueryDto): Promise<PageDto<AdminUserDto>> {
    return this.service.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Учётная запись с её правами и ограничениями' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AdminUserDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<AdminUserDto> {
    return this.service.findOne(id);
  }

  @Patch(':id/role')
  @ApiOperation({
    summary: 'Изменить роль',
    description:
      'Источник истины по ролям — Keycloak: при следующем входе роль синхронизируется ' +
      'из токена. Метод нужен, чтобы понизить права немедленно, не дожидаясь правки ' +
      'в каталоге учётных записей. Сменить роль самому себе нельзя.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AdminUserDto })
  changeRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeRoleDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AdminUserDto> {
    return this.service.changeRole(id, dto.role, dto.reason, actor);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Заблокировать или разблокировать учётную запись',
    description:
      'Блокировка действует немедленно: кэш профиля сбрасывается принудительно, ' +
      'иначе пользователь продолжал бы работать до его истечения.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AdminUserDto })
  changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AdminUserDto> {
    return this.service.changeStatus(id, dto.isActive, dto.reason, actor);
  }

  @Patch(':id/manager')
  @ApiOperation({
    summary: 'Назначить руководителя',
    description:
      'Подчинённость определяет видимость данных: руководитель видит взаимодействия ' +
      'подчинённых. Циклические назначения отклоняются.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AdminUserDto })
  changeManager(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeManagerDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AdminUserDto> {
    return this.service.changeManager(id, dto.managerId, actor);
  }

  @Put(':id/scope/:dimension')
  @ApiOperation({
    summary: 'Ограничить видимость данных по измерению',
    description:
      'Правило только сужает выборку и никогда её не расширяет. Пустой список ' +
      'значений означает «не видно ничего»; чтобы снять ограничение, удалите правило.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({
    name: 'dimension',
    enum: ['UNIVERSITY', 'IT_DIRECTION', 'SOFTWARE_PRODUCT', 'REGION'],
  })
  @ApiOkResponse({ type: AdminUserDto })
  setScopeRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('dimension') dimension: ScopeDimension,
    @Body() dto: SetScopeRuleDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AdminUserDto> {
    return this.service.setScopeRule(id, dimension, dto.allowedIds, actor);
  }

  @Delete(':id/scope/:dimension')
  @ApiOperation({ summary: 'Снять ограничение видимости по измерению' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({
    name: 'dimension',
    enum: ['UNIVERSITY', 'IT_DIRECTION', 'SOFTWARE_PRODUCT', 'REGION'],
  })
  @ApiOkResponse({ type: AdminUserDto })
  removeScopeRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('dimension') dimension: ScopeDimension,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AdminUserDto> {
    return this.service.removeScopeRule(id, dimension, actor);
  }
}

/**
 * Персональные данные субъектов.
 *
 * Обеспечивает права субъекта ПДн: получение сведений об обработке,
 * уточнение данных и прекращение обработки. Каждое обращение к этим
 * методам фиксируется в журнале действием VIEW_PERSONAL_DATA —
 * оператор обязан знать, кто и когда получал доступ к таким сведениям.
 *
 * Просмотр доступен руководителю и администратору, изменение
 * и обезличивание — только администратору: исполнение требований субъекта
 * возлагается на ответственного за организацию обработки ПДн.
 */
@ApiTags('Персональные данные')
@ApiBearerAuth('keycloak')
@Controller({ path: 'persons', version: '1' })
export class PersonController {
  constructor(private readonly service: PersonService) {}

  @Get()
  @Roles('MANAGER', 'ADMIN')
  @PersonalData('Person')
  @RateLimit({ export: true, bucket: 'personal-data' })
  @ApiOperation({
    summary: 'Реестр субъектов персональных данных',
    description:
      'Каждое обращение фиксируется в журнале аудита. Ограничение частоты строже ' +
      'обычного: метод позволяет выгрузить весь перечень контактных лиц.',
  })
  @ApiPageResponse(PersonDto, 'Постраничный список субъектов')
  findAll(@Query() query: PersonQueryDto): Promise<PageDto<PersonDto>> {
    return this.service.findAll(query);
  }

  @Get(':id')
  @Roles('MANAGER', 'ADMIN')
  @PersonalData('Person')
  @ApiOperation({
    summary: 'Сведения об обработке данных субъекта',
    description:
      'Состав обрабатываемых данных, правовое основание и срок хранения. ' +
      'Используется при ответе на обращение субъекта по ст. 14 152-ФЗ.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: PersonDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<PersonDto> {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @Roles('ADMIN')
  @PersonalData('Person')
  @ApiOperation({
    summary: 'Уточнить персональные данные',
    description:
      'Исполнение требования субъекта об уточнении неполных, неточных или устаревших ' +
      'данных (ч. 1 ст. 21 152-ФЗ). Здесь же задаётся правовое основание обработки ' +
      'и срок хранения, по истечении которого запись обезличивается автоматически.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: PersonDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePersonDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PersonDto> {
    return this.service.update(id, dto, actor);
  }

  @Post(':id/erase')
  // Действие, а не создание ресурса: 200, а не 201 по умолчанию для POST.
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Прекратить обработку и обезличить данные',
    description:
      'Исполнение требования субъекта о прекращении обработки (ч. 4 ст. 21 152-ФЗ). ' +
      'ФИО заменяется служебной отметкой, контактные данные удаляются. Строка ' +
      'сохраняется обезличенной: на неё ссылается история взаимодействий, и удаление ' +
      'разрушило бы отчётность. Запись в журнале служит основанием для акта ' +
      'об уничтожении персональных данных.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: PersonDto })
  erase(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ErasePersonDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PersonDto> {
    return this.service.erase(id, dto.reason, actor);
  }
}
