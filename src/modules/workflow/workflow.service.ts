import { Injectable } from '@nestjs/common';
import { assertNotArchived } from '../engagement/archive-guard.js';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PinoLogger } from 'nestjs-pino';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { AUDIT_ACTIONS, AuditService } from '../audit/audit.service.js';
import { DataScopeService, engagementScopeFilter } from '../access/data-scope.service.js';
import { enqueueEngagementEvent } from '../integration/outbox.js';
import { recordActivity } from '../activity/activity-log.js';
import { assertTemplateStillActive, lockAgainstPublish } from './workflow-lock.js';
import {
  WorkflowDefinition,
  findState,
  initialState,
  transitionsFrom,
  workflowDefinitionSchema,
} from './workflow-definition.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import type { EngagementSegment } from '../engagement/dto/engagement.dto.js';

/** Итог системного перехода — для аудита и уведомлений после фиксации. */
export interface SystemTransitionResult {
  engagementId: string;
  ownerId: string;
  fromStateKey: string;
  toStateKey: string;
  toStateLabel: string;
  version: number;
  comment: string;
}

/** Этап заявки: ключ статуса и его подпись в действующей схеме. */
export interface EngagementStage {
  key: string;
  label: string;
}

/** Результат выполнения перехода. */
export interface TransitionResult {
  engagementId: string;
  fromStateKey: string | null;
  toStateKey: string;
  toStateLabel: string;
  version: number;
  slaDueAt: Date | null;
}

/**
 * Движок процессов.
 *
 * Определения хранятся данными (JSONB), а не кодом, поэтому администратор
 * меняет состав статусов и правила переходов без участия разработчика —
 * это прямое требование ТЗ о возможности создавать и корректировать workflow.
 */
