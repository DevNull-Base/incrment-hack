import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export const MEETING_STATUS_VALUES = ['SCHEDULED', 'COMPLETED', 'CANCELLED'] as const;
export type MeetingStatusValue = (typeof MEETING_STATUS_VALUES)[number];

/** Предел участников: встреча, а не рассылка. */
const MAX_PARTICIPANTS = 50;
const TEXT_MAX = 4000;

export class CreateMeetingDto {
  @ApiProperty({ description: 'Начало встречи, ISO 8601 с часовым поясом', example: '2026-10-05T10:00:00+03:00' })
  @IsISO8601({ strict: true }, { message: 'Время встречи — в формате ISO 8601' })
  scheduledAt!: string;

  @ApiPropertyOptional({ description: 'Продолжительность, минут', minimum: 5, maximum: 1440, example: 60 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(1440)
  durationMinutes?: number;

  @ApiPropertyOptional({ description: 'Место или ссылка на видеовстречу', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  location?: string;

  @ApiPropertyOptional({ description: 'Повестка', maxLength: TEXT_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_MAX)
  agenda?: string;

  @ApiPropertyOptional({
    description: 'Сотрудники ИТ Школы. Не указаны — встречу проводит автор.',
    type: [String],
    format: 'uuid',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PARTICIPANTS)
  @IsUUID('all', { each: true })
  attendeeIds?: string[];

  @ApiPropertyOptional({
    description: 'Ответственные от вуза (идентификаторы из списка контактов вуза)',
    type: [String],
    format: 'uuid',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PARTICIPANTS)
  @IsUUID('all', { each: true })
  contactIds?: string[];
}

/** Не переданное поле не меняется; null очищает необязательное поле. */
export class UpdateMeetingDto {
  @ApiPropertyOptional({ description: 'Перенести встречу, ISO 8601' })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'Время встречи — в формате ISO 8601' })
  scheduledAt?: string;

  @ApiPropertyOptional({ minimum: 5, maximum: 1440, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(1440)
  durationMinutes?: number | null;

  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(500)
  location?: string | null;

  @ApiPropertyOptional({ maxLength: TEXT_MAX, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(TEXT_MAX)
  agenda?: string | null;

  @ApiPropertyOptional({ description: 'Итоги: о чём договорились', maxLength: TEXT_MAX, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(TEXT_MAX)
  protocol?: string | null;

  @ApiPropertyOptional({ enum: MEETING_STATUS_VALUES })
  @IsOptional()
  @IsIn([...MEETING_STATUS_VALUES], { message: `Допустимые значения: ${MEETING_STATUS_VALUES.join(', ')}` })
  status?: MeetingStatusValue;

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PARTICIPANTS)
  @IsUUID('all', { each: true })
  attendeeIds?: string[];

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PARTICIPANTS)
  @IsUUID('all', { each: true })
  contactIds?: string[];
}

export class MeetingParticipantDto {
  @ApiProperty({ enum: ['EMPLOYEE', 'CONTACT'], description: 'Сотрудник ИТ Школы или представитель вуза' })
  kind!: 'EMPLOYEE' | 'CONTACT';

  @ApiProperty({ format: 'uuid', description: 'app_user.id либо university_contact.id' })
  id!: string;

  @ApiProperty({ example: 'Кузнецов Андрей Иванович' })
  name!: string;

  @ApiProperty({ nullable: true, example: 'Проректор по цифровизации' })
  position!: string | null;
}

export class MeetingPersonDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;
}

export class MeetingDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  engagementId!: string;

  @ApiProperty()
  scheduledAt!: Date;

  @ApiProperty({ description: 'День по часовому поясу организации', example: '2026-10-05' })
  date!: string;

  @ApiProperty({ description: 'Время по часовому поясу организации', example: '10:00' })
  time!: string;

  @ApiProperty({ nullable: true })
  durationMinutes!: number | null;

  @ApiProperty({ nullable: true })
  location!: string | null;

  @ApiProperty({ nullable: true })
  agenda!: string | null;

  @ApiProperty({ nullable: true })
  protocol!: string | null;

  @ApiProperty({ enum: MEETING_STATUS_VALUES })
  status!: MeetingStatusValue;

  @ApiProperty({
    type: [MeetingParticipantDto],
    description: 'Сотрудники, затем представители вуза. Обезличенные в реестре ПДн не показываются.',
  })
  participants!: MeetingParticipantDto[];

  @ApiProperty({ type: MeetingPersonDto })
  createdBy!: MeetingPersonDto;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ description: 'Текущий пользователь может изменить встречу' })
  canEdit!: boolean;
}
