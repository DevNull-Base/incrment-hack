import { Injectable } from '@nestjs/common';
import { assertNotArchived } from './archive-guard.js';
import { normalizeEmail, normalizePhone } from '../../common/utils/contact-normalization.js';
import { EngagementContactDto, FillEngagementContactDto } from './dto/engagement-contact.dto.js';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration.js';
import { periodBounds } from '../../common/utils/period.js';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { PageDto, toPage } from '../../common/dto/pagination.dto.js';
import { DataScope, DataScopeService, engagementScopeFilter } from '../access/data-scope.service.js';
import { AUDIT_ACTIONS, AuditService } from '../audit/audit.service.js';
import { WorkflowService } from '../workflow/workflow.service.js';
import { findState, transitionsFrom } from '../workflow/workflow-definition.js';
import { buildStageSummary } from '../workflow/stage-summary.js';
import { enqueueEngagementEvent } from '../integration/outbox.js';
import { recordActivity } from '../activity/activity-log.js';
import { assertTemplateStillActive } from '../workflow/workflow-lock.js';
import {
  INTERNAL_EVENTS,
  type EngagementActivityEvent,
} from '../realtime/realtime.gateway.js';
import { summarizeInterest } from './interest-score.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import {
  AvailableTransitionDto,
  CounterpartyType,
  CreateEngagementDto,
  EngagementDetailDto,
  EngagementListItemDto,
  EngagementQueryDto,
  EngagementSegment,
  INTEREST_UNSET,
  InterestGroupBy,
  InterestLevel,
  InterestSummaryDto,
  InterestSummaryQueryDto,
  ReassignEngagementDto,
  TransitionHistoryItemDto,
  UpdateEngagementDto,
  ArchiveEngagementDto,
} from './dto/engagement.dto.js';

/** Сколько записей истории отдавать в карточке. */
const HISTORY_LIMIT = 50;

/** Поле заявки, по которому строится разрез рейтинга заинтересованности. */
const INTEREST_GROUP_FIELD = {
  direction: 'directionId',
  product: 'productId',
  program: 'programId',
  university: 'universityId',
} as const satisfies Record<InterestGroupBy, Prisma.EngagementScalarFieldEnum>;

/** Подпись группы, у заявок которой поле разреза не заполнено. */
const INTEREST_EMPTY_GROUP: Record<InterestGroupBy, string> = {
  direction: 'Направление не указано',
  product: 'Без продукта',
  program: 'Без программы',
  university: 'Без вуза (прямые продажи)',
};

