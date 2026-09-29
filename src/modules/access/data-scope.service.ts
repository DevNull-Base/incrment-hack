import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { createHash } from 'node:crypto';
import { PinoLogger } from 'nestjs-pino';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';

/** Время жизни рассчитанной области видимости в кэше. */
const SCOPE_CACHE_TTL_SEC = 120;

const cacheKey = (userId: string) => `access:scope:${userId}`;

/**
 * Область видимости данных пользователя.
 *
 * `null` в поле означает «без ограничений по этому измерению».
 * Пустой массив означает «не видно ничего» — это принципиально разные
 * состояния, и смешивать их нельзя: пустой массив, истолкованный как
 * «нет ограничений», открыл бы доступ ко всем данным.
 */
export interface DataScope {
  /** Ответственные, чьи взаимодействия доступны. */
  ownerIds: string[] | null;
  universityIds: string[] | null;
  directionIds: string[] | null;
  productIds: string[] | null;
  regions: string[] | null;
  /**
   * Устойчивый отпечаток области видимости.
   *
   * Обязателен в ключе любого кэша, хранящего данные: без него
   * ответ, закэшированный для администратора, был бы отдан рядовому
   * менеджеру, и кэш превратился бы в канал утечки между ролями.
   */
  fingerprint: string;
}

/** Область без ограничений — для роли ADMIN. */
const UNRESTRICTED: Omit<DataScope, 'fingerprint'> = {
  ownerIds: null,
  universityIds: null,
  directionIds: null,
  productIds: null,
  regions: null,
};

@Injectable()
export class DataScopeService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(DataScopeService.name);
  }

  /**
   * Рассчитывает область видимости пользователя.
   *
   * Правила:
   *   ADMIN   — видит всё;
   *   MANAGER — свои взаимодействия и взаимодействия подчинённых;
   *   USER    — только свои.
   * Поверх этого накладываются явные ограничения, заданные администратором
   * (таблица data_scope_rule): они только сужают выборку, никогда не расширяют.
   */
  async resolve(user: AuthenticatedUser): Promise<DataScope> {
    const cached = await this.readCache(user.id);
    if (cached) {
      return cached;
    }

    const base = user.role === 'ADMIN' ? { ...UNRESTRICTED } : await this.resolveOwnerScope(user);
    const withRules = await this.applyExplicitRules(user.id, base);
    const scope: DataScope = { ...withRules, fingerprint: fingerprintOf(withRules) };

    await this.writeCache(user.id, scope);
    return scope;
  }

  /** Сбрасывает кэш области видимости — при смене руководителя или правил. */
  async invalidate(userId: string): Promise<void> {
    await this.redis.del(cacheKey(userId)).catch((error: unknown) => {
      this.logger.warn({ err: error }, 'Не удалось сбросить кэш области видимости');
    });
  }

  private async resolveOwnerScope(user: AuthenticatedUser): Promise<Omit<DataScope, 'fingerprint'>> {
    if (user.role === 'USER') {
      return { ...UNRESTRICTED, ownerIds: [user.id] };
    }

    // MANAGER: собственные взаимодействия плюс взаимодействия подчинённых —
    // в том числе заблокированных. Прежде они отбрасывались, и заявки
    // уволившегося менеджера пропадали у руководителя: видел их только
    // администратор, а передать работу преемнику было некому. Ровно та
    // ситуация, от которой система должна защищать, — история по вузу
    // уходит вместе с человеком.
    const subordinates = await this.prisma.appUser.findMany({
      where: { managerId: user.id },
      select: { id: true },
    });

    return { ...UNRESTRICTED, ownerIds: [user.id, ...subordinates.map((item) => item.id)] };
  }

  private async applyExplicitRules(
    userId: string,
    base: Omit<DataScope, 'fingerprint'>,
  ): Promise<Omit<DataScope, 'fingerprint'>> {
    const rules = await this.prisma.dataScopeRule.findMany({
      where: { userId },
      select: { dimension: true, allowedIds: true },
    });

    const result = { ...base };

    for (const rule of rules) {
      switch (rule.dimension) {
        case 'UNIVERSITY':
          result.universityIds = intersect(result.universityIds, rule.allowedIds);
          break;
        case 'IT_DIRECTION':
          result.directionIds = intersect(result.directionIds, rule.allowedIds);
          break;
        case 'SOFTWARE_PRODUCT':
          result.productIds = intersect(result.productIds, rule.allowedIds);
          break;
        case 'REGION':
          // Регионы хранятся строками, а не идентификаторами.
          result.regions = intersect(result.regions, rule.allowedIds);
          break;
      }
    }

    return result;
  }

  private async readCache(userId: string): Promise<DataScope | null> {
    try {
      const raw = await this.redis.get(cacheKey(userId));
      return raw ? (JSON.parse(raw) as DataScope) : null;
    } catch (error) {
      this.logger.warn({ err: error }, 'Кэш областей видимости недоступен, считаем заново');
      return null;
    }
  }

  private async writeCache(userId: string, scope: DataScope): Promise<void> {
    try {
      await this.redis.set(cacheKey(userId), JSON.stringify(scope), 'EX', SCOPE_CACHE_TTL_SEC);
    } catch (error) {
      this.logger.warn({ err: error }, 'Не удалось сохранить область видимости в кэш');
    }
  }
}

