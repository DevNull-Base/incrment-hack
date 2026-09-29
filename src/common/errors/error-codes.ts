import { HttpStatus } from '@nestjs/common';

/**
 * Реестр кодов ошибок системы (НФТ 3 технического задания).
 *
 * Формат кода: CRM-<ДОМЕН>-<НОМЕР>
 *   CRM  — префикс системы
 *   ДОМЕН — трёхбуквенный код подсистемы (см. ErrorDomain)
 *   НОМЕР — четырёхзначный порядковый номер внутри домена
 *
 * Код стабилен на протяжении жизни системы: он входит в контракт API,
 * на него завязаны обработчики фронтенда и разделы документации.
 * Изменять текст сообщения можно, менять смысл существующего кода — нельзя;
 * для нового смысла заводится новый код.
 */

export const ErrorDomain = {
  COMMON: 'COM',
  AUTH: 'AUT',
  ACCESS: 'ACL',
  VALIDATION: 'VAL',
  CATALOG: 'CAT',
  ENGAGEMENT: 'ENG',
  WORKFLOW: 'WFL',
  FILES: 'FIL',
  IMPORT: 'IMP',
  REPORTING: 'REP',
  INTEGRATION: 'INT',
  ACTIVITY: 'ACT',
  AI: 'AII',
  SYSTEM: 'SYS',
} as const;

export interface ErrorDefinition {
  /** Стабильный код вида CRM-WFL-0003. */
  readonly code: string;
  /** HTTP-статус, с которым отдаётся ошибка. */
  readonly status: HttpStatus;
  /** Краткий заголовок (поле `title` в RFC 9457). */
  readonly title: string;
  /** Пояснение для документации: когда возникает и что делать. */
  readonly description: string;
}

/** Хелпер для описания кода — гарантирует единообразие формата. */
function define(
  domain: (typeof ErrorDomain)[keyof typeof ErrorDomain],
  num: number,
  status: HttpStatus,
  title: string,
  description: string,
): ErrorDefinition {
  return {
    code: `CRM-${domain}-${String(num).padStart(4, '0')}`,
    status,
    title,
    description,
  };
}

