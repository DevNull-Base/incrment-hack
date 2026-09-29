import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPageResponse, PageDto, PageQueryDto, toPage } from '../../common/dto/pagination.dto.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { Roles } from '../access/roles.decorator.js';
import { AuditService } from './audit.service.js';

class AuditLogItemDto {
  @ApiProperty({ description: 'Идентификатор записи' })
  id!: string;

  @ApiProperty({ description: 'Момент события' })
  occurredAt!: Date;

  @ApiProperty({ description: 'Адрес пользователя, выполнившего действие', nullable: true })
  actorEmail!: string | null;

  @ApiProperty({ description: 'Действие', example: 'WORKFLOW_TRANSITION' })
  action!: string;

  @ApiProperty({ description: 'Тип объекта', nullable: true })
  entityType!: string | null;

  @ApiProperty({ description: 'Идентификатор объекта', nullable: true })
  entityId!: string | null;

  @ApiProperty({ description: 'IP-адрес', nullable: true })
  ipAddress!: string | null;

  @ApiProperty({ description: 'Клиент, с которого выполнено действие', nullable: true })
  userAgent!: string | null;

  @ApiProperty({ description: 'Идентификатор запроса для сопоставления с логами', nullable: true })
  traceId!: string | null;

  @ApiProperty({ description: 'Состояние до изменения (персональные данные скрыты)', nullable: true })
  beforeState!: unknown;

  @ApiProperty({ description: 'Состояние после изменения (персональные данные скрыты)', nullable: true })
  afterState!: unknown;
}

class ChainVerificationDto {
  @ApiProperty({ description: 'Сколько записей проверено', example: 1204 })
  checked!: number;

  @ApiProperty({
    description: 'Целостность цепочки не нарушена',
    example: true,
  })
  intact!: boolean;

  @ApiProperty({
    description: 'Идентификатор первой записи с нарушением; null, если нарушений нет',
    nullable: true,
  })
  brokenAtId!: string | null;

  @ApiProperty({ description: 'Пояснение результата' })
  message!: string;
}

class AuditQueryDto extends PageQueryDto {
  @ApiProperty({ required: false, description: 'Фильтр по действию', example: 'WORKFLOW_TRANSITION' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  action?: string;

  @ApiProperty({ required: false, description: 'Фильтр по типу объекта' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  entityType?: string;

  @ApiProperty({ required: false, description: 'Фильтр по субъекту действия', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiProperty({ required: false, description: 'Начало периода (включительно)', format: 'date-time' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiProperty({ required: false, description: 'Конец периода (включительно)', format: 'date-time' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiProperty({ required: false, description: 'Глубина проверки цепочки', example: 10000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  depth?: number;
}

/**
 * Журнал действий пользователей.
 *
 * Доступен только администратору: журнал содержит сведения о том, кто и когда
 * обращался к персональным данным, и сам по себе является охраняемой
 * информацией.
 */
@ApiTags('Администрирование')
@ApiBearerAuth('keycloak')
@Roles('ADMIN')
@Controller({ path: 'audit', version: '1' })
export class AuditController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Просмотр журнала действий' })
  @ApiPageResponse(AuditLogItemDto)
  async findAll(@Query() query: AuditQueryDto): Promise<PageDto<AuditLogItemDto>> {
    // Разбор инцидента почти всегда начинается с вопросов «кто» и «когда»,
    // поэтому отбор по субъекту и периоду обязателен: без него журнал
    // на сотни тысяч записей приходится листать целиком.
    const where = {
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.from || query.to
        ? {
            occurredAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const [total, records] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { id: 'desc' },
        select: {
          id: true,
          occurredAt: true,
          actorEmail: true,
          action: true,
          entityType: true,
          entityId: true,
          ipAddress: true,
          userAgent: true,
          traceId: true,
          beforeState: true,
          afterState: true,
        },
      }),
    ]);

    const items = records.map((record) => ({
      ...record,
      // BigInt не сериализуется в JSON, поэтому идентификатор отдаётся строкой.
      id: record.id.toString(),
    }));

    return toPage(items, total, query);
  }

  /**
   * Проверка целостности журнала.
   *
   * Пересчитывает хэш-цепочку и сообщает, где она расходится. Позволяет
   * подтвердить, что записи не изменялись и не изымались, — без такой
   * проверки хэш-цепочка остаётся декларацией.
   */
  @Get('verify')
  @ApiOperation({ summary: 'Проверить целостность хэш-цепочки журнала' })
  @ApiOkResponse({ type: ChainVerificationDto })
  async verify(@Query() query: AuditQueryDto): Promise<ChainVerificationDto> {
    const result = await this.audit.verifyChain(query.depth ?? 10_000);
    const intact = result.brokenAtId === null;

    return {
      checked: result.checked,
      intact,
      brokenAtId: result.brokenAtId,
      message: intact
        ? `Проверено записей: ${result.checked}. Нарушений целостности не обнаружено.`
        : `Цепочка нарушена начиная с записи ${result.brokenAtId}. Требуется разбор инцидента.`,
    };
  }
}
