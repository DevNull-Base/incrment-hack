import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';

/**
 * Контекст текущего запроса: адрес источника, клиент, идентификатор трассировки.
 *
 * Зачем это нужно. Требования к составу регистрируемых событий (группа мер РСБ)
 * включают источник события: запись «пользователь скачал файл» без адреса,
 * с которого это сделано, для разбора инцидента бесполезна. При этом сервисы,
 * пишущие в журнал (вложения, отчёты, импорт), к HTTP-запросу доступа не имеют
 * и иметь не должны — это нарушило бы границу слоёв.
 *
 * Передавать контекст параметром через всю цепочку вызовов пришлось бы
 * в каждый сервис и каждый метод, причём единственный забытый аргумент
 * означал бы молчаливую потерю данных в журнале. Поэтому используется
 * AsyncLocalStorage: контекст устанавливается один раз на входе в запрос
 * и доступен любому коду в пределах его обработки.
 */
export interface RequestContext {
  /** IP-адрес клиента. За обратным прокси — с учётом trustProxy. */
  ipAddress: string | null;
  /** Заголовок User-Agent, усечённый до разумной длины. */
  userAgent: string | null;
  /** Сквозной идентификатор запроса — тот же, что в логах и в ответе об ошибке. */
  traceId: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Максимальная длина сохраняемого User-Agent: строка приходит от клиента. */
const USER_AGENT_MAX_LENGTH = 512;

/** Выполняет функцию в заданном контексте запроса. */
export function runInRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

/**
 * Контекст текущего запроса либо null.
 *
 * null — штатная ситуация, а не ошибка: в процессе worker кода HTTP-запроса
 * нет вовсе, и фоновые задачи обязаны продолжать работу без него.
 */
export function currentRequestContext(): RequestContext | null {
  return storage.getStore() ?? null;
}

/**
 * Подключает установку контекста к жизненному циклу Fastify.
 *
 * Используется собственный хук onRequest, а не middleware Nest: хук
 * вызывается раньше всего прочего, и обработчик остальных этапов запроса
 * наследует установленный асинхронный контекст. Тот же приём применяет
 * @fastify/request-context — отдельная зависимость ради двадцати строк
 * здесь не нужна.
 */
export function registerRequestContext(instance: FastifyInstance): void {
  instance.addHook('onRequest', (request, _reply, done) => {
    runInRequestContext(contextOf(request), done);
  });
}

/** Собирает контекст из запроса. */
function contextOf(request: FastifyRequest): RequestContext {
  const headers = request.headers;

  // Идентификатор трассировки должен совпадать с тем, что пишет pino
  // и что возвращается клиенту в ответе об ошибке. Порядок регистрации
  // хуков не гарантирован, поэтому учитываются оба случая: если pino уже
  // присвоил req.id — берём его, иначе генерируем сами и кладём в заголовок,
  // откуда pino его и прочитает (см. genReqId в logging.module).
  const fromHeader = headers['x-request-id'];
  const headerValue = Array.isArray(fromHeader) ? fromHeader[0] : fromHeader;
  const existingId = typeof request.id === 'string' ? request.id : undefined;

  const traceId = headerValue ?? existingId ?? randomUUID();

  if (!headerValue) {
    headers['x-request-id'] = traceId;
  }

  const userAgent = headers['user-agent'];

  return {
    // request.ip учитывает X-Forwarded-For, поскольку сервер создаётся
    // с trustProxy: иначе в журнале оказался бы адрес обратного прокси
    // для всех без исключения событий.
    ipAddress: request.ip ?? null,
    userAgent:
      typeof userAgent === 'string' ? userAgent.slice(0, USER_AGENT_MAX_LENGTH) : null,
    traceId,
  };
}
