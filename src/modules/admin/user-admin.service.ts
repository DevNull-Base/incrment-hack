import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PinoLogger } from 'nestjs-pino';
import { Prisma } from '../../generated/prisma/client.js';
import { ScopeDimension, UserRole } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { PageDto, toPage } from '../../common/dto/pagination.dto.js';
import { AUDIT_ACTIONS, AuditService } from '../audit/audit.service.js';
import { DataScopeService } from '../access/data-scope.service.js';
import { UserProvisioningService } from '../auth/user-provisioning.service.js';
import { INTERNAL_EVENTS, type UserDeactivatedEvent } from '../realtime/realtime.gateway.js';
import { AdminUserDto, UserQueryDto } from './dto/admin.dto.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';

/**
 * Управление учётными записями, ролями и областями видимости.
 *
 * Требование ТЗ: администратор управляет правами пользователей и выполняет
 * «разграничение пользователей по доступу к данным». Модель данных для этого
 * существовала с самого начала (роль, подчинённость, признак активности,
 * правила DataScopeRule), но изменить их было нечем — ни одного метода API
 * не существовало, и роли правились напрямую в базе.
 *
 * Все операции протоколируются: изменение прав — событие безопасности,
 * и по журналу должно быть видно, кто, когда и на каком основании расширил
 * или сузил чьи-то полномочия.
 *
 * Важное следствие изменения прав — сброс кэшей. Профиль пользователя живёт
 * в Redis 5 минут, область видимости — 2 минуты. Без принудительного сброса
 * заблокированный сотрудник продолжал бы работать до истечения кэша, а это
 * прямо противоречит смыслу блокировки.
 */
