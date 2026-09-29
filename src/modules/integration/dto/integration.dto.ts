import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { IntegrationSourceType, SyncRunStatus } from '../../../generated/prisma/enums.js';

const SOURCE_TYPES: IntegrationSourceType[] = ['LMS', 'WEBSITE'];
const RUN_STATUSES: SyncRunStatus[] = ['RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED'];

export class IntegrationSourceDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: SOURCE_TYPES, description: 'Внешняя система: LMS либо сайт' })
  type!: IntegrationSourceType;

  @ApiProperty()
  name!: string;

  @ApiProperty({ description: 'Адрес внешней системы' })
  baseUrl!: string;

  @ApiProperty()
  isEnabled!: boolean;

  @ApiProperty({
    description: 'Курсор инкрементальной выборки: с этой позиции читается следующая порция',
    nullable: true,
  })
  syncCursor!: string | null;

  @ApiProperty({ description: 'Расписание опроса; null — только ручной запуск', nullable: true })
  cronSchedule!: string | null;

  @ApiProperty({
    description:
      'Режим обмена. stub — обмен с заглушками на встроенных примерах, ' +
      'live — обращение к реальным адресам.',
    enum: ['stub', 'live'],
  })
  mode!: 'stub' | 'live';
}

export class IntegrationSyncRunDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  sourceId!: string;

  @ApiProperty({ enum: RUN_STATUSES })
  status!: SyncRunStatus;

  @ApiProperty({ description: 'Сколько событий получено' })
  fetched!: number;

  @ApiProperty({ description: 'Сколько заявок создано' })
  created!: number;

  @ApiProperty({ description: 'Сколько записей обновлено' })
  updated!: number;

  @ApiProperty({ description: 'Сколько событий пропущено как уже применённые' })
  skipped!: number;

  @ApiProperty({ description: 'Сколько событий не удалось применить' })
  failed!: number;

  @ApiProperty({ nullable: true })
  errorDetail!: string | null;

  @ApiProperty()
  startedAt!: Date;

  @ApiProperty({ nullable: true })
  finishedAt!: Date | null;
}

export class IntegrationRunQueryDto {
  @ApiPropertyOptional({ description: 'Фильтр по источнику', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  sourceId?: string;
}

export class InboundEventResultDto {
  @ApiProperty({ description: 'Принято ли событие' })
  accepted!: boolean;

  @ApiProperty({
    description:
      'Что сделано: created — заведена заявка, skipped — событие уже применялось, ' +
      'failed — событие сохранено, но не разобрано',
    enum: ['created', 'updated', 'skipped', 'failed'],
  })
  outcome!: 'created' | 'updated' | 'skipped' | 'failed';
}

export class ContractDescriptionDto {
  @ApiProperty({ description: 'Идентификатор контракта', example: 'engagement.v1' })
  contract!: string;

  @ApiProperty({ description: 'Назначение и порядок применения' })
  description!: string;

  @ApiProperty({ description: 'Схема сообщения', type: 'object', additionalProperties: true })
  schema!: Record<string, unknown>;

  @ApiProperty({ description: 'Пример сообщения', type: 'object', additionalProperties: true })
  example!: Record<string, unknown>;
}
