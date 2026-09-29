import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { maskQueryString } from '../logging/logging.module.js';
import { AppException, FieldIssue } from './app-exception.js';
import { ERRORS, ErrorDefinition } from './error-codes.js';
import { PROBLEM_TYPE_BASE, ProblemDetailsDto } from './problem-details.js';

/** Узкая проверка на известную ошибку Prisma без привязки к её внутренним классам. */
function isPrismaKnownError(error: unknown): error is { code: string; meta?: Record<string, unknown> } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string' &&
    /^P\d{4}$/.test((error as { code: string }).code)
  );
}

/**
 * Определения ошибок по HTTP-статусу — для исключений без собственного кода.
 *
 * 400 обязателен в таблице: без него некорректный запрос клиента (например,
 * пустое тело при Content-Type: application/json) проваливался в ветку
 * «внутренняя ошибка» и возвращался как 500. Клиент видел бы поломку сервера
 * вместо собственной ошибки, а показатели отказов сервиса искажались бы.
 */
const STATUS_DEFINITIONS: Partial<Record<number, ErrorDefinition>> = {
  [HttpStatus.BAD_REQUEST]: ERRORS.MALFORMED_JSON,
  [HttpStatus.UNAUTHORIZED]: ERRORS.UNAUTHENTICATED,
  [HttpStatus.FORBIDDEN]: ERRORS.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ERRORS.NOT_FOUND,
  [HttpStatus.METHOD_NOT_ALLOWED]: ERRORS.METHOD_NOT_ALLOWED,
  [HttpStatus.NOT_ACCEPTABLE]: ERRORS.VALIDATION_FAILED,
  [HttpStatus.CONFLICT]: ERRORS.CONFLICT,
  [HttpStatus.PRECONDITION_FAILED]: ERRORS.PRECONDITION_FAILED,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ERRORS.FILE_TOO_LARGE,
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: ERRORS.FILE_TYPE_NOT_ALLOWED,
  [HttpStatus.UNPROCESSABLE_ENTITY]: ERRORS.VALIDATION_FAILED,
  [HttpStatus.TOO_MANY_REQUESTS]: ERRORS.RATE_LIMITED,
  [HttpStatus.BAD_GATEWAY]: ERRORS.INTEGRATION_SOURCE_UNAVAILABLE,
  [HttpStatus.SERVICE_UNAVAILABLE]: ERRORS.DB_UNAVAILABLE,
};

/**
 * Статус ошибки клиента у ошибок Fastify и его модулей (4xx), иначе null.
 * Экспортируется ради модульных тестов.
 */
export function fastifyClientStatus(error: unknown): number | null {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;

  return typeof status === 'number' && status >= 400 && status < 500 ? status : null;
}

/**
 * Глобальный обработчик исключений.
 *
 * Приводит любую ошибку — доменную, инфраструктурную или непредвиденную —
 * к единому формату RFC 9457 со стабильным кодом (НФТ 3).
 *
 * Важное свойство: наружу никогда не уходят стек-трейсы, SQL-запросы и
 * внутренние сообщения драйверов. Они пишутся в лог с тем же traceId,
 * который клиент видит в ответе, — этого достаточно для разбора инцидента.
 */
