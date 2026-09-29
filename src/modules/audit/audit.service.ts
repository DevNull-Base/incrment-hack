import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac } from 'node:crypto';
import { PinoLogger } from 'nestjs-pino';
import { AppConfig } from '../../config/configuration.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { currentRequestContext } from '../../common/context/request-context.js';

/**
 * Действия, подлежащие протоколированию.
 *
 * Перечень закрытый: произвольные строки в журнале сделали бы невозможным
 * построение отчётов по событиям безопасности и их автоматический разбор.
 */
export const AUDIT_ACTIONS = {
  /** Первое обращение с валидным токеном — начало сеанса работы. */
  LOGIN: 'LOGIN',
  /** Отказ во входе: учётная запись деактивирована. */
  LOGIN_DENIED: 'LOGIN_DENIED',
  VIEW_PERSONAL_DATA: 'VIEW_PERSONAL_DATA',
  EXPORT_REPORT: 'EXPORT_REPORT',
  DOWNLOAD_ATTACHMENT: 'DOWNLOAD_ATTACHMENT',
  UPLOAD_ATTACHMENT: 'UPLOAD_ATTACHMENT',
  DELETE_ATTACHMENT: 'DELETE_ATTACHMENT',
  /** Загрузка отклонена антивирусом или проверкой типа. */
  ATTACHMENT_REJECTED: 'ATTACHMENT_REJECTED',
  WORKFLOW_TRANSITION: 'WORKFLOW_TRANSITION',
  WORKFLOW_TEMPLATE_CREATE: 'WORKFLOW_TEMPLATE_CREATE',
  WORKFLOW_TEMPLATE_UPDATE: 'WORKFLOW_TEMPLATE_UPDATE',
  /** Публикация редакции процесса с переводом всех текущих заявок. */
  WORKFLOW_TEMPLATE_PUBLISH: 'WORKFLOW_TEMPLATE_PUBLISH',
  ENGAGEMENT_CREATE: 'ENGAGEMENT_CREATE',
  ENGAGEMENT_UPDATE: 'ENGAGEMENT_UPDATE',
  ENGAGEMENT_REASSIGN: 'ENGAGEMENT_REASSIGN',
  CATALOG_CREATE: 'CATALOG_CREATE',
  CATALOG_UPDATE: 'CATALOG_UPDATE',
  CATALOG_DEACTIVATE: 'CATALOG_DEACTIVATE',
  IMPORT_APPLY: 'IMPORT_APPLY',
  USER_ROLE_CHANGE: 'USER_ROLE_CHANGE',
  USER_STATUS_CHANGE: 'USER_STATUS_CHANGE',
  USER_MANAGER_CHANGE: 'USER_MANAGER_CHANGE',
  DATA_SCOPE_CHANGE: 'DATA_SCOPE_CHANGE',
  /** Правила уведомлений и подключение каналов доставки. */
  NOTIFICATION_SETTINGS_CHANGE: 'NOTIFICATION_SETTINGS_CHANGE',
  /** Уточнение персональных данных по требованию субъекта (ч. 1 ст. 21 152-ФЗ). */
  PERSONAL_DATA_RECTIFY: 'PERSONAL_DATA_RECTIFY',
  /** Обезличивание персональных данных (ч. 4 ст. 21 152-ФЗ). */
  PERSONAL_DATA_ERASE: 'PERSONAL_DATA_ERASE',
  /** Изменение срока хранения персональных данных. */
  PERSONAL_DATA_RETENTION_SET: 'PERSONAL_DATA_RETENTION_SET',
  /** Регламентная очистка по истечении сроков хранения (ч. 7 ст. 5 152-ФЗ). */
  RETENTION_PURGE: 'RETENTION_PURGE',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface AuditEntry {
  actorId?: string | null;
  actorEmail?: string | null;
  action: AuditAction;
  entityType?: string | null;
  entityId?: string | null;
  /**
   * Источник события. Поля необязательны в интерфейсе, но НЕ опциональны
   * по существу: если вызывающий код их не передал, они берутся из контекста
   * текущего запроса (см. request-context). Явное указание нужно лишь там,
   * где запроса нет, — в обработчиках очередей и регламентных задачах.
   */
  ipAddress?: string | null;
  userAgent?: string | null;
  traceId?: string | null;
  /** Состояние до изменения. Персональные данные подлежат маскированию. */
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
}

/**
 * Ключ маскирования для разработки. В production запуск без собственного
 * ключа запрещён проверкой конфигурации: этот текст лежит в репозитории.
 */
const DEV_MASK_KEY = 'dev-only-audit-mask-key-not-for-production';

/** Поля, значения которых маскируются перед записью в журнал. */
const MASKED_FIELDS = new Set([
  // Строка поиска в реестре персональных данных — это чаще всего фамилия,
  // почта или телефон; журнал доступа к ПДн сохранял её открытым текстом.
  'search',
  'contactName',
  'fullName',
  // Контрагент прямой продажи — чаще всего физическое лицо, и его ФИО
  // попадало в неизменяемый журнал открытым текстом: обезличить его там
  // по требованию субъекта было бы уже невозможно.
  'counterpartyName',
  'firstName',
  'lastName',
  'middleName',
  'email',
  'phone',
  'passport',
  'snils',
  'password',
  'token',
]);

/**
 * Журнал действий пользователей (группа мер РСБ).
 *
 * Записи связаны хэш-цепочкой: каждая содержит хэш предыдущей. Подмена или
 * изъятие записи разрывает цепь и обнаруживается проверкой целостности.
 * Дополнительно UPDATE запрещён триггером на уровне БД, поэтому переписать
 * историю не сможет даже ошибка в коде приложения.
 */
@Injectable()
export class AuditService {
  private readonly maskKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
    config: ConfigService<AppConfig, true>,
  ) {
    this.logger.setContext(AuditService.name);

    const key = config.get('AUDIT_MASK_KEY', { infer: true });

    if (key.length === 0) {
      this.logger.warn('AUDIT_MASK_KEY не задан — маскирование в журнале на ключе разработки');
    }

    this.maskKey = key.length > 0 ? key : DEV_MASK_KEY;
  }

  /**
   * Записывает событие в журнал.
   *
   * Вычисление хэша требует знания предыдущей записи, поэтому вставки
   * сериализуются консультативной блокировкой: без неё два параллельных
   * перехода прочитали бы один и тот же prevHash и цепочка разорвалась бы
   * уже на втором событии.
   *
   * Блокировку (идентификатор 774101), чтение предыдущего хэша и вставку
   * выполняет функция базы audit_append одним обращением: блокировка
   * держится время одной вставки внутри PostgreSQL, а не время нескольких
   * обращений приложения, каждое из которых под нагрузкой ждёт очереди
   * событий Node. Так журнал перестал быть узким местом записи
   * (docs/load-testing.md).
   */
  async record(entry: AuditEntry): Promise<void> {
    // Источник события подставляется из контекста запроса, если вызывающий
    // код не указал его явно. Полагаться на то, что каждый из полутора
    // десятков вызовов не забудет передать адрес, нельзя: ровно так поля
    // ip_address и user_agent и оставались пустыми во всём журнале.
    const context = currentRequestContext();
    const ipAddress = entry.ipAddress ?? context?.ipAddress ?? null;
    const userAgent = entry.userAgent ?? context?.userAgent ?? null;
    const traceId = entry.traceId ?? context?.traceId ?? null;

    try {
      // Момент события вычисляется здесь и передаётся явно: он входит в хэш,
      // и если положиться на now() в БД, в хэш попадёт одно время, а в строку —
      // другое, и проверка целостности объявит нарушением каждую запись.
      const payload = {
        occurredAt: new Date().toISOString(),
        actorId: entry.actorId ?? null,
        actorEmail: entry.actorEmail ?? null,
        action: entry.action,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        beforeState: mask(entry.beforeState, this.maskKey),
        afterState: mask(entry.afterState, this.maskKey),
      };

      // Блокировка, чтение предыдущего хэша и вставка — одним обращением
      // (функция audit_append, миграция 20260929140000). Хэш база считает
      // от той же канонической строки, что и computeHash, поэтому
      // verifyChain сверяет его без изменений.
      await this.prisma.$executeRaw`
        SELECT audit_append(
          ${payload.occurredAt}::timestamptz,
          ${payload.actorId}::uuid,
          ${payload.actorEmail}::text,
          ${payload.action}::text,
          ${payload.entityType}::text,
          ${payload.entityId}::text,
          ${ipAddress}::text,
          ${userAgent}::text,
          ${traceId}::text,
          ${toJsonb(payload.beforeState)}::jsonb,
          ${toJsonb(payload.afterState)}::jsonb,
          ${canonicalJson(payload)}::text
        )`;
    } catch (error) {
      // Сбой журналирования не должен отменять уже выполненную операцию,
      // но обязан быть заметен: событие уходит в лог с уровнем error,
      // по которому настраивается оповещение администратора.
      this.logger.error(
        { err: error, action: entry.action, entityId: entry.entityId },
        'Не удалось записать событие в журнал аудита',
      );
    }
  }

  /**
   * Проверяет целостность хэш-цепочки журнала.
   *
   * Возвращает номер первой записи, на которой цепь расходится, либо null,
   * если нарушений нет. Используется администратором и при регламентных
   * проверках защищённости.
   */
  async verifyChain(limit = 10_000): Promise<{ checked: number; brokenAtId: string | null }> {
    const records = await this.prisma.auditLog.findMany({
      orderBy: { id: 'asc' },
      take: limit,
      select: {
        id: true,
        occurredAt: true,
        actorId: true,
        actorEmail: true,
        action: true,
        entityType: true,
        entityId: true,
        beforeState: true,
        afterState: true,
        prevHash: true,
        hash: true,
      },
    });

    // Проверка привязывается к ПЕРВОЙ доступной записи, а не требует, чтобы
    // у неё отсутствовал предыдущий хэш. Это обязательно: регламентная
    // очистка удаляет записи за пределами срока хранения, и после первой же
    // такой очистки жёсткая привязка к началу цепочки объявляла бы
    // нарушением каждую проверку. Подмена и изъятие записей ВНУТРИ
    // проверяемого диапазона обнаруживаются по-прежнему.
    let expectedPrev: string | null = records[0]?.prevHash ?? null;

    for (const record of records) {
      if (record.prevHash !== expectedPrev) {
        return { checked: records.length, brokenAtId: record.id.toString() };
      }

      const recomputed = computeHash(record.prevHash, {
        occurredAt: record.occurredAt.toISOString(),
        actorId: record.actorId,
        actorEmail: record.actorEmail,
        action: record.action,
        entityType: record.entityType,
        entityId: record.entityId,
        beforeState: record.beforeState as Record<string, unknown> | null,
        afterState: record.afterState as Record<string, unknown> | null,
      });

      if (recomputed !== record.hash) {
        return { checked: records.length, brokenAtId: record.id.toString() };
      }

      expectedPrev = record.hash;
    }

    return { checked: records.length, brokenAtId: null };
  }
}

