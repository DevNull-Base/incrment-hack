import 'reflect-metadata';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Logger } from 'nestjs-pino';
import helmet from '@fastify/helmet';
import compress from '@fastify/compress';
import multipart from '@fastify/multipart';
import { AppModule } from './app.module.js';
import { AppException } from './common/errors/app-exception.js';
import { toFieldIssues } from './common/errors/validation-issues.js';
import { AppConfig } from './config/configuration.js';
import { setupSwagger } from './bootstrap/swagger.js';
import { registerRequestContext } from './common/context/request-context.js';
import { ConfiguredIoAdapter } from './bootstrap/websocket-adapter.js';

/**
 * Точка входа процесса `api`: HTTP и WebSocket.
 *
 * Fastify выбран вместо Express ради сериализации ответов по схеме
 * (fast-json-stringify) — на выдаче списков и отчётов это заметно дешевле,
 * чем JSON.stringify, а именно эти маршруты формируют время отклика.
 */
/**
 * Разбор тела запроса в формате JSON.
 *
 * Собственный обработчик решает две задачи, которых нет у стандартного.
 *
 * Первая: пустое тело при заголовке `Content-Type: application/json`
 * считается допустимым и превращается в пустой объект. Клиентские
 * библиотеки проставляют этот заголовок всем POST-запросам подряд,
 * и обращение к методу, которому тело не нужно (например, запуск
 * синхронизации), иначе отклонялось бы с ошибкой «некорректный JSON» —
 * при том что тела там и не предполагается.
 *
 * Вторая: сохраняется тело в исходном виде. По нему проверяется подпись
 * входящих вызовов внешних систем; текст, пересобранный из разобранного
 * объекта, для этого не годится — порядок ключей и пробелы не сохраняются,
 * и подпись перестала бы сходиться.
 */
function registerJsonBodyParser(instance: FastifyInstance): void {
  instance.removeContentTypeParser('application/json');

  instance.addContentTypeParser(
    'application/json',
    // Предел JSON меньше общего: тело разбирается ДО проверки токена, и
    // запрос без токена с телом в 10 МБ стоил серверу разбора 10 МБ.
    // Ограничение частоты такие запросы не останавливает — оно ведётся
    // после аутентификации. Самый объёмный законный JSON — пачка оплат
    // с сайта — укладывается в предел с запасом (≈8 тыс. записей).
    { parseAs: 'buffer', bodyLimit: JSON_BODY_LIMIT_BYTES },
    (request: FastifyRequest & { rawBody?: Buffer }, body: Buffer, done) => {
      request.rawBody = body;

      const text = body.toString('utf8').trim();

      if (text.length === 0) {
        done(null, {});
        return;
      }

      try {
        done(null, JSON.parse(text) as unknown);
      } catch {
        // Статус 400 обязателен: без него ошибка разбора доходила до
        // обработчика исключений как непредвиденная и возвращалась
        // клиенту 500 — поломкой сервера вместо ошибки в запросе.
        done(Object.assign(new Error('Некорректный JSON'), { statusCode: 400 }), undefined);
      }
    },
  );
}

/**
 * Запрет кэширования ответов API по умолчанию.
 *
 * Ответы API почти все персональные: профиль, списки заявок, пользователи.
 * Прежде no-store ставился только на маршрутах с @PersonalData и на
 * выгрузках, а /auth/me и /admin/users (почта сотрудников) уходили без
 * него — кэширующий прокси по пути мог отдать профиль одного пользователя
 * другому. Маршрут, которому кэш нужен, задаёт заголовок сам.
 */
function registerNoStoreDefault(instance: FastifyInstance, apiPrefix: string): void {
  const prefix = `/${apiPrefix}/`;

  instance.addHook('onSend', (request, reply, payload, done) => {
    if (request.url.startsWith(prefix) && !reply.hasHeader('cache-control')) {
      void reply.header('Cache-Control', 'no-store');
    }
    done(null, payload);
  });
}

/** Предел тела JSON-запроса. Файлы идут multipart и ограничены отдельно. */
const JSON_BODY_LIMIT_BYTES = 2 * 1024 * 1024;

