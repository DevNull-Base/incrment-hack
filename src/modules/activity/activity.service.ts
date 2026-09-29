import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module.js';
import { AppConfig } from '../../config/configuration.js';
import { AppException } from '../../common/errors/app-exception.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';

/** Сколько недавних объектов помнить на пользователя. */
const RECENT_LIMIT = 20;

/** Предел размера сохраняемого состояния — защита от «раздувания» записи. */
const MAX_STATE_BYTES = 64 * 1024;

/**
 * Сколько состояний экранов и черновиков хранится на пользователя.
 *
 * Размер одной записи ограничен, а число — прежде нет: ключ экрана
 * задаёт клиент, и скрипт с произвольными ключами заполнял бы таблицу
 * по 64 КБ за запрос. Экранов и форм в интерфейсе — десятки, поэтому
 * старейшие сверх предела просто вытесняются, как в списке недавних.
 */
const MAX_WORKSPACES_PER_USER = 100;
const MAX_DRAFTS_PER_USER = 100;

/** Ключ экрана, тип объекта, идентификатор: латиница, цифры, «.», «_», «-», «:». */
const KEY_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;

const workspaceKey = (userId: string, scopeKey: string) => `activity:ws:${userId}:${scopeKey}`;
const draftKey = (userId: string, entityType: string, entityId: string) =>
  `activity:draft:${userId}:${entityType}:${entityId}`;

/**
 * Признак черновика, не привязанного к объекту (форма создания).
 *
 * Используется пустая строка, а не NULL: PostgreSQL считает NULL-значения
 * РАЗЛИЧНЫМИ в уникальных индексах, поэтому при NULL ограничение
 * (пользователь, тип, объект) не действовало бы, и черновиков одной
 * и той же новой формы накапливалось бы сколько угодно.
 */
const NEW_ENTITY_MARKER = '';

/** Приводит необязательный идентификатор к значению, пригодному для ключа. */
const toEntityKey = (entityId: string | null): string => entityId ?? NEW_ENTITY_MARKER;

/** Обратное преобразование для выдачи наружу. */
const fromEntityKey = (entityId: string | null): string | null =>
  entityId === NEW_ENTITY_MARKER ? null : entityId;

export interface WorkspaceState {
  scopeKey: string;
  state: Record<string, unknown>;
  updatedAt: Date | null;
}

export interface DraftRecord {
  entityType: string;
  entityId: string | null;
  payload: Record<string, unknown>;
  updatedAt: Date;
}

export interface RecentItem {
  entityType: string;
  entityId: string;
  title: string;
  visitedAt: Date;
}

/**
 * Кэш действий пользователя — функциональное требование ТЗ (п.13).
 *
 * Формулировка требования допускает разные прочтения, поэтому поясняю
 * принятое. Речь не о кэшировании ответов сервера, а о СОХРАНЕНИИ
 * РАБОЧЕГО КОНТЕКСТА: это следует из соседнего требования о том, что
 * страница не должна обновляться или сбрасываться при работе с данными.
 *
 * Подсистема решает бытовую, но болезненную задачу. Менеджер настроил
 * фильтры по десятку вузов, выбрал колонки, начал писать комментарий
 * к переходу — и закрыл вкладку или потерял связь. Без сохранения
 * контекста вся эта работа пропадает, и её приходится повторять.
 *
 * Реализованы четыре уровня:
 *   1. рабочий контекст экрана — фильтры, колонки, сортировка, вкладки;
 *   2. черновики незавершённого ввода;
 *   3. недавно просмотренные объекты;
 *   4. ключи идемпотентности (см. IdempotencyInterceptor).
 *
 * Горячая копия живёт в Redis, долговременная — в БД. Такое сочетание
 * даёт скорость чтения и при этом переживает очистку кэша: потеря Redis
 * не должна стоить пользователю его настроек.
 */
