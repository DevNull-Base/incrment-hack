import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { FastifyRequest } from 'fastify';
import { IsObject, IsOptional } from 'class-validator';
import { AppConfig } from '../../config/configuration.js';
import { readUploadedFile } from '../files/uploaded-file.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { RateLimit } from '../access/rate-limit.decorator.js';
import { Roles } from '../access/roles.decorator.js';
import { ImportService } from './import.service.js';
import { IMPORT_FIELDS, IMPORT_FIELD_KEYS, type ColumnMapping } from './import-fields.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';

class ImportFieldDto {
  @ApiProperty({ description: 'Ключ поля', example: 'universityName' })
  key!: string;

  @ApiProperty({ description: 'Название поля по ТЗ', example: 'Название ВУЗа' })
  label!: string;

  @ApiProperty({ description: 'Обязательно ли поле' })
  required!: boolean;

  @ApiProperty({ description: 'Варианты заголовков, распознаваемые автоматически', type: [String] })
  synonyms!: string[];
}

class SetResolutionsDto {
  @ApiProperty({
    description:
      'Решения по неоднозначным совпадениям вузов: наименование из файла → ' +
      'идентификатор существующего вуза либо "CREATE_NEW". ' +
      'Например: {"Псковский государственный университет": "CREATE_NEW"}',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsObject()
  resolutions!: Record<string, string>;
}

class UpdateMappingDto {
  @ApiPropertyOptional({
    description:
      'Сопоставление: заголовок колонки файла → ключ поля. ' +
      'Например: {"Название ВУЗа": "universityName", "Вендор": "vendorName"}',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsOptional()
  @IsObject()
  mapping?: Record<string, string>;
}

class ImportJobCreatedDto {
  @ApiProperty({ format: 'uuid' })
  jobId!: string;

  @ApiProperty({ description: 'Статус задачи', example: 'PENDING' })
  status!: string;

  @ApiProperty({
    description: 'Пояснение дальнейших действий',
    example: 'Файл принят. Дождитесь статуса DRY_RUN_READY и подтвердите импорт.',
  })
  message!: string;
}

/**
 * Импорт каталогов из файлов XLS/XLSX.
 *
 * Требование ТЗ: каталоги должны актуализироваться подгрузкой файлов
 * по согласованному маппингу полей.
 *
 * Порядок работы намеренно двухшаговый: сначала предварительный просмотр
 * без записи данных, затем подтверждение. Импорт «вслепую» в каталог,
 * на котором построены все отчёты, недопустим — ошибку в маппинге
 * колонок пришлось бы разбирать вручную по всей базе.
 */
@ApiTags('Импорт')
@ApiBearerAuth('keycloak')
@Roles('MANAGER', 'ADMIN')
@Controller({ path: 'import', version: '1' })
export class ImportController {
  constructor(
    private readonly service: ImportService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /** Перечень полей, в которые можно сопоставлять колонки файла. */
  @Get('fields')
  @ApiOperation({ summary: 'Поля, доступные для сопоставления' })
  @ApiOkResponse({ type: ImportFieldDto, isArray: true })
  fields(): ImportFieldDto[] {
    return IMPORT_FIELD_KEYS.map((key) => ({
      key,
      label: IMPORT_FIELDS[key].label,
      required: IMPORT_FIELDS[key].required,
      synonyms: [...IMPORT_FIELDS[key].synonyms],
    }));
  }

  @Post()
  @RateLimit({ export: true, bucket: 'import' })
  @ApiOperation({
    summary: 'Загрузить файл для импорта',
    description:
      'Файл принимается и ставится в очередь на предварительный разбор. ' +
      'Метод возвращается сразу: разбор выполняется фоновым процессом.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiOkResponse({ type: ImportJobCreatedDto })
  async upload(
    @Req() request: FastifyRequest,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ImportJobCreatedDto> {
    // Обрезанная по лимиту таблица разобралась бы частично и импортировалась
    // бы без части строк, поэтому она отклоняется целиком.
    const file = await readUploadedFile(
      request,
      this.config.get('UPLOAD_MAX_FILE_SIZE_MB', { infer: true }) * 1024 * 1024,
    );
    const result = await this.service.createJob(file.fileName, file.content, user);

    return {
      ...result,
      message:
        'Файл принят и поставлен в очередь на разбор. ' +
        'Дождитесь статуса DRY_RUN_READY, проверьте сводку и подтвердите импорт.',
    };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Сводка предварительного разбора',
    description:
      'Показывает, что произойдёт при импорте: сколько записей создастся и обновится, ' +
      'какие строки отвергнуты, какие вузы распознаны как уже существующие.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  preview(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getPreview(id);
  }

  /**
   * Исправление маппинга колонок.
   *
   * После изменения сопоставления разбор выполняется заново: сводка,
   * рассчитанная по прежнему маппингу, к новому отношения не имеет.
   */
  @Put(':id/mapping')
  @ApiOperation({ summary: 'Изменить сопоставление колонок и пересчитать сводку' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async updateMapping(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMappingDto,
  ) {
    await this.service.runDryRun(id, (dto.mapping ?? {}) as ColumnMapping);
    return this.service.getPreview(id);
  }

  /**
   * Решения по неоднозначным совпадениям вузов.
   *
   * Система не объединяет организации по близости наименований
   * самостоятельно: на реальных данных «Псковский государственный
   * университет» и «Санкт-Петербургский государственный университет»
   * дают высокую оценку сходства за счёт общих слов. Ошибочное слияние
   * необратимо, поэтому решение принимает человек, а поведением
   * по умолчанию остаётся создание новой записи.
   */
  @Put(':id/resolutions')
  @ApiOperation({ summary: 'Подтвердить или отклонить совпадения вузов' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async setResolutions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetResolutionsDto,
  ) {
    await this.service.setResolutions(id, dto.resolutions ?? {});
    return this.service.getPreview(id);
  }

  @Post(':id/apply')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Применить импорт',
    description:
      'Доступно только после предварительного просмотра. Повторное применение той же задачи запрещено.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  apply(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.apply(id, user);
  }
}
