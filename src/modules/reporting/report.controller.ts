import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiPropertyOptional,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ToBoolean } from '../../common/dto/query-transforms.js';
import type { FastifyReply } from 'fastify';
import { ReportFormat } from '../../generated/prisma/enums.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { RateLimit } from '../access/rate-limit.decorator.js';
import { ReportService } from './report.service.js';
import { REPORT_COLUMNS, REPORT_COLUMN_KEYS, DEFAULT_REPORT_COLUMNS } from './report-columns.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';

class ReportColumnDto {
  @ApiProperty({ description: 'Ключ колонки', example: 'universityName' })
  key!: string;

  @ApiProperty({ description: 'Подпись в шапке отчёта', example: 'Наименование вуза' })
  label!: string;

  @ApiProperty({ description: 'Тип значения', enum: ['text', 'date', 'datetime', 'number', 'boolean'] })
  type!: string;

  @ApiProperty({ description: 'Пояснение' })
  description!: string;

  @ApiProperty({ description: 'Входит ли колонка в набор по умолчанию' })
  isDefault!: boolean;
}

class ReportFiltersDto {
  @ApiPropertyOptional({ description: 'Начало периода (ISO 8601)', example: '2025-01-01' })
  @IsOptional()
  @IsDateString({}, { message: 'Ожидается дата в формате ISO 8601' })
  periodFrom?: string;

  @ApiPropertyOptional({ description: 'Конец периода (ISO 8601)', example: '2025-12-31' })
  @IsOptional()
  @IsDateString({}, { message: 'Ожидается дата в формате ISO 8601' })
  periodTo?: string;