@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AllExceptionsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<{ url?: string; id?: string; method?: string }>();
    const response = ctx.getResponse();

    const traceId = request?.id ?? randomUUID();
    // Путь без параметров: адрес целиком возвращал клиенту его же ввод
    // (сканер принимал это за выполненную команду), а строка поиска уходила
    // в системы сбора ошибок интерфейса. По traceId запрос находится в журнале.
    const instance = request?.url ? request.url.split('?')[0] : 'unknown';

    const resolved = this.resolve(exception, request?.method);

    const body: ProblemDetailsDto = {
      type: `${PROBLEM_TYPE_BASE}/${resolved.definition.code}`,
      title: resolved.definition.title,
      status: resolved.definition.status,
      detail: resolved.detail,
      code: resolved.definition.code,
      instance,
      traceId: String(traceId),
      timestamp: new Date().toISOString(),
      ...(resolved.issues?.length ? { errors: resolved.issues } : {}),
      ...(resolved.meta ? { meta: resolved.meta } : {}),
    };

    // 5xx — наша вина, пишем с полным стеком. 4xx — ожидаемый исход, warn без шума.
    // Адрес — без значений поиска: журнал ошибок уходит туда же, куда
    // и журнал запросов, и фамилия из ?search= не должна оседать там.
    const logPayload = {
      traceId,
      code: resolved.definition.code,
      method: request?.method,
      url: maskQueryString(request?.url ?? instance),
    };

    if (resolved.definition.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error({ ...logPayload, err: exception }, resolved.definition.title);
    } else {
      this.logger.warn(logPayload, `${resolved.definition.code}: ${resolved.detail}`);
    }

    httpAdapter.reply(response, body, resolved.definition.status);
  }

  /** Сопоставляет произвольное исключение с определением ошибки из реестра. */
  private resolve(
    exception: unknown,
    method: string | undefined,
  ): {
    definition: ErrorDefinition;
    detail: string;
    issues?: FieldIssue[];
    meta?: Record<string, unknown>;
  } {
    if (exception instanceof AppException) {
      return {
        definition: exception.definition,
        detail: exception.detail,
        issues: exception.issues,
        meta: exception.meta,
      };
    }

    if (isPrismaKnownError(exception)) {
      return this.fromPrisma(exception, method);
    }

    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    const clientStatus = fastifyClientStatus(exception);

    if (clientStatus !== null) {
      return this.fromClientStatus(clientStatus);
    }

    return { definition: ERRORS.INTERNAL, detail: ERRORS.INTERNAL.description };
  }

  /**
   * Ошибка клиента, пришедшая не исключением Nest, а ошибкой Fastify
   * или его модулей: слишком большое тело, неверный тип содержимого,
   * повреждённый multipart. У таких ошибок есть собственный statusCode,
   * и прежде он терялся — клиент получал 500, как при поломке сервера.
   * Текст ошибки наружу не отдаётся: он написан для разработчика.
   */
  private fromClientStatus(status: number): { definition: ErrorDefinition; detail: string } {
    const definition = STATUS_DEFINITIONS[status] ?? ERRORS.VALIDATION_FAILED;
    return { definition, detail: definition.description };
  }

  /** Переводит коды ошибок Prisma в доменные коды системы. */
  private fromPrisma(
    error: { code: string; meta?: Record<string, unknown> },
    method: string | undefined,
  ): {
    definition: ErrorDefinition;
    detail: string;
    meta?: Record<string, unknown>;
  } {
    switch (error.code) {
      case 'P2002': // нарушение уникального ограничения
        return {
          definition: ERRORS.CATALOG_DUPLICATE,
          detail: 'Запись с такими значениями уникальных полей уже существует.',
          meta: { fields: error.meta?.target },
        };
      case 'P2003': // нарушение внешнего ключа
        // Одна и та же ошибка базы означает противоположное в зависимости
        // от операции: при удалении на запись ещё ссылаются, а при создании
        // или правке указана ссылка на несуществующую запись. Прежде оба
        // случая отвечали 409 «Запись используется», и создание заявки
        // с несуществующим направлением выглядело как конфликт.
        return method?.toUpperCase() === 'DELETE'
          ? {
              definition: ERRORS.CATALOG_IN_USE,
              detail: 'Запись нельзя удалить: на неё ссылаются другие записи.',
              meta: { constraint: error.meta?.field_name },
            }
          : {
              definition: ERRORS.VALIDATION_FAILED,
              detail: 'Указана ссылка на запись, которой не существует.',
              meta: { constraint: error.meta?.field_name },
            };
      case 'P2025': // запись не найдена
        return { definition: ERRORS.NOT_FOUND, detail: ERRORS.NOT_FOUND.description };
      case 'P2007': // неверное значение для типа столбца
      case 'P2010': // то же в сыром запросе
        // Значение не того типа (строка вместо UUID и т. п.) — ошибка
        // во входных данных, а не поломка сервера. Прежде такие запросы
        // отвечали 500, и сбой клиента выглядел как отказ системы.
        if (driverErrorCode(error.meta) === '22P02') {
          return {
            definition: ERRORS.VALIDATION_FAILED,
            detail: 'Значение одного из параметров имеет неверный формат.',
          };
        }
        return { definition: ERRORS.INTERNAL, detail: ERRORS.INTERNAL.description };
      case 'P1001': // нет соединения с БД
      case 'P1002':
        return { definition: ERRORS.DB_UNAVAILABLE, detail: ERRORS.DB_UNAVAILABLE.description };
      default:
        // Код Prisma не раскрываем клиенту — он попадёт только в лог.
        return { definition: ERRORS.INTERNAL, detail: ERRORS.INTERNAL.description };
    }
  }

  /** Переводит стандартные исключения Nest (в т.ч. от ValidationPipe). */
  private fromHttpException(exception: HttpException): {
    definition: ErrorDefinition;
    detail: string;
    issues?: FieldIssue[];
  } {
    const status = exception.getStatus();
    const payload = exception.getResponse();

    // ValidationPipe отдаёт { message: string[] } — разворачиваем в errors[].
    if (status === HttpStatus.BAD_REQUEST && typeof payload === 'object' && payload !== null) {
      const messages = (payload as { message?: unknown }).message;
      if (Array.isArray(messages)) {
        return {
          definition: ERRORS.VALIDATION_FAILED,
          detail: ERRORS.VALIDATION_FAILED.description,
          issues: messages.map((message) => ({ field: '', message: String(message) })),
        };
      }
    }

    const definition = STATUS_DEFINITIONS[status] ?? ERRORS.INTERNAL;
    const detail =
      typeof payload === 'object' && payload !== null && typeof (payload as { message?: unknown }).message === 'string'
        ? (payload as { message: string }).message
        : definition.description;

    return { definition, detail };
  }
}

/** Код ошибки PostgreSQL из ошибки драйвера, если Prisma его передала. */
function driverErrorCode(meta: Record<string, unknown> | undefined): string | undefined {
  const adapterError = meta?.driverAdapterError as { cause?: { originalCode?: unknown } } | undefined;
  const code = adapterError?.cause?.originalCode;
  return typeof code === 'string' ? code : undefined;
}
