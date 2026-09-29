import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ScanStatus } from '../../generated/prisma/enums.js';
import { AppConfig } from '../../config/configuration.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { RateLimit } from '../access/rate-limit.decorator.js';
import { AttachmentService } from './attachment.service.js';
import { ALLOWED_EXTENSIONS } from './file-validation.js';
import { readUploadedFile } from './uploaded-file.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';

class AttachmentDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'Имя файла' })
  fileName!: string;

  @ApiProperty({ description: 'Тип содержимого, определённый по сигнатуре файла' })
  mimeType!: string;

  @ApiProperty({ description: 'Размер в байтах' })
  sizeBytes!: number;

  @ApiProperty({ description: 'Контрольная сумма SHA-256' })
  sha256!: string;

  @ApiProperty({
    description:
      'Результат антивирусной проверки. SKIPPED означает, что проверка не проводилась ' +
      '(сканер отключён), и это намеренно отличается от CLEAN.',
    enum: ['PENDING', 'CLEAN', 'INFECTED', 'SKIPPED', 'ERROR'],
  })
  scanStatus!: ScanStatus;

  @ApiProperty({ description: 'Кто загрузил' })
  uploadedByName!: string;

  @ApiProperty({
    description: 'Этап процесса, к которому приложен файл',
    nullable: true,
    example: 'SIGNING',
  })
  stateKey!: string | null;

  @ApiProperty({
    description: 'Подпись этапа на момент загрузки — не меняется при переименовании статуса',
    nullable: true,
    example: 'Подписание документов',
  })
  stateLabel!: string | null;

  @ApiProperty()
  createdAt!: Date;
}

/**
 * Вложения к взаимодействиям.
 *
 * Требование ТЗ: возможность прикладывать файлы к статусам в форматах
 * png, jpeg, pdf, zip, gzip, rar, doc, docx, xls, xlsx.
 */
@ApiTags('Файлы')
@ApiBearerAuth('keycloak')
@Controller({ path: 'engagements/:engagementId/attachments', version: '1' })
export class FilesController {
  constructor(
    private readonly service: AttachmentService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список файлов взаимодействия' })
  @ApiParam({ name: 'engagementId', format: 'uuid' })
  @ApiQuery({
    name: 'stateKey',
    required: false,
    description: 'Только файлы этого этапа процесса',
    example: 'SIGNING',
  })
  @ApiOkResponse({ type: AttachmentDto, isArray: true })
  list(
    @Param('engagementId', ParseUUIDPipe) engagementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('stateKey') stateKey?: string,
  ): Promise<AttachmentDto[]> {
    return this.service.list(engagementId, user, stateKey?.slice(0, 64) || undefined);
  }

  /**
   * Загрузка файла.
   *
   * Тип определяется по сигнатуре содержимого, а не по расширению
   * и не по заголовку Content-Type: и то, и другое задаётся клиентом.
   */
  @Post()
  @RateLimit({ export: true, bucket: 'attachments' })
  @ApiOperation({
    summary: 'Приложить файл',
    description:
      `Допустимые форматы: ${ALLOWED_EXTENSIONS.join(', ')}. Тип проверяется по содержимому файла. ` +
      'Файл прикладывается к этапу процесса — по умолчанию к текущему. Условие ' +
      '«из этапа нельзя выйти без документа» учитывает только файлы этого этапа.',
  })
  @ApiParam({ name: 'engagementId', format: 'uuid' })
  @ApiQuery({
    name: 'stateKey',
    required: false,
    description:
      'Этап, к которому приложить файл. Не указан — текущий этап заявки. ' +
      'Этап должен быть в действующей схеме процесса, иначе CRM-ENG-0001.',
    example: 'SIGNING',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiCreatedResponse({ type: AttachmentDto })
  async upload(
    @Param('engagementId', ParseUUIDPipe) engagementId: string,
    @Req() request: FastifyRequest,
    @CurrentUser() user: AuthenticatedUser,
    @Query('stateKey') stateKey?: string,
  ): Promise<AttachmentDto> {
    // Лимит задан при регистрации multipart: поток обрывается на нём,
    // и файл целиком в память не попадает. Обрезанный файл отклоняется.
    const file = await readUploadedFile(
      request,
      this.config.get('UPLOAD_MAX_FILE_SIZE_MB', { infer: true }) * 1024 * 1024,
    );

    return this.service.upload(
      engagementId,
      file.fileName,
      file.content,
      user,
      stateKey?.slice(0, 64) || undefined,
    );
  }

  /**
   * Скачивание файла.
   *
   * Содержимое отдаётся потоком через API, а не подписанной ссылкой:
   * ссылка обошла бы проверку прав и не оставила записи в журнале.
   */
  @Get(':attachmentId')
  @RateLimit({ export: true, bucket: 'attachments' })
  @ApiOperation({ summary: 'Скачать файл' })
  @ApiParam({ name: 'engagementId', format: 'uuid' })
  @ApiParam({ name: 'attachmentId', format: 'uuid' })
  async download(
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const file = await this.service.download(attachmentId, user);

    // filename* с кодировкой UTF-8 обязателен: без него имена файлов
    // на кириллице превращаются в набор вопросительных знаков.
    const encodedName = encodeURIComponent(file.fileName);

    await reply
      .header('Content-Type', file.mimeType)
      .header('Content-Length', String(file.sizeBytes))
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`)
      // Вложения могут содержать персональные данные — запрещаем
      // промежуточное кэширование.
      .header('Cache-Control', 'private, no-store')
      .send(file.stream);
  }

  @Delete(':attachmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Удалить файл',
    description:
      'Выполняется мягкое удаление: запись помечается удалённой, содержимое остаётся в хранилище, ' +
      'поскольку то же содержимое может быть приложено к другим карточкам.',
  })
  @ApiParam({ name: 'engagementId', format: 'uuid' })
  @ApiParam({ name: 'attachmentId', format: 'uuid' })
  @ApiNoContentResponse()
  remove(
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.service.softDelete(attachmentId, user);
  }
}
