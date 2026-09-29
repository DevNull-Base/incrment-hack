import { z } from 'zod';

/**
 * Схема конфигурации приложения.
 *
 * Принцип fail fast: процесс не должен стартовать с невалидной конфигурацией.
 * Отдельно проверяются «опасные в production» комбинации — обход аутентификации,
 * открытый CORS, отключённая деперсонализация ПДн.
 */

/** Приводит строковые представления булевых значений из окружения к boolean. */
const booleanFromEnv = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1');

/** Целое число из строки окружения с проверкой диапазона. */
const intFromEnv = (min: number, max: number) =>
  z.coerce.number().int().min(min).max(max);

/** Проверяет имя часового пояса по базе IANA, встроенной в среду исполнения. */
function isKnownTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const csvList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );

export const configSchema = z
  .object({
    // --- Приложение ---
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ROLE: z.enum(['api', 'worker']).default('api'),
    PORT: intFromEnv(1, 65535).default(3000),
    API_PREFIX: z.string().default('api'),
    // Значение по умолчанию задаётся в типе РЕЗУЛЬТАТА преобразования (массив),
    // а не в исходной строке: в zod 4 default применяется после transform.
    CORS_ORIGINS: csvList.default(['http://localhost:5173']),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    // --- PostgreSQL ---
    DATABASE_URL: z.string().url(),
    DB_POOL_MAX: intFromEnv(1, 200).default(20),

    // --- Redis ---
    REDIS_URL: z.string().url(),

    // --- Keycloak ---
    // Внутренний адрес Keycloak: по нему бэкенд забирает JWKS.
    KEYCLOAK_BASE_URL: z.string().url(),
    // Публичный адрес, который видит браузер. Именно он попадает в claim `iss`
    // выпущенного токена. В Docker внутреннее и внешнее имена различаются
    // (keycloak:8080 против localhost:8080), и без разделения проверка issuer
    // отвергала бы корректные токены. Пусто — совпадает с KEYCLOAK_BASE_URL.
    KEYCLOAK_PUBLIC_URL: z.string().url().optional(),
    KEYCLOAK_REALM: z.string().min(1),
    KEYCLOAK_CLIENT_ID: z.string().min(1),
    KEYCLOAK_AUDIENCE: z.string().default(''),
    AUTH_DEV_BYPASS: booleanFromEnv.default(false),
    AUTH_DEV_BYPASS_ROLE: z.enum(['USER', 'MANAGER', 'ADMIN']).default('ADMIN'),

    // --- S3 / MinIO ---
    S3_ENDPOINT: z.string().url(),
    S3_REGION: z.string().default('us-east-1'),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
    S3_BUCKET_ATTACHMENTS: z.string().min(1).default('crm-attachments'),
    S3_BUCKET_REPORTS: z.string().min(1).default('crm-reports'),
    S3_FORCE_PATH_STYLE: booleanFromEnv.default(true),
    // Шифрование объектов на стороне хранилища. AES256 — управление ключами
    // берёт на себя MinIO; none — шифрование обеспечивается средствами ФС
    // или дискового массива на узле развёртывания.
    S3_SERVER_SIDE_ENCRYPTION: z.enum(['none', 'AES256']).default('none'),

    // --- Отчёты ---
    REPORT_SYNC_ROW_THRESHOLD: intFromEnv(0, 100_000).default(2000),
    REPORT_MAX_ROWS: intFromEnv(1, 10_000_000).default(500_000),
    REPORT_CACHE_TTL_SEC: intFromEnv(0, 86_400 * 30).default(3600),
    WORKER_CONCURRENCY: intFromEnv(1, 64).default(4),

    // --- Загрузки ---
    UPLOAD_MAX_FILE_SIZE_MB: intFromEnv(1, 1024).default(50),
    // Отдельный, более строгий лимит для импорта: файл разбирается в памяти
    // целиком (см. комментарий в XlsParserService), поэтому его размер
    // напрямую определяет расход памяти процесса worker.
    IMPORT_MAX_FILE_SIZE_MB: intFromEnv(1, 200).default(25),
    CLAMAV_ENABLED: booleanFromEnv.default(false),
    CLAMAV_HOST: z.string().default('localhost'),
    CLAMAV_PORT: intFromEnv(1, 65535).default(3310),
    // Выдавать ли файлы, не прошедшие антивирусную проверку (вердикты
    // SKIPPED и ERROR). По умолчанию запрещено: непроверенный файл,
    // доступный для скачивания, делает антивирусную меру декоративной.
    // Администратор получает такой файл в любом случае — иначе разобрать
    // инцидент было бы невозможно.
    ALLOW_UNSCANNED_DOWNLOAD: booleanFromEnv.default(false),

    // --- Ограничение интенсивности запросов ---
    // Защищает от перебора идентификаторов и от массовой выгрузки ПДн
    // штатными методами API.
    THROTTLE_TTL_SEC: intFromEnv(1, 3600).default(60),
    THROTTLE_LIMIT: intFromEnv(1, 100_000).default(300),
    /** Отдельный, более строгий лимит на выгрузки и формирование отчётов. */
    THROTTLE_EXPORT_LIMIT: intFromEnv(1, 10_000).default(30),

    // --- Сроки хранения ---
    /** Периодичность регламентной очистки (cron-выражение). */
    RETENTION_CRON: z.string().default('0 30 3 * * *'),
    /** Хранение журнала аудита. Три года — типовой срок для журналов ИБ. */
    AUDIT_RETENTION_DAYS: intFromEnv(90, 3650).default(1095),
    /** Срок хранения ПДн по умолчанию, если не задан явно для записи. */
    PERSONAL_DATA_RETENTION_DAYS: intFromEnv(30, 3650).default(1095),
    /** Отсрочка физического удаления вложений после пометки удалёнными. */
    ATTACHMENT_PURGE_GRACE_DAYS: intFromEnv(0, 365).default(30),
    /** Срок хранения черновиков и рабочих контекстов пользователя. */
    WORKSPACE_RETENTION_DAYS: intFromEnv(1, 365).default(90),

    // --- Документация API ---
    SWAGGER_ENABLED: booleanFromEnv.default(true),
    SWAGGER_USER: z.string().default('docs'),
    // Пусто — документация открыта. В production пустое значение запрещено
    // перекрёстной проверкой ниже.
    SWAGGER_PASSWORD: z.string().default(''),

    // --- Календарь задач ---
    /**
     * Часовой пояс организации. В нём считаются календарные дни задач:
     * «задача на 30 сентября» и признак просрочки. Время в базе хранится
     * в UTC, а день — это понятие местное, и в полночь по UTC у Москвы
     * уже три часа утра.
     */
    APP_TIMEZONE: z
      .string()
      .default('Europe/Moscow')
      .refine(isKnownTimeZone, 'Неизвестный часовой пояс: ожидается имя IANA, например Europe/Moscow'),

    // --- Кэш действий пользователя ---
    ACTIVITY_STATE_TTL_SEC: intFromEnv(60, 86_400 * 90).default(604_800),
    IDEMPOTENCY_TTL_SEC: intFromEnv(60, 86_400 * 7).default(86_400),

    // --- Интеграции с LMS и сайтом ---
    /**
     * Режим работы адаптеров. stub — обмен с заглушками на встроенных
     * примерах данных; live — обращение к реальным адресам. Контракт API
     * заказчиком пока не передан, поэтому по умолчанию stub: система
     * должна показывать двусторонний обмен без внешних систем.
     */
    INTEGRATION_MODE: z.enum(['stub', 'live']).default('stub'),
    LMS_BASE_URL: z.string().url().default('http://mock-external:4010'),
    LMS_TOKEN: z.string().default(''),
    CMS_BASE_URL: z.string().url().default('http://mock-external:4011'),
    CMS_TOKEN: z.string().default(''),
    /**
     * Адреса ботов мессенджеров. Задаются развёртыванием, а не настройкой
     * канала в интерфейсе: адрес из интерфейса позволял отправить сохранённый
     * токен бота на любой узел и обращаться из сервера во внутреннюю сеть.
     */
    NOTIFY_TELEGRAM_API_URL: z.string().url().default('https://api.telegram.org'),
    NOTIFY_MAX_API_URL: z.string().url().default('https://botapi.max.ru'),

    /** Общий секрет для проверки подписи входящих вызовов внешних систем. */
    INTEGRATION_WEBHOOK_SECRET: z.string().default(''),

    /**
     * Ключ маскирования персональных данных в журнале аудита (HMAC-SHA256).
     * Один и тот же у API и worker: иначе одно значение давало бы в журнале
     * два разных отпечатка. Смена ключа не ломает журнал, но отпечатки до
     * и после смены между собой несравнимы.
     */
    AUDIT_MASK_KEY: z.string().default(''),
    INTEGRATION_HTTP_TIMEOUT_MS: intFromEnv(1000, 120_000).default(15_000),
    /** Расписание опроса внешних систем; пусто — только ручной запуск. */
    INTEGRATION_SYNC_CRON: z.string().default('0 */15 * * * *'),
    /** Периодичность отправки накопленных исходящих событий. */
    INTEGRATION_OUTBOX_CRON: z.string().default('*/30 * * * * *'),

    // --- ИИ ---
    LLM_ENABLED: booleanFromEnv.default(false),
    LLM_PROVIDER: z.enum(['openai', 'gigachat', 'yandexgpt', 'ollama']).default('openai'),
    LLM_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
    LLM_API_KEY: z.string().default(''),
    LLM_MODEL: z.string().default('gpt-4o-mini'),
    LLM_TIMEOUT_MS: intFromEnv(1000, 120_000).default(20_000),
    LLM_DEPERSONALIZE: booleanFromEnv.default(true),
  })
  // --- Перекрёстные проверки безопасности ---
  .superRefine((cfg, ctx) => {
    const isProd = cfg.NODE_ENV === 'production';

    if (isProd && cfg.AUTH_DEV_BYPASS) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_DEV_BYPASS'],
        message:
          'AUTH_DEV_BYPASS=true недопустим при NODE_ENV=production: это полностью отключает аутентификацию.',
      });
    }

    // Без проверки аудитории API принимает токен любого клиента realm —
    // в том числе выданный другому приложению, которому доступ к CRM
    // не предназначался.
    if (isProd && cfg.KEYCLOAK_AUDIENCE.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['KEYCLOAK_AUDIENCE'],
        message: 'KEYCLOAK_AUDIENCE обязателен при NODE_ENV=production: без него не проверяется, кому выдан токен.',
      });
    }

    if (isProd && cfg.CORS_ORIGINS.includes('*')) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'CORS_ORIGINS=* недопустим при NODE_ENV=production: укажите конкретные домены фронтенда.',
      });
    }

    // Требование 152-ФЗ: ПДн не должны уходить во внешний LLM-сервис в открытом виде.
    if (isProd && cfg.LLM_ENABLED && !cfg.LLM_DEPERSONALIZE) {
      ctx.addIssue({
        code: 'custom',
        path: ['LLM_DEPERSONALIZE'],
        message:
          'LLM_DEPERSONALIZE=false недопустим при включённом ИИ в production: ' +
          'отправка персональных данных во внешний сервис нарушает 152-ФЗ.',
      });
    }

    // Боевой обмен без подписи входящих вызовов означает, что принять
    // событие и создать заявку сможет кто угодно, кто знает адрес.
    if (isProd && cfg.INTEGRATION_MODE === 'live' && cfg.INTEGRATION_WEBHOOK_SECRET.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['INTEGRATION_WEBHOOK_SECRET'],
        message:
          'INTEGRATION_WEBHOOK_SECRET обязателен при INTEGRATION_MODE=live: без него ' +
          'входящие вызовы внешних систем не проверяются.',
      });
    }

    // Метка из образца настроек — не секрет: её текст лежит в публичном
    // репозитории, и подписать им событие может кто угодно.
    if (isProd && /^ЗАМЕНИТЬ/i.test(cfg.INTEGRATION_WEBHOOK_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        path: ['INTEGRATION_WEBHOOK_SECRET'],
        message:
          'INTEGRATION_WEBHOOK_SECRET содержит метку из образца настроек. Задайте ' +
          'случайное значение — deploy.ps1 делает это сам при выкладке.',
      });
    }

    // Без ключа отпечаток ФИО в журнале — обычный SHA-256, и имя по нему
    // подбирается перебором словаря имён за секунды. Ключ из образца
    // настроек лежит в публичном репозитории и защищает не лучше.
    if (isProd && (cfg.AUDIT_MASK_KEY.length < 32 || /^ЗАМЕНИТЬ/i.test(cfg.AUDIT_MASK_KEY))) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUDIT_MASK_KEY'],
        message:
          'AUDIT_MASK_KEY обязателен при NODE_ENV=production: случайная строка не короче ' +
          '32 символов, одна для API и worker. deploy.ps1 создаёт её сам при выкладке.',
      });
    }

    // Внешние провайдеры требуют ключ; локальная Ollama — нет.
    if (cfg.LLM_ENABLED && cfg.LLM_PROVIDER !== 'ollama' && cfg.LLM_API_KEY.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['LLM_API_KEY'],
        message: `LLM_API_KEY обязателен для провайдера ${cfg.LLM_PROVIDER}.`,
      });
    }

    if (cfg.CLAMAV_ENABLED && cfg.CLAMAV_HOST.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['CLAMAV_HOST'],
        message: 'CLAMAV_HOST обязателен при CLAMAV_ENABLED=true.',
      });
    }

    // Антивирусная проверка загружаемых файлов — обязательная мера (группа
    // мер АВЗ). Запуск в production без неё означал бы, что система принимает
    // и раздаёт пользователям непроверенные файлы.
    if (isProd && !cfg.CLAMAV_ENABLED) {
      ctx.addIssue({
        code: 'custom',
        path: ['CLAMAV_ENABLED'],
        message:
          'CLAMAV_ENABLED=false недопустим при NODE_ENV=production: ' +
          'загружаемые файлы должны проходить антивирусную проверку.',
      });
    }

    // Выдача непроверенных файлов сводит предыдущую меру на нет,
    // поэтому в production отключается вместе с ней.
    if (isProd && cfg.ALLOW_UNSCANNED_DOWNLOAD) {
      ctx.addIssue({
        code: 'custom',
        path: ['ALLOW_UNSCANNED_DOWNLOAD'],
        message:
          'ALLOW_UNSCANNED_DOWNLOAD=true недопустим при NODE_ENV=production: ' +
          'файлы без успешной антивирусной проверки не должны выдаваться пользователям.',
      });
    }

    // Документация раскрывает полную карту API и структуру данных.
    // В production она либо закрыта паролем, либо не публикуется вовсе.
    if (isProd && cfg.SWAGGER_ENABLED && cfg.SWAGGER_PASSWORD.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['SWAGGER_PASSWORD'],
        message:
          'В production задайте SWAGGER_PASSWORD либо отключите публикацию документации ' +
          '(SWAGGER_ENABLED=false): Swagger UI доступен без аутентификации.',
      });
    }
  });

export type AppConfig = z.infer<typeof configSchema>;

/**
 * Валидирует окружение и возвращает типизированную конфигурацию.
 * Вызывается @nestjs/config на этапе загрузки модуля — до старта HTTP-сервера.
 */
export function validateConfig(raw: Record<string, unknown>): AppConfig {
  const result = configSchema.safeParse(raw);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  • ${issue.path.join('.') || '(корень)'}: ${issue.message}`)
      .join('\n');

    throw new Error(`Некорректная конфигурация приложения:\n${details}\n`);
  }

  return result.data;
}