export const ERRORS = {
  // ---------------------------------------------------------------- COMMON --
  INTERNAL: define(
    ErrorDomain.COMMON,
    1,
    HttpStatus.INTERNAL_SERVER_ERROR,
    'Внутренняя ошибка сервера',
    'Непредвиденная ошибка. Детали доступны в логах по traceId из ответа.',
  ),
  NOT_FOUND: define(
    ErrorDomain.COMMON,
    2,
    HttpStatus.NOT_FOUND,
    'Ресурс не найден',
    'Запрошенный объект отсутствует либо недоступен текущему пользователю.',
  ),
  METHOD_NOT_ALLOWED: define(
    ErrorDomain.COMMON,
    3,
    HttpStatus.METHOD_NOT_ALLOWED,
    'Метод не поддерживается',
    'HTTP-метод неприменим к указанному ресурсу.',
  ),
  RATE_LIMITED: define(
    ErrorDomain.COMMON,
    4,
    HttpStatus.TOO_MANY_REQUESTS,
    'Превышен лимит запросов',
    'Клиент превысил допустимую частоту обращений. Повторите запрос позже.',
  ),
  CONFLICT: define(
    ErrorDomain.COMMON,
    5,
    HttpStatus.CONFLICT,
    'Конфликт состояния',
    'Объект изменён другим пользователем. Обновите данные и повторите операцию.',
  ),
  PRECONDITION_FAILED: define(
    ErrorDomain.COMMON,
    6,
    HttpStatus.PRECONDITION_FAILED,
    'Предусловие не выполнено',
    'Значение заголовка If-Match не совпадает с текущей версией объекта.',
  ),

  // ------------------------------------------------------------------ AUTH --
  UNAUTHENTICATED: define(
    ErrorDomain.AUTH,
    1,
    HttpStatus.UNAUTHORIZED,
    'Требуется аутентификация',
    'Отсутствует или некорректен заголовок Authorization с Bearer-токеном.',
  ),
  TOKEN_EXPIRED: define(
    ErrorDomain.AUTH,
    2,
    HttpStatus.UNAUTHORIZED,
    'Срок действия токена истёк',
    'Access-токен просрочен. Обновите его через Keycloak и повторите запрос.',
  ),
  TOKEN_INVALID: define(
    ErrorDomain.AUTH,
    3,
    HttpStatus.UNAUTHORIZED,
    'Некорректный токен',
    'Подпись, issuer или audience токена не прошли проверку.',
  ),
  USER_DISABLED: define(
    ErrorDomain.AUTH,
    4,
    HttpStatus.FORBIDDEN,
    'Учётная запись заблокирована',
    'Пользователь деактивирован администратором системы.',
  ),
  NO_CRM_ROLE: define(
    ErrorDomain.AUTH,
    6,
    HttpStatus.FORBIDDEN,
    'Нет доступа к CRM',
    'Учётной записи не назначена роль CRM (USER, MANAGER или ADMIN). Обратитесь к администратору.',
  ),
  AUTH_PROVIDER_UNAVAILABLE: define(
    ErrorDomain.AUTH,
    5,
    HttpStatus.SERVICE_UNAVAILABLE,
    'Сервер аутентификации недоступен',
    'Не удалось получить ключи проверки токена у сервера аутентификации. Токен при этом ' +
      'может быть действителен: повторите запрос позже, выходить из системы не нужно.',
  ),

  // ---------------------------------------------------------------- ACCESS --
  FORBIDDEN: define(
    ErrorDomain.ACCESS,
    1,
    HttpStatus.FORBIDDEN,
    'Недостаточно прав',
    'Роль пользователя не позволяет выполнить операцию.',
  ),
  OUT_OF_DATA_SCOPE: define(
    ErrorDomain.ACCESS,
    2,
    HttpStatus.FORBIDDEN,
    'Объект вне области видимости',
    'Объект не входит в разрешённую пользователю выборку данных (DataScope).',
  ),
  LAST_ADMINISTRATOR: define(
    ErrorDomain.ACCESS,
    3,
    HttpStatus.CONFLICT,
    'Нельзя оставить систему без администратора',
    'Операция снимает права или блокирует последнюю активную учётную запись ' +
      'с ролью ADMIN. Сначала назначьте другого администратора.',
  ),
  SELF_PRIVILEGE_CHANGE: define(
    ErrorDomain.ACCESS,
    4,
    HttpStatus.CONFLICT,
    'Изменение собственных прав запрещено',
    'Администратор не может менять свою роль, статус или область видимости: ' +
      'это исключает как случайную самоблокировку, так и бесконтрольное ' +
      'расширение собственных полномочий.',
  ),
  MANAGER_CYCLE: define(
    ErrorDomain.ACCESS,
    5,
    HttpStatus.UNPROCESSABLE_ENTITY,
    'Циклическая подчинённость',
    'Назначение образует цикл в иерархии руководителей: пользователь оказался бы ' +
      'подчинённым самому себе, и расчёт области видимости не завершился бы.',
  ),
  PERSONAL_DATA_ERASED: define(
    ErrorDomain.ACCESS,
    6,
    HttpStatus.CONFLICT,
    'Персональные данные уже обезличены',
    'Запись субъекта обезличена ранее; повторная обработка невозможна.',
  ),

  // ------------------------------------------------------------ VALIDATION --
  VALIDATION_FAILED: define(
    ErrorDomain.VALIDATION,
    1,
    HttpStatus.UNPROCESSABLE_ENTITY,
    'Ошибка валидации',
    'Тело запроса или параметры не соответствуют схеме. Подробности — в поле errors.',
  ),
  MALFORMED_JSON: define(
    ErrorDomain.VALIDATION,
    2,
    HttpStatus.BAD_REQUEST,
    'Некорректный JSON',
    'Тело запроса не является валидным JSON.',
  ),

  // --------------------------------------------------------------- CATALOG --
  CATALOG_DUPLICATE: define(
    ErrorDomain.CATALOG,
    1,
    HttpStatus.CONFLICT,
    'Дубликат записи каталога',
    'Запись с таким естественным ключом уже существует.',
  ),
  CATALOG_IN_USE: define(
    ErrorDomain.CATALOG,
    2,
    HttpStatus.CONFLICT,
    'Запись используется',
    'Элемент каталога нельзя удалить: на него ссылаются существующие взаимодействия.',
  ),

  // ------------------------------------------------------------ ENGAGEMENT --
  ENGAGEMENT_STAGE_UNKNOWN: define(
    ErrorDomain.ENGAGEMENT,
    1,
    HttpStatus.UNPROCESSABLE_ENTITY,
    'Этап не найден в процессе',
    'Заметку или файл можно привязать только к этапу, который есть в действующей ' +
      'схеме процесса заявки. Список этапов отдаётся в карточке, в поле stages.',
  ),

  ENGAGEMENT_ARCHIVED: define(
    ErrorDomain.ENGAGEMENT,
    2,
    HttpStatus.CONFLICT,
    'Заявка в архиве',
    'Архивная заявка доступна только для чтения. Верните её из архива, чтобы продолжить работу.',
  ),

  // -------------------------------------------------------------- WORKFLOW --
  WF_TRANSITION_NOT_ALLOWED: define(
    ErrorDomain.WORKFLOW,
    1,
    HttpStatus.CONFLICT,
    'Переход недопустим',
    'Шаблон workflow не содержит перехода из текущего статуса в запрошенный.',
  ),
  WF_GUARD_FAILED: define(
    ErrorDomain.WORKFLOW,
    2,
    HttpStatus.UNPROCESSABLE_ENTITY,
    'Условия перехода не выполнены',
    'Не заполнены обязательные поля или не приложены требуемые документы.',
  ),
  WF_TEMPLATE_INVALID: define(
    ErrorDomain.WORKFLOW,
    3,
    HttpStatus.UNPROCESSABLE_ENTITY,
    'Некорректный шаблон workflow',
    'Определение шаблона не проходит проверку: недостижимые состояния или циклы без выхода.',
  ),
  WF_TEMPLATE_IN_USE: define(
    ErrorDomain.WORKFLOW,
    4,
    HttpStatus.CONFLICT,
    'Версия шаблона используется',
    'Нельзя удалить версию шаблона, к которой привязаны активные экземпляры.',
  ),
  WF_CONCURRENT_TRANSITION: define(
    ErrorDomain.WORKFLOW,
    5,
    HttpStatus.CONFLICT,
    'Конкурентное изменение статуса',
    'Другой пользователь выполнил переход раньше. Обновите карточку и повторите.',
  ),
  WF_TEMPLATE_NOT_EDITABLE: define(
    ErrorDomain.WORKFLOW,
    6,
    HttpStatus.CONFLICT,
    'Действующая редакция не редактируется',
    'Правки вносятся в черновик, который затем публикуется. Опубликованная ' +
      'редакция неизменна: по ней работают все текущие заявки.',
  ),
  WF_PUBLISH_MAPPING_REQUIRED: define(
    ErrorDomain.WORKFLOW,
    7,
    HttpStatus.BAD_REQUEST,
    'Требуется сопоставление статусов',
    'В новой редакции отсутствуют статусы, в которых стоят заявки. Укажите, ' +
      'в какой статус их перевести: заявки не могут остаться без места в процессе.',
  ),
  WF_PUBLISH_CONFIRMATION_REQUIRED: define(
    ErrorDomain.WORKFLOW,
    8,
    HttpStatus.PRECONDITION_REQUIRED,
    'Публикация не подтверждена',
    'Публикация затрагивает все текущие заявки. Запросите предварительный ' +
      'просмотр изменений и подтвердите операцию явным признаком confirm.',
  ),

  // ----------------------------------------------------------------- FILES --
  FILE_TOO_LARGE: define(
    ErrorDomain.FILES,
    1,
    HttpStatus.PAYLOAD_TOO_LARGE,
    'Файл слишком большой',
    'Размер файла превышает установленный лимит UPLOAD_MAX_FILE_SIZE_MB.',
  ),
  FILE_TYPE_NOT_ALLOWED: define(
    ErrorDomain.FILES,
    2,
    HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    'Недопустимый тип файла',
    'Фактический тип файла (по сигнатуре) не входит в список разрешённых.',
  ),
  FILE_INFECTED: define(
    ErrorDomain.FILES,
    3,
    HttpStatus.UNPROCESSABLE_ENTITY,
    'Обнаружено вредоносное содержимое',
    'Антивирусная проверка отклонила файл. Загрузка заблокирована.',
  ),
  FILE_STORAGE_UNAVAILABLE: define(
    ErrorDomain.FILES,
    4,
    HttpStatus.SERVICE_UNAVAILABLE,
    'Хранилище недоступно',
    'Объектное хранилище не отвечает. Повторите попытку позже.',
  ),
  FILE_NOT_SCANNED: define(
    ErrorDomain.FILES,
    5,
    HttpStatus.UNPROCESSABLE_ENTITY,
    'Файл не прошёл антивирусную проверку',
    'Проверка не выполнялась либо завершилась ошибкой. Выдача файла заблокирована ' +
      'до успешного сканирования; обратитесь к администратору системы.',
  ),

  // ---------------------------------------------------------------- IMPORT --
  IMPORT_FILE_UNREADABLE: define(
    ErrorDomain.IMPORT,
    1,
    HttpStatus.UNPROCESSABLE_ENTITY,
    'Файл не читается',
    'Не удалось разобрать файл как XLS/XLSX. Возможно, он повреждён или защищён паролем.',
  ),
  IMPORT_MAPPING_INCOMPLETE: define(
    ErrorDomain.IMPORT,
    2,
    HttpStatus.UNPROCESSABLE_ENTITY,
    'Маппинг колонок неполон',
    'Не сопоставлены обязательные поля. Уточните профиль маппинга.',
  ),
  IMPORT_NO_ROWS: define(
    ErrorDomain.IMPORT,
    3,
    HttpStatus.UNPROCESSABLE_ENTITY,
    'Нет строк для импорта',
    'После применения маппинга и фильтров не осталось ни одной корректной строки.',
  ),
  IMPORT_ALREADY_APPLIED: define(
    ErrorDomain.IMPORT,
    4,
    HttpStatus.CONFLICT,
    'Импорт уже применён',
    'Повторное применение той же задачи импорта запрещено.',
  ),
  IMPORT_DRY_RUN_REQUIRED: define(
    ErrorDomain.IMPORT,
    5,
    HttpStatus.UNPROCESSABLE_ENTITY,
    'Требуется предварительный просмотр',
    'Перед применением импорта необходимо выполнить dry-run и подтвердить результат.',
  ),
  IMPORT_JOB_BUSY: define(
    ErrorDomain.IMPORT,
    6,
    HttpStatus.CONFLICT,
    'Задача импорта в работе',
    'Задача сейчас разбирается или применяется. Дождитесь окончания и повторите действие.',
  ),

  // ------------------------------------------------------------- REPORTING --
  REPORT_UNKNOWN_COLUMN: define(
    ErrorDomain.REPORTING,
    1,
    HttpStatus.UNPROCESSABLE_ENTITY,
    'Неизвестная колонка отчёта',
    'Запрошена колонка вне белого списка. Допустимые значения — в GET /reports/columns.',
  ),
  REPORT_TOO_LARGE: define(
    ErrorDomain.REPORTING,
    2,
    HttpStatus.UNPROCESSABLE_ENTITY,
    'Отчёт превышает лимит строк',
    'Результат выборки больше REPORT_MAX_ROWS. Сузьте период или фильтры.',
  ),
  REPORT_JOB_NOT_FOUND: define(
    ErrorDomain.REPORTING,
    3,
    HttpStatus.NOT_FOUND,
    'Задача отчёта не найдена',
    'Задача не существует, принадлежит другому пользователю или истёк срок хранения.',
  ),
  REPORT_JOB_FAILED: define(
    ErrorDomain.REPORTING,
    4,
    HttpStatus.INTERNAL_SERVER_ERROR,
    'Ошибка формирования отчёта',
    'Задача завершилась с ошибкой. Детали — в поле detail и в логах по traceId.',
  ),
  REPORT_NOT_READY: define(
    ErrorDomain.REPORTING,
    5,
    HttpStatus.CONFLICT,
    'Отчёт ещё не готов',
    'Файл запрошен до завершения задачи. Дождитесь статуса COMPLETED.',
  ),
  REPORT_FORMAT_UNSUPPORTED: define(
    ErrorDomain.REPORTING,
    6,
    HttpStatus.UNPROCESSABLE_ENTITY,
    'Формат не поддерживается',
    'Допустимые форматы выгрузки: xlsx, xls, pdf, csv, json.',
  ),

  // ----------------------------------------------------------- INTEGRATION --
  INTEGRATION_SOURCE_UNAVAILABLE: define(
    ErrorDomain.INTEGRATION,
    1,
    HttpStatus.BAD_GATEWAY,
    'Внешний источник недоступен',
    'LMS или сайт не ответили в отведённое время. Синхронизация будет повторена.',
  ),
  INTEGRATION_CONTRACT_MISMATCH: define(
    ErrorDomain.INTEGRATION,
    2,
    HttpStatus.BAD_GATEWAY,
    'Несоответствие контракта источника',
    'Ответ внешней системы не проходит валидацию схемой. Payload сохранён для разбора.',
  ),
  INTEGRATION_SYNC_IN_PROGRESS: define(
    ErrorDomain.INTEGRATION,
    3,
    HttpStatus.CONFLICT,
    'Синхронизация уже выполняется',
    'Для источника уже запущена задача синхронизации.',
  ),
  INTEGRATION_WEBHOOK_DISABLED: define(
    ErrorDomain.INTEGRATION,
    4,
    HttpStatus.SERVICE_UNAVAILABLE,
    'Приём событий не настроен',
    'Не задан секрет подписи входящих вызовов (INTEGRATION_WEBHOOK_SECRET). Без него ' +
      'события внешних систем не принимаются: подлинность вызова нечем проверить.',
  ),
  LMS_EXPORT_EMPTY: define(
    ErrorDomain.INTEGRATION,
    5,
    HttpStatus.UNPROCESSABLE_ENTITY,
    'Некого выгружать в LMS',
    'Под отбор не попал ни один оплаченный слушатель, готовый к выгрузке. ' +
      'Проверьте отбор и список кандидатов: у слушателя без почты учётную запись LMS не завести.',
  ),

  // -------------------------------------------------------------- ACTIVITY --
  IDEMPOTENCY_KEY_REUSED: define(
    ErrorDomain.ACTIVITY,
    1,
    HttpStatus.CONFLICT,
    'Повторное использование ключа идемпотентности',
    'Тот же Idempotency-Key уже применялся с другим телом запроса.',
  ),
  IDEMPOTENCY_IN_FLIGHT: define(
    ErrorDomain.ACTIVITY,
    2,
    HttpStatus.CONFLICT,
    'Запрос уже обрабатывается',
    'Операция с этим Idempotency-Key ещё выполняется. Дождитесь результата.',
  ),

  // -------------------------------------------------------------------- AI --
  AI_DISABLED: define(
    ErrorDomain.AI,
    1,
    HttpStatus.SERVICE_UNAVAILABLE,
    'ИИ-функции отключены',
    'LLM_ENABLED=false. Система работает в полном объёме без ИИ-подсказок.',
  ),
  AI_PROVIDER_ERROR: define(
    ErrorDomain.AI,
    2,
    HttpStatus.BAD_GATEWAY,
    'Ошибка LLM-провайдера',
    'Внешняя модель вернула ошибку или не ответила в отведённое время.',
  ),
  AI_UNSAFE_OUTPUT: define(
    ErrorDomain.AI,
    3,
    HttpStatus.UNPROCESSABLE_ENTITY,
    'Некорректный ответ модели',
    'Ответ LLM не прошёл валидацию схемой и был отклонён.',
  ),

  // ---------------------------------------------------------------- SYSTEM --
  DB_UNAVAILABLE: define(
    ErrorDomain.SYSTEM,
    1,
    HttpStatus.SERVICE_UNAVAILABLE,
    'База данных недоступна',
    'Нет соединения с PostgreSQL.',
  ),
  CACHE_UNAVAILABLE: define(
    ErrorDomain.SYSTEM,
    2,
    HttpStatus.SERVICE_UNAVAILABLE,
    'Кэш недоступен',
    'Нет соединения с Redis. Часть функций работает в деградированном режиме.',
  ),
  QUEUE_UNAVAILABLE: define(
    ErrorDomain.SYSTEM,
    3,
    HttpStatus.SERVICE_UNAVAILABLE,
    'Очередь задач недоступна',
    'Не удалось поставить задачу в очередь.',
  ),
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorKey = keyof typeof ERRORS;

/** Полный перечень кодов — используется для генерации раздела документации. */
export const ERROR_LIST: readonly ErrorDefinition[] = Object.values(ERRORS);

/** Обратный индекс: код → определение. */
export const ERROR_BY_CODE: ReadonlyMap<string, ErrorDefinition> = new Map(
  ERROR_LIST.map((definition) => [definition.code, definition]),
);