@Injectable()
export class EngagementService {
  /** Часовой пояс организации: в нём считаются календарные границы периодов. */
  private readonly timeZone: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly workflow: WorkflowService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
    config: ConfigService<AppConfig, true>,
  ) {
    this.timeZone = config.get('APP_TIMEZONE', { infer: true });
  }

  /**
   * Список взаимодействий с учётом фильтров и области видимости.
   *
   * Ограничение видимости применяется НЕ поверх результата, а внутри
   * условия выборки: фильтрация после запроса ломала бы счётчик total
   * и постраничный вывод — пользователь видел бы «найдено 63», получая
   * три строки.
   */
  async findAll(
    query: EngagementQueryDto,
    user: AuthenticatedUser,
  ): Promise<PageDto<EngagementListItemDto>> {
    const [scope, searchUniversityIds] = await Promise.all([
      this.dataScope.resolve(user),
      query.search ? this.universitiesMatching(query.search) : Promise.resolve([]),
    ]);
    const where = this.buildWhere(query, scope, searchUniversityIds);

    const [total, records] = await Promise.all([
      this.prisma.engagement.count({ where }),
      this.prisma.engagement.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: buildOrderBy(query),
        select: engagementListSelection,
      }),
    ]);

    return toPage(records.map(toEngagementListItem), total, query);
  }

  /** Карточка взаимодействия с историей, этапами и доступными переходами. */
  async findOne(id: string, user: AuthenticatedUser): Promise<EngagementDetailDto> {
    const scope = await this.dataScope.resolve(user);

    const record = await this.prisma.engagement.findFirst({
      where: { id, ...engagementScopeFilter(scope) },
      select: {
        ...engagementListSelection,
        title: true,
        version: true,
        interestComment: true,
        interestUpdatedAt: true,
        interestUpdatedBy: { select: { displayName: true } },
        program: { select: { name: true } },
        paymentConfirmedAt: true,
        paymentReference: true,
        studyStream: true,
        lmsExportedAt: true,
        archivedAt: true,
        archiveReason: true,
        archivedBy: { select: { displayName: true } },
        workflowInstance: {
          select: {
            id: true,
            currentStateKey: true,
            // Поля норматива обязательны: вложенная выборка перекрывает
            // ту, что задана в списочной, и без них toEngagementListItem
            // не сможет вычислить признак просрочки.
            slaDueAt: true,
            completedAt: true,
            templateId: true,
            transitions: {
              orderBy: { createdAt: 'desc' },
              take: HISTORY_LIMIT,
              select: {
                id: true,
                fromStateLabel: true,
                toStateLabel: true,
                comment: true,
                createdAt: true,
                actor: { select: { displayName: true } },
              },
            },
          },
        },
      },
    });

    if (!record) {
      // Объект вне области видимости и несуществующий объект неразличимы
      // намеренно: иначе по коду ответа можно было бы установить факт
      // существования чужой записи.
      throw new AppException('NOT_FOUND', {
        detail: 'Взаимодействие не найдено либо недоступно текущему пользователю.',
      });
    }

    const instance = record.workflowInstance;

    const [noteGroups, attachmentGroups, currentStageFiles, definition] = await Promise.all([
      this.prisma.engagementNote.groupBy({
        by: ['stateKey', 'stateLabel'],
        where: { engagementId: id, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.attachment.groupBy({
        by: ['stateKey', 'stateLabel'],
        where: { entityType: 'ENGAGEMENT', entityId: id, deletedAt: null },
        _count: { _all: true },
      }),
      // Условие «приложите документ» закрывает только проверенный файл
      // текущего этапа — ровно так же считает движок при переходе, иначе
      // кнопка выглядела бы доступной, а переход получал бы отказ.
      instance
        ? this.prisma.attachment.count({
            where: {
              entityType: 'ENGAGEMENT',
              entityId: id,
              stateKey: instance.currentStateKey,
              deletedAt: null,
              scanStatus: { in: ['CLEAN', 'SKIPPED'] },
            },
          })
        : Promise.resolve(0),
      // Определение процесса — из кэша неизменяемых редакций, без обращения к базе.
      instance ? this.workflow.definitionOf(instance.templateId) : Promise.resolve(null),
    ]);

    // Подтверждённая оплата прямой продажи закрывает требование документа
    // так же, как файл, — ровно по тому же правилу, что и движок процессов.
    const stageDocumentPresent =
      currentStageFiles > 0 || (record.segment === 'B2C' && record.paymentConfirmedAt !== null);

    const availableTransitions =
      instance && definition
        ? this.computeAvailableTransitions(definition, instance.currentStateKey, user, stageDocumentPresent)
        : [];

    const stages =
      instance && definition
        ? buildStageSummary(
            definition,
            instance.currentStateKey,
            toStageCounts(noteGroups),
            toStageCounts(attachmentGroups),
          )
        : [];

    const history: TransitionHistoryItemDto[] = (instance?.transitions ?? []).map((item) => ({
      id: item.id.toString(),
      fromStateLabel: item.fromStateLabel,
      toStateLabel: item.toStateLabel,
      actorName: item.actor.displayName,
      comment: item.comment,
      createdAt: item.createdAt,
    }));

    return {
      ...toEngagementListItem(record),
      programName: record.program?.name ?? null,
      title: record.title,
      version: record.version,
      availableTransitions,
      history,
      attachmentCount: sumCounts(attachmentGroups),
      noteCount: sumCounts(noteGroups),
      stages,
      interestComment: record.interestComment,
      interestUpdatedAt: record.interestUpdatedAt,
      interestUpdatedByName: record.interestUpdatedBy?.displayName ?? null,
      paymentConfirmedAt: record.paymentConfirmedAt,
      paymentReference: record.paymentReference,
      studyStream: record.studyStream,
      lmsExportedAt: record.lmsExportedAt,
      archivedAt: record.archivedAt,
      archivedByName: record.archivedBy?.displayName ?? null,
      archiveReason: record.archiveReason,
    };
  }

  /**
   * Отправить заявку в архив.
   *
   * Завершённую заявку (обучение пройдено, отказ) убирает в архив и её
   * ответственный — работа по ней окончена. Незавершённую — только
   * руководитель или администратор и с указанием причины: это решение
   * прекратить работу, и по журналу должно быть видно, кто и почему его принял.
   */
  async archive(id: string, dto: ArchiveEngagementDto, user: AuthenticatedUser): Promise<EngagementDetailDto> {
    const scope = await this.dataScope.resolve(user);
    const existing = await this.prisma.engagement.findFirst({
      where: { id, ...engagementScopeFilter(scope) },
      select: {
        id: true,
        ownerId: true,
        version: true,
        isArchived: true,
        currentStateKey: true,
        currentStateLabel: true,
        workflowInstance: { select: { completedAt: true } },
      },
    });

    if (!existing) {
      throw new AppException('NOT_FOUND', {
        detail: 'Взаимодействие не найдено либо недоступно текущему пользователю.',
      });
    }

    if (existing.isArchived) {
      return this.findOne(id, user);
    }

    const finished = existing.workflowInstance?.completedAt != null;
    const reason = dto.reason?.trim() || null;

    if (!finished && user.role === 'USER') {
      throw new AppException('FORBIDDEN', {
        detail: 'Незавершённую заявку отправляет в архив руководитель: работа по ней ещё не окончена.',
      });
    }

    if (!finished && !reason) {
      throw new AppException('VALIDATION_FAILED', {
        detail: 'Укажите, почему незавершённая заявка уходит в архив.',
        issues: [{ field: 'reason', message: 'Причина обязательна для незавершённой заявки' }],
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.engagement.update({
        where: { id },
        data: {
          isArchived: true,
          archivedAt: new Date(),
          archivedById: user.id,
          archiveReason: reason,
          version: { increment: 1 },
        },
      });

      await recordActivity(tx, {
        type: 'ENGAGEMENT_ARCHIVED',
        actorId: user.id,
        engagementId: id,
        stage: { key: existing.currentStateKey, label: existing.currentStateLabel },
        details: { reason, finished },
      });
    });

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTIONS.ENGAGEMENT_UPDATE,
      entityType: 'Engagement',
      entityId: id,
      beforeState: { isArchived: false },
      afterState: { isArchived: true, reason, finished },
    });

    this.emitActivity({
      engagementId: id,
      recipientIds: [existing.ownerId, user.id],
      type: 'ENGAGEMENT_ARCHIVED',
      actorName: user.displayName,
      version: existing.version + 1,
    });

    return this.findOne(id, user);
  }

  /** Вернуть заявку из архива — любому, кому она видна. */
  async restore(id: string, user: AuthenticatedUser): Promise<EngagementDetailDto> {
    const scope = await this.dataScope.resolve(user);
    const existing = await this.prisma.engagement.findFirst({
      where: { id, ...engagementScopeFilter(scope) },
      select: {
        id: true,
        ownerId: true,
        version: true,
        isArchived: true,
        archiveReason: true,
        currentStateKey: true,
        currentStateLabel: true,
      },
    });

    if (!existing) {
      throw new AppException('NOT_FOUND', {
        detail: 'Взаимодействие не найдено либо недоступно текущему пользователю.',
      });
    }

    if (!existing.isArchived) {
      return this.findOne(id, user);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.engagement.update({
        where: { id },
        data: {
          isArchived: false,
          archivedAt: null,
          archivedById: null,
          archiveReason: null,
          version: { increment: 1 },
        },
      });

      await recordActivity(tx, {
        type: 'ENGAGEMENT_RESTORED',
        actorId: user.id,
        engagementId: id,
        stage: { key: existing.currentStateKey, label: existing.currentStateLabel },
      });
    });

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTIONS.ENGAGEMENT_UPDATE,
      entityType: 'Engagement',
      entityId: id,
      beforeState: { isArchived: true, reason: existing.archiveReason },
      afterState: { isArchived: false },
    });

    this.emitActivity({
      engagementId: id,
      recipientIds: [existing.ownerId, user.id],
      type: 'ENGAGEMENT_RESTORED',
      actorName: user.displayName,
      version: existing.version + 1,
    });

    return this.findOne(id, user);
  }

  async create(dto: CreateEngagementDto, user: AuthenticatedUser): Promise<EngagementDetailDto> {
    const segment: EngagementSegment = dto.segment ?? 'B2B';
    const counterparty = resolveCounterparty(segment, dto);

    // Шаблон выбирается по сегменту: маршруты работы с вузом и прямой
    // продажи различаются составом этапов.
    const template = await this.workflow.getDefaultTemplate(segment);
    const initial = this.workflow.getInitialState(template.definition);

    // Рядовой пользователь может завести взаимодействие только на себя:
    // иначе он мог бы назначить работу коллеге в обход руководителя.
    const ownerId =
      user.role === 'USER' ? user.id : (dto.ownerId ?? user.id);

    if (ownerId !== user.id) {
      await this.assertAssignableOwner(ownerId, user);
    }

    if (dto.counterpartyContactId) {
      await this.assertLinkablePerson(dto.counterpartyContactId, segment, user);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      await assertTemplateStillActive(tx, template.id);

      const engagement = await tx.engagement.create({
        data: {
          segment,
          universityId: counterparty.universityId,
          counterpartyType: counterparty.type,
          counterpartyName: counterparty.name,
          counterpartyContactId: dto.counterpartyContactId ?? null,
          directionId: dto.directionId,
          productId: dto.productId ?? null,
          programId: dto.programId ?? null,
          ownerId,
          title: dto.title ?? null,
          currentStateKey: initial.key,
          currentStateLabel: initial.label,
        },
        select: { id: true },
      });

      await tx.workflowInstance.create({
        data: {
          engagementId: engagement.id,
          templateId: template.id,
          currentStateKey: initial.key,
          slaDueAt: initial.slaDueAt,
        },
      });

      // Событие для внешних систем пишется в той же транзакции: при откате
      // не останется сообщения о заявке, которой нет.
      await enqueueEngagementEvent(tx, 'engagement.created', { engagementId: engagement.id });

      await recordActivity(tx, {
        type: 'ENGAGEMENT_CREATED',
        actorId: user.id,
        engagementId: engagement.id,
        stage: { key: initial.key, label: initial.label },
        details: { segment, ownerId },
      });

      return engagement;
    });

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTIONS.ENGAGEMENT_CREATE,
      entityType: 'Engagement',
      entityId: created.id,
      afterState: {
        segment,
        universityId: counterparty.universityId,
        counterpartyName: counterparty.name,
        directionId: dto.directionId,
        ownerId,
        stateKey: initial.key,
      },
    });

    return this.findOne(created.id, user);
  }

  /**
   * Правка карточки: название, программа, заинтересованность.
   *
   * Версия записи растёт, как и при переходе: карточка, открытая до правки,
   * не должна молча затереть её. Если изменить нечего, запись не трогается —
   * повторная отправка той же формы не порождает пустых событий в ленте.
   */
  async update(
    id: string,
    dto: UpdateEngagementDto,
    user: AuthenticatedUser,
    expectedVersion: number | null,
  ): Promise<EngagementDetailDto> {
    const scope = await this.dataScope.resolve(user);

    const existing = await this.prisma.engagement.findFirst({
      where: { id, ...engagementScopeFilter(scope) },
      select: {
        id: true,
        version: true,
        ownerId: true,
        directionId: true,
        title: true,
        programId: true,
        interestLevel: true,
        interestComment: true,
        currentStateKey: true,
        currentStateLabel: true,
        program: { select: { id: true, name: true } },
        isArchived: true,
      },
    });

    if (!existing) {
      throw new AppException('NOT_FOUND', {
        detail: 'Взаимодействие не найдено либо недоступно текущему пользователю.',
      });
    }

    assertNotArchived(existing);

    if (expectedVersion !== null && expectedVersion !== existing.version) {
      throw new AppException('CONFLICT', {
        detail: 'Карточка изменена другим пользователем. Обновите её и повторите правку.',
        meta: { expectedVersion, actualVersion: existing.version },
      });
    }

    const data: Prisma.EngagementUncheckedUpdateManyInput = {};
    const changedFields: string[] = [];

    if (dto.title !== undefined) {
      const title = dto.title?.trim() || null;

      if (title !== existing.title) {
        data.title = title;
        changedFields.push('title');
      }
    }

    let nextProgram: { id: string; name: string } | null = existing.program;

    if (dto.programId !== undefined && dto.programId !== existing.programId) {
      nextProgram = dto.programId ? await this.findProgramFor(dto.programId, existing.directionId) : null;
      data.programId = nextProgram?.id ?? null;
      changedFields.push('programId');
    }

    const interest = resolveInterestChange(existing, dto);

    if (interest.changed) {
      data.interestLevel = interest.level;
      data.interestComment = interest.comment;
      data.interestUpdatedAt = new Date();
      data.interestUpdatedById = user.id;
    }

    if (changedFields.length === 0 && !interest.changed) {
      return this.findOne(id, user);
    }

    const stage = { key: existing.currentStateKey, label: existing.currentStateLabel };

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.engagement.updateMany({
        where: { id, version: existing.version },
        data: { ...data, version: { increment: 1 } },
      });

      if (updated.count === 0) {
        throw new AppException('CONFLICT', {
          detail: 'Карточка изменена другим пользователем во время правки. Обновите её.',
        });
      }

      if (interest.changed) {
        await recordActivity(tx, {
          type: 'INTEREST_CHANGED',
          actorId: user.id,
          engagementId: id,
          stage,
          details: {
            fromLevel: existing.interestLevel,
            toLevel: interest.level,
            comment: interest.comment,
          },
        });
      }

      if (changedFields.length > 0) {
        await recordActivity(tx, {
          type: 'ENGAGEMENT_UPDATED',
          actorId: user.id,
          engagementId: id,
          stage,
          details: {
            fields: changedFields,
            ...(changedFields.includes('programId')
              ? { programFrom: existing.program?.name ?? null, programTo: nextProgram?.name ?? null }
              : {}),
          },
        });
      }
    });

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTIONS.ENGAGEMENT_UPDATE,
      entityType: 'Engagement',
      entityId: id,
      beforeState: {
        title: existing.title,
        programId: existing.programId,
        interestLevel: existing.interestLevel,
        interestComment: existing.interestComment,
      },
      afterState: {
        title: data.title === undefined ? existing.title : data.title,
        programId: data.programId === undefined ? existing.programId : data.programId,
        interestLevel: interest.level,
        interestComment: interest.comment,
      },
    });

    this.emitActivity({
      engagementId: id,
      recipientIds: [existing.ownerId, user.id],
      type: interest.changed ? 'INTEREST_CHANGED' : 'ENGAGEMENT_UPDATED',
      actorName: user.displayName,
      version: existing.version + 1,
    });

    return this.findOne(id, user);
  }

  /**
   * Переназначение ответственного.
   *
   * Требование ТЗ: менять ответственных за вузы может руководитель.
   * Проверка роли выполняется декоратором на контроллере, здесь же
   * фиксируется само изменение — переназначение затрагивает область
   * видимости и потому подлежит обязательному протоколированию.
   *
   * Заявка ищется в области видимости того, кто переназначает: роль
   * руководителя даёт право распоряжаться работой своих подчинённых,
   * а не любой заявкой в системе.
   */
  async reassign(
    id: string,
    dto: ReassignEngagementDto,
    user: AuthenticatedUser,
  ): Promise<EngagementDetailDto> {
    const scope = await this.dataScope.resolve(user);

    const existing = await this.prisma.engagement.findFirst({
      where: { id, ...engagementScopeFilter(scope) },
      select: {
        id: true,
        ownerId: true,
        version: true,
        currentStateKey: true,
        currentStateLabel: true,
        isArchived: true,
        owner: { select: { displayName: true } },
      },
    });

    if (!existing) {
      throw new AppException('NOT_FOUND', {
        detail: 'Взаимодействие не найдено либо недоступно текущему пользователю.',
      });
    }

    assertNotArchived(existing);

    const newOwner = await this.prisma.appUser.findUnique({
      where: { id: dto.ownerId },
      select: { id: true, displayName: true, isActive: true, managerId: true },
    });

    if (!newOwner || !newOwner.isActive) {
      throw new AppException('NOT_FOUND', {
        detail: 'Указанный пользователь не найден либо деактивирован.',
      });
    }

    // Руководитель распоряжается работой своего отдела: передать заявку
    // он может себе или подчинённому. Прежде ограничения не было — заявка
    // уходила в чужой отдел, пропадала из области видимости руководителя,
    // и он получал в ответ «не найдено» на успешно выполненную операцию.
    if (user.role === 'MANAGER' && newOwner.id !== user.id && newOwner.managerId !== user.id) {
      throw new AppException('OUT_OF_DATA_SCOPE', {
        detail: 'Руководитель передаёт заявки только себе и своим подчинённым.',
        meta: { ownerId: newOwner.id },
      });
    }

    if (newOwner.id === existing.ownerId) {
      return this.findOne(id, user);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.engagement.update({
        where: { id },
        data: { ownerId: dto.ownerId, version: { increment: 1 } },
      });

      await recordActivity(tx, {
        type: 'OWNER_CHANGED',
        actorId: user.id,
        engagementId: id,
        stage: { key: existing.currentStateKey, label: existing.currentStateLabel },
        details: { fromOwnerId: existing.ownerId, toOwnerId: newOwner.id },
      });
    });

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTIONS.ENGAGEMENT_REASSIGN,
      entityType: 'Engagement',
      entityId: id,
      beforeState: { ownerId: existing.ownerId, ownerName: existing.owner.displayName },
      afterState: { ownerId: newOwner.id, ownerName: newOwner.displayName, reason: dto.reason ?? null },
    });

    // Область видимости обоих участников изменилась — сбрасываем кэш,
    // иначе прежний ответственный продолжал бы видеть карточку,
    // а новый не увидел бы её до истечения TTL.
    await Promise.all([
      this.dataScope.invalidate(existing.ownerId),
      this.dataScope.invalidate(dto.ownerId),
    ]);

    this.emitActivity({
      engagementId: id,
      recipientIds: [existing.ownerId, newOwner.id, user.id],
      type: 'OWNER_CHANGED',
      actorName: user.displayName,
      version: existing.version + 1,
    });

    return this.findOne(id, user);
  }

  /**
   * Рейтинг заинтересованности по направлениям, продуктам, программам
   * или вузам — в границах области видимости пользователя.
   */
  async interestSummary(
    query: InterestSummaryQueryDto,
    user: AuthenticatedUser,
  ): Promise<InterestSummaryDto> {
    const scope = await this.dataScope.resolve(user);
    const groupBy = query.groupBy ?? 'direction';
    const field = INTEREST_GROUP_FIELD[groupBy];

    const period: Prisma.DateTimeFilter = periodBounds(query.periodFrom, query.periodTo, this.timeZone);

    const where: Prisma.EngagementWhereInput = {
      ...(query.includeArchived ? {} : { isArchived: false }),
      ...(query.segment ? { segment: query.segment } : {}),
      ...(Object.keys(period).length > 0 ? { createdAt: period } : {}),
      ...engagementScopeFilter(scope),
    };

    // Поле разреза выбирается во время выполнения, а тип groupBy в Prisma
    // выводится из литерала: аргументы и результат описаны явно.
    const groupArgs: Prisma.EngagementGroupByArgs = {
      by: [field, 'interestLevel'],
      where,
      _count: { _all: true },
      orderBy: { [field]: 'asc' },
    };

    const groups = (await this.prisma.engagement.groupBy(groupArgs as never)) as unknown as Array<
      Record<string, unknown> & { interestLevel: InterestLevel | null; _count: { _all: number } }
    >;

    const counts = groups.map((group) => ({
      key: (group[field] as string | null) ?? null,
      level: group.interestLevel,
      count: group._count._all,
    }));

    const ids = [...new Set(counts.map((row) => row.key).filter((key): key is string => key !== null))];
    const names = await this.groupNames(groupBy, ids);

    return {
      groupBy,
      rows: summarizeInterest(counts, (key) =>
        key === null ? INTEREST_EMPTY_GROUP[groupBy] : (names.get(key) ?? key),
      ),
    };
  }

  /** Наименования групп рейтинга. */
  private async groupNames(groupBy: InterestGroupBy, ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) {
      return new Map();
    }

    switch (groupBy) {
      case 'direction': {
        const rows = await this.prisma.itDirection.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        });
        return new Map(rows.map((row) => [row.id, row.name]));
      }
      case 'product': {
        const rows = await this.prisma.softwareProduct.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        });
        return new Map(rows.map((row) => [row.id, row.name]));
      }
      case 'program': {
        const rows = await this.prisma.itProgram.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        });
        return new Map(rows.map((row) => [row.id, row.name]));
      }
      case 'university': {
        const rows = await this.prisma.university.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, shortName: true },
        });
        return new Map(rows.map((row) => [row.id, row.shortName ?? row.name]));
      }
    }
  }

  /**
   * Программа для заявки. Должна существовать и относиться к направлению
   * заявки: программа по DevOps в заявке по информационной безопасности —
   * ошибка ввода, которую отчёты по программам потом не разберут.
   */
  private async findProgramFor(
    programId: string,
    directionId: string,
  ): Promise<{ id: string; name: string }> {
    const program = await this.prisma.itProgram.findUnique({
      where: { id: programId },
      select: { id: true, name: true, directionId: true },
    });

    if (!program) {
      throw new AppException('VALIDATION_FAILED', {
        detail: 'Программа не найдена в каталоге.',
        issues: [{ field: 'programId', message: 'Выберите программу из каталога' }],
      });
    }

    if (program.directionId !== directionId) {
      throw new AppException('VALIDATION_FAILED', {
        detail: 'Программа относится к другому ИТ-направлению, чем заявка.',
        issues: [{ field: 'programId', message: 'Выберите программу направления заявки' }],
      });
    }

    return { id: program.id, name: program.name };
  }

  private emitActivity(event: EngagementActivityEvent): void {
    this.events.emit(INTERNAL_EVENTS.ENGAGEMENT_ACTIVITY, event);
  }

  /** Собирает условие выборки из фильтров и области видимости. */
  /**
   * Вузы, подходящие под строку поиска.
   *
   * Ищутся отдельным запросом, а не условием на связанную таблицу внутри
   * выборки заявок: «OR» через связь не может опереться ни на один индекс,
   * и на 50 000 заявок каждый поиск перебирал их все — 120 мс процессора
   * базы на запрос (docs/load-testing.md). Вузов сотни, их поиск идёт
   * по триграммным индексам, а заявки дальше отбираются по university_id.
   */
  private async universitiesMatching(search: string): Promise<string[]> {
    const rows = await this.prisma.university.findMany({
      where: {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { shortName: { contains: search, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  private buildWhere(
    query: EngagementQueryDto,
    scope: DataScope,
    searchUniversityIds: string[] = [],
  ): Prisma.EngagementWhereInput {
    const period: Prisma.DateTimeFilter = periodBounds(query.periodFrom, query.periodTo, this.timeZone);
    const updated: Prisma.DateTimeFilter = periodBounds(query.updatedFrom, query.updatedTo, this.timeZone);

    const conditions: Prisma.EngagementWhereInput[] = [];

    if (query.interestLevels && query.interestLevels.length > 0) {
      const levels = query.interestLevels.filter(
        (value): value is InterestLevel => value !== INTEREST_UNSET,
      );
      const withUnset = query.interestLevels.includes(INTEREST_UNSET);

      conditions.push({
        OR: [
          ...(levels.length > 0 ? [{ interestLevel: { in: levels } }] : []),
          ...(withUnset ? [{ interestLevel: null }] : []),
        ],
      });
    }

    if (query.search) {
      conditions.push({
        OR: [
          ...(searchUniversityIds.length > 0 ? [{ universityId: { in: searchUniversityIds } }] : []),
          // Поиск обязан работать и по прямым продажам: у заявки B2C
          // вуза нет, и без этого условия она не находилась бы вовсе.
          { counterpartyName: { contains: query.search, mode: 'insensitive' } },
          { title: { contains: query.search, mode: 'insensitive' } },
        ],
      });
    }

    const scopeFilter = engagementScopeFilter(scope);

    return {
      ...(query.includeArchived ? {} : { isArchived: false }),
      ...(query.segment ? { segment: query.segment } : {}),
      ...(query.universityId ? { universityId: query.universityId } : {}),
      ...(query.directionId ? { directionId: query.directionId } : {}),
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.programId ? { programId: query.programId } : {}),
      ...(query.ownerId ? { ownerId: query.ownerId } : {}),
      ...(query.stateKey ? { currentStateKey: query.stateKey } : {}),
      ...(Object.keys(period).length > 0 ? { createdAt: period } : {}),
      ...(Object.keys(updated).length > 0 ? { updatedAt: updated } : {}),
      ...scopeFilter,
      // Условия с собственным OR (поиск, заинтересованность) собираются
      // в общий AND вместе с условием области видимости: слияние объектов
      // по верхнему уровню потеряло бы одно из них.
      AND: [...(scopeFilter.AND ? toArray(scopeFilter.AND) : []), ...conditions],
    };
  }

  /**
   * Контактное лицо заявки прямой продажи — в пределах видимости.
   *
   * В карточке заявки контактов нет: там только наименование контрагента.
   * Менеджеру, который ведёт слушателя, почта и телефон нужны для работы,
   * а видеть весь реестр персональных данных ему незачем.
   */
  async getContact(id: string, user: AuthenticatedUser): Promise<EngagementContactDto> {
    const person = await this.requireContact(id, user);
    return { personId: person.id, fullName: person.fullName, email: person.email, phone: person.phone };
  }

  /**
   * Дописать недостающие почту или телефон контакта.
   *
   * Выгрузка в LMS пропускает слушателя без почты и просит её уточнить, но
   * менеджеру было некуда её вписать: правка реестра доступна только
   * администратору. Здесь заполняются только пустые поля — изменить уже
   * сохранённое значение значит уточнить персональные данные, и это
   * по-прежнему делает администратор.
   */
  async fillContact(
    id: string,
    dto: FillEngagementContactDto,
    user: AuthenticatedUser,
  ): Promise<EngagementContactDto> {
    const person = await this.requireContact(id, user);
    assertNotArchived(person);
    const issues: Array<{ field: string; message: string }> = [];
    const data: Prisma.PersonUpdateInput = {};

    if (dto.email !== undefined && dto.email.trim() !== '') {
      const email = normalizeEmail(dto.email);

      if (!email) {
        issues.push({ field: 'email', message: 'Адрес почты не распознан' });
      } else if (person.email && person.email !== email) {
        throw new AppException('FORBIDDEN', {
          detail: 'Почта уже указана. Изменить её может администратор через реестр персональных данных.',
        });
      } else if (!person.email) {
        data.email = email;
      }
    }

    if (dto.phone !== undefined && dto.phone.trim() !== '') {
      const phone = normalizePhone(dto.phone);

      if (!phone) {
        issues.push({ field: 'phone', message: 'Ожидается российский номер: +7 900 111-22-33' });
      } else if (person.phone && person.phone !== phone) {
        throw new AppException('FORBIDDEN', {
          detail: 'Телефон уже указан. Изменить его может администратор через реестр персональных данных.',
        });
      } else if (!person.phone) {
        data.phone = phone;
      }
    }

    if (issues.length > 0) {
      throw new AppException('VALIDATION_FAILED', { detail: 'Контактные данные заполнены неверно.', issues });
    }

    if (Object.keys(data).length === 0) {
      return { personId: person.id, fullName: person.fullName, email: person.email, phone: person.phone };
    }

    const updated = await this.prisma.person.update({
      where: { id: person.id },
      data,
      select: { id: true, fullName: true, email: true, phone: true },
    });

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTIONS.PERSONAL_DATA_RECTIFY,
      entityType: 'Person',
      entityId: person.id,
      beforeState: { email: person.email, phone: person.phone },
      afterState: { email: updated.email, phone: updated.phone, engagementId: id, filled: Object.keys(data) },
    });

    return { personId: updated.id, fullName: updated.fullName, email: updated.email, phone: updated.phone };
  }

  private async requireContact(
    id: string,
    user: AuthenticatedUser,
  ): Promise<{ id: string; fullName: string; email: string | null; phone: string | null; isArchived: boolean }> {
    const scope = await this.dataScope.resolve(user);
    const engagement = await this.prisma.engagement.findFirst({
      where: { id, ...engagementScopeFilter(scope) },
      select: {
        isArchived: true,
        counterpartyContact: { select: { id: true, fullName: true, email: true, phone: true, erasedAt: true } },
      },
    });

    if (!engagement) {
      throw new AppException('NOT_FOUND', {
        detail: 'Взаимодействие не найдено либо недоступно текущему пользователю.',
      });
    }

    const contact = engagement.counterpartyContact;

    if (!contact || contact.erasedAt) {
      throw new AppException('NOT_FOUND', {
        detail: contact ? 'Данные контакта обезличены.' : 'У заявки нет контактного лица из реестра.',
      });
    }

    return { ...contact, isArchived: engagement.isArchived };
  }

  /**
   * Кому руководитель может поручить новую заявку — тем же правилом, что
   * и при переназначении: себе или подчинённому, и только действующему
   * сотруднику. Прежде при создании проверки не было, и заявка заводилась
   * на сотрудника чужого отдела либо на заблокированного.
   */
  private async assertAssignableOwner(ownerId: string, user: AuthenticatedUser): Promise<void> {
    const owner = await this.prisma.appUser.findUnique({
      where: { id: ownerId },
      select: { id: true, isActive: true, managerId: true },
    });

    if (!owner || !owner.isActive) {
      throw new AppException('VALIDATION_FAILED', {
        detail: 'Указанный ответственный не найден либо деактивирован.',
        issues: [{ field: 'ownerId', message: 'Выберите действующего сотрудника' }],
      });
    }

    if (user.role === 'MANAGER' && owner.managerId !== user.id) {
      throw new AppException('OUT_OF_DATA_SCOPE', {
        detail: 'Руководитель поручает заявки только себе и своим подчинённым.',
        meta: { ownerId },
      });
    }
  }

  /**
   * Привязка записи реестра персональных данных к заявке прямой продажи.
   *
   * Реестр доступен руководителю и администратору; рядовой менеджер его не
   * видит и выбрать человека из него не может. Прежде идентификатор
   * принимался от любого пользователя без проверки: к своей заявке можно
   * было привязать постороннего человека — и тогда его будущая оплата
   * с сайта попадала в эту заявку, а обезличивание переписывало её.
   */
  private async assertLinkablePerson(
    personId: string,
    segment: EngagementSegment,
    user: AuthenticatedUser,
  ): Promise<void> {
    if (segment !== 'B2C') {
      throw new AppException('VALIDATION_FAILED', {
        detail: 'Контактное лицо из реестра привязывается только к заявке прямой продажи.',
        issues: [{ field: 'counterpartyContactId', message: 'Контакты вуза ведутся в карточке вуза' }],
      });
    }

    if (user.role === 'USER') {
      throw new AppException('FORBIDDEN', {
        detail: 'Привязать запись реестра персональных данных может руководитель или администратор.',
      });
    }

    const person = await this.prisma.person.findFirst({
      where: { id: personId, erasedAt: null },
      select: { id: true },
    });

    if (!person) {
      throw new AppException('VALIDATION_FAILED', {
        detail: 'Запись реестра не найдена либо обезличена.',
        issues: [{ field: 'counterpartyContactId', message: 'Выберите действующую запись реестра' }],
      });
    }
  }

  /**
   * Рассчитывает доступные переходы и причины недоступности.
   *
   * Недоступные переходы не скрываются, а отдаются с пояснением: пользователю
   * важно понимать, чего не хватает для продвижения («приложите документ»),
   * а не гадать, почему кнопка исчезла.
   */
  private computeAvailableTransitions(
    definition: ReturnType<WorkflowService['parseDefinition']>,
    currentStateKey: string,
    user: AuthenticatedUser,
    stageDocumentPresent: boolean,
  ): AvailableTransitionDto[] {
    const currentState = findState(definition, currentStateKey);
    const needsAttachment = currentState?.requiresAttachment === true && !stageDocumentPresent;

    return transitionsFrom(definition, currentStateKey).map((transition) => {
      const roleAllowed =
        transition.allowedRoles.length === 0 || transition.allowedRoles.includes(user.role);

      let blockedReason: string | null = null;
      if (!roleAllowed) {
        blockedReason = `Действие доступно ролям: ${transition.allowedRoles.join(', ')}`;
      } else if (needsAttachment) {
        blockedReason = 'Приложите подтверждающий документ к текущему этапу';
      }

      return {
        toStateKey: transition.to,
        toStateLabel: findState(definition, transition.to)?.label ?? transition.to,
        label: transition.label,
        requiresComment: transition.requiresComment,
        requiresAttachment: currentState?.requiresAttachment === true,
        allowed: blockedReason === null,
        blockedReason,
      };
    });
  }
}

/**
 * Состав полей строки списка. Экспортируется: ленте действий нужны
 * те же карточки в том же виде, что и списку заявок.
 */
export const engagementListSelection = {
  id: true,
  segment: true,
  counterpartyType: true,
  counterpartyName: true,
  universityId: true,
  directionId: true,
  productId: true,
  programId: true,
  externalSource: true,
  ownerId: true,
  currentStateKey: true,
  currentStateLabel: true,
  interestLevel: true,
  isArchived: true,
  createdAt: true,
  updatedAt: true,
  university: { select: { name: true, shortName: true } },
  direction: { select: { name: true } },
  product: { select: { name: true } },
  program: { select: { name: true } },
  owner: { select: { displayName: true } },
  workflowInstance: { select: { slaDueAt: true, completedAt: true } },
} satisfies Prisma.EngagementSelect;

type ListRecord = {
  id: string;
  segment: EngagementSegment;
  counterpartyType: CounterpartyType;
  counterpartyName: string | null;
  universityId: string | null;
  directionId: string;
  productId: string | null;
  programId: string | null;
  externalSource: string | null;
  ownerId: string;
  currentStateKey: string;
  currentStateLabel: string;
  interestLevel: InterestLevel | null;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
  university: { name: string; shortName: string | null } | null;
  direction: { name: string };
  product: { name: string } | null;
  program: { name: string } | null;
  owner: { displayName: string };
  workflowInstance: { slaDueAt: Date | null; completedAt: Date | null } | null;
};

/** Порядок списка. Заявки без оценки при сортировке по ней всегда в конце. */
function buildOrderBy(query: EngagementQueryDto): Prisma.EngagementOrderByWithRelationInput[] {
  const order = query.sortOrder;

  switch (query.sortBy) {
    case 'universityName':
      return [{ university: { name: order } }, { id: 'asc' }];
    case 'interestLevel':
      return [{ interestLevel: { sort: order, nulls: 'last' } }, { updatedAt: 'desc' }, { id: 'asc' }];
    case 'createdAt':
      return [{ createdAt: order }, { id: 'asc' }];
    default:
      return [{ updatedAt: order }, { id: 'asc' }];
  }
}

/**
 * Итог правки оценки заинтересованности.
 *
 * Снятие оценки убирает и обоснование: причина без оценки ничего не
 * объясняет. Обоснование без оценки — ошибка ввода, а не пустая операция.
 */
function resolveInterestChange(
  existing: { interestLevel: InterestLevel | null; interestComment: string | null },
  dto: UpdateEngagementDto,
): { changed: boolean; level: InterestLevel | null; comment: string | null } {
  const level = dto.interestLevel !== undefined ? dto.interestLevel : existing.interestLevel;
  let comment =
    dto.interestComment !== undefined ? dto.interestComment?.trim() || null : existing.interestComment;

  if (level === null) {
    if (dto.interestComment) {
      throw new AppException('VALIDATION_FAILED', {
        detail: 'Обоснование указывается вместе с оценкой заинтересованности.',
        issues: [{ field: 'interestLevel', message: 'Выберите оценку: LOW, MEDIUM или HIGH' }],
      });
    }
    comment = null;
  }

  const changed = level !== existing.interestLevel || comment !== existing.interestComment;

  return { changed, level, comment };
}

/** Строки группировки по этапу в вид, понятный сводке этапов. */
function toStageCounts(
  groups: Array<{ stateKey: string | null; stateLabel: string | null; _count: { _all: number } }>,
): Array<{ stateKey: string; stateLabel: string | null; count: number }> {
  return groups
    .filter((group): group is typeof group & { stateKey: string } => group.stateKey !== null)
    .map((group) => ({ stateKey: group.stateKey, stateLabel: group.stateLabel, count: group._count._all }));
}

function sumCounts(groups: Array<{ _count: { _all: number } }>): number {
  return groups.reduce((sum, group) => sum + group._count._all, 0);
}

function toArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

/**
 * Приводит реквизиты контрагента к записываемому виду и проверяет их состав.
 *
 * Та же проверка продублирована CHECK-ограничением таблицы, и это не лишнее:
 * ограничение защищает данные от импорта и синхронизации, а проверка здесь
 * даёт пользователю понятный ответ с указанием незаполненного поля вместо
 * отказа СУБД.
 */
function resolveCounterparty(
  segment: EngagementSegment,
  dto: CreateEngagementDto,
): { universityId: string | null; type: CounterpartyType; name: string | null } {
  if (segment === 'B2B') {
    if (!dto.universityId) {
      throw new AppException('VALIDATION_FAILED', {
        detail: 'Для взаимодействия с вузом необходимо указать вуз.',
        issues: [{ field: 'universityId', message: 'Укажите вуз' }],
      });
    }

    return { universityId: dto.universityId, type: 'UNIVERSITY', name: null };
  }

  const name = dto.counterpartyName?.trim();

  if (!name) {
    throw new AppException('VALIDATION_FAILED', {
      detail: 'Для прямой работы необходимо указать наименование контрагента.',
      issues: [{ field: 'counterpartyName', message: 'Укажите контрагента' }],
    });
  }

  const type = dto.counterpartyType ?? 'PERSON';

  if (type === 'UNIVERSITY') {
    throw new AppException('VALIDATION_FAILED', {
      detail:
        'Вуз не может быть контрагентом прямой продажи: для работы с учебным ' +
        'заведением используется сегмент B2B.',
      issues: [{ field: 'counterpartyType', message: 'Допустимо PERSON либо COMPANY' }],
    });
  }

  return { universityId: null, type, name };
}

/** Строка списка заявок. Экспортируется для ленты действий. */
export function toEngagementListItem(record: ListRecord): EngagementListItemDto {
  const slaDueAt = record.workflowInstance?.slaDueAt ?? null;
  const completed = record.workflowInstance?.completedAt != null;

  return {
    id: record.id,
    segment: record.segment,
    counterpartyType: record.counterpartyType,
    // Для B2B имя контрагента — это наименование вуза. Пустая строка
    // недостижима: CHECK-ограничение таблицы требует либо вуза, либо
    // наименования контрагента.
    counterpartyName: record.university?.name ?? record.counterpartyName ?? '',
    universityId: record.universityId,
    universityName: record.university?.name ?? null,
    universityShortName: record.university?.shortName ?? null,
    directionId: record.directionId,
    directionName: record.direction.name,
    productId: record.productId,
    productName: record.product?.name ?? null,
    programId: record.programId,
    programName: record.program?.name ?? null,
    externalSource: record.externalSource,
    ownerId: record.ownerId,
    ownerName: record.owner.displayName,
    currentStateKey: record.currentStateKey,
    currentStateLabel: record.currentStateLabel,
    slaDueAt,
    interestLevel: record.interestLevel,
    // Завершённое взаимодействие не считается просроченным, даже если
    // норматив последнего этапа формально истёк.
    isOverdue: !completed && slaDueAt !== null && slaDueAt.getTime() < Date.now(),
    isArchived: record.isArchived,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