/** Идентификатор записи каталога. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class UserAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly dataScope: DataScopeService,
    private readonly provisioning: UserProvisioningService,
    private readonly events: EventEmitter2,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(UserAdminService.name);
  }

  async findAll(query: UserQueryDto): Promise<PageDto<AdminUserDto>> {
    const where: Prisma.AppUserWhereInput = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.activeOnly ? { isActive: true } : {}),
      ...(query.search
        ? {
            OR: [
              { displayName: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, records] = await Promise.all([
      this.prisma.appUser.count({ where }),
      this.prisma.appUser.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: [{ role: 'asc' }, { displayName: query.sortOrder }],
        select: USER_SELECTION,
      }),
    ]);

    return toPage(records.map(toAdminUserDto), total, query);
  }

  async findOne(id: string): Promise<AdminUserDto> {
    return toAdminUserDto(await this.require(id));
  }

  /**
   * Изменение роли.
   *
   * Назначенная здесь роль действует, пока её не сменит администратор,
   * и роль из токена Keycloak её больше не перекрывает. Прежде перекрывала:
   * сброс кэша профиля заставлял заново прочитать роль из токена, и смена
   * откатывалась на первом же запросе пользователя — понизить права
   * скомпрометированной учётной записи через систему было невозможно.
   */
  async changeRole(
    id: string,
    role: UserRole,
    reason: string | undefined,
    actor: AuthenticatedUser,
  ): Promise<AdminUserDto> {
    const target = await this.require(id);

    this.assertNotSelf(target.id, actor);

    if (target.role === 'ADMIN' && role !== 'ADMIN') {
      await this.assertNotLastAdmin(target.id);
    }

    const updated = await this.prisma.appUser.update({
      where: { id },
      data: { role, roleManagedLocally: true },
      select: USER_SELECTION,
    });

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: AUDIT_ACTIONS.USER_ROLE_CHANGE,
      entityType: 'AppUser',
      entityId: id,
      beforeState: { role: target.role },
      afterState: { role, reason: reason ?? null },
    });

    await this.resetCaches(updated.keycloakSub, id);

    this.logger.info({ userId: id, from: target.role, to: role }, 'Изменена роль пользователя');

    return toAdminUserDto(updated);
  }

  /** Блокировка и разблокировка учётной записи. */
  async changeStatus(
    id: string,
    isActive: boolean,
    reason: string | undefined,
    actor: AuthenticatedUser,
  ): Promise<AdminUserDto> {
    const target = await this.require(id);

    this.assertNotSelf(target.id, actor);

    if (!isActive && target.role === 'ADMIN') {
      await this.assertNotLastAdmin(target.id);
    }

    const updated = await this.prisma.appUser.update({
      where: { id },
      data: { isActive },
      select: USER_SELECTION,
    });

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: AUDIT_ACTIONS.USER_STATUS_CHANGE,
      entityType: 'AppUser',
      entityId: id,
      beforeState: { isActive: target.isActive },
      afterState: { isActive, reason: reason ?? null },
    });

    // Сброс кэша обязателен именно здесь: иначе заблокированный пользователь
    // продолжал бы работать до истечения кэша профиля.
    await this.resetCaches(updated.keycloakSub, id);

    // Открытые подключения к каналу обновлений закрываются тоже: токен там
    // проверялся при подключении, и без этого события шли бы дальше.
    if (!isActive) {
      const event: UserDeactivatedEvent = { userId: id };
      this.events.emit(INTERNAL_EVENTS.USER_DEACTIVATED, event);
    }

    this.logger.info({ userId: id, isActive }, 'Изменён статус учётной записи');

    return toAdminUserDto(updated);
  }

  /**
   * Назначение руководителя.
   *
   * Подчинённость определяет область видимости: руководитель видит данные
   * подчинённых. Поэтому проверяется отсутствие цикла — иначе расчёт
   * области видимости зациклился бы, а пользователь получил бы доступ
   * к данным «через себя».
   */
  async changeManager(
    id: string,
    managerId: string | null,
    actor: AuthenticatedUser,
  ): Promise<AdminUserDto> {
    const target = await this.require(id);

    if (managerId !== null) {
      if (managerId === id) {
        throw new AppException('MANAGER_CYCLE', {
          detail: 'Пользователь не может быть собственным руководителем.',
        });
      }

      await this.require(managerId);
      await this.assertNoCycle(id, managerId);
    }

    const updated = await this.prisma.appUser.update({
      where: { id },
      data: { managerId },
      select: USER_SELECTION,
    });

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: AUDIT_ACTIONS.USER_MANAGER_CHANGE,
      entityType: 'AppUser',
      entityId: id,
      beforeState: { managerId: target.managerId },
      afterState: { managerId },
    });

    // Меняется видимость данных и у самого пользователя, и у обоих
    // руководителей — прежнего и нового.
    await this.resetCaches(updated.keycloakSub, id);
    await this.invalidateScopeOf(target.managerId);
    await this.invalidateScopeOf(managerId);

    return toAdminUserDto(updated);
  }

  /**
   * Значения правила видимости: для вуза, направления и продукта —
   * идентификаторы существующих записей каталога, для региона — названия.
   *
   * Прежде значения сохранялись как есть. Строка, не являющаяся UUID,
   * попадала затем в каждый запрос пользователя к заявкам и отчётам,
   * и все они падали с внутренней ошибкой — пользователь терял доступ
   * к системе целиком из-за опечатки в правиле.
   */
  private async validateScopeValues(dimension: ScopeDimension, values: string[]): Promise<string[]> {
    const unique = Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)));

    if (dimension === 'REGION') {
      return unique;
    }

    const malformed = unique.filter((value) => !UUID_PATTERN.test(value));

    if (malformed.length > 0) {
      throw new AppException('VALIDATION_FAILED', {
        detail: `Значения не являются идентификаторами: ${malformed.slice(0, 5).join(', ')}.`,
        issues: [{ field: 'allowedIds', message: 'Ожидаются идентификаторы записей каталога (UUID)' }],
      });
    }

    const where = { id: { in: unique } };
    const found =
      dimension === 'UNIVERSITY'
        ? await this.prisma.university.findMany({ where, select: { id: true } })
        : dimension === 'IT_DIRECTION'
          ? await this.prisma.itDirection.findMany({ where, select: { id: true } })
          : await this.prisma.softwareProduct.findMany({ where, select: { id: true } });

    const known = new Set(found.map((record) => record.id));
    const missing = unique.filter((value) => !known.has(value));

    if (missing.length > 0) {
      throw new AppException('VALIDATION_FAILED', {
        detail: `В каталоге нет записей: ${missing.slice(0, 5).join(', ')}.`,
        issues: [{ field: 'allowedIds', message: 'Укажите существующие записи каталога' }],
      });
    }

    return unique;
  }

  /** Устанавливает или заменяет правило ограничения видимости. */
  async setScopeRule(
    id: string,
    dimension: ScopeDimension,
    allowedIds: string[],
    actor: AuthenticatedUser,
  ): Promise<AdminUserDto> {
    const target = await this.require(id);

    this.assertNotSelf(target.id, actor);

    allowedIds = await this.validateScopeValues(dimension, allowedIds);

    const previous = target.scopeRules.find((rule) => rule.dimension === dimension);

    await this.prisma.dataScopeRule.upsert({
      where: { userId_dimension: { userId: id, dimension } },
      create: { userId: id, dimension, allowedIds },
      update: { allowedIds },
    });

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: AUDIT_ACTIONS.DATA_SCOPE_CHANGE,
      entityType: 'AppUser',
      entityId: id,
      beforeState: { dimension, allowedIds: previous?.allowedIds ?? null },
      afterState: { dimension, allowedIds },
    });

    await this.resetCaches(target.keycloakSub, id);

    return this.findOne(id);
  }

  /** Снимает ограничение по измерению: пользователь снова видит всё доступное по роли. */
  async removeScopeRule(
    id: string,
    dimension: ScopeDimension,
    actor: AuthenticatedUser,
  ): Promise<AdminUserDto> {
    const target = await this.require(id);

    this.assertNotSelf(target.id, actor);

    const previous = target.scopeRules.find((rule) => rule.dimension === dimension);

    if (!previous) {
      throw new AppException('NOT_FOUND', {
        detail: `Ограничение по измерению ${dimension} для пользователя не задано.`,
      });
    }

    await this.prisma.dataScopeRule.delete({
      where: { userId_dimension: { userId: id, dimension } },
    });

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: AUDIT_ACTIONS.DATA_SCOPE_CHANGE,
      entityType: 'AppUser',
      entityId: id,
      beforeState: { dimension, allowedIds: previous.allowedIds },
      afterState: { dimension, allowedIds: null },
    });

    await this.resetCaches(target.keycloakSub, id);

    return this.findOne(id);
  }

  // ------------------------------------------------------------- инварианты --

  /**
   * Запрещает администратору менять собственные права.
   *
   * Защищает сразу от двух ошибок: снять с себя права и лишиться доступа
   * к управлению, либо незаметно расширить собственные полномочия. Изменение
   * прав администратора выполняет другой администратор — это обычное
   * требование разделения полномочий.
   */
  private assertNotSelf(targetId: string, actor: AuthenticatedUser): void {
    if (targetId === actor.id) {
      throw new AppException('SELF_PRIVILEGE_CHANGE');
    }
  }

  /** Не даёт оставить систему без единого действующего администратора. */
  private async assertNotLastAdmin(excludedId: string): Promise<void> {
    const remaining = await this.prisma.appUser.count({
      where: { role: 'ADMIN', isActive: true, id: { not: excludedId } },
    });

    if (remaining === 0) {
      throw new AppException('LAST_ADMINISTRATOR');
    }
  }

  /**
   * Проверяет, что назначение не образует цикл подчинённости.
   *
   * Поднимаемся от кандидата в руководители вверх по иерархии: если на пути
   * встретился сам пользователь, назначение замкнуло бы кольцо. Счётчик шагов
   * ограничен на случай цикла, уже существующего в данных, — без него
   * проверка сама зациклилась бы.
   */
  private async assertNoCycle(userId: string, managerId: string): Promise<void> {
    let currentId: string | null = managerId;

    for (let depth = 0; depth < MAX_HIERARCHY_DEPTH && currentId !== null; depth += 1) {
      if (currentId === userId) {
        throw new AppException('MANAGER_CYCLE', {
          detail: 'Назначение образует цикл: пользователь оказался бы подчинённым самому себе.',
          meta: { userId, managerId },
        });
      }

      const parent: { managerId: string | null } | null = await this.prisma.appUser.findUnique({
        where: { id: currentId },
        select: { managerId: true },
      });

      currentId = parent?.managerId ?? null;
    }
  }

  private async require(id: string) {
    const record = await this.prisma.appUser.findUnique({
      where: { id },
      select: USER_SELECTION,
    });

    if (!record) {
      throw new AppException('NOT_FOUND', { detail: 'Пользователь не найден.' });
    }

    return record;
  }

  /** Сбрасывает кэши профиля и области видимости — изменение прав должно действовать сразу. */
  private async resetCaches(keycloakSub: string, userId: string): Promise<void> {
    await this.provisioning.invalidate(keycloakSub);
    await this.dataScope.invalidate(userId);
  }

  private async invalidateScopeOf(userId: string | null): Promise<void> {
    if (userId) {
      await this.dataScope.invalidate(userId);
    }
  }
}

