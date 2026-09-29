import { describe, expect, it, vi } from 'vitest';
import { EngagementService } from '../../src/modules/engagement/engagement.service.js';
import type { DataScope } from '../../src/modules/access/data-scope.service.js';

const unrestricted: DataScope = {
  ownerIds: null,
  universityIds: null,
  directionIds: null,
  productIds: null,
  regions: null,
  fingerprint: 'test',
};

/**
 * Поиск по заявкам.
 *
 * Условие «вуз с таким названием» прежде стояло внутри выборки заявок
 * через связь, и такое «OR» не могло опереться ни на один индекс: на
 * 50 000 заявок поиск стоил 120 мс процессора базы на запрос
 * (docs/load-testing.md). Теперь вузы находятся отдельным запросом,
 * а заявки отбираются по university_id — это и проверяется.
 */
function setup(universities: Array<{ id: string }>) {
  const prisma = {
    university: { findMany: vi.fn().mockResolvedValue(universities) },
    engagement: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
  };
  const dataScope = { resolve: vi.fn().mockResolvedValue(unrestricted) };
  const config = { get: () => 'Europe/Moscow' };
  const service = new EngagementService(
    prisma as never,
    dataScope as never,
    {} as never,
    {} as never,
    {} as never,
    config as never,
  );
  const user = { id: 'u1', role: 'ADMIN' } as never;
  const query = { search: 'УЗ-42', page: 1, limit: 25, skip: 0 } as never;
  return { prisma, service, user, query };
}

function searchCondition(where: { AND?: Array<{ OR?: unknown[] }> } & Record<string, unknown>): unknown[] {
  const serialized = JSON.stringify(where);
  expect(serialized).not.toContain('"university":{"name"');
  const found = (where.AND ?? []).find((part) => Array.isArray(part.OR) && JSON.stringify(part.OR).includes('counterpartyName'));
  expect(found).toBeDefined();
  return found?.OR ?? [];
}

describe('поиск по заявкам', () => {
  it('вузы ищутся отдельным запросом, заявки — по university_id', async () => {
    const { prisma, service, user, query } = setup([{ id: 'uni-1' }, { id: 'uni-2' }]);
    await service.findAll(query, user);

    expect(prisma.university.findMany).toHaveBeenCalledTimes(1);
    const universityWhere = JSON.stringify(prisma.university.findMany.mock.calls[0][0].where);
    expect(universityWhere).toContain('"name":{"contains":"УЗ-42","mode":"insensitive"}');
    expect(universityWhere).toContain('"shortName":{"contains":"УЗ-42","mode":"insensitive"}');

    const where = prisma.engagement.findMany.mock.calls[0][0].where;
    const or = searchCondition(where);
    expect(or).toContainEqual({ universityId: { in: ['uni-1', 'uni-2'] } });
    expect(or).toContainEqual({ counterpartyName: { contains: 'УЗ-42', mode: 'insensitive' } });
    // Счётчик и страница — по одному и тому же условию.
    expect(prisma.engagement.count.mock.calls[0][0].where).toEqual(where);
  });

  it('без подходящих вузов остаётся поиск по контрагенту и заголовку', async () => {
    const { prisma, service, user, query } = setup([]);
    await service.findAll(query, user);

    const or = searchCondition(prisma.engagement.findMany.mock.calls[0][0].where);
    expect(JSON.stringify(or)).not.toContain('universityId');
    expect(or).toHaveLength(2);
  });

  it('без строки поиска вузы не запрашиваются', async () => {
    const { prisma, service, user } = setup([]);
    await service.findAll({ page: 1, limit: 25, skip: 0 } as never, user);
    expect(prisma.university.findMany).not.toHaveBeenCalled();
  });
});
