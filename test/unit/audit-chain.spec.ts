import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { AuditService } from '../../src/modules/audit/audit.service.js';

/**
 * Запись журнала в том виде, в каком её читает проверка целостности.
 */
interface Row {
  id: bigint;
  occurredAt: Date;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  prevHash: string | null;
  hash: string;
}

/** Повторяет расчёт хэша, выполняемый сервисом при записи события. */
function hashOf(prevHash: string | null, row: Omit<Row, 'hash' | 'prevHash' | 'id'>): string {
  const payload = {
    action: row.action,
    actorEmail: row.actorEmail,
    actorId: row.actorId,
    afterState: row.afterState,
    beforeState: row.beforeState,
    entityId: row.entityId,
    entityType: row.entityType,
    occurredAt: row.occurredAt.toISOString(),
  };

  return createHash('sha256')
    .update(`${prevHash ?? ''}|${JSON.stringify(payload)}`)
    .digest('hex');
}

/** Собирает корректную цепочку из n записей. */
function buildChain(count: number, startId = 1): Row[] {
  const rows: Row[] = [];
  let prevHash: string | null = null;

  for (let index = 0; index < count; index += 1) {
    const body = {
      occurredAt: new Date(Date.UTC(2026, 8, 16, 10, index)),
      actorId: `actor-${index}`,
      actorEmail: `user${index}@rtk.ru`,
      action: 'EXPORT_REPORT',
      entityType: 'Report',
      entityId: `report-${index}`,
      beforeState: null,
      afterState: { rowCount: index },
    };

    const hash = hashOf(prevHash, body);
    rows.push({ id: BigInt(startId + index), ...body, prevHash, hash });
    prevHash = hash;
  }

  return rows;
}

/** Сервис с подставленным хранилищем: база для проверки цепочки не нужна. */
function serviceOver(rows: Row[]): AuditService {
  const prisma = {
    auditLog: {
      findMany: async () => rows,
    },
  };

  const logger = {
    setContext: () => undefined,
    error: () => undefined,
    warn: () => undefined,
    info: () => undefined,
  };

  const config = { get: () => 'test-audit-mask-key-0123456789abcdef' };

  return new AuditService(
    prisma as unknown as ConstructorParameters<typeof AuditService>[0],
    logger as unknown as ConstructorParameters<typeof AuditService>[1],
    config as unknown as ConstructorParameters<typeof AuditService>[2],
  );
}

/**
 * Целостность журнала аудита.
 *
 * Хэш-цепочка имеет смысл только вместе с проверкой: без неё она остаётся
 * декларацией. Отдельно проверяется совместимость с регламентной очисткой —
 * после удаления старых записей по срокам хранения проверка обязана
 * оставаться корректной, иначе она начнёт сообщать о нарушении при каждом
 * запуске и перестанет восприниматься всерьёз.
 */
describe('проверка целостности журнала', () => {
  it('подтверждает целостность корректной цепочки', async () => {
    const result = await serviceOver(buildChain(5)).verifyChain();

    expect(result).toEqual({ checked: 5, brokenAtId: null });
  });

  it('обнаруживает изменение содержимого записи', async () => {
    const rows = buildChain(5);
    // Правка задним числом: событие переписано, хэш остался прежним.
    rows[2].actorEmail = 'подменённый@rtk.ru';

    const result = await serviceOver(rows).verifyChain();

    expect(result.brokenAtId).toBe('3');
  });

  it('обнаруживает изъятие записи из середины', async () => {
    const rows = buildChain(5);
    rows.splice(2, 1);

    const result = await serviceOver(rows).verifyChain();

    // Следующая за изъятой запись ссылается на хэш, которого больше нет.
    expect(result.brokenAtId).toBe('4');
  });

  it('не считает нарушением очистку по сроку хранения', async () => {
    // Регламентная задача удаляет записи с начала журнала: проверка
    // привязывается к первой доступной записи, а не требует,
    // чтобы у неё отсутствовал предыдущий хэш.
    const rows = buildChain(10).slice(4);

    const result = await serviceOver(rows).verifyChain();

    expect(result.brokenAtId).toBeNull();
    expect(result.checked).toBe(6);
  });

  it('обнаруживает нарушение и после очистки', async () => {
    const rows = buildChain(10).slice(4);
    rows[2].afterState = { rowCount: 9999 };

    const result = await serviceOver(rows).verifyChain();

    expect(result.brokenAtId).not.toBeNull();
  });

  it('считает пустой журнал целостным', async () => {
    const result = await serviceOver([]).verifyChain();

    expect(result).toEqual({ checked: 0, brokenAtId: null });
  });
});

/**
 * Запись события.
 *
 * Хэш считает функция базы audit_append по той же формуле, что computeHash,
 * от канонической строки, которую передаёт приложение. Здесь проверяется
 * сторона приложения: одно обращение к базе, и в канонической строке ровно
 * то, что потом прочитает проверка целостности, — тот же момент события
 * и те же состояния.
 */
describe('запись в журнал аудита', () => {
  function recorder() {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const prisma = {
      $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
        calls.push({ sql: strings.join('?'), values });
        return Promise.resolve(1);
      },
    };
    const logger = { setContext: () => undefined, error: () => undefined, warn: () => undefined, info: () => undefined };
    const config = { get: () => 'test-audit-mask-key-0123456789abcdef' };
    const service = new AuditService(
      prisma as unknown as ConstructorParameters<typeof AuditService>[0],
      logger as unknown as ConstructorParameters<typeof AuditService>[1],
      config as unknown as ConstructorParameters<typeof AuditService>[2],
    );
    return { service, calls };
  }

  it('пишет одним вызовом audit_append с канонической строкой события', async () => {
    const { service, calls } = recorder();

    await service.record({
      actorId: '8d7c3b2a-1f00-4c9e-9a51-4d2b7a0c1e01',
      actorEmail: 'kam@rtk.ru',
      action: 'WORKFLOW_TRANSITION',
      entityType: 'Engagement',
      entityId: 'e-1',
      afterState: { stateKey: 'SIGNING', comment: null },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('audit_append(');

    const values = calls[0].values;
    const canonical = JSON.parse(values.at(-1) as string) as Record<string, unknown>;

    // Ключи отсортированы — иначе хэш зависел бы от порядка полей.
    expect(Object.keys(canonical)).toEqual([...Object.keys(canonical)].sort());
    // Момент, сохраняемый в строке, и момент в хэше — один и тот же.
    expect(canonical.occurredAt).toBe(values[0]);
    expect(canonical.action).toBe('WORKFLOW_TRANSITION');
    // Пустое состояние — SQL NULL, заполненное — тот же JSON, что в хэше.
    expect(values[9]).toBeNull();
    expect(JSON.parse(values[10] as string)).toEqual(canonical.afterState);
  });

  it('сбой записи не отменяет операцию, вызвавшую аудит', async () => {
    const prisma = { $executeRaw: () => Promise.reject(new Error('база недоступна')) };
    const errors: unknown[] = [];
    const logger = { setContext: () => undefined, error: (...args: unknown[]) => errors.push(args), warn: () => undefined, info: () => undefined };
    const config = { get: () => 'test-audit-mask-key-0123456789abcdef' };
    const service = new AuditService(
      prisma as unknown as ConstructorParameters<typeof AuditService>[0],
      logger as unknown as ConstructorParameters<typeof AuditService>[1],
      config as unknown as ConstructorParameters<typeof AuditService>[2],
    );

    await expect(service.record({ action: 'LOGIN' })).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
  });
});
