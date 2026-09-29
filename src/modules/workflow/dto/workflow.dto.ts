import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ToBoolean } from '../../../common/dto/query-transforms.js';
import { EngagementSegment } from '../../../generated/prisma/enums.js';
import { EDUCATION_PROJECT_VALUES, type EducationProjectValue } from '../../catalog/catalog-enums.js';

const SITE_SOURCE_MESSAGE = `Допустимые значения: ${EDUCATION_PROJECT_VALUES.join(', ')}`;

const SEGMENT_VALUES: EngagementSegment[] = ['B2B', 'B2C'];

export class WorkflowTemplateQueryDto {
  @ApiPropertyOptional({ description: 'Фильтр по сегменту', enum: SEGMENT_VALUES })
  @IsOptional()
  @IsEnum(SEGMENT_VALUES)
  segment?: EngagementSegment;

  @ApiPropertyOptional({
    description: 'Показывать прошлые редакции и черновики, а не только действующие',
    default: false,
  })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  includeInactive?: boolean = false;
}

export class CreateWorkflowTemplateDto {
  @ApiPropertyOptional({
    description:
      'Ключ семейства редакций. Если указать ключ существующего процесса, ' +
      'черновик станет его следующей редакцией; иначе будет заведён новый процесс.',
    example: 'university-engagement',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-z][a-z0-9-]*$/, {
    message: 'Ключ: строчные латинские буквы, цифры и дефис',
  })
  key?: string;

  @ApiProperty({ description: 'Название редакции', example: 'Взаимодействие с вузом' })
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ description: 'Описание изменений редакции' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({
    description: 'Сегмент, для которого действует процесс. По умолчанию B2B.',
    enum: SEGMENT_VALUES,
  })
  @IsOptional()
  @IsEnum(SEGMENT_VALUES)
  segment?: EngagementSegment;

