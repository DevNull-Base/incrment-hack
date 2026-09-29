import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { PageQueryDto } from '../../../common/dto/pagination.dto.js';

export const STREAM_STATUS_VALUES = ['PLANNED', 'ACTIVE', 'COMPLETED', 'PAUSED'] as const;
export type StreamStatusValue = (typeof STREAM_STATUS_VALUES)[number];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'Ожидается дата в формате YYYY-MM-DD';
const STATUS_MESSAGE = `Допустимые значения: ${STREAM_STATUS_VALUES.join(', ')}`;

export class CreateLearningStreamDto {
  @ApiProperty({ description: 'Программа', format: 'uuid' })
  @IsUUID()
  programId!: string;

  @ApiPropertyOptional({
    description: 'Вуз, при котором идёт поток; null — набор прямых продаж с сайта',
    format: 'uuid',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  universityId?: string | null;

  @ApiPropertyOptional({ description: 'Подпись потока, как в LMS', example: 'Осень-2026', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(200)
  name?: string | null;

  @ApiProperty({ description: 'Начало обучения, YYYY-MM-DD', example: '2026-09-01' })
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
  startDate!: string;

  @ApiPropertyOptional({ description: 'Окончание обучения, YYYY-MM-DD', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
  endDate?: string | null;

  @ApiProperty({ description: 'Обучающихся в потоке', minimum: 0, maximum: 100000, example: 45 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  studentsCount!: number;

  @ApiPropertyOptional({ enum: STREAM_STATUS_VALUES, default: 'PLANNED' })
  @IsOptional()
  @IsIn([...STREAM_STATUS_VALUES], { message: STATUS_MESSAGE })
  status?: StreamStatusValue;
}

/** Изменение потока — полной заменой, как у остальных записей каталога. */
export class UpdateLearningStreamDto extends CreateLearningStreamDto {}

export class LearningStreamQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Потоки программы', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  programId?: string;

  @ApiPropertyOptional({ description: 'Потоки при вузе', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  universityId?: string;

  @ApiPropertyOptional({ enum: STREAM_STATUS_VALUES })
  @IsOptional()
  @IsIn([...STREAM_STATUS_VALUES], { message: STATUS_MESSAGE })
  status?: StreamStatusValue;
}

export class LearningStreamDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  programId!: string;

  @ApiProperty({ example: 'Основы DevOps-практик' })
  programName!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  universityId!: string | null;

  @ApiProperty({ description: 'Сокращённое, а при его отсутствии полное наименование вуза', nullable: true })
  universityName!: string | null;

  @ApiProperty({ nullable: true, example: 'Осень-2026' })
  name!: string | null;

  @ApiProperty({ example: '2026-09-01' })
  startDate!: string;

  @ApiProperty({ nullable: true, example: '2026-12-20' })
  endDate!: string | null;

  @ApiProperty({ example: 45 })
  studentsCount!: number;

  @ApiProperty({ enum: STREAM_STATUS_VALUES })
  status!: StreamStatusValue;

  @ApiProperty({ description: 'Источник записи: lms — пришёл синхронизацией, null — заведён вручную', nullable: true })
  externalSource!: string | null;
}
