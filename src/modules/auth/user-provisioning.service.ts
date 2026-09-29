import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module.js';
import { AppConfig } from '../../config/configuration.js';
import { AppException } from '../../common/errors/app-exception.js';
import { AUDIT_ACTIONS, AuditService } from '../audit/audit.service.js';
import {
  AuthenticatedUser,
  KeycloakClaims,
  resolveDisplayName,
  resolveRole,
} from './authenticated-user.js';

/** Время жизни профиля пользователя в кэше. */
const PROFILE_CACHE_TTL_SEC = 300;

/**
 * Окно, в пределах которого повторные обращения считаются одним сеансом.
 *
 * Совпадает с ssoSessionIdleTimeout в Keycloak (30 минут): токен живёт
 * 15 минут и молча обновляется, поэтому «вход» как отдельное событие
 * на стороне API не наблюдается вовсе. Событие LOGIN фиксируется при
 * первом за это окно обращении — это и есть начало сеанса работы.
 *
 * Без такого окна журнал заполнился бы записью каждые пять минут
 * на каждого активного пользователя, и найти в нём настоящие входы
 * стало бы невозможно.
 */
const SESSION_WINDOW_SEC = 1800;

const cacheKey = (sub: string) => `auth:profile:${sub}`;
const sessionKey = (sub: string) => `auth:session:${sub}`;

/**
 * Сопоставление учётной записи Keycloak с локальной записью AppUser.
 *
 * Применяется подход just-in-time provisioning: пользователь заводится
 * в системе при первом обращении с валидным токеном. Это избавляет
 * администратора от ручного дублирования учётных записей, уже заведённых
 * в Keycloak, и исключает расхождение двух списков пользователей.
 *
 * Роль синхронизируется из Keycloak при каждом входе — до тех пор, пока её
 * не назначит администратор в самой системе. После этого действует роль,
 * назначенная в CRM: иначе понизить права через систему было бы нельзя —
 * сброс кэша профиля при смене роли заставлял заново прочитать её из токена,
 * и изменение откатывалось на первом же запросе пользователя.
 */
