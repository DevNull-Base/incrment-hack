import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsObject, IsOptional, Max, Min } from 'class-validator';
import { ToBoolean } from '../../../common/dto/query-transforms.js';
import { PageQueryDto } from '../../../common/dto/pagination.dto.js';
import { NotificationChannel } from '../../../generated/prisma/enums.js';

const CHANNEL_VALUES: NotificationChannel[] = ['IN_APP', 'EMAIL', 'TELEGRAM', 'MAX'];

export class NotificationQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    description: 'Канал. По умолчанию — уведомления внутри системы.',
    enum: CHANNEL_VALUES,
  })
  @IsOptional()
  @IsEnum(CHANNEL_VALUES)
  channel?: NotificationChannel;

  @ApiPropertyOptional({ description: 'Только непрочитанные', default: false })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  onlyUnread?: boolean = false;
}

export class NotificationDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: CHANNEL_VALUES })
  channel!: NotificationChannel;

  @ApiProperty()
  subject!: string;

  @ApiProperty()
  body!: string;

  @ApiProperty({ description: 'Тип объекта, к которому относится уведомление', nullable: true })
  entityType!: string | null;

  @ApiProperty({ nullable: true })
  entityId!: string | null;

  @ApiProperty({ nullable: true })
  readAt!: Date | null;

  @ApiProperty({ description: 'Момент успешной доставки', nullable: true })
  sentAt!: Date | null;

  @ApiProperty({
    description: 'Причина, по которой доставка не состоялась',
    nullable: true,
  })
  deliveryError!: string | null;

  @ApiProperty()
  createdAt!: Date;
}

export class UnreadCountDto {
  @ApiProperty({ description: 'Число непрочитанных уведомлений' })
  unread!: number;
}

export class UpdatePolicyDto {
  @ApiPropertyOptional({
    description:
      'Через сколько дней простоя в одном статусе уходит напоминание. ' +
      'На сессии вопросов и ответов назван срок «более одной или двух недель».',
    minimum: 1,
    maximum: 365,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  escalationDays?: number;

  @ApiPropertyOptional({ description: 'Уведомлять ответственного о смене статуса' })
  @IsOptional()
  @IsBoolean()
  notifyOwnerOnTransition?: boolean;

  @ApiPropertyOptional({ description: 'Дублировать напоминание руководителю' })
  @IsOptional()
  @IsBoolean()
  notifyManagerOnEscalation?: boolean;
}

export class UpdateChannelDto {
  @ApiPropertyOptional({ description: 'Включён ли канал' })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional({
    description:
      'Параметры подключения. Для мессенджеров — botToken и chatId, ' +
      'для почты — host, port, from. Пустое значение секрета оставляет ' +
      'сохранённое прежде.',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}

export class ChannelSettingsDto {
  @ApiProperty({ enum: CHANNEL_VALUES })
  channel!: NotificationChannel;

  @ApiProperty()
  isEnabled!: boolean;

  @ApiProperty({ description: 'Достаточно ли настроек для доставки' })
  ready!: boolean;

  @ApiProperty({ description: 'Чего не хватает либо особенности канала', nullable: true })
  readinessDetail!: string | null;

  @ApiProperty({
    description: 'Параметры подключения; секреты замаскированы',
    type: 'object',
    additionalProperties: true,
  })
  settings!: Record<string, unknown>;

  @ApiProperty({ description: 'Итог последней проверки канала', nullable: true })
  lastTestDelivered!: boolean | null;

  @ApiProperty({ nullable: true })
  lastTestDetail!: string | null;
}

export class NotificationSettingsDto {
  @ApiProperty({ description: 'Порог простоя заявки в днях' })
  escalationDays!: number;

  @ApiProperty()
  notifyOwnerOnTransition!: boolean;

  @ApiProperty()
  notifyManagerOnEscalation!: boolean;

  @ApiProperty({ type: [ChannelSettingsDto] })
  channels!: ChannelSettingsDto[];
}
