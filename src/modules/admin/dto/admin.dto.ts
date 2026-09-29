import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/pagination.dto.js';
import { PdLawfulBasis, ScopeDimension, UserRole } from '../../../generated/prisma/enums.js';

const ROLE_VALUES: UserRole[] = ['USER', 'MANAGER', 'ADMIN'];
const DIMENSION_VALUES: ScopeDimension[] = [
  'UNIVERSITY',
  'IT_DIRECTION',
  'SOFTWARE_PRODUCT',
  'REGION',
];
const LAWFUL_BASIS_VALUES: PdLawfulBasis[] = [
  'CONTRACT',
  'CONSENT',
  'LEGAL_OBLIGATION',
  'UNDEFINED',
];

// ---------------------------------------------------------------- Пользователи

export class UserQueryDto extends PageQueryDto {
  // Поле search объявлено в PageQueryDto и здесь не дублируется:
  // поиск идёт по имени и адресу электронной почты.

  @ApiPropertyOptional({ enum: ROLE_VALUES, description: 'Фильтр по роли' })
  @IsOptional()
  @IsEnum(ROLE_VALUES)
  role?: UserRole;

  @ApiPropertyOptional({ description: 'Только активные учётные записи' })
  @IsOptional()
  @IsBoolean()
  activeOnly?: boolean;
}

export class ScopeRuleDto {
  @ApiProperty({ enum: DIMENSION_VALUES, description: 'Измерение ограничения' })
  dimension!: ScopeDimension;

  @ApiProperty({
    type: [String],
    description: 'Разрешённые значения: идентификаторы либо названия регионов',
  })
  allowedIds!: string[];
}

export class AdminUserDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ enum: ROLE_VALUES })
  role!: UserRole;

  @ApiProperty({
    description:
      'Откуда роль: KEYCLOAK — синхронизируется из токена при каждом входе, ' +
      'CRM — назначена администратором в системе и токеном не перекрывается',
    enum: ['KEYCLOAK', 'CRM'],
  })
  roleSource!: 'KEYCLOAK' | 'CRM';

  @ApiProperty({ description: 'Активна ли учётная запись' })
  isActive!: boolean;

  @ApiProperty({ nullable: true, format: 'uuid', description: 'Идентификатор руководителя' })
  managerId!: string | null;

  @ApiProperty({ nullable: true, description: 'Отображаемое имя руководителя' })
  managerName!: string | null;

  @ApiProperty({ nullable: true, description: 'Последнее обращение к системе' })
  lastLoginAt!: Date | null;

  @ApiProperty({ type: [ScopeRuleDto], description: 'Действующие ограничения видимости' })
  scopeRules!: ScopeRuleDto[];
}

export class ChangeRoleDto {
  @ApiProperty({ enum: ROLE_VALUES, description: 'Новая роль пользователя' })
  @IsEnum(ROLE_VALUES)
  role!: UserRole;

  @ApiPropertyOptional({ description: 'Основание изменения — попадает в журнал аудита' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ChangeStatusDto {
  @ApiProperty({ description: 'true — доступ разрешён, false — учётная запись заблокирована' })
  @IsBoolean()
  isActive!: boolean;

  @ApiPropertyOptional({ description: 'Основание изменения — попадает в журнал аудита' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ChangeManagerDto {
  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'Идентификатор руководителя; null — подчинённость снимается',
  })
  @IsOptional()
  @IsUUID()
  managerId!: string | null;
}

export class SetScopeRuleDto {
  @ApiProperty({
    type: [String],
    description:
      'Разрешённые значения. Пустой список означает «не видно ничего» — это осмысленное ' +
      'состояние, а не отсутствие ограничения; чтобы снять ограничение, удалите правило.',
  })
  @IsArray()
  @ArrayMaxSize(10_000)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  allowedIds!: string[];
}

// ------------------------------------------------------------ Персональные данные

export class PersonQueryDto extends PageQueryDto {
  // search — из PageQueryDto: поиск по ФИО, адресу и телефону.

  @ApiPropertyOptional({ description: 'Включать обезличенные записи' })
  @IsOptional()
  @IsBoolean()
  includeErased?: boolean;
}

export class PersonDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'ФИО. Для обезличенных записей — служебная отметка' })
  fullName!: string;

  @ApiProperty({ nullable: true })
  email!: string | null;

  @ApiProperty({ nullable: true })
  phone!: string | null;

  @ApiProperty({ nullable: true })
  position!: string | null;

  @ApiProperty({ enum: LAWFUL_BASIS_VALUES, description: 'Правовое основание обработки (ст. 6 152-ФЗ)' })
  lawfulBasis!: PdLawfulBasis;

  @ApiProperty({ nullable: true, description: 'Дата, после которой данные подлежат обезличиванию' })
  retentionUntil!: Date | null;

  @ApiProperty({ nullable: true, description: 'Момент обезличивания' })
  erasedAt!: Date | null;

  @ApiProperty({ type: [String], description: 'Вузы, в которых субъект указан ответственным' })
  universities!: string[];
}

export class UpdatePersonDto {
  @ApiPropertyOptional({ description: 'Уточнённое ФИО' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  fullName?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(320)
  email?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  position?: string | null;

  @ApiPropertyOptional({ enum: LAWFUL_BASIS_VALUES })
  @IsOptional()
  @IsEnum(LAWFUL_BASIS_VALUES)
  lawfulBasis?: PdLawfulBasis;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Дата, после которой запись обезличивается регламентной задачей',
  })
  @IsOptional()
  @IsDateString()
  retentionUntil?: string | null;

  @ApiPropertyOptional({ description: 'Основание изменения — попадает в журнал аудита' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ErasePersonDto {
  @ApiProperty({
    description:
      'Основание обезличивания: требование субъекта, истечение срока хранения, ' +
      'решение оператора. Требуется для акта об уничтожении персональных данных.',
  })
  @IsString()
  @MaxLength(500)
  reason!: string;
}
