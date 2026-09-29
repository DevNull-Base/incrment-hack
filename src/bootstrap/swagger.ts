import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { ProblemDetailsDto } from '../common/errors/problem-details.js';
import { ERROR_LIST } from '../common/errors/error-codes.js';
import { withStandardErrorResponses } from './openapi-errors.js';

/**
 * Описание контракта API.
 *
 * Для этого проекта контракт — основной продукт: фронтенд разрабатывает
 * отдельная команда. Поэтому документация не «побочный эффект», а артефакт:
 * из неё генерируется TypeScript-клиент и поднимается mock-сервер, чтобы
 * фронтенд не ждал готовности реализации.
 *
 * Вынесено в отдельную функцию, чтобы работающий сервер и скрипт выгрузки
 * спецификации строили документ из одного источника: иначе файл openapi.json,
 * отданный фронтенд-команде, со временем разошёлся бы с реальным поведением.
 */
export function buildOpenApiConfig() {
  const description = [
    'REST API системы контроля взаимодействия с вузами по ИТ-направлениям.',
    '',
    '### Аутентификация',
    'Все методы, кроме служебных, требуют Bearer-токен, выданный Keycloak',
    '(Authorization Code Flow + PKCE). Токен передаётся в заголовке `Authorization`.',
    '',
    '### Формат ошибок',
    'Ошибки возвращаются по RFC 9457 (Problem Details) и всегда содержат стабильный',
    'код вида `CRM-<ДОМЕН>-<НОМЕР>`. Реагируйте на поле `code`, а не на текст сообщения.',
    `Всего в реестре ${ERROR_LIST.length} кодов — полный перечень приведён в разделе`,
    '«Коды ошибок» сопроводительной документации.',
    '',
    '### Идемпотентность',
    'Изменяющие запросы принимают заголовок `Idempotency-Key`. Повторная отправка',
    'с тем же ключом возвращает первоначальный результат и не создаёт дубликат —',
    'это защищает от двойных кликов и повторов после сетевых таймаутов.',
    '',
    '### Конкурентные изменения',
    'Ответы по взаимодействиям содержат заголовок `ETag`. При изменении статуса',
    'передавайте его в `If-Match`: если объект успели изменить, вернётся',
    '`CRM-WFL-0005` вместо молчаливой перезаписи чужих правок.',
    '',
    '### Длительные операции',
    'Формирование больших отчётов выполняется асинхронно: метод возвращает',
    '`202 Accepted` с идентификатором задачи, прогресс приходит по WebSocket,',
    'готовый файл забирается отдельным запросом.',
  ].join('\n');

  return new DocumentBuilder()
    .setTitle('CRM «ИТ Школа РТК»')
    .setDescription(description)
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access-токен Keycloak',
      },
      'keycloak',
    )
    .addGlobalParameters({
      name: 'X-Request-Id',
      in: 'header',
      required: false,
      description: 'Идентификатор запроса для сквозной трассировки. Генерируется, если не передан.',
      schema: { type: 'string', format: 'uuid' },
    })
    .addTag('Служебные', 'Проверки доступности и диагностика')
    .addTag('Каталоги', 'Вузы, вендоры, ИТ-продукты, направления и программы')
    .addTag('Взаимодействия', 'Карточки взаимодействия с вузами')
    .addTag('Workflow', 'Шаблоны процессов и переходы между статусами')
    .addTag('Файлы', 'Загрузка и выдача вложений')
    .addTag('Импорт', 'Загрузка данных из XLS/XLSX')
    .addTag('Отчёты', 'Формирование отчётов и выгрузок')
    .addTag('Аналитика', 'Агрегаты и диаграммы')
    .addTag('Интеграции', 'Синхронизация с LMS и сайтом')
    .addTag('Рабочий контекст', 'Кэш действий пользователя: фильтры, черновики, недавнее')
    .addTag('Администрирование', 'Пользователи, права и настройки')
    .build();
}

/**
 * Опции сборки документа. Используются и сервером, и скриптом выгрузки,
 * поэтому openapi.json совпадает с тем, что отдаёт Swagger UI.
 */
export const OPENAPI_DOCUMENT_OPTIONS = {
  // ProblemDetailsDto не встречается в сигнатурах методов напрямую,
  // поэтому включается в схему явно: без него описание формата ошибок
  // не попало бы в спецификацию.
  extraModels: [ProblemDetailsDto],
  operationIdFactory: (_controllerKey: string, methodKey: string) => methodKey,
};