/**
 * Кому доверять заголовок X-Forwarded-For.
 *
 * Прежде доверие было безусловным (trustProxy: true): любой клиент,
 * добравшийся до API напрямую, подставлял в заголовок произвольный адрес —
 * и тот попадал в журнал аудита как адрес источника, а ограничение частоты
 * открытых маршрутов (приём событий и оплат) вёл по адресу, который
 * клиент менял на каждом запросе.
 *
 * По умолчанию доверие — только частным сетям и локальному узлу: так
 * устроены и стенд (Caddy на том же сервере → Docker), и локальный стек.
 * Иная схема задаётся TRUST_PROXY: список адресов и подсетей либо
 * true/false.
 */
export function resolveTrustProxy(raw: string | undefined): boolean | string {
  const value = (raw ?? '').trim();

  if (value.length === 0) return 'loopback,linklocal,uniquelocal';
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      // Доверяем заголовкам прокси: за reverse proxy иначе в логах и
      // журнале аудита окажется адрес прокси вместо адреса клиента.
      trustProxy: resolveTrustProxy(process.env.TRUST_PROXY),
      bodyLimit: 10 * 1024 * 1024,
      // Идентификатор запроса генерирует pino (см. logging.module),
      // поэтому собственный счётчик Fastify отключаем.
      genReqId: () => undefined as unknown as string,
    }),
    // bodyParser: false — разбор тела берёт на себя registerJsonBodyParser
    // ниже. Иначе Nest зарегистрировал бы собственный обработчик JSON поверх
    // нашего, и Fastify отверг бы второй обработчик того же типа содержимого.
    { bufferLogs: true, bodyParser: false },
  );

  const config = app.get(ConfigService<AppConfig, true>);
  const logger = app.get(Logger);
  app.useLogger(logger);

  const apiPrefix = config.get('API_PREFIX', { infer: true });
  const isProduction = config.get('NODE_ENV', { infer: true }) === 'production';

  // Контекст запроса устанавливается до всего остального: из него журнал
  // аудита берёт адрес источника события и идентификатор трассировки.
  registerRequestContext(app.getHttpAdapter().getInstance());

  registerJsonBodyParser(app.getHttpAdapter().getInstance());
  registerNoStoreDefault(app.getHttpAdapter().getInstance(), apiPrefix);

  // --- Безопасность транспорта ---
  await app.register(helmet, {
    // Swagger UI подключает собственные стили и скрипты; строгая CSP
    // ломает интерфейс документации, поэтому в dev она ослаблена.
    contentSecurityPolicy: isProduction ? undefined : false,
  });

  await app.register(compress, { encodings: ['br', 'gzip', 'deflate'] });

  await app.register(multipart, {
    limits: {
      fileSize: config.get('UPLOAD_MAX_FILE_SIZE_MB', { infer: true }) * 1024 * 1024,
      files: 10,
    },
  });

  // Канал обновлений использует тот же список источников, что и HTTP.
  app.useWebSocketAdapter(new ConfiguredIoAdapter(app, config.get('CORS_ORIGINS', { infer: true })));

  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: true,
    exposedHeaders: [
      'ETag',
      'X-Request-Id',
      'Content-Disposition',
      'X-Report-Rows',
      // Итог выгрузки в LMS: сколько выгружено, пропущено и осталось.
      'X-Exported-Count',
      'X-Skipped-Count',
      'X-Remaining-Count',
    ],
  });

  // --- Маршрутизация и валидация ---
  app.setGlobalPrefix(apiPrefix, { exclude: ['health', 'health/live', 'health/ready', 'metrics'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // Неизвестное поле в теле запроса — ошибка, а не тихое игнорирование:
      // так опечатка в имени фильтра не приведёт к незаметно неверной выборке.
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      // Ошибка проверки сразу получает стабильный код и имена полей:
      // интерфейсу нужно знать, какое поле подсветить.
      exceptionFactory: (errors) =>
        new AppException('VALIDATION_FAILED', {
          detail: 'Некоторые поля заполнены неверно.',
          issues: toFieldIssues(errors),
        }),
    }),
  );

  setupSwagger(app, apiPrefix, {
    enabled: config.get('SWAGGER_ENABLED', { infer: true }),
    user: config.get('SWAGGER_USER', { infer: true }),
    password: config.get('SWAGGER_PASSWORD', { infer: true }),
  });

  // Корректное завершение: дать текущим запросам доиграть, закрыть пулы.
  app.enableShutdownHooks();

  const port = config.get('PORT', { infer: true });
  await app.listen({ port, host: '0.0.0.0' });

  logger.log(
    `API запущен на порту ${port}; Swagger UI: http://localhost:${port}/${apiPrefix}/docs`,
    'Bootstrap',
  );
}

void bootstrap();