/**
 * Пересечение ограничений. Отсутствие ограничения (null) заменяется
 * новым списком; иначе берётся пересечение — правила только сужают доступ.
 */
function intersect(current: string[] | null, incoming: string[]): string[] {
  if (current === null) {
    return [...incoming];
  }

  const allowed = new Set(incoming);
  return current.filter((item) => allowed.has(item));
}

/**
 * Устойчивый отпечаток области видимости.
 * Списки сортируются, поэтому одинаковые по смыслу области дают
 * одинаковый отпечаток независимо от порядка записей в БД.
 */
function fingerprintOf(scope: Omit<DataScope, 'fingerprint'>): string {
  const normalized = JSON.stringify({
    o: scope.ownerIds ? [...scope.ownerIds].sort() : null,
    u: scope.universityIds ? [...scope.universityIds].sort() : null,
    d: scope.directionIds ? [...scope.directionIds].sort() : null,
    p: scope.productIds ? [...scope.productIds].sort() : null,
    r: scope.regions ? [...scope.regions].sort() : null,
  });

  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/**
 * Условие выборки взаимодействий, вытекающее из области видимости.
 *
 * Вынесено сюда намеренно: фильтр обязан применяться единообразно всеми
 * потребителями. Когда такой код дублируется по сервисам, рано или поздно
 * появляется путь, где его забыли, — и он становится дырой в разграничении
 * доступа, незаметной при обычном просмотре списков.
 */
export function engagementScopeFilter(scope: DataScope): Prisma.EngagementWhereInput {
  // Ограничения по вузу и региону описывают работу с учебными заведениями
  // и к прямым продажам неприменимы: у заявки B2C вуза нет вовсе, и условие
  // по university_id спрятало бы такие заявки целиком — включая собственные
  // заявки пользователя. Поэтому эти два измерения сужают только B2B.
  // Направление и продукт есть у заявок обоих сегментов и применяются к ним
  // одинаково, а ограничение по ответственному действует всегда.
  const universityConstraints: Prisma.EngagementWhereInput[] = [];

  if (scope.universityIds) {
    universityConstraints.push({ universityId: { in: scope.universityIds } });
  }
  if (scope.regions) {
    universityConstraints.push({ university: { region: { in: scope.regions } } });
  }

  const conditions: Prisma.EngagementWhereInput[] = [];

  if (scope.ownerIds) conditions.push({ ownerId: { in: scope.ownerIds } });
  if (scope.directionIds) conditions.push({ directionId: { in: scope.directionIds } });
  if (scope.productIds) conditions.push({ productId: { in: scope.productIds } });

  if (universityConstraints.length > 0) {
    conditions.push({ OR: [{ segment: 'B2C' as const }, { AND: universityConstraints }] });
  }

  // Все условия — внутри AND, ни одно не лежит на верхнем уровне. Вызывающий
  // код раскрывает фильтр рядом с собственным отбором ({ ownerId, ...scope }),
  // и прежде ownerId, directionId и productId области видимости молча
  // затирали одноимённый отбор пользователя: у руководителя фильтр
  // «ответственный» показывал весь отдел, а «мои сроки» в календаре —
  // сроки всех подчинённых.
  return conditions.length > 0 ? { AND: conditions } : {};
}
