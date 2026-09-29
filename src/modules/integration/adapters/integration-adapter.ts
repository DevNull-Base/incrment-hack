import { PinoLogger } from 'nestjs-pino';
import { AppException } from '../../../common/errors/app-exception.js';
import { EngagementPayload, InboundEvent } from '../contracts/engagement-contract.js';

/** Тип внешней системы. Совпадает с enum IntegrationSourceType. */
export type IntegrationKind = 'LMS' | 'WEBSITE';

export interface FetchResult {
  events: unknown[];
  /** Новое значение курсора инкрементальной выборки. */
  cursor: string | null;
}

/**
 * Адаптер внешней системы.
 *
 * Интерфейс один на LMS и на сайт: обе системы обмениваются одним и тем же
 * набором данных, а различие сводится к адресу и формату курсора. Это
 * позволяет держать всю логику применения данных в одном месте, а не
 * писать её дважды.
 */
export interface IntegrationAdapter {
  readonly kind: IntegrationKind;
  /** Забрать события, произошедшие после курсора. */
  fetchEvents(cursor: string | null): Promise<FetchResult>;
  /** Отправить состояние заявки во внешнюю систему. */
  push(payload: EngagementPayload): Promise<void>;
}

/**
 * Адаптер поверх HTTP.
 *
 * Применяется при INTEGRATION_MODE=live. Контракт внешних систем ещё
 * не утверждён, поэтому здесь закреплён контракт со стороны CRM: две
 * конечные точки, обмен JSON, авторизация токеном.
 */
export class HttpIntegrationAdapter implements IntegrationAdapter {
  constructor(
    readonly kind: IntegrationKind,
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly timeoutMs: number,
    private readonly logger: PinoLogger,
  ) {}

  async fetchEvents(cursor: string | null): Promise<FetchResult> {
    const url = new URL('/api/crm/events', this.baseUrl);
    if (cursor) {
      url.searchParams.set('since', cursor);
    }

    const text = await this.request(url, { method: 'GET' });
    let body: { events?: unknown; cursor?: unknown };

    try {
      body = JSON.parse(text) as { events?: unknown; cursor?: unknown };
    } catch {
      throw new AppException('INTEGRATION_CONTRACT_MISMATCH', {
        detail: `Внешняя система ${this.kind} вернула ответ, который не является JSON.`,
        meta: { kind: this.kind },
      });
    }

    // Форма ответа проверяется до разбора событий: объект вместо массива
    // прежде ронял синхронизацию невнятной ошибкой перебора.
    if (body.events !== undefined && !Array.isArray(body.events)) {
      throw new AppException('INTEGRATION_CONTRACT_MISMATCH', {
        detail: `Внешняя система ${this.kind}: поле events должно быть массивом.`,
        meta: { kind: this.kind },
      });
    }

    return {
      events: (body.events as unknown[] | undefined) ?? [],
      cursor: typeof body.cursor === 'string' ? body.cursor : null,
    };
  }

  async push(payload: EngagementPayload): Promise<void> {
    const url = new URL('/api/crm/engagements', this.baseUrl);

    await this.request(url, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
    });
  }

  /**
   * Запрос с ограничением по времени и объёму.
   *
   * Тайм-аут обязателен: система работает в закрытом контуре с жёстко
   * заданными адресами, и зависший вызов к недоступной системе иначе
   * занял бы обработчик очереди до бесконечности.
   *
   * Тайм-аут действует до конца чтения тела, а не только до заголовков:
   * прежде таймер снимался, как только приходил статус, и система,
   * отдающая ответ по байту, держала синхронизацию сколь угодно долго.
   * Объём ответа ограничен — его целиком держит память процесса.
   * Перенаправления не выполняются: адреса LMS и сайта заданы явно,
   * и уводить обращение с токеном на другой узел незачем.
   */
  private async request(url: URL, init: RequestInit): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        redirect: 'error',
        signal: controller.signal,
        headers: {
          ...(init.headers ?? {}),
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
      });

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new AppException('INTEGRATION_SOURCE_UNAVAILABLE', {
          detail: `Внешняя система ${this.kind} ответила кодом ${response.status}.`,
          meta: { kind: this.kind, status: response.status },
        });
      }

      return await readLimited(response, MAX_RESPONSE_BYTES, this.kind);
    } catch (error: unknown) {
      if (error instanceof AppException) {
        throw error;
      }

      this.logger.warn({ err: error, kind: this.kind }, 'Сбой обращения к внешней системе');

      throw new AppException('INTEGRATION_SOURCE_UNAVAILABLE', {
        detail: `Внешняя система ${this.kind} недоступна.`,
        meta: { kind: this.kind },
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Наибольший ответ внешней системы. Пачка событий такого объёма не бывает. */
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

/** Тело ответа текстом, но не больше maxBytes: сверх предела чтение прерывается. */
async function readLimited(response: Response, maxBytes: number, kind: string): Promise<string> {
  if (!response.body) {
    return '';
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    total += value.byteLength;

    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new AppException('INTEGRATION_CONTRACT_MISMATCH', {
        detail: `Ответ внешней системы ${kind} больше ${Math.round(maxBytes / 1024 / 1024)} МБ.`,
        meta: { kind },
      });
    }

    chunks.push(value);
  }

  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Адаптер-заглушка.
 *
 * Работает вместо HTTP при INTEGRATION_MODE=stub — режиме по умолчанию.
 * Контракт внешних систем заказчиком не передан, и заглушка позволяет
 * показать обмен целиком: входящие события приходят из встроенного набора
 * примеров, исходящие попадают в журнал вместо сети.
 *
 * Курсор соблюдается по-настоящему: повторный запуск синхронизации не
 * выдаёт те же события заново, поэтому поведение совпадает с боевым.
 */
export class StubIntegrationAdapter implements IntegrationAdapter {
  /** Отправленные наружу сообщения — их показывает журнал прогона. */
  private readonly delivered: EngagementPayload[] = [];

  constructor(
    readonly kind: IntegrationKind,
    private readonly fixtures: InboundEvent[],
    private readonly logger: PinoLogger,
  ) {}

  fetchEvents(cursor: string | null): Promise<FetchResult> {
    const offset = cursor ? Number.parseInt(cursor, 10) : 0;
    const start = Number.isFinite(offset) && offset > 0 ? offset : 0;
    const events = this.fixtures.slice(start);

    return Promise.resolve({
      events,
      cursor: String(start + events.length),
    });
  }

  push(payload: EngagementPayload): Promise<void> {
    this.delivered.push(payload);

    this.logger.info(
      {
        kind: this.kind,
        event: payload.event,
        engagementId: payload.keys.engagementId,
        status: payload.status.key,
        attachments: payload.attachments.length,
      },
      'Заглушка интеграции: сообщение отправлено во внешнюю систему',
    );

    return Promise.resolve();
  }

  /** Что было отправлено — используется проверками и ручными сценариями. */
  deliveredMessages(): readonly EngagementPayload[] {
    return this.delivered;
  }
}