@Injectable()
export class WorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly dataScope: DataScopeService,
    private readonly events: EventEmitter2,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WorkflowService.name);
  }

  /**
   * Разобранные определения неизменяемых редакций по идентификатору.
   *
   * Карточка и переход читали определение процесса из базы и проверяли его
   * схемой на каждом обращении. Редакцию, по которой ведутся заявки,
   * изменить нельзя — правится только черновик (updateTemplate отклоняет
   * действующую и опубликованную), поэтому её разбор кэшируется навсегда.
   * Черновики не кэшируются: на них заявки не ссылаются, а правятся они.
   */
  private readonly definitions = new Map<string, WorkflowDefinition>();

  async definitionOf(templateId: string): Promise<WorkflowDefinition> {
    const cached = this.definitions.get(templateId);
    if (cached) {
      return cached;
    }

    const template = await this.prisma.workflowTemplate.findUnique({
      where: { id: templateId },
      select: { definition: true, isActive: true, publishedAt: true },
    });

    if (!template) {
      throw new AppException('NOT_FOUND', { detail: 'Редакция процесса не найдена.' });
    }

    const definition = this.parseDefinition(template.definition);
    if (template.isActive || template.publishedAt !== null) {
      this.definitions.set(templateId, definition);
    }
    return definition;
  }

  /** Разбирает определение из JSONB с проверкой схемой. */
  parseDefinition(raw: unknown): WorkflowDefinition {
    const result = workflowDefinitionSchema.safeParse(raw);

    if (!result.success) {
      throw new AppException('WF_TEMPLATE_INVALID', {
        detail: 'Определение процесса не проходит проверку.',
        issues: result.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    return result.data;
  }

  /**
   * Действующий шаблон сегмента — им инициализируются новые взаимодействия.
   *
   * Он же единственный: в каждом сегменте активна ровно одна редакция,
   * что гарантирует частичный уникальный индекс в миграции.
   */
  async getDefaultTemplate(
    segment: EngagementSegment = 'B2B',
  ): Promise<{ id: string; definition: WorkflowDefinition }> {
    const template = await this.prisma.workflowTemplate.findFirst({
      where: { isActive: true, isDefault: true, segment },
      orderBy: { version: 'desc' },
      select: { id: true, definition: true },
    });

    if (!template) {
      throw new AppException('NOT_FOUND', {
        detail: `Не найден действующий шаблон процесса для сегмента ${segment}. Выполните наполнение данными.`,
      });
    }

    return { id: template.id, definition: this.parseDefinition(template.definition) };
  }

  /**
   * Выполняет переход взаимодействия в новое состояние.
   *
   * Все проверки собраны здесь, а не размазаны по контроллеру:
   *   1. взаимодействие входит в область видимости пользователя;
   *   2. переход существует в шаблоне ТОЙ ВЕРСИИ, к которой привязан экземпляр;
   *   3. роль пользователя допускает переход;
   *   4. выполнены условия перехода — комментарий и вложения;
   *   5. запись не изменена конкурентно (сверка версии).
   *
   * Проверка области видимости выполняется здесь, а не в контроллере:
   * перенеси её выше — и любой новый путь вызова движка (импорт, массовая
   * операция, обработчик очереди) обошёл бы разграничение доступа.
   *
   * Запись в журнал переходов, обновление денормализованного статуса
   * и запись аудита выполняются в одной транзакции: иначе при сбое между
   * шагами история и текущий статус разошлись бы, и отчёты перестали
   * сходиться с карточкой.
   */
  async performTransition(
    engagementId: string,
    toStateKey: string,
    comment: string | undefined,
    user: AuthenticatedUser,
    expectedVersion: number | null,
  ): Promise<TransitionResult> {
    const scope = await this.dataScope.resolve(user);

    const engagement = await this.prisma.engagement.findFirst({
      where: { id: engagementId, ...engagementScopeFilter(scope) },
      select: {
        id: true,
        version: true,
        ownerId: true,
        isArchived: true,
        currentStateKey: true,
        counterpartyName: true,
        university: { select: { name: true } },
        workflowInstance: {
          select: {
            id: true,
            currentStateKey: true,
            templateId: true,
          },
        },
      },
    });

    if (!engagement || !engagement.workflowInstance) {
      // Недоступное и несуществующее взаимодействие дают одинаковый ответ:
      // иначе по различию кодов (404 против 409) можно было бы установить
      // факт существования чужой записи и подобрать её статус.
      throw new AppException('NOT_FOUND', {
        detail: 'Взаимодействие не найдено либо недоступно текущему пользователю.',
      });
    }

    assertNotArchived(engagement);

    // Оптимистичная блокировка. Проверка выполняется до всех остальных,
    // чтобы пользователь, работающий с устаревшей карточкой, получил
    // понятный отказ, а не сообщение о недопустимом переходе из статуса,
    // который он уже не видит.
    if (expectedVersion !== null && expectedVersion !== engagement.version) {
      throw new AppException('WF_CONCURRENT_TRANSITION', {
        detail:
          'Карточка изменена другим пользователем. Обновите её и повторите операцию.',
        meta: { expectedVersion, actualVersion: engagement.version },
      });
    }

    const instance = engagement.workflowInstance;
    const definition = await this.definitionOf(instance.templateId);
    // Этап берётся из той же строки, что и версия. Заявку и экземпляр
    // процесса Prisma читает разными запросами, и переход другого
    // пользователя, завершившийся между ними, давал старую версию при новом
    // этапе: проверка версии проходила, а человек вместо «карточку изменил
    // другой пользователь» получал отказ по условиям чужого этапа.
    // Нагрузочный замер это поймал (docs/load-testing.md).
    const fromStateKey = engagement.currentStateKey;

    const transition = transitionsFrom(definition, fromStateKey).find(
      (item) => item.to === toStateKey,
    );

    if (!transition) {
      const available = transitionsFrom(definition, fromStateKey).map((item) => item.to);
      throw new AppException('WF_TRANSITION_NOT_ALLOWED', {
        detail: `Из статуса «${findState(definition, fromStateKey)?.label ?? fromStateKey}» переход в «${
          findState(definition, toStateKey)?.label ?? toStateKey
        }» не предусмотрен процессом.`,
        meta: { from: fromStateKey, to: toStateKey, available },
      });
    }

    if (transition.allowedRoles.length > 0 && !transition.allowedRoles.includes(user.role)) {
      throw new AppException('FORBIDDEN', {
        detail: `Переход «${transition.label}» доступен ролям: ${transition.allowedRoles.join(', ')}.`,
        meta: { requiredRoles: transition.allowedRoles, actualRole: user.role },
      });
    }

    await this.assertGuards(engagementId, definition, fromStateKey, transition.requiresComment, comment);

    const toState = findState(definition, toStateKey);
    const toStateLabel = toState?.label ?? toStateKey;
    const fromStateLabel = findState(definition, fromStateKey)?.label ?? fromStateKey;

    const slaDueAt = toState?.slaDays
      ? new Date(Date.now() + toState.slaDays * 24 * 60 * 60 * 1000)
      : null;

    const result = await this.prisma.$transaction(async (tx) => {
      // Переход проверен по редакции, прочитанной до транзакции. Если её
      // успели сменить публикацией, переход отменяется, а пока публикация
      // идёт — ждёт её окончания.
      await assertTemplateStillActive(tx, instance.templateId);

      // Условие по version во WHERE закрывает гонку между проверкой выше
      // и записью: если за это время кто-то успел выполнить переход,
      // обновление не затронет ни одной строки.
      const updated = await tx.engagement.updateMany({
        where: { id: engagementId, version: engagement.version },
        data: {
          currentStateKey: toStateKey,
          currentStateLabel: toStateLabel,
          version: { increment: 1 },
        },
      });

      if (updated.count === 0) {
        throw new AppException('WF_CONCURRENT_TRANSITION', {
          detail: 'Статус изменён другим пользователем во время выполнения операции.',
        });
      }

      await tx.workflowInstance.update({
        where: { id: instance.id },
        data: {
          currentStateKey: toStateKey,
          enteredAt: new Date(),
          slaDueAt,
          completedAt: toState?.isFinal ? new Date() : null,
        },
      });

      const journal = await tx.workflowTransition.create({
        data: {
          instanceId: instance.id,
          fromStateKey,
          // Подписи фиксируются на момент перехода: если статус впоследствии
          // переименуют, история покажет то название, которое видел
          // пользователь в момент действия.
          fromStateLabel,
          toStateKey,
          toStateLabel,
          actorId: user.id,
          comment: comment ?? null,
        },
        select: { id: true },
      });

      await recordActivity(tx, {
        type: 'STATE_CHANGED',
        actorId: user.id,
        engagementId,
        stage: { key: toStateKey, label: toStateLabel },
        transitionId: journal.id,
        details: { fromStateKey, fromStateLabel, toStateKey, toStateLabel },
      });

      // Исходящее событие пишется здесь же: внешние системы должны узнать
      // о переходе ровно тогда, когда он состоялся, и не узнать о нём,
      // если транзакция откатится.
      await enqueueEngagementEvent(tx, 'engagement.state_changed', {
        engagementId,
        previousStatus: { key: fromStateKey, label: fromStateLabel },
      });

      return { version: engagement.version + 1 };
    });

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTIONS.WORKFLOW_TRANSITION,
      entityType: 'Engagement',
      entityId: engagementId,
      beforeState: { stateKey: fromStateKey, stateLabel: fromStateLabel },
      afterState: { stateKey: toStateKey, stateLabel: toStateLabel, comment: comment ?? null },
    });

    this.logger.info(
      { engagementId, from: fromStateKey, to: toStateKey, actor: user.id },
      'Выполнен переход по процессу',
    );

    // Публикуем доменное событие, а не обращаемся к WebSocket напрямую.
    // Благодаря этому движок остаётся работоспособным в процессе worker,
    // где канала обновлений нет вовсе.
    //
    // Получатели — ответственный за карточку и совершивший переход:
    // рассылать событие всем подряд нельзя, иначе клиент узнавал бы
    // об изменениях в недоступных ему карточках.
    const recipientIds = Array.from(new Set([engagement.ownerId, user.id]));

    this.events.emit('engagement.updated', {
      engagementId,
      recipientIds,
      fromStateKey,
      toStateKey,
      toStateLabel,
      version: result.version,
      actorName: user.displayName,
      ownerId: engagement.ownerId,
      actorId: user.id,
      counterpartyName: engagement.university?.name ?? engagement.counterpartyName ?? '',
    });

    return {
      engagementId,
      fromStateKey,
      toStateKey,
      toStateLabel,
      version: result.version,
      slaDueAt,
    };
  }

  /** Проверяет условия, обязательные для выхода из текущего состояния. */
  private async assertGuards(
    engagementId: string,
    definition: WorkflowDefinition,
    fromStateKey: string,
    requiresComment: boolean,
    comment: string | undefined,
  ): Promise<void> {
    if (requiresComment && (!comment || comment.trim().length === 0)) {
      throw new AppException('WF_GUARD_FAILED', {
        detail: 'Для этого перехода обязателен комментарий.',
        issues: [{ field: 'comment', message: 'Укажите комментарий к переходу' }],
      });
    }

    const fromState = findState(definition, fromStateKey);

    if (fromState?.requiresAttachment) {
      const attachments = await this.prisma.attachment.count({
        where: {
          entityType: 'ENGAGEMENT',
          entityId: engagementId,
          // Условие закрывает только файл этого этапа. Любой файл заявки
          // тут не годится: скан с первой встречи иначе выпускал бы заявку
          // из подписания договора без самого договора.
          stateKey: fromStateKey,
          deletedAt: null,
          // Файл, не прошедший антивирусную проверку, условие не закрывает.
          scanStatus: { in: ['CLEAN', 'SKIPPED'] },
        },
      });

      if (attachments === 0 && !(await this.paymentConfirmed(engagementId))) {
        throw new AppException('WF_GUARD_FAILED', {
          detail: `Этап «${fromState.label}» требует приложить подтверждающий документ.`,
          meta: { requiredAt: fromStateKey },
        });
      }
    }
  }

  /**
   * Оплата прямой продажи подтверждена сайтом либо загрузкой оплат.
   *
   * Для заявки B2C это и есть подтверждающий документ этапа «Договор
   * и оплата»: факт оплаты пришёл из системы, которая её принимала.
   * Требовать от менеджера ещё и скан квитанции, которой у него нет,
   * значило бы заставлять прикладывать пустышки ради прохода по процессу.
   */
  private async paymentConfirmed(engagementId: string): Promise<boolean> {
    const engagement = await this.prisma.engagement.findUnique({
      where: { id: engagementId },
      select: { segment: true, paymentConfirmedAt: true },
    });

    return engagement?.segment === 'B2C' && engagement.paymentConfirmedAt !== null;
  }

  /**
   * Перевод заявки по событию внешней системы.
   *
   * Отличается от пользовательского перехода в трёх местах, и каждое —
   * осознанное.
   *
   * Условия перехода не проверяются. Комментарий и приложенный документ —
   * требования к работе менеджера, а здесь фиксируется уже состоявшийся
   * факт: обучение в LMS завершено независимо от того, приложил ли кто-то
   * файл в CRM. Отклонять факт из-за невыполненной формальности значило бы
   * расходиться с действительностью.
   *
   * Роли не проверяются: действует не человек, а система.
   *
   * Маршрут всё же соблюдается частично: если статуса с таким ключом
   * в действующей схеме нет, переход не выполняется вовсе — администратор
   * мог переработать процесс, и выдумывать за него состояние нельзя.
   *
   * Запись в журнал переходов делается обязательно: в карточке должно быть
   * видно, что статус сменила внешняя система, а не молча изменились данные.
   */
  async applySystemTransition(
    engagementId: string,
    toStateKey: string,
    comment: string,
  ): Promise<boolean> {
    const moved = await this.prisma.$transaction((tx) =>
      this.applySystemTransitionInTx(tx, engagementId, toStateKey, comment),
    );

    if (!moved) {
      return false;
    }

    await this.publishSystemTransition(moved);
    return true;
  }

  /**
   * Системный переход внутри чужой транзакции.
   *
   * Нужен там, где переход — часть более крупного изменения, которое должно
   * либо пройти целиком, либо не пройти вовсе: загрузка пачки оплат
   * переводит заявки и заводит новые, а предварительный просмотр откатывает
   * всё разом. Журнал аудита и уведомление клиентов вызывающий отправляет
   * после фиксации транзакции через publishSystemTransition — иначе
   * откатанный переход успел бы попасть в аудит и на экраны.
   */
  async applySystemTransitionInTx(
    tx: Prisma.TransactionClient,
    engagementId: string,
    toStateKey: string,
    comment: string,
  ): Promise<SystemTransitionResult | null> {
    // Схема читается после блокировки — то есть всегда действующая.
    await lockAgainstPublish(tx);

    const engagement = await tx.engagement.findUnique({
      where: { id: engagementId },
      select: {
        id: true,
        ownerId: true,
        version: true,
        isArchived: true,
        currentStateKey: true,
        currentStateLabel: true,
        workflowInstance: {
          select: { id: true, template: { select: { definition: true } } },
        },
      },
    });

    // Архивная заявка внешними событиями не двигается: она только для чтения.
    if (!engagement?.workflowInstance || engagement.isArchived) {
      return null;
    }

    const definition = this.parseDefinition(engagement.workflowInstance.template.definition);
    const toState = findState(definition, toStateKey);

    if (!toState || engagement.currentStateKey === toStateKey) {
      return null;
    }

    const slaDueAt = toState.slaDays
      ? new Date(Date.now() + toState.slaDays * 24 * 60 * 60 * 1000)
      : null;

    await tx.engagement.update({
      where: { id: engagementId },
      data: {
        currentStateKey: toState.key,
        currentStateLabel: toState.label,
        version: { increment: 1 },
      },
    });

    await tx.workflowInstance.update({
      where: { id: engagement.workflowInstance.id },
      data: {
        currentStateKey: toState.key,
        enteredAt: new Date(),
        slaDueAt,
        completedAt: toState.isFinal ? new Date() : null,
      },
    });

    const journal = await tx.workflowTransition.create({
      data: {
        instanceId: engagement.workflowInstance.id,
        fromStateKey: engagement.currentStateKey,
        fromStateLabel: engagement.currentStateLabel,
        toStateKey: toState.key,
        toStateLabel: toState.label,
        // Автором значится ответственный: внешняя система своей учётной
        // записи в CRM не имеет, а журнал переходов требует человека.
        // Происхождение перехода объясняет комментарий.
        actorId: engagement.ownerId,
        comment,
      },
      select: { id: true },
    });

    // В ленте автора нет: переход совершил не ответственный, и в его
    // списке «что я менял» такой записи быть не должно.
    await recordActivity(tx, {
      type: 'STATE_CHANGED',
      source: 'INTEGRATION',
      actorId: null,
      engagementId,
      stage: { key: toState.key, label: toState.label },
      transitionId: journal.id,
      details: {
        fromStateKey: engagement.currentStateKey,
        fromStateLabel: engagement.currentStateLabel,
        toStateKey: toState.key,
        toStateLabel: toState.label,
      },
    });

    await enqueueEngagementEvent(tx, 'engagement.state_changed', {
      engagementId,
      previousStatus: {
        key: engagement.currentStateKey,
        label: engagement.currentStateLabel,
      },
    });

    return {
      engagementId,
      ownerId: engagement.ownerId,
      fromStateKey: engagement.currentStateKey,
      toStateKey: toState.key,
      toStateLabel: toState.label,
      version: engagement.version + 1,
      comment,
    };
  }

  /** Аудит и уведомление клиентов о зафиксированном системном переходе. */
  async publishSystemTransition(moved: SystemTransitionResult): Promise<void> {
    await this.audit.record({
      action: AUDIT_ACTIONS.WORKFLOW_TRANSITION,
      entityType: 'Engagement',
      entityId: moved.engagementId,
      beforeState: { stateKey: moved.fromStateKey },
      afterState: { stateKey: moved.toStateKey, source: 'integration', comment: moved.comment },
    });

    this.events.emit('engagement.updated', {
      engagementId: moved.engagementId,
      recipientIds: [moved.ownerId],
      fromStateKey: moved.fromStateKey,
      toStateKey: moved.toStateKey,
      toStateLabel: moved.toStateLabel,
      version: moved.version,
      actorName: 'Внешняя система',
      ownerId: moved.ownerId,
      actorId: undefined,
    });
  }

  /**
   * Определяет этап заявки для заметки или файла.
   *
   * Ключ не указан — этап текущий: так заметка, оставленная в карточке,
   * сама оказывается на том шаге, где стоит заявка. Указанный ключ должен
   * быть в действующей схеме процесса заявки: привязать заметку к этапу,
   * которого в процессе нет, значит спрятать её от всех.
   */
  resolveStage(
    definition: WorkflowDefinition,
    currentStateKey: string,
    requestedKey: string | undefined,
  ): EngagementStage {
    const key = requestedKey ?? currentStateKey;
    const state = findState(definition, key);

    if (!state) {
      throw new AppException('ENGAGEMENT_STAGE_UNKNOWN', {
        detail: `Этапа «${key}» нет в процессе этой заявки.`,
        issues: [{ field: 'stateKey', message: 'Укажите этап из действующей схемы процесса' }],
        meta: { stateKey: key, available: definition.states.map((item) => item.key) },
      });
    }

    return { key: state.key, label: state.label };
  }

  /** Начальное состояние процесса — для создания нового взаимодействия. */
  getInitialState(definition: WorkflowDefinition): { key: string; label: string; slaDueAt: Date | null } {
    const state = initialState(definition);

    return {
      key: state.key,
      label: state.label,
      slaDueAt: state.slaDays ? new Date(Date.now() + state.slaDays * 24 * 60 * 60 * 1000) : null,
    };
  }
}