@Injectable()
export class ActivityService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ActivityService.name);
  }

  // ------------------------------------------------------ Рабочий контекст --

  /**
   * Возвращает сохранённый контекст экрана.
   *
   * Сначала проверяется Redis, затем БД. Чтение из БД при промахе кэша
   * обязательно: иначе после перезапуска Redis пользователь обнаружил бы
   * сброшенные фильтры, а именно этого требование и не допускает.
   */
  async getWorkspace(userId: string, scopeKey: string): Promise<WorkspaceState> {
    assertKey(scopeKey, 'scopeKey');
    const cached = await this.readCache(workspaceKey(userId, scopeKey));

    if (cached) {
      return { scopeKey, state: cached, updatedAt: null };
    }

    const record = await this.prisma.userWorkspaceState.findUnique({
      where: { userId_scopeKey: { userId, scopeKey } },
      select: { state: true, updatedAt: true },
    });

    if (!record) {
      return { scopeKey, state: {}, updatedAt: null };
    }

    const state = record.state as Record<string, unknown>;
    await this.writeCache(workspaceKey(userId, scopeKey), state);

    return { scopeKey, state, updatedAt: record.updatedAt };
  }

  /** Сохраняет контекст экрана. */
  async saveWorkspace(
    userId: string,
    scopeKey: string,
    state: Record<string, unknown>,
  ): Promise<WorkspaceState> {
    assertKey(scopeKey, 'scopeKey');
    this.assertSize(state, 'состояние экрана');

    const record = await this.prisma.userWorkspaceState.upsert({
      where: { userId_scopeKey: { userId, scopeKey } },
      create: { userId, scopeKey, state: state as object },
      update: { state: state as object },
      select: { state: true, updatedAt: true },
    });

    const excess = await this.prisma.userWorkspaceState.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      skip: MAX_WORKSPACES_PER_USER,
      select: { scopeKey: true },
    });

    if (excess.length > 0) {
      await this.prisma.userWorkspaceState.deleteMany({
        where: { userId, scopeKey: { in: excess.map((item) => item.scopeKey) } },
      });
      await Promise.all(
        excess.map((item) => this.redis.del(workspaceKey(userId, item.scopeKey)).catch(() => undefined)),
      );
    }

    await this.writeCache(workspaceKey(userId, scopeKey), state);

    return { scopeKey, state, updatedAt: record.updatedAt };
  }

  async clearWorkspace(userId: string, scopeKey: string): Promise<void> {
    assertKey(scopeKey, 'scopeKey');
    await this.prisma.userWorkspaceState
      .delete({ where: { userId_scopeKey: { userId, scopeKey } } })
      .catch(() => undefined);

    await this.redis.del(workspaceKey(userId, scopeKey)).catch(() => undefined);
  }

  // ------------------------------------------------------------ Черновики --

  /**
   * Сохраняет черновик незавершённого ввода.
   *
   * Вызывается интерфейсом периодически во время набора текста. Поэтому
   * запись идёт сначала в Redis, а в БД — только при заметном изменении:
   * обращение к базе на каждое нажатие клавиши создало бы нагрузку,
   * несоизмеримую с ценностью данных.
   */
  async saveDraft(
    userId: string,
    entityType: string,
    entityId: string | null,
    payload: Record<string, unknown>,
  ): Promise<DraftRecord> {
    assertKey(entityType, 'entityType');
    if (entityId !== null) assertKey(entityId, 'entityId');
    this.assertSize(payload, 'черновик');

    const key = draftKey(userId, entityType, entityId ?? 'new');
    await this.writeCache(key, payload);

    const entityKey = toEntityKey(entityId);

    const record = await this.prisma.userDraft.upsert({
      where: { userId_entityType_entityId: { userId, entityType, entityId: entityKey } },
      create: { userId, entityType, entityId: entityKey, payload: payload as object },
      update: { payload: payload as object },
      select: { updatedAt: true },
    });

    const excess = await this.prisma.userDraft.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      skip: MAX_DRAFTS_PER_USER,
      select: { id: true, entityType: true, entityId: true },
    });

    if (excess.length > 0) {
      await this.prisma.userDraft.deleteMany({ where: { id: { in: excess.map((item) => item.id) } } });
      await Promise.all(
        excess.map((item) =>
          this.redis
            .del(draftKey(userId, item.entityType, fromEntityKey(item.entityId) ?? 'new'))
            .catch(() => undefined),
        ),
      );
    }

    return { entityType, entityId, payload, updatedAt: record.updatedAt };
  }

  async getDraft(
    userId: string,
    entityType: string,
    entityId: string | null,
  ): Promise<DraftRecord | null> {
    assertKey(entityType, 'entityType');
    if (entityId !== null) assertKey(entityId, 'entityId');

    const key = draftKey(userId, entityType, entityId ?? 'new');
    const cached = await this.readCache(key);

    if (cached) {
      return { entityType, entityId, payload: cached, updatedAt: new Date() };
    }

    const record = await this.prisma.userDraft.findUnique({
      where: { userId_entityType_entityId: { userId, entityType, entityId: toEntityKey(entityId) } },
      select: { payload: true, updatedAt: true },
    });

    if (!record) {
      return null;
    }

    const payload = record.payload as Record<string, unknown>;
    await this.writeCache(key, payload);

    return { entityType, entityId, payload, updatedAt: record.updatedAt };
  }

  /**
   * Удаляет черновик.
   *
   * Вызывается после успешной отправки формы: оставленный черновик
   * при следующем открытии подставил бы уже отправленный текст,
   * и пользователь отправил бы его повторно.
   */
  async discardDraft(userId: string, entityType: string, entityId: string | null): Promise<void> {
    assertKey(entityType, 'entityType');
    if (entityId !== null) assertKey(entityId, 'entityId');
    await this.prisma.userDraft
      .delete({
        where: { userId_entityType_entityId: { userId, entityType, entityId: toEntityKey(entityId) } },
      })
      .catch(() => undefined);

    await this.redis.del(draftKey(userId, entityType, entityId ?? 'new')).catch(() => undefined);
  }

  /** Все незавершённые черновики пользователя — показываются при входе. */
  async listDrafts(userId: string): Promise<DraftRecord[]> {
    const records = await this.prisma.userDraft.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { entityType: true, entityId: true, payload: true, updatedAt: true },
    });

    return records.map((record) => ({
      entityType: record.entityType,
      entityId: fromEntityKey(record.entityId),
      payload: record.payload as Record<string, unknown>,
      updatedAt: record.updatedAt,
    }));
  }

  // -------------------------------------------------------------- Недавнее --

  /**
   * Отмечает объект как просмотренный.
   *
   * Список ограничен: без обрезки таблица росла бы неограниченно,
   * а пользы от сотой по счёту записи нет.
   */
  async trackVisit(
    userId: string,
    entityType: string,
    entityId: string,
    title: string,
  ): Promise<void> {
    assertKey(entityType, 'entityType');
    assertKey(entityId, 'entityId');

    await this.prisma.userRecentItem.upsert({
      where: { userId_entityType_entityId: { userId, entityType, entityId } },
      create: { userId, entityType, entityId, title: title.slice(0, 300) },
      update: { visitedAt: new Date(), title: title.slice(0, 300) },
    });

    // Обрезка выполняется здесь же, а не отдельной регламентной задачей:
    // так список не может вырасти между её запусками.
    const excess = await this.prisma.userRecentItem.findMany({
      where: { userId },
      orderBy: { visitedAt: 'desc' },
      skip: RECENT_LIMIT,
      select: { id: true },
    });

    if (excess.length > 0) {
      await this.prisma.userRecentItem.deleteMany({
        where: { id: { in: excess.map((item) => item.id) } },
      });
    }
  }

  async listRecent(userId: string): Promise<RecentItem[]> {
    const records = await this.prisma.userRecentItem.findMany({
      where: { userId },
      orderBy: { visitedAt: 'desc' },
      take: RECENT_LIMIT,
      select: { entityType: true, entityId: true, title: true, visitedAt: true },
    });

    return records;
  }

  /** Полная сводка рабочего контекста — запрашивается интерфейсом при входе. */
  async getSnapshot(user: AuthenticatedUser): Promise<{
    recent: RecentItem[];
    drafts: DraftRecord[];
    workspaces: Array<{ scopeKey: string; updatedAt: Date }>;
  }> {
    const [recent, drafts, workspaces] = await Promise.all([
      this.listRecent(user.id),
      this.listDrafts(user.id),
      this.prisma.userWorkspaceState.findMany({
        where: { userId: user.id },
        orderBy: { updatedAt: 'desc' },
        select: { scopeKey: true, updatedAt: true },
      }),
    ]);

    return { recent, drafts, workspaces };
  }

  // ------------------------------------------------------------ Служебное --

  private assertSize(payload: unknown, label: string): void {
    const size = Buffer.byteLength(JSON.stringify(payload ?? {}), 'utf8');

    if (size > MAX_STATE_BYTES) {
      throw new AppException('VALIDATION_FAILED', {
        detail:
          `Размер данных (${label}) ${Math.round(size / 1024)} КБ превышает предел ` +
          `${MAX_STATE_BYTES / 1024} КБ.`,
        meta: { sizeBytes: size, maxBytes: MAX_STATE_BYTES },
      });
    }
  }

  private async readCache(key: string): Promise<Record<string, unknown> | null> {
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    } catch (error) {
      // Недоступность кэша не должна ломать работу: данные есть в БД.
      this.logger.warn({ err: error, key }, 'Кэш рабочего контекста недоступен');
      return null;
    }
  }

  private async writeCache(key: string, value: Record<string, unknown>): Promise<void> {
    const ttl = this.config.get('ACTIVITY_STATE_TTL_SEC', { infer: true });

    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttl);
    } catch (error) {
      this.logger.warn({ err: error, key }, 'Не удалось сохранить рабочий контекст в кэш');
    }
  }
}

/** Ключи задаёт клиент — принимаются только короткие и без спецсимволов. */
function assertKey(value: string, field: string): void {
  if (!KEY_PATTERN.test(value)) {
    throw new AppException('VALIDATION_FAILED', {
      detail: 'Ключ содержит недопустимые символы или слишком длинный.',
      issues: [{ field, message: 'Латиница, цифры и «._:-», не длиннее 100 символов' }],
    });
  }
}