  @ApiPropertyOptional({
    description: 'Отбор по сегментам взаимодействия',
    type: [String],
    enum: ['B2B', 'B2C'],
    example: ['B2B'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @IsIn(['B2B', 'B2C'], { each: true })
  segments?: string[];

  @ApiPropertyOptional({ description: 'Отбор по вузам', type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  universityIds?: string[];

  @ApiPropertyOptional({ description: 'Отбор по ИТ-направлениям', type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  directionIds?: string[];

  @ApiPropertyOptional({ description: 'Отбор по ИТ-продуктам', type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  productIds?: string[];

  @ApiPropertyOptional({ description: 'Отбор по ИТ-программам', type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  programIds?: string[];

  @ApiPropertyOptional({ description: 'Отбор по ответственным', type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  ownerIds?: string[];

  @ApiPropertyOptional({ description: 'Отбор по статусам', type: [String], example: ['SIGNING'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  stateKeys?: string[];

  @ApiPropertyOptional({ description: 'Отбор по регионам', type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  regions?: string[];

  @ApiPropertyOptional({
    description: 'Отбор по заинтересованности; UNSET — заявки без оценки',
    type: [String],
    enum: ['LOW', 'MEDIUM', 'HIGH', 'UNSET'],
    example: ['HIGH'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'UNSET'], { each: true })
  interestLevels?: string[];

  @ApiPropertyOptional({ description: 'Только просроченные по нормативу', default: false })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  onlyOverdue?: boolean;

  @ApiPropertyOptional({ description: 'Включать архивные записи', default: false })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  includeArchived?: boolean;
}

class CreateReportDto {
  @ApiPropertyOptional({ description: 'Заголовок отчёта', example: 'Взаимодействия за 2025 год' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiProperty({
    description: 'Ключи колонок из перечня GET /reports/columns',
    type: [String],
    example: DEFAULT_REPORT_COLUMNS,
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'Выберите хотя бы одну колонку' })
  @ArrayMaxSize(30, { message: 'Не более 30 колонок в одном отчёте' })
  @IsString({ each: true })
  columns!: string[];

  @ApiProperty({
    description: 'Формат выгрузки',
    enum: ['XLSX', 'XLS', 'PDF', 'CSV', 'JSON'],
    example: 'XLSX',
  })
  @IsIn(['XLSX', 'XLS', 'PDF', 'CSV', 'JSON'], {
    message: 'Допустимые форматы: XLSX, XLS, PDF, CSV, JSON',
  })
  format!: ReportFormat;

  @ApiPropertyOptional({ description: 'Условия отбора', type: ReportFiltersDto })
  @IsOptional()
  @Type(() => ReportFiltersDto)
  filters?: ReportFiltersDto;
}

class ReportJobDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'] })
  status!: string;

  @ApiProperty({ description: 'Доля выполнения, 0–100' })
  progress!: number;

  @ApiProperty({ description: 'Число строк', nullable: true })
  rowCount!: number | null;

  @ApiProperty({ description: 'Размер файла в байтах', nullable: true })
  sizeBytes!: number | null;

  @ApiProperty({ description: 'Код ошибки, если формирование не удалось', nullable: true })
  errorCode!: string | null;
}

/**
 * Формирование отчётов.
 *
 * Требование ТЗ: отчёты по взаимодействиям за выбранный период, по вузам,
 * направлениям, продуктам и ответственным, в форматах xls, xlsx, pdf.
 * Дополнительно поддерживаются csv и json — последний прямо предусмотрен
 * требованием о результирующем json-файле.
 */
@ApiTags('Отчёты')
@ApiBearerAuth('keycloak')
@Controller({ path: 'reports', version: '1' })
export class ReportController {
  constructor(private readonly service: ReportService) {}

  /** Доступные колонки — по ним фронтенд строит конструктор отчёта. */
  @Get('columns')
  @ApiOperation({ summary: 'Перечень доступных колонок' })
  @ApiOkResponse({ type: ReportColumnDto, isArray: true })
  columns(): ReportColumnDto[] {
    return REPORT_COLUMN_KEYS.map((key) => ({
      key,
      label: REPORT_COLUMNS[key].label,
      type: REPORT_COLUMNS[key].type,
      description: REPORT_COLUMNS[key].description,
      isDefault: DEFAULT_REPORT_COLUMNS.includes(key),
    }));
  }

  /**
   * Запрос отчёта.
   *
   * Способ формирования выбирается системой по объёму выборки:
   *   • небольшой отчёт возвращается сразу файлом (200 с телом документа);
   *   • объёмный ставится в очередь, и возвращается 202 с идентификатором
   *     задачи; ход выполнения приходит по каналу обновлений, готовый файл
   *     забирается методом GET /reports/{id}/download.
   *
   * Формирование документа не выполняется в процессе, обслуживающем
   * запросы: рендеринг занимает процессор на секунды и остановил бы
   * обслуживание всех остальных пользователей.
   */
  @Post()
  // Формирование и скачивание отчётов делят одну корзину: отчёт — главный
  // штатный способ вынести из системы большой объём данных, включая ПДн.
  @RateLimit({ export: true, bucket: 'reports' })
  @ApiOperation({ summary: 'Сформировать отчёт' })
  @ApiBody({ type: CreateReportDto })
  @ApiResponse({ status: 200, description: 'Отчёт сформирован и возвращён файлом' })
  @ApiResponse({
    status: 202,
    description: 'Отчёт поставлен в очередь; следите за ходом по идентификатору задачи',
    type: ReportJobDto,
  })
  async create(
    @Body() dto: CreateReportDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const result = await this.service.request(
      {
        title: dto.title,
        columns: dto.columns,
        format: dto.format,
        filters: (dto.filters ?? {}) as Record<string, never>,
      },
      user,
    );

    if (result.kind === 'sync') {
      const encodedName = encodeURIComponent(result.fileName);

      await reply
        .status(HttpStatus.OK)
        .header('Content-Type', result.mimeType)
        .header('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`)
        .header('X-Report-Rows', String(result.rowCount))
        // Отчёт может содержать персональные данные — запрещаем
        // промежуточное кэширование.
        .header('Cache-Control', 'private, no-store')
        .send(result.stream);
      return;
    }

    await reply.status(HttpStatus.ACCEPTED).send({
      jobId: result.jobId,
      status: result.status,
      rowCount: result.rowCount,
      fromCache: result.fromCache,
      message: result.fromCache
        ? 'Такой отчёт уже сформирован, файл доступен для скачивания.'
        : 'Отчёт поставлен в очередь. Ход выполнения приходит по каналу обновлений.',
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Состояние задачи формирования отчёта' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ReportJobDto })
  getJob(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.getJob(id, user);
  }

  @Get(':id/download')
  @RateLimit({ export: true, bucket: 'reports' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Скачать готовый отчёт' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const file = await this.service.download(id, user);
    const encodedName = encodeURIComponent(file.fileName);

    await reply
      .header('Content-Type', file.mimeType)
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`)
      .header('Cache-Control', 'private, no-store')
      .send(file.stream);
  }
}