/**
 * Приводит значение к канонической форме с рекурсивной сортировкой ключей.
 *
 * Нужно потому, что JSON.stringify сохраняет порядок вставки: одна и та же
 * по смыслу запись, собранная в другом порядке полей, дала бы другой хэш.
 *
 * Сортировка выполняется именно так, а не через второй аргумент
 * JSON.stringify: там передаётся не сортировщик, а СПИСОК разрешённых
 * ключей, причём действующий на всех уровнях вложенности. Вложенные
 * объекты при этом теряют все поля, чьи имена не совпали с верхним
 * уровнем, — и хэш перестаёт зависеть от их содержимого.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      result[key] = canonicalize(source[key]);
    }
    return result;
  }

  return value;
}

/** Хэш записи от её содержимого и хэша предыдущей. */
/** Каноническая строка события — то, от чего считается хэш. */
export function canonicalJson(payload: Record<string, unknown>): string {
  return JSON.stringify(canonicalize(payload));
}

/**
 * Хэш записи. Та же формула записана в функции audit_append в базе —
 * менять её можно только вместе с миграцией, иначе новые записи
 * не пройдут проверку целостности.
 */
export function computeHash(prevHash: string | null, payload: Record<string, unknown>): string {
  return createHash('sha256')
    .update(`${prevHash ?? ''}|${canonicalJson(payload)}`)
    .digest('hex');
}