  @ApiPropertyOptional({
    description:
      'Сайт-источник, для которого собран процесс: sz-rt — федеральный проект, edu-rt — ' +
      'коммерческие программы. Не указан у следующей редакции — наследуется от предыдущей; ' +
      'null — процесс общий.',
    enum: EDUCATION_PROJECT_VALUES,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn([...EDUCATION_PROJECT_VALUES], { message: SITE_SOURCE_MESSAGE })
  siteSource?: EducationProjectValue | null;

  @ApiProperty({
    description:
      'Определение процесса: состояния и переходы. Проверяется схемой — ' +
      'ровно одно начальное состояние, хотя бы одно завершающее, все состояния ' +
      'достижимы, из завершающих переходов нет.',
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  definition!: Record<string, unknown>;
}

export class UpdateWorkflowTemplateDto {
  @ApiPropertyOptional({ description: 'Название редакции' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ description: 'Сайт-источник; null — процесс общий', enum: EDUCATION_PROJECT_VALUES, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn([...EDUCATION_PROJECT_VALUES], { message: SITE_SOURCE_MESSAGE })
  siteSource?: EducationProjectValue | null;

  @ApiPropertyOptional({ description: 'Описание изменений редакции' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({
    description: 'Определение процесса целиком',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  definition?: Record<string, unknown>;
}

export class PublishWorkflowTemplateDto {
  @ApiProperty({
    description:
      'Подтверждение операции. Публикация переводит на новую редакцию все ' +
      'текущие заявки, поэтому выполняется только с явным подтверждением.',
    default: false,
  })
  @IsBoolean()
  confirm!: boolean;

  @ApiPropertyOptional({
    description:
      'Куда перевести заявки из исчезающих статусов: ключ прежнего статуса → ' +
      'ключ статуса новой редакции. Обязательно для каждого удаляемого статуса, ' +
      'в котором есть заявки.',
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { DOCUMENTS_REVISION: 'DOCUMENTS_EXCHANGE' },
  })
  @IsOptional()
  @IsObject()
  stateMapping?: Record<string, string>;
}

export class WorkflowTemplateSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'Ключ семейства редакций', example: 'university-engagement' })
  key!: string;

  @ApiProperty({ description: 'Номер редакции' })
  version!: number;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ description: 'Сайт-источник процесса; null — процесс общий', enum: EDUCATION_PROJECT_VALUES, nullable: true })
  siteSource!: EducationProjectValue | null;

  @ApiProperty({ enum: SEGMENT_VALUES })
  segment!: EngagementSegment;

  @ApiProperty({ description: 'Действует ли редакция сейчас' })
  isActive!: boolean;

  @ApiProperty({ description: 'Назначается ли новым заявкам сегмента' })
  isDefault!: boolean;

  @ApiProperty({ nullable: true })
  publishedAt!: Date | null;

  @ApiProperty({ description: 'Число состояний' })
  stateCount!: number;

  @ApiProperty({ description: 'Сколько заявок ведётся по этой редакции' })
  engagementCount!: number;
}

export class WorkflowTemplateDetailDto extends WorkflowTemplateSummaryDto {
  @ApiProperty({
    description: 'Определение процесса: состояния и переходы',
    type: 'object',
    additionalProperties: true,
  })
  definition!: Record<string, unknown>;
}

/** Статус, исчезающий из процесса, и число стоящих в нём заявок. */
export class RemovedStateDto {
  @ApiProperty({ example: 'DOCUMENTS_REVISION' })
  key!: string;

  @ApiProperty({ example: 'Корректировка документов' })
  label!: string;

  @ApiProperty({ description: 'Сколько заявок стоит в этом статусе сейчас' })
  engagementCount!: number;

  @ApiProperty({
    description:
      'Сколько заметок этого этапа переедет вместе с заявками. Считаются заметки ' +
      'только тех заявок, что стоят в статусе сейчас: у ушедших дальше заметки ' +
      'остаются историей на прежнем этапе.',
  })
  noteCount!: number;

  @ApiProperty({ description: 'Сколько файлов этого этапа переедет вместе с заявками' })
  attachmentCount!: number;

  @ApiProperty({
    description: 'Предлагаемая цель переноса — соседний статус процесса',
    nullable: true,
  })
  suggestedTarget!: string | null;
}

export class RenamedStateDto {
  @ApiProperty()
  key!: string;

  @ApiProperty()
  fromLabel!: string;

  @ApiProperty()
  toLabel!: string;
}

export class AddedStateDto {
  @ApiProperty()
  key!: string;

  @ApiProperty()
  label!: string;
}

/**
 * Итог предварительного просмотра публикации.
 *
 * Это данные для диалога подтверждения: администратор должен видеть, что
 * именно изменится и сколько заявок будет затронуто, до того как нажмёт
 * «опубликовать».
 */
export class WorkflowPublishPreviewDto {
  @ApiProperty({ description: 'Редакция, действующая сейчас', nullable: true })
  currentTemplateId!: string | null;

  @ApiProperty({ description: 'Публикуемая редакция', format: 'uuid' })
  nextTemplateId!: string;

  @ApiProperty({ type: [AddedStateDto], description: 'Появляющиеся статусы' })
  addedStates!: AddedStateDto[];

  @ApiProperty({ type: [RemovedStateDto], description: 'Исчезающие статусы' })
  removedStates!: RemovedStateDto[];

  @ApiProperty({ type: [RenamedStateDto], description: 'Переименованные статусы' })
  renamedStates!: RenamedStateDto[];

  @ApiProperty({ description: 'Изменился ли состав переходов' })
  transitionsChanged!: boolean;

  @ApiProperty({ description: 'Сколько заявок будет переведено на новую редакцию' })
  affectedEngagements!: number;

  @ApiProperty({ description: 'Сколько заявок сменит статус из-за его удаления' })
  relocatedEngagements!: number;

  @ApiProperty({
    description:
      'Сколько заметок переедет на новый этап вместе с заявками. Подпись этапа, ' +
      'на котором заметка написана, сохраняется.',
  })
  relocatedNotes!: number;

  @ApiProperty({
    description:
      'Сколько файлов переедет на новый этап вместе с заявками. Для нового статуса ' +
      'они считаются приложенными к нему — условие «приложите документ» их учитывает.',
  })
  relocatedAttachments!: number;

  @ApiProperty({
    description: 'Предлагаемое сопоставление статусов: прежний ключ → новый ключ',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  suggestedMapping!: Record<string, string>;

  @ApiProperty({
    description:
      'Незакрытые вопросы: статусы с заявками, для которых цель переноса ' +
      'не подобрана автоматически. Пока список не пуст, публикация отклоняется.',
    type: [String],
  })
  blockingIssues!: string[];
}

/** Итог публикации. */
export class WorkflowPublishResultDto {
  @ApiProperty({ format: 'uuid' })
  templateId!: string;

  @ApiProperty({ description: 'Номер опубликованной редакции' })
  version!: number;

  @ApiProperty({ description: 'Сколько заявок переведено на новую редакцию' })
  movedEngagements!: number;

  @ApiProperty({ description: 'Сколько заявок сменило статус' })
  relocatedEngagements!: number;
}