@Injectable()
export class UserProvisioningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly audit: AuditService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(UserProvisioningService.name);
  }

  async resolve(claims: KeycloakClaims): Promise<AuthenticatedUser> {
    const cached = await this.readCache(claims.sub);
    if (cached) {
      return cached;
    }

    const user = await this.upsert(claims);
    await this.writeCache(user);
    await this.recordSessionStart(user);
    return user;
  }

  /** Сбрасывает кэш профиля — вызывается при изменении роли или блокировке. */
  async invalidate(keycloakSub: string): Promise<void> {
    await this.redis.del(cacheKey(keycloakSub)).catch((error: unknown) => {
      // Недоступность кэша не должна ломать операцию: худшее последствие —
      // профиль обновится через PROFILE_CACHE_TTL_SEC.
      this.logger.warn({ err: error }, 'Не удалось сбросить кэш профиля пользователя');
    });
  }

  private async upsert(claims: KeycloakClaims): Promise<AuthenticatedUser> {
    const role = resolveRole(claims.realm_access?.roles);
    const displayName = resolveDisplayName(claims);
    const email = claims.email ?? `${claims.preferred_username ?? claims.sub}@unknown.local`;

    const profileFields = { email, displayName, role, lastLoginAt: new Date() };
    const selection = {
      id: true,
      keycloakSub: true,
      email: true,
      displayName: true,
      role: true,
      managerId: true,
      isActive: true,
    } as const;

    // Роль из токена не перекрывает роль, назначенную администратором в CRM.
    const { role: tokenRole, ...otherProfileFields } = profileFields;
    const profileFor = (roleManagedLocally: boolean) =>
      roleManagedLocally || tokenRole === null ? otherProfileFields : { ...otherProfileFields, role: tokenRole };

    // Без роли CRM в токене вход разрешён только сотруднику, которому роль
    // назначил администратор в самой CRM. Остальным — отказ, и запись
    // о них не заводится.
    const denyWithoutRole = async (existing: { id: string; roleManagedLocally: boolean } | null) => {
      if (tokenRole !== null || existing?.roleManagedLocally) {
        return;
      }

      if (existing) {
        await this.audit.record({
          actorId: existing.id,
          actorEmail: email,
          action: AUDIT_ACTIONS.LOGIN_DENIED,
          entityType: 'AppUser',
          entityId: existing.id,
          afterState: { reason: 'В токене нет роли CRM' },
        });
      }

      this.logger.warn({ keycloakSub: claims.sub }, 'Отказ во входе: в токене нет роли CRM');
      throw new AppException('NO_CRM_ROLE');
    };

    // Шаг 1: обычный случай — пользователь уже сопоставлен с учётной записью.
    const bySub = await this.prisma.appUser.findUnique({
      where: { keycloakSub: claims.sub },
      select: { id: true, roleManagedLocally: true },
    });

    let record;

    if (bySub) {
      await denyWithoutRole(bySub);

      record = await this.prisma.appUser.update({
        where: { id: bySub.id },
        // managerId намеренно НЕ трогаем: иерархия подчинённости ведётся
        // в CRM руководителем, а не в каталоге учётных записей.
        data: profileFor(bySub.roleManagedLocally),
        select: selection,
      });
    } else {
      // Шаг 2: записи с таким `sub` нет, но пользователь с этим адресом
      // может уже существовать. Так бывает, когда запись создана заранее
      // (демонстрационные данные, предварительная настройка иерархии)
      // либо учётную запись пересоздали в Keycloak — тогда у того же
      // человека появляется новый `sub`.
      //
      // Без этой ветки upsert по keycloakSub уходил бы в создание записи
      // и падал на уникальности email, а пользователь получал бы отказ
      // с невнятной ошибкой «дубликат записи каталога».
      //
      // Сопоставление по адресу безопасно: источник истины по учётным
      // записям — Keycloak, где адреса уникальны (duplicateEmailsAllowed
      // отключён), а токен уже прошёл проверку подписи.
      //
      // Но только для подтверждённого адреса. Почту в Keycloak пользователь
      // может сменить сам, и неподтверждённый адрес — это просто строка,
      // которую он вписал. Без проверки новая учётная запись с чужим адресом
      // занимала бы запись CRM, заведённую заранее или оставшуюся после
      // удаления прежней учётной записи, — вместе с её ролью и заявками.
      const byEmail = await this.prisma.appUser.findUnique({
        where: { email },
        select: { id: true, roleManagedLocally: true },
      });

      if (byEmail && claims.email_verified !== true) {
        this.logger.warn(
          { keycloakSub: claims.sub, appUserId: byEmail.id },
          'Отказ в привязке учётной записи: адрес почты не подтверждён',
        );

        throw new AppException('FORBIDDEN', {
          detail:
            'Адрес почты учётной записи не подтверждён, а в системе уже есть сотрудник ' +
            'с таким адресом. Обратитесь к администратору.',
        });
      }

      await denyWithoutRole(byEmail);

      record = byEmail
        ? await this.prisma.appUser.update({
            where: { id: byEmail.id },
            data: { ...profileFor(byEmail.roleManagedLocally), keycloakSub: claims.sub },
            select: selection,
          })
        : await this.prisma.appUser.create({
            // Роль из токена здесь заведомо есть: без неё denyWithoutRole отказал выше.
            data: { keycloakSub: claims.sub, ...otherProfileFields, role: tokenRole ?? 'USER' },
            select: selection,
          });
    }

    if (!record.isActive) {
      // Отказ во входе фиксируется обязательно: попытки обращения
      // с отключённой учётной записи — типовой признак того, что токен
      // остался у уволенного сотрудника либо был скомпрометирован.
      await this.audit.record({
        actorId: record.id,
        actorEmail: record.email,
        action: AUDIT_ACTIONS.LOGIN_DENIED,
        entityType: 'AppUser',
        entityId: record.id,
        afterState: { reason: 'Учётная запись деактивирована' },
      });

      throw new AppException('USER_DISABLED', {
        detail: 'Учётная запись деактивирована администратором системы.',
      });
    }

    return {
      id: record.id,
      keycloakSub: record.keycloakSub,
      email: record.email,
      displayName: record.displayName,
      role: record.role,
      managerId: record.managerId,
    };
  }

  /**
   * Фиксирует начало сеанса работы (мера РСБ: регистрация входа в систему).
   *
   * Ключ занимается атомарно, командой SET NX: при параллельных запросах
   * одного пользователя запись о входе создаст ровно один из них. Без NX
   * пара одновременных вкладок браузера дала бы два события входа.
   *
   * Недоступность Redis не должна ни ломать вход, ни приводить к молчаливой
   * потере события: в этом случае вход записывается без дедупликации.
   */
  private async recordSessionStart(user: AuthenticatedUser): Promise<void> {
    let isNewSession = true;

    try {
      const claimed = await this.redis.set(
        sessionKey(user.keycloakSub),
        new Date().toISOString(),
        'EX',
        SESSION_WINDOW_SEC,
        'NX',
      );
      isNewSession = claimed !== null;
    } catch (error) {
      this.logger.warn({ err: error }, 'Кэш сеансов недоступен: вход фиксируется без дедупликации');
    }

    if (!isNewSession) {
      return;
    }

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTIONS.LOGIN,
      entityType: 'AppUser',
      entityId: user.id,
      afterState: { role: user.role },
    });
  }

  private async readCache(sub: string): Promise<AuthenticatedUser | null> {
    try {
      const raw = await this.redis.get(cacheKey(sub));
      return raw ? (JSON.parse(raw) as AuthenticatedUser) : null;
    } catch (error) {
      // Работаем в деградированном режиме: без кэша, но с доступом к данным.
      this.logger.warn({ err: error }, 'Кэш профилей недоступен, читаем из БД');
      return null;
    }
  }

  private async writeCache(user: AuthenticatedUser): Promise<void> {
    try {
      await this.redis.set(cacheKey(user.keycloakSub), JSON.stringify(user), 'EX', PROFILE_CACHE_TTL_SEC);
    } catch (error) {
      this.logger.warn({ err: error }, 'Не удалось сохранить профиль в кэш');
    }
  }

  /**
   * Фиктивный пользователь для локальной разработки без Keycloak.
   * Включается только через AUTH_DEV_BYPASS, который запрещён в production
   * проверкой конфигурации на старте.
   */
  async devBypassUser(): Promise<AuthenticatedUser> {
    const role = this.config.get('AUTH_DEV_BYPASS_ROLE', { infer: true });

    return this.resolve({
      sub: 'dev-bypass-user',
      email: 'dev@localhost',
      preferred_username: 'dev',
      name: 'Разработчик (обход аутентификации)',
      realm_access: { roles: [role] },
    });
  }
}
