import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { AppConfig } from '../../config/configuration.js';

/**
 * Доступен ли человекочитаемый вывод логов.
 *
 * Проверяется разрешением модуля, а не режимом запуска: в продуктовом образе
 * зависимости разработки вырезаны, и включённый там pretty-транспорт роняет
 * процесс на старте — ошибка выглядит как отказ приложения, хотя дело
 * исключительно в оформлении логов.
 */
function isPrettyAvailable(): boolean {
  try {
    createRequire(import.meta.url).resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

/**
 * Поля, которые никогда не должны попадать в журналы.
 *
 * Требование 152-ФЗ: персональные данные не логируются в открытом виде.
 * Сюда же вынесены секреты — токены, ключи, cookie: их утечка в лог
 * превращает систему хранения логов в хранилище учётных данных.
 */
/**
 * Служебные обращения, которым в журнале запросов делать нечего: пробы
 * готовности и метрики идут каждые несколько секунд и вытесняют всё
 * остальное — на стенде журнал api превращался в сплошной поток
 * «GET /health/live 200».
 *
 * Адрес берётся из `originalUrl`, а не из `url`, и это принципиально.
 * Пробы вынесены из общего префикса API, поэтому nestjs-pino подключает
 * своё middleware отдельным маршрутом именно на них, а `@fastify/middie`
 * перед вызовом middleware срезает с `req.url` путь, по которому оно
 * смонтировано: фильтр видит «/» вместо «/health/live» и ничего не
 * отфильтровывает. В журнал при этом попадает полный адрес — `req.url`
 * восстанавливается до того, как отработают сериализаторы, и расхождение
 * выглядит необъяснимым.
 */
export function isServiceProbeRequest(req: { url?: string; originalUrl?: string }): boolean {
  const url = req.originalUrl ?? req.url ?? '';
  return url.startsWith('/health') || url.startsWith('/metrics');
}

const REDACTED_PATHS = [
  // Секреты и учётные данные
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.apiKey',
  '*.secret',
  // Персональные данные.
  //
  // Шаблоны перечислены на трёх уровнях вложенности и отдельно для элементов
  // массивов. Одного уровня недостаточно: `*.email` закрывает `{ user: { email } }`,
  // но НЕ закрывает `{ data: { user: { email } } }` и `{ contacts: [{ email }] }`,
  // а именно в таком виде персональные данные и встречаются в ответах —
  // список ответственных от вуза приходит массивом.
  ...expandPersonalDataPaths(),
];

/**
 * Параметры адреса, значения которых в журнал не пишутся: строка поиска
 * в реестре персональных данных и списках — это чаще всего фамилия, почта
 * или телефон, а журнал запросов уходит в общую систему сбора логов.
 */
const MASKED_QUERY_PARAMS = new Set(['search', 'q', 'email', 'phone', 'fullname', 'name']);

/** Наибольшая длина адреса запроса в журнале. */
const MAX_LOGGED_URL = 512;

/**
 * Адрес запроса без персональных данных в параметрах. Сам параметр
 * остаётся — видно, что поиск был, — а значение заменяется.
 * Экспортируется ради модульных тестов.
 */
export function maskQueryString(url: string | undefined): string | undefined {
  if (!url) return url;

  // Адрес длиной в десятки килобайт (так делают сканеры и перебор) не
  // должен дважды целиком попадать в журнал: это способ раздувать логи.
  if (url.length > MAX_LOGGED_URL) {
    url = `${url.slice(0, MAX_LOGGED_URL)}…[обрезано, всего ${url.length}]`;
  }

  const index = url.indexOf('?');
  if (index < 0) return url;

  const masked = url
    .slice(index + 1)
    .split('&')
    .map((pair) => {
      const separator = pair.indexOf('=');
      const rawKey = separator < 0 ? pair : pair.slice(0, separator);
      let key = rawKey;

      try {
        key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
      } catch {
        // Ключ, который не декодируется, сравнивается как есть.
      }

      return separator >= 0 && MASKED_QUERY_PARAMS.has(key.toLowerCase()) ? `${rawKey}=[REDACTED]` : pair;
    })
    .join('&');

  return `${url.slice(0, index)}?${masked}`;
}

/**
 * Разворачивает шаблоны маскирования по уровням вложенности.
 *
 * Правило проекта — не писать в лог объекты с персональными данными,
 * а логировать идентификаторы. Маскирование страхует от нарушения этого
 * правила: цена ошибки (персональные данные, осевшие в системе сбора логов)
 * несопоставима со стоимостью нескольких десятков шаблонов.
 */
function expandPersonalDataPaths(): string[] {
  const fields = ['fullName', 'firstName', 'lastName', 'middleName', 'email', 'phone', 'snils', 'passport'];

  return fields.flatMap((field) => [
    `*.${field}`,
    `*.*.${field}`,
    `*.*.*.${field}`,
    `*[*].${field}`,
    `*.*[*].${field}`,
    `*.*.*[*].${field}`,
  ]);
}

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const isProduction = config.get('NODE_ENV', { infer: true }) === 'production';

        return {
          pinoHttp: {
            level: config.get('LOG_LEVEL', { infer: true }),

            // traceId сквозной: приходит от клиента или генерируется здесь,
            // затем попадает и в лог, и в тело ответа об ошибке.
            genReqId: (req, res) => {
              const incoming = req.headers['x-request-id'];
              const id = (Array.isArray(incoming) ? incoming[0] : incoming) ?? randomUUID();
              res.setHeader('X-Request-Id', id);
              return id;
            },

            redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },

            // В production — построчный JSON для сбора в Loki/ELK.
            // В разработке — человекочитаемый вывод, но только если
            // pino-pretty доступен. Пакет объявлен среди зависимостей
            // разработки, а образ собирается с --omit=dev: без этой проверки
            // запуск образа в режиме разработки (перекрытие docker-compose.dev.yml)
            // падал при старте с «unable to determine transport target».
            transport:
              isProduction || !isPrettyAvailable()
                ? undefined
                : {
                    target: 'pino-pretty',
                    options: {
                      singleLine: true,
                      translateTime: 'HH:MM:ss.l',
                      ignore: 'pid,hostname',
                    },
                  },

            // Health-проверки и метрики создают постоянный шум в логах.
            //
            // Обёртка, а не передача функции напрямую: её узкий тип параметра
            // подставился бы в обобщённый тип всех настроек pino-http, и
            // соседние обработчики потеряли бы поля запроса — genReqId перестал
            // бы видеть headers.
            autoLogging: { ignore: (req) => isServiceProbeRequest(req) },

            customProps: () => ({
              service: 'rtk-crm',
              role: config.get('APP_ROLE', { infer: true }),
            }),

            serializers: {
              req: (req) => ({
                id: req.id,
                method: req.method,
                url: maskQueryString(req.url),
                remoteAddress: req.remoteAddress,
              }),
              res: (res) => ({ statusCode: res.statusCode }),
            },
          },
        };
      },
    }),
  ],
  exports: [LoggerModule],
})
export class AppLoggingModule {}
