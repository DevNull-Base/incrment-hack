import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PinoLogger } from 'nestjs-pino';
import { Prisma } from '../../generated/prisma/client.js';
import { NotificationChannel } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { AUDIT_ACTIONS, AuditService } from '../audit/audit.service.js';
import { PageDto, toPage } from '../../common/dto/pagination.dto.js';
import {
  NotificationChannelTransport,
  OutgoingNotification,
} from './channels/notification-channel.js';
import {
  ChannelSettingsDto,
  NotificationDto,
  NotificationQueryDto,
  NotificationSettingsDto,
  UpdateChannelDto,
  UpdatePolicyDto,
} from './dto/notification.dto.js';

/** Замена значения секрета в ответах API. */
export const SECRET_MASK = '••••••';

/**
 * Настройка, значение которой не показывается после сохранения.
 *
 * Определяется по смыслу имени, а не по точному списку: список из четырёх
 * имён пропускал всё остальное, и пароль почтового узла под именем
 * smtpPassword возвращался открытым текстом. Экспортируется ради тестов.
 */
export function isSecretSetting(key: string): boolean {
  return /pass|secret|token|key/i.test(key);
}

/**
 * Значение секрета, которое означает «оставить прежнее».
 *
 * Пустое — если поле не трогали. Маска — если форма, открытая с уже
 * сохранённым токеном, отправила обратно то, что ей показали: прежде
 * такое сохранение заменяло настоящий токен шестью точками, и канал
 * молча переставал работать.
 */
export function keepsStoredSecret(value: unknown): boolean {
  return value === '' || value === null || value === undefined || value === SECRET_MASK;
}

/**
 * Допустимые параметры каналов.
 *
 * Список закрытый: настройки канала — это то, чем сервер пользуется при
 * обращении наружу, и произвольный ключ в них либо ничего не значит,
 * либо (как бывший apiUrl) меняет адрес, на который уходит токен.
 */
const CHANNEL_SETTING_KEYS: Record<NotificationChannel, readonly string[]> = {
  IN_APP: [],
  EMAIL: ['host', 'port', 'from', 'user', 'smtpPassword', 'secure'],
  TELEGRAM: ['botToken', 'chatId'],
  MAX: ['botToken', 'chatId'],
};

/** Длина значения настройки: токены и адреса короче, остальное — ошибка ввода. */
const MAX_SETTING_LENGTH = 500;

/** Правила уведомлений. Строка в таблице всегда одна. */
const POLICY_ID = 1;

export interface NotifyRequest {
  userId: string;
  subject: string;
  body: string;
  entityType?: string | null;
  entityId?: string | null;
  /**
   * Основа ключа повторной отправки. Канал добавляется к нему самим
   * сервисом: одно и то же событие уходит несколькими каналами, и общий
   * ключ на все каналы подавил бы все доставки, кроме первой.
   */
  dedupeKey?: string | null;
}

/**
 * Уведомления пользователей.
 *
 * Требование появилось на сессии вопросов и ответов: заявка, застрявшая
 * в одном статусе, должна сама напомнить о себе. В техническом задании
 * уведомлений нет, поэтому ограничений формата тоже нет — выбран порядок,
 * при котором система остаётся работоспособной в закрытом контуре:
 * уведомление всегда сохраняется внутри системы, а внешние каналы
 * подключаются по мере настройки и их недоступность ничего не ломает.
 */
