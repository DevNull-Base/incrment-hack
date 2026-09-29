import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { Public } from '../../../common/decorators/public.decorator.js';
import { PersonalData } from '../../../common/decorators/personal-data.decorator.js';
import { AppConfig } from '../../../config/configuration.js';
import { RateLimit } from '../../access/rate-limit.decorator.js';
import { Roles } from '../../access/roles.decorator.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../../auth/authenticated-user.js';
import { readUploadedFile } from '../../files/uploaded-file.js';
import { PaymentImportQueryDto, PaymentIntakeResultDto } from './dto/payment-intake.dto.js';
import { PaymentIntakeService } from './payment-intake.service.js';

/** Тело запроса в исходном виде — его сохраняет разборщик JSON (см. main.ts). */
type RawBodyRequest = FastifyRequest & { rawBody?: Buffer };

/** Запись в формате сайта — как в образце, переданном заказчиком. */
const PAYMENT_EXAMPLE = [
  {
    'Номер заявки': 'ORD-20260917143022-K7QX2M',
    Курс: 'Инженер-тестировщик',
    Фамилия: 'Петрова',
    Имя: 'Анна',
    Отчество: 'Сергеевна',
    Телефон: '7 (900) 111-22-33',
    Email: 'petrova.as@example.ru',
    'Номер потока': 3,
  },
];

@ApiTags('Интеграции')
@ApiBearerAuth('keycloak')
@Controller({ path: 'integration', version: '1' })
export class PaymentIntakeController {
  constructor(
    private readonly service: PaymentIntakeService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /**
   * Оплаты с сайта.
   *
   * Маршрут открыт без токена пользователя: обращается сайт. Подлинность —
   * подпись тела запроса общим секретом (INTEGRATION_WEBHOOK_SECRET), как
   * у событий LMS и сайта.
   */
  @Post('website/payments')
  @HttpCode(HttpStatus.OK)
  @Public()
  @ApiOperation({
    summary: 'Оплаты с сайта',
    description:
      'Массив оплат в формате сайта: «Номер заявки», «Курс», «Фамилия», «Имя», «Отчество», ' +
      '«Телефон», «Email», «Номер потока» (латинские имена полей тоже принимаются). ' +
      'Пустые элементы, телефоны в любом виде, ФИО в любом регистре допустимы. По каждой ' +
      'записи — итог: заведена заявка, отмечена оплата в существующей, уже учтена или отклонена ' +
      'с причиной. Повторная доставка той же оплаты ничего не меняет.',
  })
  @ApiHeader({ name: 'x-signature', description: 'HMAC-SHA256 тела запроса, hex' })
  @ApiBody({ schema: { type: 'array', items: { type: 'object' } }, examples: { payments: { value: PAYMENT_EXAMPLE } } })
  @ApiOkResponse({ type: PaymentIntakeResultDto })
  websitePayments(
    @Req() request: RawBodyRequest,
    @Body() body: unknown,
    @Headers('x-signature') signature?: string,
  ): Promise<PaymentIntakeResultDto> {
    return this.service.acceptWebhook(
      request.rawBody?.toString('utf8') ?? JSON.stringify(body ?? []),
      signature,
    );
  }

  /**
   * Загрузка файла оплат руководителем — выгрузка сайта за период либо
   * таблица с теми же полями. По умолчанию предварительный просмотр.
   */
  @Post('payments/import')
  @Roles('MANAGER', 'ADMIN')
  @RateLimit({ export: true, bucket: 'import' })
  @HttpCode(HttpStatus.OK)
  @PersonalData('Payment')
  @ApiOperation({
    summary: 'Загрузить оплаты из файла',
    description:
      'JSON в формате сайта либо XLSX/XLS с теми же заголовками. dryRun=true (по умолчанию) — ' +
      'показать, что произойдёт, ничего не записывая; dryRun=false — применить. ' +
      'Оплаченные слушатели попадают в выгрузку для LMS.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiOkResponse({ type: PaymentIntakeResultDto })
  async importFile(
    @Req() request: FastifyRequest,
    @Query() query: PaymentImportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PaymentIntakeResultDto> {
    const file = await readUploadedFile(
      request,
      this.config.get('IMPORT_MAX_FILE_SIZE_MB', { infer: true }) * 1024 * 1024,
    );

    return this.service.importFile(file.fileName, file.content, query.dryRun ?? true, user);
  }
}