/** Состояние для колонки JSONB: null остаётся SQL NULL, а не JSON null. */
function toJsonb(state: Record<string, unknown> | null): string | null {
  return state === null ? null : JSON.stringify(state);
}

/**
 * Маскирует персональные данные перед записью в журнал.
 *
 * Журнал обязан фиксировать факт доступа к персональным данным, но сам
 * хранилищем таких данных быть не должен — иначе система протоколирования
 * превращается в дополнительную точку их утечки (152-ФЗ).
 *
 * Экспортируется ради модульных тестов: отказ маскирования ничем себя
 * не проявляет — система работает, просто персональные данные начинают
 * накапливаться в журнале, — и обнаружить такое можно только проверкой.
 */
export function mask(
  state: Record<string, unknown> | null | undefined,
  secret: string,
): Record<string, unknown> | null {
  if (!state) {
    return null;
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(state)) {
    result[key] = maskValue(key, value, secret);
  }

  return result;
}

/**
 * Маскирует одно значение с учётом имени поля, под которым оно лежит.
 *
 * Обход массивов обязателен. Типичное состояние выглядит как
 * `{ contacts: [{ fullName, email }, ...] }`, и рекурсия, пропускающая
 * массивы, оставила бы весь список контактов в журнале в открытом виде —
 * ровно те данные, ради защиты которых маскирование и делается.
 *
 * Имя поля передаётся вглубь: элементы массива `fullName: ['Иванов', ...]`
 * подлежат маскированию так же, как скалярное значение того же поля.
 */
function maskValue(key: string, value: unknown, secret: string): unknown {
  if (MASKED_FIELDS.has(key) && typeof value === 'string' && value.length > 0) {
    // Сохраняем признак наличия и изменения значения, но не само значение:
    // одинаковые значения дают одинаковый отпечаток, поэтому по журналу
    // видно, менялось ли поле.
    //
    // Отпечаток — HMAC с секретным ключом, а не простой хэш. Простой хэш
    // восстанавливался перебором: ФИО, почта и телефон берутся из конечных
    // словарей, и отпечаток «Иванов Иван Иванович» вычисляется заранее
    // любым, кто прочитал журнал. Без ключа такой перебор невозможен.
    return `[скрыто:${createHmac('sha256', secret).update(value).digest('hex').slice(0, 8)}]`;
  }

  if (Array.isArray(value)) {
    return value.map((item) => maskValue(key, item, secret));
  }

  if (value !== null && typeof value === 'object') {
    return mask(value as Record<string, unknown>, secret);
  }

  return value;
}
