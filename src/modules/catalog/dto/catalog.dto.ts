import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ToBoolean } from '../../../common/dto/query-transforms.js';
import { PageQueryDto } from '../../../common/dto/pagination.dto.js';
import {
  AUDIENCE_VALUES,
  EDUCATION_PROJECT_VALUES,
  type AudienceValue,
  type EducationProjectValue,
} from '../catalog-enums.js';

// ===========================================================================
//  ВУЗ
// ===========================================================================

export class CreateUniversityDto {
  @ApiProperty({ description: 'Полное наименование вуза', example: 'Казанский федеральный университет' })
  @IsString()
  @Length(2, 500)
  name!: string;

  @ApiPropertyOptional({ description: 'Сокращённое наименование', example: 'КФУ' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  shortName?: string;

  @ApiPropertyOptional({ description: 'ИНН организации', example: '1655018018' })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{10}$|^[0-9]{12}$/, { message: 'ИНН должен содержать 10 или 12 цифр' })
  inn?: string;

  @ApiPropertyOptional({ description: 'Регион', example: 'Республика Татарстан' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  region?: string;

  @ApiPropertyOptional({ description: 'Город', example: 'Казань' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  city?: string;

  @ApiPropertyOptional({ description: 'Сайт вуза', example: 'https://kpfu.ru' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  website?: string;
}

export class UpdateUniversityDto extends CreateUniversityDto {
  @ApiPropertyOptional({ description: 'Активна ли запись каталога' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UniversityDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'Полное наименование' })
  name!: string;

  @ApiProperty({ description: 'Сокращённое наименование', nullable: true })
  shortName!: string | null;

  @ApiProperty({ description: 'ИНН', nullable: true })
  inn!: string | null;

  @ApiProperty({ description: 'Регион', nullable: true })
  region!: string | null;

  @ApiProperty({ description: 'Город', nullable: true })
  city!: string | null;

  @ApiProperty({ description: 'Сайт', nullable: true })
  website!: string | null;

  @ApiProperty({ description: 'Активна ли запись' })
  isActive!: boolean;

  @ApiProperty({ description: 'Число взаимодействий с вузом', example: 4 })
  engagementCount!: number;

  @ApiProperty({ description: 'Дата создания записи' })
  createdAt!: Date;
}

export const UNIVERSITY_SORT_VALUES = ['name', 'createdAt', 'engagementCount'] as const;
export type UniversitySort = (typeof UNIVERSITY_SORT_VALUES)[number];

export class UniversityQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Фильтр по региону' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  region?: string;

  @ApiPropertyOptional({ description: 'Только активные записи', default: true })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  activeOnly?: boolean = true;

  @ApiPropertyOptional({
    description:
      'Поле сортировки. Поиск по наименованию, ИНН и городу — search, направление — sortOrder.',
    enum: UNIVERSITY_SORT_VALUES,
    default: 'name',
  })
  @IsOptional()
  @IsIn([...UNIVERSITY_SORT_VALUES], { message: `Допустимые значения: ${UNIVERSITY_SORT_VALUES.join(', ')}` })
  sortBy?: UniversitySort = 'name';
}

/** Кандидат на совпадение при проверке дубликатов. */
export class SimilarUniversityDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'Наименование найденного вуза' })
  name!: string;

  @ApiProperty({
    description: 'Оценка схожести от 0 до 1. Выше 0.8 — почти наверняка тот же вуз.',
    example: 0.92,
  })
  similarity!: number;
}

// ===========================================================================
//  Вендор
// ===========================================================================

export class CreateVendorDto {
  @ApiProperty({ description: 'Наименование вендора', example: 'Ростелеком' })
  @IsString()
  @Length(2, 300)
  name!: string;
}

export class UpdateVendorDto extends CreateVendorDto {
  @ApiPropertyOptional({ description: 'Активна ли запись каталога' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class VendorDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ description: 'Число продуктов вендора', example: 3 })
  productCount!: number;

  @ApiProperty({ description: 'Число контактных лиц вендора', example: 1 })
  contactCount!: number;
}

// ===========================================================================
//  ИТ-продукт (ПО)
// ===========================================================================

export class CreateSoftwareProductDto {
  @ApiProperty({ description: 'Наименование продукта', example: 'РТК Облако' })
  @IsString()
  @Length(2, 300)
  name!: string;

  @ApiProperty({ description: 'Идентификатор вендора', format: 'uuid' })
  @IsUUID()
  vendorId!: string;

  @ApiPropertyOptional({ description: 'Описание продукта' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class UpdateSoftwareProductDto extends CreateSoftwareProductDto {
  @ApiPropertyOptional({ description: 'Активна ли запись каталога' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SoftwareProductDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ format: 'uuid' })
  vendorId!: string;

  @ApiProperty({ description: 'Наименование вендора' })
  vendorName!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty()
  isActive!: boolean;
}

export class SoftwareProductQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Фильтр по вендору', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @ApiPropertyOptional({ description: 'Только активные записи', default: true })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  activeOnly?: boolean = true;
}

// ===========================================================================
//  ИТ-направление
// ===========================================================================

export class CreateItDirectionDto {
  @ApiProperty({ description: 'Наименование направления', example: 'DevOps' })
  @IsString()
  @Length(2, 200)
  name!: string;

  @ApiPropertyOptional({ description: 'Краткий код направления', example: 'DEVOPS' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string;
}

export class UpdateItDirectionDto extends CreateItDirectionDto {
  @ApiPropertyOptional({ description: 'Активна ли запись каталога' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ItDirectionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  code!: string | null;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ description: 'Число программ по направлению', example: 2 })
  programCount!: number;
}

// ===========================================================================
//  ИТ-программа
// ===========================================================================

export class CreateItProgramDto {
  @ApiProperty({ description: 'Наименование программы', example: 'Основы DevOps-практик' })
  @IsString()
  @Length(2, 300)
  name!: string;

  @ApiProperty({ description: 'Идентификатор направления', format: 'uuid' })
  @IsUUID()
  directionId!: string;

  @ApiPropertyOptional({
    description: 'Идентификатор продукта, вокруг которого построена программа',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ description: 'Объём программы в часах', example: 72, minimum: 1, maximum: 10000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  hoursTotal?: number;

  // Карточка каталога курсов. Не переданное поле при изменении программы
  // остаётся прежним: форма ведения справочника их не показывает, и её
  // сохранение не должно стирать описание, заведённое в каталоге курсов.

  @ApiPropertyOptional({
    description: 'Образовательный проект, через который программа предлагается',
    enum: EDUCATION_PROJECT_VALUES,
    default: 'rtk-school',
  })
  @IsOptional()
  @IsIn([...EDUCATION_PROJECT_VALUES], { message: `Допустимые значения: ${EDUCATION_PROJECT_VALUES.join(', ')}` })
  source?: EducationProjectValue;

  @ApiPropertyOptional({ description: 'Описание программы', maxLength: 4000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @ApiPropertyOptional({ description: 'Для кого программа', maxLength: 2000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  audience?: string | null;

  @ApiPropertyOptional({
    description: 'Категория аудитории — для фильтра каталога',
    enum: AUDIENCE_VALUES,
    default: 'specialists',
  })
  @IsOptional()
  @IsIn([...AUDIENCE_VALUES], { message: `Допустимые значения: ${AUDIENCE_VALUES.join(', ')}` })
  audienceCategory?: AudienceValue;

  @ApiPropertyOptional({ description: 'Что необходимо для зачисления', maxLength: 2000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  requirements?: string | null;
}

export class UpdateItProgramDto extends CreateItProgramDto {
  @ApiPropertyOptional({ description: 'Активна ли запись каталога' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ItProgramDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ format: 'uuid' })
  directionId!: string;

  @ApiProperty({ description: 'Наименование направления' })
  directionName!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  productId!: string | null;

  @ApiProperty({ description: 'Наименование продукта', nullable: true })
  productName!: string | null;

  @ApiProperty({ nullable: true })
  hoursTotal!: number | null;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ description: 'Образовательный проект', enum: EDUCATION_PROJECT_VALUES })
  source!: EducationProjectValue;

  @ApiProperty({ description: 'Описание программы', nullable: true })
  description!: string | null;

  @ApiProperty({ description: 'Для кого программа', nullable: true })
  audience!: string | null;

  @ApiProperty({ description: 'Категория аудитории', enum: AUDIENCE_VALUES })
  audienceCategory!: AudienceValue;

  @ApiProperty({ description: 'Что необходимо для зачисления', nullable: true })
  requirements!: string | null;

  @ApiProperty({ description: 'Потоков идёт сейчас (статус ACTIVE)', example: 2 })
  activeStreamCount!: number;

  @ApiProperty({ description: 'Обучается сейчас — сумма по идущим потокам', example: 83 })
  studentsCount!: number;
}

export const PROGRAM_SORT_VALUES = ['name', 'hoursTotal', 'students'] as const;
export type ProgramSort = (typeof PROGRAM_SORT_VALUES)[number];

export class ItProgramQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Фильтр по направлению', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  directionId?: string;

  @ApiPropertyOptional({ description: 'Только активные записи', default: true })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  activeOnly?: boolean = true;

  @ApiPropertyOptional({ description: 'Образовательный проект', enum: EDUCATION_PROJECT_VALUES })
  @IsOptional()
  @IsIn([...EDUCATION_PROJECT_VALUES], { message: `Допустимые значения: ${EDUCATION_PROJECT_VALUES.join(', ')}` })
  source?: EducationProjectValue;

  @ApiPropertyOptional({ description: 'Категория аудитории', enum: AUDIENCE_VALUES })
  @IsOptional()
  @IsIn([...AUDIENCE_VALUES], { message: `Допустимые значения: ${AUDIENCE_VALUES.join(', ')}` })
  audienceCategory?: AudienceValue;

  @ApiPropertyOptional({ description: 'Программы, по которым есть потоки в этом вузе', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  universityId?: string;

  @ApiPropertyOptional({ description: 'Не меньше часов', minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  hoursMin?: number;

  @ApiPropertyOptional({ description: 'Не больше часов', minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  hoursMax?: number;

  @ApiPropertyOptional({
    description: 'true — только программы с идущими или запланированными потоками; false — без них',
  })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  hasStreams?: boolean;

  @ApiPropertyOptional({
    description:
      'Поле сортировки. students — по числу обучающихся сейчас. Поиск — search (по названию и описанию), ' +
      'направление — sortOrder.',
    enum: PROGRAM_SORT_VALUES,
    default: 'name',
  })
  @IsOptional()
  @IsIn([...PROGRAM_SORT_VALUES], { message: `Допустимые значения: ${PROGRAM_SORT_VALUES.join(', ')}` })
  sortBy?: ProgramSort = 'name';
}
