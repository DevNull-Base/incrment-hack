import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { PinoLogger } from 'nestjs-pino';
import { Namespace, Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AppConfig } from '../../config/configuration.js';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module.js';
import { JwtVerifierService } from '../auth/jwt-verifier.service.js';
import { UserProvisioningService } from '../auth/user-provisioning.service.js';
import { DataScopeService } from '../access/data-scope.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';

/** Имена событий, отправляемых клиенту. */
export const REALTIME_EVENTS = {
  ENGAGEMENT_UPDATED: 'engagement.updated',
  ENGAGEMENT_ACTIVITY: 'engagement.activity',
  REPORT_PROGRESS: 'report.progress',
  NOTIFICATION: 'notification',
  NOTIFICATION_CREATED: 'notification.created',
} as const;

/** Внутренние события шины приложения, транслируемые в WebSocket. */
export const INTERNAL_EVENTS = {
  /** Учётная запись заблокирована: её подключения закрываются. */
  USER_DEACTIVATED: 'user.deactivated',
  ENGAGEMENT_UPDATED: 'engagement.updated',
  ENGAGEMENT_ACTIVITY: 'engagement.activity',
  REPORT_PROGRESS: 'report.progress',
  NOTIFICATION_CREATED: 'notification.created',
} as const;

export interface EngagementUpdatedEvent {
  engagementId: string;
  /** Кому адресовано событие. Пусто — всем подписчикам карточки. */
  recipientIds?: string[];
  fromStateKey: string | null;
  toStateKey: string;
  toStateLabel: string;
  version: number;
  actorName: string;
  /** Ответственный за заявку — ему адресуется уведомление о смене статуса. */
  ownerId?: string;
  /** Кто выполнил переход: себе уведомление о собственном действии не шлётся. */
  actorId?: string;
  /** Контрагент заявки: вуз либо лицо. Нужен для текста уведомления. */
  counterpartyName?: string;
}

/**
 * В карточке что-то изменилось помимо статуса: заметка, файл, оценка
 * заинтересованности, ответственный, название.
 *
 * Отдельное событие, а не engagement.updated: тот означает смену статуса,
 * и на него подписаны уведомления о переходах. Смешав их, система слала бы
 * уведомление «статус изменён» на каждую заметку.
 */
export interface EngagementActivityEvent {
  engagementId: string;
  /** Кому адресовано событие: ответственному и автору действия. */
  recipientIds: string[];
  /** Тип действия из ленты: NOTE_ADDED, ATTACHMENT_ADDED, INTEREST_CHANGED… */
  type: string;
  actorName: string;
  /** Новая версия карточки, если действие её изменило. */
  version?: number;
}

export interface UserDeactivatedEvent {
  userId: string;
}

export interface NotificationCreatedEvent {
  userId: string;
  subject: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
}

export interface ReportProgressEvent {
  jobId: string;
  requestedById: string;
  status: string;
  progress: number;
  rowCount?: number;
}

/**
 * Канал обновлений реального времени.
 *
 * Назначение — требование ТЗ о том, что страница не должна обновляться
 * или сбрасываться при изменении данных: клиент получает изменения
 * событием и правит нужный фрагмент интерфейса, не перезагружаясь
 * и не теряя введённый текст.
 *
 * Адаптер Redis обязателен при нескольких репликах API: без него событие,
 * порождённое на одном экземпляре, не дойдёт до клиентов, подключённых
 * к другому, и часть пользователей продолжит видеть устаревшие данные.
 */