/** Предел обхода иерархии руководителей при проверке циклов. */
const MAX_HIERARCHY_DEPTH = 50;

const USER_SELECTION = {
  id: true,
  keycloakSub: true,
  email: true,
  displayName: true,
  role: true,
  roleManagedLocally: true,
  isActive: true,
  managerId: true,
  lastLoginAt: true,
  manager: { select: { displayName: true } },
  scopeRules: { select: { dimension: true, allowedIds: true } },
} as const;

type UserRecord = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  roleManagedLocally: boolean;
  isActive: boolean;
  managerId: string | null;
  lastLoginAt: Date | null;
  manager: { displayName: string } | null;
  scopeRules: Array<{ dimension: ScopeDimension; allowedIds: string[] }>;
};

function toAdminUserDto(record: UserRecord): AdminUserDto {
  return {
    id: record.id,
    email: record.email,
    displayName: record.displayName,
    role: record.role,
    roleSource: record.roleManagedLocally ? 'CRM' : 'KEYCLOAK',
    isActive: record.isActive,
    managerId: record.managerId,
    managerName: record.manager?.displayName ?? null,
    lastLoginAt: record.lastLoginAt,
    scopeRules: record.scopeRules.map((rule) => ({
      dimension: rule.dimension,
      allowedIds: rule.allowedIds,
    })),
  };
}