@Injectable()
export class NotificationService {
  private readonly transports = new Map<NotificationChannel, NotificationChannelTransport>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
    private readonly logger: PinoLogger,
    transports: NotificationChannelTransport[],
  ) {
    this.logger.setContext(NotificationService.name);

    for (const transport of transports) {
      this.transports.set(transport.channel, transport);
    }
  }

  /** Список уведомлений пользователя. */
  async list(
    userId: string,
    query: NotificationQueryDto,
  ): Promise<PageDto<NotificationDto>> {
    const where: Prisma.NotificationWhereInput = {
      userId,
      // По умолчанию показываются уведомления внутри системы: записи
      // по внешним каналам — это журнал доставки того же события,
      // и в списке пользователя они выглядели бы дублями.
      channel: query.channel ?? 'IN_APP',
      ...(query.onlyUnread ? { readAt: null } : {}),
    };

    const [total, records] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
    ]);

    return toPage(
      records.map((item) => ({
        id: item.id.toString(),
        channel: item.channel,
        subject: item.subject,
        body: item.body,
        entityType: item.entityType,
        entityId: item.entityId,
        readAt: item.readAt,
        sentAt: item.sentAt,
        deliveryError: item.deliveryError,
        createdAt: item.createdAt,
      })),
      total,
      query,
    );
  }

  /** Число непрочитанных — для счётчика в интерфейсе. */
  async unreadCount(userId: string): Promise<{ unread: number }> {
    const unread = await this.prisma.notification.count({
      where: { userId, channel: 'IN_APP', readAt: null },
    });

    return { unread };
  }

  /**
   * Отметка о прочтении.
   *
   * Условие по пользователю входит в UPDATE, а не проверяется заранее:
   * иначе между проверкой и записью оставался бы зазор, в котором чужое
   * уведомление можно было бы отметить прочитанным.
   */
  async markRead(userId: string, id: string): Promise<void> {
    // Условия «ещё не прочитано» здесь намеренно нет: повторная отметка —
    // обычное дело при повторе запроса или открытии в двух вкладках,
    // и отвечать на неё отказом означало бы показывать пользователю ошибку
    // там, где всё в порядке. Дата прочтения при этом не сдвигается.
    const updated = await this.prisma.notification.updateMany({
      where: { id: BigInt(id), userId, readAt: null },
      data: { readAt: new Date() },
    });

    if (updated.count > 0) {
      return;
    }

    const exists = await this.prisma.notification.count({
      where: { id: BigInt(id), userId },
    });

    if (exists > 0) {
      return;
    }

    // Чужое и несуществующее уведомление отвечают одинаково: иначе
    // по коду ответа устанавливался бы факт существования записи.
    throw new AppException('NOT_FOUND', { detail: 'Уведомление не найдено.' });
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });

    return { updated: result.count };
  }

  /**
   * Отправка уведомления по всем включённым каналам.
   *
   * Уведомление внутри системы создаётся всегда, даже если все внешние
   * каналы выключены: без этого напоминание о зависшей заявке существовало
   * бы только в журнале сервера и до пользователя не дошло бы вовсе.
   */
  async notify(request: NotifyRequest): Promise<{ created: number }> {
    const recipient = await this.prisma.appUser.findUnique({
      where: { id: request.userId },
      select: { id: true, displayName: true, email: true, isActive: true },
    });

    if (!recipient || !recipient.isActive) {
      return { created: 0 };
    }

    const channels = await this.resolveTargetChannels();
    let created = 0;

    for (const { channel, settings } of channels) {
      const dedupeKey = request.dedupeKey ? `${request.dedupeKey}:${channel}` : null;

      // Повтор отсекается до доставки: иначе внешний сервис получал бы
      // сообщение заново при каждом прогоне планировщика, а запись
      // отбрасывалась бы уже после отправки.
      if (dedupeKey) {
        const existing = await this.prisma.notification.findUnique({
          where: { dedupeKey },
          select: { id: true },
        });

        if (existing) {
          continue;
        }
      }

      const message: OutgoingNotification = {
        subject: request.subject,
        body: request.body,
        recipient: {
          id: recipient.id,
          displayName: recipient.displayName,
          email: recipient.email,
        },
        entityType: request.entityType,
        entityId: request.entityId,
      };

      const transport = this.transports.get(channel);
      const result = transport
        ? await transport.send(message, settings)
        : { delivered: false, detail: `Канал ${channel} не поддерживается сборкой.` };

      try {
        await this.prisma.notification.create({
          data: {
            userId: recipient.id,
            channel,
            subject: request.subject,
            body: request.body,
            entityType: request.entityType ?? null,
            entityId: request.entityId ?? null,
            sentAt: result.delivered ? new Date() : null,
            deliveryError: result.delivered ? null : (result.detail ?? 'Доставка не выполнена'),
            dedupeKey,
          },
        });

        created += 1;
      } catch (error: unknown) {
        // Гонка на уникальном ключе: другой процесс успел записать то же
        // уведомление. Это штатный исход при нескольких репликах worker.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          continue;
        }

        throw error;
      }
    }

    if (created > 0) {
      // Интерфейс узнаёт о новом уведомлении сразу, без опроса сервера.
      this.events.emit('notification.created', {
        userId: recipient.id,
        subject: request.subject,
        body: request.body,
        entityType: request.entityType ?? null,
        entityId: request.entityId ?? null,
      });
    }

    return { created };
  }

  /** Текущие правила и состояние каналов. */
  async getSettings(): Promise<NotificationSettingsDto> {
    const policy = await this.ensurePolicy();
    const configs = await this.ensureChannelConfigs();

    return {
      escalationDays: policy.escalationDays,
      notifyOwnerOnTransition: policy.notifyOwnerOnTransition,
      notifyManagerOnEscalation: policy.notifyManagerOnEscalation,
      channels: configs.map((config) => this.describeChannel(config)),
    };
  }

  async updatePolicy(dto: UpdatePolicyDto, actor: { id: string; email: string }): Promise<NotificationSettingsDto> {
    const before = await this.ensurePolicy();

    await this.prisma.notificationPolicy.update({
      where: { id: POLICY_ID },
      data: {
        ...(dto.escalationDays !== undefined ? { escalationDays: dto.escalationDays } : {}),
        ...(dto.notifyOwnerOnTransition !== undefined
          ? { notifyOwnerOnTransition: dto.notifyOwnerOnTransition }
          : {}),
        ...(dto.notifyManagerOnEscalation !== undefined
          ? { notifyManagerOnEscalation: dto.notifyManagerOnEscalation }
          : {}),
      },
    });

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: AUDIT_ACTIONS.NOTIFICATION_SETTINGS_CHANGE,
      entityType: 'NotificationPolicy',
      entityId: String(POLICY_ID),
      beforeState: {
        escalationDays: before.escalationDays,
        notifyOwnerOnTransition: before.notifyOwnerOnTransition,
        notifyManagerOnEscalation: before.notifyManagerOnEscalation,
      },
      afterState: { ...dto },
    });

    return this.getSettings();
  }

  /**
   * Настройка канала.
   *
   * Значения секретов сохраняются, но наружу больше не отдаются. Пустое
   * значение секрета означает «оставить прежний»: иначе форма, открытая
   * с замаскированным токеном, стирала бы его при первом же сохранении
   * любой другой настройки.
   */
  async updateChannel(
    channel: NotificationChannel,
    dto: UpdateChannelDto,
    actor: { id: string; email: string },
  ): Promise<ChannelSettingsDto> {
    const configs = await this.ensureChannelConfigs();
    const current = configs.find((item) => item.channel === channel);
    const currentSettings = (current?.settings ?? {}) as Record<string, unknown>;

    assertChannelSettings(channel, dto.settings ?? {});

    // Ключи, которых больше нет в списке допустимых (прежний apiUrl),
    // из сохранённых настроек убираются при первом же сохранении.
    const allowed = CHANNEL_SETTING_KEYS[channel] ?? [];
    const settings: Record<string, unknown> = Object.fromEntries(
      Object.entries(currentSettings).filter(([key]) => allowed.includes(key)),
    );

    for (const [key, value] of Object.entries(dto.settings ?? {})) {
      if (isSecretSetting(key) && keepsStoredSecret(value)) {
        continue;
      }

      settings[key] = value;
    }

    const updated = await this.prisma.notificationChannelConfig.upsert({
      where: { channel },
      create: {
        channel,
        isEnabled: dto.isEnabled ?? false,
        settings: settings as Prisma.InputJsonValue,
      },
      update: {
        ...(dto.isEnabled !== undefined ? { isEnabled: dto.isEnabled } : {}),
        settings: settings as Prisma.InputJsonValue,
      },
    });

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: AUDIT_ACTIONS.NOTIFICATION_SETTINGS_CHANGE,
      entityType: 'NotificationChannelConfig',
      entityId: channel,
      beforeState: { isEnabled: current?.isEnabled ?? false },
      // Состав настроек, но не значения: токен бота в журнале аудита —
      // это тот же секрет, только в неожиданном месте.
      afterState: { isEnabled: updated.isEnabled, keys: Object.keys(settings) },
    });

    return this.describeChannel(updated);
  }

  /** Проверочное сообщение: показывает, доходит ли канал до адресата. */
  async sendTest(
    channel: NotificationChannel,
    actor: { id: string; displayName: string; email: string },
  ): Promise<ChannelSettingsDto> {
    const configs = await this.ensureChannelConfigs();
    const config = configs.find((item) => item.channel === channel);
    const settings = (config?.settings ?? {}) as Record<string, unknown>;
    const transport = this.transports.get(channel);

    if (!transport) {
      throw new AppException('VALIDATION_FAILED', {
        detail: `Канал ${channel} не поддерживается сборкой.`,
      });
    }

    const result = await transport.send(
      {
        subject: 'Проверка канала уведомлений',
        body:
          'Это проверочное сообщение CRM ИТ Школы РТК. Если оно получено, ' +
          'канал настроен верно.',
        recipient: { id: actor.id, displayName: actor.displayName, email: actor.email },
      },
      settings,
    );

    await this.prisma.notification.create({
      data: {
        userId: actor.id,
        channel,
        subject: 'Проверка канала уведомлений',
        body: 'Проверочное сообщение, отправленное администратором.',
        sentAt: result.delivered ? new Date() : null,
        deliveryError: result.delivered ? null : (result.detail ?? 'Доставка не выполнена'),
      },
    });

    return {
      ...this.describeChannel(config ?? { channel, isEnabled: false, settings: {} }),
      lastTestDelivered: result.delivered,
      lastTestDetail: result.detail ?? null,
    };
  }

  /** Действующие правила. Строка создаётся, если её ещё нет. */
  async ensurePolicy(): Promise<{
    escalationDays: number;
    notifyOwnerOnTransition: boolean;
    notifyManagerOnEscalation: boolean;
  }> {
    // Строка правил заводится один раз, дальше только читается. Прежде здесь
    // был upsert на каждое событие — транзакция из нескольких операторов
    // ради одного чтения, и так на каждом переходе по этапу.
    const policy =
      (await this.prisma.notificationPolicy.findUnique({ where: { id: POLICY_ID } })) ??
      (await this.prisma.notificationPolicy.upsert({
        where: { id: POLICY_ID },
        create: { id: POLICY_ID },
        update: {},
      }));

    return {
      escalationDays: policy.escalationDays,
      notifyOwnerOnTransition: policy.notifyOwnerOnTransition,
      notifyManagerOnEscalation: policy.notifyManagerOnEscalation,
    };
  }

  /**
   * Каналы, по которым уходит уведомление.
   *
   * Внутрисистемный канал присутствует всегда и выключению не подлежит:
   * это единственный способ доставки, не зависящий от внешних сервисов.
   */
  private async resolveTargetChannels(): Promise<
    Array<{ channel: NotificationChannel; settings: Record<string, unknown> }>
  > {
    const configs = await this.ensureChannelConfigs();

    return configs
      .filter((config) => config.channel === 'IN_APP' || config.isEnabled)
      .map((config) => ({
        channel: config.channel,
        settings: (config.settings ?? {}) as Record<string, unknown>,
      }));
  }

  /** Строки настроек каналов; отсутствующие заводятся выключенными. */
  private async ensureChannelConfigs(): Promise<
    Array<{ channel: NotificationChannel; isEnabled: boolean; settings: unknown }>
  > {
    const known: NotificationChannel[] = ['IN_APP', 'EMAIL', 'TELEGRAM', 'MAX'];
    const existing = await this.prisma.notificationChannelConfig.findMany();
    const missing = known.filter(
      (channel) => !existing.some((item) => item.channel === channel),
    );

    if (missing.length > 0) {
      await this.prisma.notificationChannelConfig.createMany({
        data: missing.map((channel) => ({
          channel,
          // Внутрисистемный канал работает сразу; внешние включает
          // администратор после настройки подключения.
          isEnabled: channel === 'IN_APP',
        })),
        skipDuplicates: true,
      });

      return this.prisma.notificationChannelConfig.findMany();
    }

    return existing;
  }

  /** Состояние канала для интерфейса — без значений секретов. */
  private describeChannel(config: {
    channel: NotificationChannel;
    isEnabled: boolean;
    settings: unknown;
  }): ChannelSettingsDto {
    const settings = (config.settings ?? {}) as Record<string, unknown>;
    const transport = this.transports.get(config.channel);
    const readiness = transport?.describeReadiness(settings) ?? {
      ready: false,
      detail: 'Канал не поддерживается сборкой.',
    };

    const visible: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(settings)) {
      visible[key] = isSecretSetting(key) && value ? SECRET_MASK : value;
    }

    return {
      channel: config.channel,
      isEnabled: config.isEnabled,
      ready: readiness.ready,
      readinessDetail: readiness.detail ?? null,
      settings: visible,
      lastTestDelivered: null,
      lastTestDetail: null,
    };
  }
}

/** Проверка настроек канала: только известные ключи и простые значения. */
function assertChannelSettings(channel: NotificationChannel, settings: Record<string, unknown>): void {
  const allowed = CHANNEL_SETTING_KEYS[channel] ?? [];
  const issues: Array<{ field: string; message: string }> = [];

  for (const [key, value] of Object.entries(settings)) {
    if (!allowed.includes(key)) {
      issues.push({
        field: `settings.${key}`,
        message:
          allowed.length > 0
            ? `Неизвестный параметр канала. Допустимы: ${allowed.join(', ')}`
            : 'У этого канала нет настраиваемых параметров',
      });
      continue;
    }

    const scalar = value === null || ['string', 'number', 'boolean'].includes(typeof value);

    if (!scalar || (typeof value === 'string' && value.length > MAX_SETTING_LENGTH)) {
      issues.push({
        field: `settings.${key}`,
        message: `Ожидается строка, число или логическое значение не длиннее ${MAX_SETTING_LENGTH} символов`,
      });
    }
  }

  if (issues.length > 0) {
    throw new AppException('VALIDATION_FAILED', {
      detail: 'Настройки канала заполнены неверно.',
      issues,
    });
  }
}
