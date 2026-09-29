import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/pagination.dto.js';
import { EngagementListItemDto, toList } from '../../engagement/dto/engagement.dto.js';
import type { ActivitySource, ActivityType } from '../../../generated/prisma/enums.js';

export const ACTIVITY_TYPE_VALUES: ActivityType[] = [
  'ENGAGEMENT_CREATED',
  'ENGAGEMENT_UPDATED',
  'STATE_CHANGED',
  'INTEREST_CHANGED',
  'OWNER_CHANGED',
  'NOTE_ADDED',
  'NOTE_UPDATED',
  'NOTE_DELETED',
  'ATTACHMENT_ADDED',
  'ATTACHMENT_DELETED',
  'TASK_CREATED',
  'TASK_UPDATED',
  'TASK_COMPLETED',
  'TASK_REOPENED',
  'TASK_DELETED',
  'PAYMENT_CONFIRMED',
  'LMS_EXPORTED',
  'ENGAGEMENT_ARCHIVED',
  'ENGAGEMENT_RESTORED',
  'MEETING_SCHEDULED',
  'MEETING_UPDATED',
];

const ACTIVITY_SOURCE_VALUES: ActivitySource[] = ['USER', 'INTEGRATION', 'WORKFLOW'];

/** Отбор ленты: период, типы событий, заявка. Постраничный вывод — как везде. */
export class ActivityFeedQueryDto extends PickType(PageQueryDto, ['page', 'limit'] as const) {
  @ApiPropertyOptional({ description: 'Не раньше, ISO 8601' })
  @IsOptional()
  @IsDateString({}, { message: 'Ожидается дата в формате ISO 8601' })
  from?: string;

  @ApiPropertyOptional({ description: 'Не позже, ISO 8601' })
  @IsOptional()
  @IsDateString({}, { message: 'Ожидается дата в формате ISO 8601' })
  to?: string;

  @ApiPropertyOptional({
    description: 'Типы событий — повтором параметра или через запятую',
    type: [String],
    enum: ACTIVITY_TYPE_VALUES,
    example: ['STATE_CHANGED', 'NOTE_ADDED'],
  })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @ArrayMaxSize(ACTIVITY_TYPE_VALUES.length)
  @IsIn(ACTIVITY_TYPE_VALUES, { each: true, message: 'Неизвестный тип события' })
  types?: ActivityType[];

  @ApiPropertyOptional({ description: 'Только события по этой заявке', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  engagementId?: string;
}

/** История одной заявки: те же отборы, кроме самой заявки. */
export class EngagementTimelineQueryDto extends PickType(ActivityFeedQueryDto, [
  'page',
  'limit',
  'from',
  'to',
  'types',
] as const) {}

export class RecentEngagementsQueryDto {
  @ApiPropertyOptional({
    description: 'За сколько последних дней, от 1 до 90',
    default: 14,
    minimum: 1,
    maximum: 90,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days: number = 14;

  @ApiPropertyOptional({ description: 'Сколько заявок вернуть, до 50', default: 20, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;
}

export class ActivityActorDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Иванова Анна' })
  name!: string;
}

export class ActivityEngagementDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'Вуз либо лицо', example: 'НИЯУ МИФИ' })
  counterpartyName!: string;

  @ApiProperty({ example: 'DevOps' })
  directionName!: string;

  @ApiProperty({ description: 'Текущий статус заявки', example: 'Подписание документов' })
  currentStateLabel!: string;
}

export class ActivityStageDto {
  @ApiProperty({ example: 'SIGNING' })
  key!: string;

  @ApiProperty({ description: 'Подпись этапа на момент действия', example: 'Подписание документов' })
  label!: string;
}

export class ActivityNoteDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'Начало текста заметки, до 200 символов', nullable: true })
  excerpt!: string | null;

  @ApiProperty({ description: 'Заметку удалили — текст не показывается' })
  isDeleted!: boolean;
}

export class ActivityAttachmentDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ nullable: true, description: 'Имя файла; null — запись файла уже удалена из системы' })
  fileName!: string | null;

  @ApiProperty()
  isDeleted!: boolean;
}

export class ActivityTaskDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ nullable: true })
  title!: string | null;

  @ApiProperty({ description: 'Дата задачи, YYYY-MM-DD', nullable: true, example: '2026-09-30' })
  dueDate!: string | null;

  @ApiProperty()
  isCompleted!: boolean;

  @ApiProperty()
  isDeleted!: boolean;
}

export class ActivityItemDto {
  @ApiProperty({ description: 'Идентификатор события' })
  id!: string;

  @ApiProperty()
  occurredAt!: Date;

  @ApiProperty({ enum: ACTIVITY_TYPE_VALUES })
  type!: ActivityType;

  @ApiProperty({
    description:
      'USER — действие человека, INTEGRATION — внешней системы, WORKFLOW — перенос при правке процесса',
    enum: ACTIVITY_SOURCE_VALUES,
  })
  source!: ActivitySource;

  @ApiProperty({ description: 'Короткий заголовок', example: 'Смена статуса' })
  title!: string;

  @ApiProperty({
    description: 'Что именно изменилось',
    example: '«Организация встречи» → «Обмен документами»',
  })
  summary!: string;

  @ApiProperty({ type: ActivityActorDto, nullable: true, description: 'null — действие внешней системы' })
  actor!: ActivityActorDto | null;

  @ApiProperty({ type: ActivityEngagementDto, nullable: true })
  engagement!: ActivityEngagementDto | null;

  @ApiProperty({ type: ActivityStageDto, nullable: true })
  stage!: ActivityStageDto | null;

  @ApiProperty({ type: ActivityNoteDto, nullable: true })
  note!: ActivityNoteDto | null;

  @ApiProperty({ type: ActivityAttachmentDto, nullable: true })
  attachment!: ActivityAttachmentDto | null;

  @ApiProperty({ type: ActivityTaskDto, nullable: true })
  task!: ActivityTaskDto | null;

  @ApiProperty({
    description: 'Комментарий к переходу либо обоснование оценки заинтересованности',
    nullable: true,
  })
  comment!: string | null;

  @ApiProperty({
    description:
      'Подробности для собственной подачи в интерфейсе: ключи и подписи статусов ' +
      '(fromStateKey, toStateLabel…), значения оценки (fromLevel, toLevel), изменённые поля.',
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  details!: Record<string, unknown> | null;
}

export class RecentEngagementDto {
  @ApiProperty({ type: EngagementListItemDto, description: 'Карточка в том же виде, что и в списке' })
  engagement!: EngagementListItemDto;

  @ApiProperty({ description: 'Когда пользователь последний раз что-то делал по заявке' })
  lastActivityAt!: Date;

  @ApiProperty({ description: 'Что это было', type: ActivityItemDto })
  lastActivity!: ActivityItemDto;

  @ApiProperty({ description: 'Сколько действий по заявке за период' })
  actionCount!: number;
}
