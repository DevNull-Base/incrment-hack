import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import { Public } from '../../common/decorators/public.decorator.js';
import { Roles } from '../access/roles.decorator.js';
import { AppException } from '../../common/errors/app-exception.js';
import { IntegrationService } from './integration.service.js';
import {
  ENGAGEMENT_PAYLOAD_EXAMPLE,
  INBOUND_EVENT_EXAMPLE,
  engagementPayloadSchema,
  inboundEventSchema,
} from './contracts/engagement-contract.js';
import {
  ContractDescriptionDto,
  InboundEventResultDto,
  IntegrationRunQueryDto,
  IntegrationSourceDto,
  IntegrationSyncRunDto,
} from './dto/integration.dto.js';

/** Тело запроса в исходном виде — его сохраняет разборщик JSON (см. main.ts). */
type RawBodyRequest = FastifyRequest & { rawBody?: Buffer };

/**
 * Обмен с LMS и сайтом ИТ Школы.
 *
 * Обмен двусторонний: CRM забирает события внешних систем (синхронизация
 * и приём вызовов) и отправляет им изменения по заявкам (журнал исходящих
 * событий, отправляемый фоновым процессом).
 *
 * Контракт внешних систем заказчиком не передан — обе системы в переработке,
 * поэтому по умолчанию система работает в режиме заглушек и обменивается
 * встроенными примерами данных. Контракт со стороны CRM опубликован
 * маршрутом contracts и является предметом будущей стыковки.
 */
@ApiTags('Интеграции')
@ApiBearerAuth('keycloak')
@Controller({ path: 'integration', version: '1' })
export class IntegrationController {
  constructor(private readonly service: IntegrationService) {}

  @Get('sources')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Настроенные внешние системы' })
  @ApiOkResponse({ type: [IntegrationSourceDto] })
  listSources(): Promise<IntegrationSourceDto[]> {
    return this.service.listSources();
  }

  @Get('runs')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'История синхронизаций',
    description: 'Последние 50 прогонов со счётчиками принятых и отклонённых событий.',
  })
  @ApiOkResponse({ type: [IntegrationSyncRunDto] })
  listRuns(@Query() query: IntegrationRunQueryDto): Promise<IntegrationSyncRunDto[]> {
    return this.service.listRuns(query.sourceId);
  }

  @Post('sources/:id/sync')
  // Действие, а не создание ресурса: 200, а не 201 по умолчанию для POST.
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Запустить синхронизацию',
    description:
      'Ставит задачу в очередь и сразу возвращает запись о прогоне: разбор ' +
      'выполняется фоновым процессом, а не в обработчике запроса.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: IntegrationSyncRunDto })
  sync(@Param('id', ParseUUIDPipe) id: string): Promise<IntegrationSyncRunDto> {
    return this.service.requestSync(id);
  }

  @Delete('sources/:id/cursor')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Сбросить курсор выборки',
    description:
      'После сброса следующая синхронизация читает события внешней системы ' +
      'с начала. Дубли при этом не возникают: применённые события опознаются ' +
      'по идентификатору и пропускаются.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: IntegrationSourceDto })
  resetCursor(@Param('id', ParseUUIDPipe) id: string): Promise<IntegrationSourceDto> {
    return this.service.resetCursor(id);
  }

  /**
   * Приём события от LMS.
   *
   * Маршрут открыт без токена пользователя: обращается система, а не человек.
   * Подлинность подтверждается подписью тела запроса общим секретом —
   * см. INTEGRATION_WEBHOOK_SECRET.
   */
  @Post('lms/events')
  // Действие, а не создание ресурса: 200, а не 201 по умолчанию для POST.
  @HttpCode(HttpStatus.OK)
  @Public()
  @ApiOperation({ summary: 'Событие из LMS' })
  @ApiHeader({ name: 'x-signature', description: 'HMAC-SHA256 тела запроса, hex' })
  @ApiBody({ schema: { type: 'object' }, examples: { event: { value: INBOUND_EVENT_EXAMPLE } } })
  @ApiOkResponse({ type: InboundEventResultDto })
  lmsEvent(
    @Req() request: RawBodyRequest,
    @Body() body: unknown,
    @Headers('x-signature') signature?: string,
  ): Promise<InboundEventResultDto> {
    return this.service.acceptInboundEvent('LMS', rawBodyOf(request, body), signature);
  }

  /** Приём заявки с сайта. Условия те же, что и для LMS. */
  @Post('website/events')
  // Действие, а не создание ресурса: 200, а не 201 по умолчанию для POST.
  @HttpCode(HttpStatus.OK)
  @Public()
  @ApiOperation({ summary: 'Событие с сайта' })
  @ApiHeader({ name: 'x-signature', description: 'HMAC-SHA256 тела запроса, hex' })
  @ApiBody({ schema: { type: 'object' }, examples: { event: { value: INBOUND_EVENT_EXAMPLE } } })
  @ApiOkResponse({ type: InboundEventResultDto })
  websiteEvent(
    @Req() request: RawBodyRequest,
    @Body() body: unknown,
    @Headers('x-signature') signature?: string,
  ): Promise<InboundEventResultDto> {
    return this.service.acceptInboundEvent('WEBSITE', rawBodyOf(request, body), signature);
  }

  /**
   * Описание контракта обмена.
   *
   * Отдаётся из кода, а не из отдельного документа: описание, живущее рядом
   * со схемой, не расходится с тем, что система действительно отправляет
   * и принимает.
   */
  @Get('contracts/:name')
  @ApiOperation({
    summary: 'Контракт обмена: схема и пример',
    description:
      'engagement.v1 — что CRM отправляет во внешние системы. ' +
      'inbound.v1 — что CRM принимает от них.',
  })
  @ApiParam({ name: 'name', enum: ['engagement.v1', 'inbound.v1'] })
  @ApiOkResponse({ type: ContractDescriptionDto })
  contract(@Param('name') name: string): ContractDescriptionDto {
    if (name === 'engagement.v1') {
      return {
        contract: 'engagement.v1',
        description:
          'Состояние заявки, отправляемое в LMS и на сайт при создании заявки ' +
          'и при каждом переходе по процессу. Ключи связи в поле keys адресуют ' +
          'записи CRM, поля attachments — объекты в S3-совместимом хранилище.',
        schema: z.toJSONSchema(engagementPayloadSchema) as Record<string, unknown>,
        example: ENGAGEMENT_PAYLOAD_EXAMPLE as unknown as Record<string, unknown>,
      };
    }

    if (name === 'inbound.v1') {
      return {
        contract: 'inbound.v1',
        description:
          'Событие внешней системы: заявка с сайта либо запись на обучение ' +
          'в LMS. Поле externalId обеспечивает идемпотентность — повторная ' +
          'доставка того же события не создаёт вторую заявку.',
        schema: z.toJSONSchema(inboundEventSchema) as Record<string, unknown>,
        example: INBOUND_EVENT_EXAMPLE as unknown as Record<string, unknown>,
      };
    }

    throw new AppException('NOT_FOUND', {
      detail: `Контракт «${name}» не опубликован. Доступны: engagement.v1, inbound.v1.`,
    });
  }
}

/**
 * Тело запроса в исходном виде.
 *
 * Запасной путь через повторную сериализацию оставлен для режима, когда
 * сырое тело недоступно: подпись в этом случае не сойдётся, и вызов будет
 * отклонён — это предпочтительнее, чем принять неподписанное событие.
 */
function rawBodyOf(request: RawBodyRequest, body: unknown): string {
  return request.rawBody?.toString('utf8') ?? JSON.stringify(body ?? {});
}