export interface SwaggerAccessOptions {
  /** Публиковать ли интерфейс документации вообще. */
  enabled: boolean;
  /** Учётные данные для входа в документацию. Пусто — защита не ставится. */
  user: string;
  password: string;
}

export function setupSwagger(
  app: INestApplication,
  apiPrefix: string,
  access: SwaggerAccessOptions,
): void {
  if (!access.enabled) {
    return;
  }

  const config = buildOpenApiConfig();
  const document = withStandardErrorResponses(SwaggerModule.createDocument(app, config, OPENAPI_DOCUMENT_OPTIONS));

  if (access.password.length > 0) {
    protectDocs(app, apiPrefix, access);
  }

  SwaggerModule.setup(`${apiPrefix}/docs`, app, document, {
    jsonDocumentUrl: `${apiPrefix}/docs-json`,
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'none',
      filter: true,
      tagsSorter: 'alpha',
    },
    customSiteTitle: 'CRM ИТ Школа РТК — API',
  });
}

/**
 * Закрывает документацию паролем.
 *
 * Маршруты Swagger регистрируются мимо guard'ов Nest, поэтому глобальная
 * проверка токена на них не распространяется — в production полная карта
 * API, схемы данных и перечень полей оказывались доступны без какой-либо
 * аутентификации. Это не уязвимость сама по себе, но это разведданные,
 * которые незачем публиковать.
 *
 * Используется базовая аутентификация на уровне хука Fastify: отдельный
 * guard здесь неприменим, а полноценный OIDC-вход ради страницы
 * документации избыточен.
 */
function protectDocs(
  app: INestApplication,
  apiPrefix: string,
  access: SwaggerAccessOptions,
): void {
  const instance = app.getHttpAdapter().getInstance() as FastifyInstance;
  const docsPrefix = `/${apiPrefix}/docs`;

  instance.addHook('onRequest', (request, reply, done) => {
    if (!isDocsRequest(request, docsPrefix)) {
      done();
      return;
    }

    const header = request.headers.authorization;

    if (typeof header === 'string' && header.toLowerCase().startsWith('basic ')) {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      const user = separator >= 0 ? decoded.slice(0, separator) : '';
      const password = separator >= 0 ? decoded.slice(separator + 1) : '';

      if (equalsConstantTime(user, access.user) && equalsConstantTime(password, access.password)) {
        done();
        return;
      }
    }

    void reply
      .header('WWW-Authenticate', 'Basic realm="CRM API docs", charset="UTF-8"')
      .code(401)
      .send({ message: 'Документация API требует аутентификации.' });
  });
}

/**
 * Относится ли запрос к документации.
 *
 * Сравнивать сырой адрес нельзя: маршрутизатор Fastify декодирует путь,
 * и запрос «/api/%64ocs-json» попадал в документацию, минуя пароль, —
 * схема API отдавалась любому. Поэтому проверяется маршрут, который
 * Fastify выбрал для запроса, а при его отсутствии — декодированный путь.
 * Путь, который не декодируется, считается относящимся к документации:
 * в сомнительном случае лучше спросить пароль лишний раз.
 */
export function isDocsRequest(request: { url: string; routeOptions?: { url?: string } }, docsPrefix: string): boolean {
  const route = request.routeOptions?.url;

  if (route && route.startsWith(docsPrefix)) {
    return true;
  }

  const rawPath = request.url.split('?')[0] ?? '';

  try {
    return decodeURIComponent(rawPath).toLowerCase().startsWith(docsPrefix.toLowerCase());
  } catch {
    return true;
  }
}

/**
 * Сравнение строк за постоянное время.
 *
 * Обычное сравнение завершается на первом несовпавшем символе, и по времени
 * ответа пароль подбирается посимвольно. Длины выравниваются хэшированием:
 * timingSafeEqual требует буферов одинакового размера и сам по себе
 * раскрыл бы длину пароля исключением.
 */
function equalsConstantTime(actual: string, expected: string): boolean {
  const left = createHash('sha256').update(actual).digest();
  const right = createHash('sha256').update(expected).digest();
  return timingSafeEqual(left, right);
}
