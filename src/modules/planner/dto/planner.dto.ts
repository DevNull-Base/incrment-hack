import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/pagination.dto.js';
import { ToBoolean } from '../../../common/dto/query-transforms.js';
import { toList } from '../../engagement/dto/engagement.dto.js';
import { MeetingDto } from '../../meetings/dto/meeting.dto.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'Ожидается дата в формате YYYY-MM-DD';
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIME_MESSAGE = 'Ожидается время в формате HH:mm';

export const TASK_STATUS_VALUES = ['open', 'done', 'overdue', 'all'] as const;
export type TaskStatusFilter = (typeof TASK_STATUS_VALUES)[number];

export const CALENDAR_KIND_VALUES = ['TASK', 'STAGE_DEADLINE', 'MEETING'] as const;
export type CalendarItemKind = (typeof CALENDAR_KIND_VALUES)[number];

export class CreateTaskDto {
  @ApiProperty({ example: 'Позвонить проректору МИФИ по пилоту', maxLength: 300 })
  @IsString()
  @MinLength(1, { message: 'Укажите, что нужно сделать' })
  @MaxLength(300)
  title!: string;

  @ApiPropertyOptional({ description: 'Подробности', maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiProperty({ description: 'День задачи, YYYY-MM-DD', example: '2026-09-30' })
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
  dueDate!: string;

  @ApiPropertyOptional({
    description:
      'Время по часовому поясу организации, HH:mm. Не указано — задача на весь день ' +
      'и считается просроченной со следующего дня.',
    example: '15:00',
  })
  @IsOptional()
  @Matches(TIME_PATTERN, { message: TIME_MESSAGE })
  dueTime?: string;

  @ApiPropertyOptional({
    description: 'Когда напомнить, ISO 8601. Напоминание приходит обычным уведомлением.',
    example: '2026-09-30T09:00:00+03:00',
  })
  @IsOptional()
  @IsDateString({}, { message: 'Ожидается дата и время в формате ISO 8601' })
  remindAt?: string;

  @ApiPropertyOptional({ description: 'Заявка, к которой относится задача', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  engagementId?: string;

  @ApiPropertyOptional({
    description:
      'Исполнитель. По умолчанию — сам пользователь. Руководитель может поставить задачу ' +
      'подчинённому, администратор — любому активному пользователю.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  ownerId?: string;
}

/**
 * Правка задачи. Передаются только изменяемые поля; null очищает
 * необязательное значение. Исполнитель здесь не меняется: переназначение
 * поручения — отдельное решение, а не правка текста.
 */
export class UpdateTaskDto {
  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Укажите, что нужно сделать' })
  @MaxLength(300)
  title?: string;

  @ApiPropertyOptional({ maxLength: 4000, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @ApiPropertyOptional({ example: '2026-10-02' })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
  dueDate?: string;

  @ApiPropertyOptional({ description: 'null — задача на весь день', nullable: true, example: '11:30' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(TIME_PATTERN, { message: TIME_MESSAGE })
  dueTime?: string | null;

  @ApiPropertyOptional({ description: 'null — без напоминания', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsDateString({}, { message: 'Ожидается дата и время в формате ISO 8601' })
  remindAt?: string | null;

  @ApiPropertyOptional({ description: 'null — отвязать от заявки', format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  engagementId?: string | null;
}

export class TaskQueryDto extends PickType(PageQueryDto, ['page', 'limit'] as const) {
  @ApiPropertyOptional({
    description: 'open — невыполненные, done — выполненные, overdue — просроченные, all — все',
    enum: TASK_STATUS_VALUES,
    default: 'open',
  })
  @IsOptional()
  @IsIn([...TASK_STATUS_VALUES], { message: 'Допустимые значения: open, done, overdue, all' })
  status: TaskStatusFilter = 'open';

  @ApiPropertyOptional({ description: 'Не раньше этого дня, YYYY-MM-DD' })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
  from?: string;

  @ApiPropertyOptional({ description: 'Не позже этого дня, YYYY-MM-DD' })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
  to?: string;

  @ApiPropertyOptional({ description: 'Только задачи по этой заявке', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  engagementId?: string;

  @ApiPropertyOptional({
    description: 'false — мои задачи (я исполнитель), true — задачи, которые я поставил другим',
    default: false,
  })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  assignedByMe?: boolean;
}

export class CalendarQueryDto {
  @ApiProperty({ description: 'Первый день, YYYY-MM-DD', example: '2026-09-01' })
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
  from!: string;

  @ApiProperty({
    description: 'Последний день включительно, YYYY-MM-DD; не больше 92 дней',
    example: '2026-09-30',
  })
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
  to!: string;

  @ApiPropertyOptional({
    description:
      'Что показывать: TASK — задачи, STAGE_DEADLINE — сроки этапов заявок по нормативу, ' +
      'MEETING — встречи с представителями вузов. По умолчанию — всё.',
    type: [String],
    enum: CALENDAR_KIND_VALUES,
  })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @ArrayMaxSize(CALENDAR_KIND_VALUES.length)
  @IsIn([...CALENDAR_KIND_VALUES], { each: true, message: 'Допустимые значения: TASK, STAGE_DEADLINE, MEETING' })
  kinds?: CalendarItemKind[];

  @ApiPropertyOptional({
    description:
      'Сроки этапов по всем заявкам в области видимости, а не только по своим. ' +
      'Для руководителя — сроки подчинённых. Задачи всегда только свои.',
    default: false,
  })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  team?: boolean;

  @ApiPropertyOptional({ description: 'Показывать выполненные задачи', default: true })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  includeCompleted?: boolean;
}

export class PlannerPersonDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Петров Сергей' })
  name!: string;
}

export class PlannerEngagementDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'Вуз либо лицо', example: 'НИЯУ МИФИ' })
  counterpartyName!: string;

  @ApiProperty({ example: 'Организация встречи' })
  currentStateLabel!: string;
}

export class TaskDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ description: 'День задачи, YYYY-MM-DD', example: '2026-09-30' })
  dueDate!: string;

  @ApiProperty({
    description: 'Время по часовому поясу организации; null — на весь день',
    nullable: true,
    example: '15:00',
  })
  dueTime!: string | null;

  @ApiProperty({ description: 'Точный момент срока в UTC; null — на весь день', nullable: true })
  dueAt!: Date | null;

  @ApiProperty({ nullable: true })
  remindAt!: Date | null;

  @ApiProperty({ description: 'Напоминание уже отправлено' })
  isReminderSent!: boolean;

  @ApiProperty()
  isCompleted!: boolean;

  @ApiProperty({ nullable: true })
  completedAt!: Date | null;

  @ApiProperty({ description: 'Срок прошёл, а задача не выполнена' })
  isOverdue!: boolean;

  @ApiProperty({ type: PlannerPersonDto, description: 'Исполнитель' })
  owner!: PlannerPersonDto;

  @ApiProperty({ type: PlannerPersonDto, nullable: true, description: 'Кто поставил задачу' })
  createdBy!: PlannerPersonDto | null;

  @ApiProperty({ description: 'Задачу поставил другой человек — руководитель' })
  isAssigned!: boolean;

  @ApiProperty({ type: PlannerEngagementDto, nullable: true })
  engagement!: PlannerEngagementDto | null;

  @ApiProperty({
    description:
      'Можно ли менять текст, срок, напоминание и удалять задачу. Задачу, поставленную ' +
      'руководителем, исполнитель выполняет, но не правит.',
  })
  canEdit!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class CalendarDeadlineDto {
  @ApiProperty({ example: 'DOCUMENTS_EXCHANGE' })
  stateKey!: string;

  @ApiProperty({ example: 'Обмен документами' })
  stateLabel!: string;

  @ApiProperty({ type: PlannerPersonDto, description: 'Ответственный за заявку' })
  owner!: PlannerPersonDto;
}

export class CalendarItemDto {
  @ApiProperty({ enum: CALENDAR_KIND_VALUES })
  kind!: CalendarItemKind;

  @ApiProperty({ description: 'Задача либо заявка, к которой относится срок', format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'День, YYYY-MM-DD', example: '2026-09-30' })
  date!: string;

  @ApiProperty({ description: 'Время по часовому поясу организации; null — на весь день', nullable: true })
  time!: string | null;

  @ApiProperty({ description: 'Точный момент в UTC; null — на весь день', nullable: true })
  at!: Date | null;

  @ApiProperty({ example: 'Позвонить проректору МИФИ по пилоту' })
  title!: string;

  @ApiProperty({ description: 'Задача выполнена' })
  isDone!: boolean;

  @ApiProperty({ description: 'Срок прошёл' })
  isOverdue!: boolean;

  @ApiProperty({ type: PlannerEngagementDto, nullable: true })
  engagement!: PlannerEngagementDto | null;

  @ApiProperty({ type: TaskDto, nullable: true, description: 'Для kind = TASK' })
  task!: TaskDto | null;

  @ApiProperty({ type: CalendarDeadlineDto, nullable: true, description: 'Для kind = STAGE_DEADLINE' })
  deadline!: CalendarDeadlineDto | null;

  @ApiProperty({ type: MeetingDto, nullable: true, description: 'Для kind = MEETING' })
  meeting!: MeetingDto | null;
}

export class CalendarDto {
  @ApiProperty({ example: '2026-09-01' })
  from!: string;

  @ApiProperty({ example: '2026-09-30' })
  to!: string;

  @ApiProperty({ description: 'Часовой пояс, в котором считаются дни', example: 'Europe/Moscow' })
  timezone!: string;

  @ApiProperty({
    type: [CalendarItemDto],
    description: 'По дням, внутри дня — сначала «на весь день», затем по времени',
  })
  items!: CalendarItemDto[];
}