@WebSocketGateway({
  namespace: '/ws',
  // Список допустимых источников задаётся не здесь, а в ConfiguredIoAdapter:
  // параметры декоратора статичны, а домены фронтенда приходят из
  // конфигурации (CORS_ORIGINS) и должны совпадать с политикой HTTP.
  // Прежнее значение `origin: true` отражало любой источник.
  // Опрос как запасной транспорт: часть корпоративных прокси
  // не пропускает постоянные соединения WebSocket.
  transports: ['websocket', 'polling'],
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly verifier: JwtVerifierService,
    private readonly provisioning: UserProvisioningService,
    private readonly dataScope: DataScopeService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RealtimeGateway.name);
  }

  afterInit(server: Server | Namespace): Promise<void> | void {
    try {
      // Для шлюза с namespace сюда передаётся Namespace, а не корневой
      // Server. Различие существенно: у Namespace поле `adapter` хранит
      // экземпляр адаптера, а у Server это МЕТОД его установки. Вызов
      // на Namespace завершался ошибкой «server.adapter is not a function»,
      // и события не расходились между репликами — при одном экземпляре
      // это оставалось незамеченным.
      const root: Server =
        typeof (server as Server).adapter === 'function'
          ? (server as Server)
          : (server as Namespace).server;

      // Публикация и подписка требуют разных соединений: соединение Redis,
      // переведённое в режим подписки, обычных команд не принимает.
      // duplicate() подключается самостоятельно, вызывать connect() не нужно.
      const pubClient = this.redis.duplicate();
      const subClient = this.redis.duplicate();

      root.adapter(createAdapter(pubClient, subClient));
      this.logger.info('Канал реального времени подключён к Redis');
    } catch (error) {
      // Без адаптера канал продолжает работать в пределах одного процесса.
      // Это деградация, а не отказ: при единственной реплике поведение
      // не отличается, при нескольких — часть клиентов не получит событий.
      this.logger.error(
        { err: error },
        'Не удалось подключить адаптер Redis: события не будут доходить между репликами',
      );
    }
  }

  /**
   * Аутентификация при подключении.
   *
   * Токен передаётся в auth.token рукопожатия, а не в строке запроса:
   * параметры URL попадают в журналы прокси и историю браузера,
   * то есть токен доступа оказался бы записан в открытом виде.
   */
  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = extractToken(client);

      if (this.config.get('AUTH_DEV_BYPASS', { infer: true })) {
        const user = await this.provisioning.devBypassUser();
        await this.joinRooms(client, user);
        return;
      }

      if (!token) {
        client.emit('error', { code: 'CRM-AUT-0001', message: 'Требуется токен доступа' });
        client.disconnect(true);
        return;
      }

      const claims = await this.verifier.verify(token);
      const user = await this.provisioning.resolve(claims);
      await this.joinRooms(client, user);
      this.scheduleExpiry(client, claims.exp);
    } catch (error) {
      this.logger.warn({ err: error, socketId: client.id }, 'Отклонено подключение к каналу обновлений');
      client.emit('error', { code: 'CRM-AUT-0003', message: 'Токен не прошёл проверку' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const timer = (client.data as { expiryTimer?: NodeJS.Timeout }).expiryTimer;

    if (timer) {
      clearTimeout(timer);
    }

    this.logger.debug({ socketId: client.id }, 'Клиент отключился от канала обновлений');
  }

  /**
   * Закрывает подключение, когда истекает токен, с которым оно открыто.
   *
   * Токен проверяется только при рукопожатии, и без этого подключение жило
   * бы сколько угодно после истечения токена — события продолжали бы
   * приходить тому, чей доступ уже отозван. Клиент получает код истечения
   * и переподключается со свежим токеном: в socket.io-client для этого
   * auth задаётся функцией, которая берёт текущий токен.
   */
  private scheduleExpiry(client: Socket, exp: number | undefined): void {
    if (!exp) {
      return;
    }

    const delay = Math.max(0, exp * 1000 - Date.now());

    // Таймер Node.js ограничен ~24 днями; токен Keycloak живёт минуты,
    // а заведомо долгий срок просто не требует досрочного закрытия.
    if (delay > 2_147_000_000) {
      return;
    }

    const timer = setTimeout(() => {
      client.emit('error', { code: 'CRM-AUT-0002', message: 'Срок действия токена истёк' });
      client.disconnect(true);
    }, delay);

    timer.unref();
    (client.data as { expiryTimer?: NodeJS.Timeout }).expiryTimer = timer;
  }

  /**
   * Блокировка учётной записи закрывает все её подключения сразу — на всех
   * репликах, благодаря адаптеру Redis. Иначе заблокированный сотрудник
   * продолжал бы получать уведомления с названиями заявок до тех пор,
   * пока сам не закроет вкладку.
   */
  @OnEvent(INTERNAL_EVENTS.USER_DEACTIVATED)
  disconnectUser(event: UserDeactivatedEvent): void {
    if (!this.server) return;

    this.server.in(userRoom(event.userId)).emit('error', {
      code: 'CRM-AUT-0004',
      message: 'Учётная запись заблокирована',
    });
    this.server.in(userRoom(event.userId)).disconnectSockets(true);
  }

  /**
   * Размещает подключение в комнатах.
   *
   * Комната на пользователя — для адресных событий (прогресс отчёта,
   * уведомления). Комната на область видимости — для событий по данным:
   * пользователи с одинаковыми правами получают одни и те же изменения,
   * а разграничение доступа при этом не нарушается, поскольку отпечаток
   * прав входит в имя комнаты.
   */
  private async joinRooms(client: Socket, user: AuthenticatedUser): Promise<void> {
    const scope = await this.dataScope.resolve(user);

    client.data.user = user;
    await client.join(userRoom(user.id));
    await client.join(scopeRoom(scope.fingerprint));

    client.emit('connected', {
      userId: user.id,
      displayName: user.displayName,
      role: user.role,
    });

    this.logger.debug({ socketId: client.id, userId: user.id }, 'Клиент подключён к каналу обновлений');
  }

  /**
   * Транслирует изменение статуса взаимодействия.
   *
   * Событие адресуется конкретным пользователям, а не рассылается всем:
   * широковещательная рассылка означала бы, что клиент узнаёт об изменениях
   * в карточках, которые ему недоступны, — то есть утечку самим фактом
   * существования записи.
   */
  @OnEvent(INTERNAL_EVENTS.ENGAGEMENT_UPDATED)
  emitEngagementUpdated(event: EngagementUpdatedEvent): void {
    if (!this.server) return;

    const payload = {
      engagementId: event.engagementId,
      fromStateKey: event.fromStateKey,
      toStateKey: event.toStateKey,
      toStateLabel: event.toStateLabel,
      version: event.version,
      actorName: event.actorName,
      at: new Date().toISOString(),
    };

    for (const recipientId of event.recipientIds ?? []) {
      this.server.to(userRoom(recipientId)).emit(REALTIME_EVENTS.ENGAGEMENT_UPDATED, payload);
    }
  }

  /**
   * Изменение карточки помимо статуса — тем же адресатам, что и смена статуса.
   * Клиент по нему перечитывает заметки, файлы или шапку карточки.
   */
  @OnEvent(INTERNAL_EVENTS.ENGAGEMENT_ACTIVITY)
  emitEngagementActivity(event: EngagementActivityEvent): void {
    if (!this.server) return;

    const payload = {
      engagementId: event.engagementId,
      type: event.type,
      actorName: event.actorName,
      version: event.version ?? null,
      at: new Date().toISOString(),
    };

    for (const recipientId of new Set(event.recipientIds)) {
      this.server.to(userRoom(recipientId)).emit(REALTIME_EVENTS.ENGAGEMENT_ACTIVITY, payload);
    }
  }

  /**
   * Новое уведомление — только его адресату.
   *
   * Пользователь видит напоминание сразу, без опроса сервера: счётчик
   * непрочитанных иначе обновлялся бы только при перезагрузке страницы.
   */
  @OnEvent(INTERNAL_EVENTS.NOTIFICATION_CREATED)
  emitNotification(event: NotificationCreatedEvent): void {
    if (!this.server) return;

    this.server.to(userRoom(event.userId)).emit(REALTIME_EVENTS.NOTIFICATION_CREATED, {
      subject: event.subject,
      body: event.body,
      entityType: event.entityType,
      entityId: event.entityId,
      at: new Date().toISOString(),
    });
  }

  /** Прогресс формирования отчёта — только его заказчику. */
  @OnEvent(INTERNAL_EVENTS.REPORT_PROGRESS)
  emitReportProgress(event: ReportProgressEvent): void {
    if (!this.server) return;

    this.server.to(userRoom(event.requestedById)).emit(REALTIME_EVENTS.REPORT_PROGRESS, {
      jobId: event.jobId,
      status: event.status,
      progress: event.progress,
      rowCount: event.rowCount ?? null,
      at: new Date().toISOString(),
    });
  }
}

const userRoom = (userId: string) => `user:${userId}`;
const scopeRoom = (fingerprint: string) => `scope:${fingerprint}`;

/** Извлекает токен из рукопожатия. */
function extractToken(client: Socket): string | null {
  const fromAuth = (client.handshake.auth as { token?: unknown } | undefined)?.token;
  if (typeof fromAuth === 'string' && fromAuth.length > 0) {
    return fromAuth.replace(/^Bearer\s+/i, '');
  }

  const header = client.handshake.headers.authorization;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7);
  }

  return null;
}
