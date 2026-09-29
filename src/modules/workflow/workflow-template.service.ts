import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { Prisma } from '../../generated/prisma/client.js';
import { EngagementSegment } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { AUDIT_ACTIONS, AuditService } from '../audit/audit.service.js';
import { WorkflowService } from './workflow.service.js';
import { WorkflowDefinition, findState } from './workflow-definition.js';
import { diffDefinitions, validateMapping } from './workflow-diff.js';
import { recordActivities } from '../activity/activity-log.js';
import { enqueueEngagementEvent } from '../integration/outbox.js';
import { PUBLISH_LOCK_ID } from './workflow-lock.js';
import type { EducationProject } from '../../generated/prisma/enums.js';
import { projectFromApi, projectToApi } from '../catalog/catalog-enums.js';
import {
  CreateWorkflowTemplateDto,
  PublishWorkflowTemplateDto,
  UpdateWorkflowTemplateDto,
  WorkflowPublishPreviewDto,
  WorkflowPublishResultDto,
  WorkflowTemplateDetailDto,
  WorkflowTemplateQueryDto,
  WorkflowTemplateSummaryDto,
} from './dto/workflow.dto.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';


/** Комментарий, с которым заявка переносится при удалении статуса. */
const RELOCATION_COMMENT =
  'Автоматический перенос: статус удалён при изменении схемы процесса';

/**
 * Редактор процессов.
 *
 * Отделён от движка (WorkflowService) намеренно: движок исполняет процесс
 * для каждой заявки, а этот сервис меняет сам процесс — операция редкая,
 * административная и затрагивающая все заявки сегмента сразу.
 *
 * Главное правило, заданное заказчиком: процесс един для всех и редакции
 * не сосуществуют. Публикация новой редакции переводит на неё ВСЕ текущие
 * заявки сегмента, а прошлые редакции остаются только как журнал изменений.
 */
@Injectable()
export class WorkflowTemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: WorkflowService,
    private readonly audit: AuditService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WorkflowTemplateService.name);
  }

  /** Перечень редакций процессов. */
  async list(query: WorkflowTemplateQueryDto): Promise<WorkflowTemplateSummaryDto[]> {
    const templates = await this.prisma.workflowTemplate.findMany({
      where: {
        ...(query.segment ? { segment: query.segment } : {}),
        ...(query.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ segment: 'asc' }, { key: 'asc' }, { version: 'desc' }],
    });

    const counts = await this.prisma.workflowInstance.groupBy({
      by: ['templateId'],
      _count: { _all: true },
    });
    const countByTemplate = new Map(counts.map((row) => [row.templateId, row._count._all]));

    return templates.map((template) => ({
      ...this.toSummary(template),
      engagementCount: countByTemplate.get(template.id) ?? 0,
    }));
  }

  /** Редакция целиком, вместе с определением процесса. */
  async findOne(id: string): Promise<WorkflowTemplateDetailDto> {
    const template = await this.prisma.workflowTemplate.findUnique({ where: { id } });

    if (!template) {
      throw new AppException('NOT_FOUND', { detail: 'Редакция процесса не найдена.' });
    }

    const engagementCount = await this.prisma.workflowInstance.count({
      where: { templateId: id },
    });

    return {
      ...this.toSummary(template),
      engagementCount,
      definition: template.definition as Record<string, unknown>,
    };
  }

  /**
   * Черновик новой редакции.
   *
   * Черновик не действует ни на одну заявку: он существует, чтобы схему
   * можно было собрать и проверить, не останавливая работу. Действующей
   * редакция становится только после публикации.
   */
  async createDraft(
    dto: CreateWorkflowTemplateDto,
    user: AuthenticatedUser,
  ): Promise<WorkflowTemplateDetailDto> {
    // Проверка определения выполняется до записи: схема с недостижимым
    // состоянием или ссылкой на несуществующий статус не должна попадать
    // в базу даже в виде черновика.
    const definition = this.workflow.parseDefinition(dto.definition);
    const segment: EngagementSegment = dto.segment ?? 'B2B';
    const key = dto.key ?? `process-${Date.now().toString(36)}`;

    const last = await this.prisma.workflowTemplate.findFirst({
      where: { key },
      orderBy: { version: 'desc' },
      select: { version: true, segment: true, siteSource: true },
    });

    if (last && last.segment !== segment) {
      throw new AppException('VALIDATION_FAILED', {
        detail: `Процесс ${key} относится к сегменту ${last.segment}; сменить сегмент у существующего процесса нельзя.`,
        issues: [{ field: 'segment', message: 'Сегмент не совпадает с предыдущими редакциями' }],
      });
    }

    const created = await this.prisma.workflowTemplate.create({
      data: {
        key,
        version: (last?.version ?? 0) + 1,
        segment,
        // Следующая редакция наследует сайт процесса, если его не сменили явно.
        siteSource:
          dto.siteSource === undefined
            ? (last?.siteSource ?? null)
            : dto.siteSource === null
              ? null
              : projectFromApi(dto.siteSource),
        name: dto.name,
        description: dto.description ?? null,
        definition: definition as unknown as Prisma.InputJsonValue,
        isActive: false,
        isDefault: false,
      },
    });

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTIONS.WORKFLOW_TEMPLATE_CREATE,
      entityType: 'WorkflowTemplate',
      entityId: created.id,
      afterState: { key, version: created.version, segment, states: definition.states.length },
    });

    return { ...this.toSummary(created), engagementCount: 0, definition: dto.definition };
  }

  /** Правка черновика. Действующая редакция неизменна. */
  async updateDraft(
    id: string,
    dto: UpdateWorkflowTemplateDto,
    user: AuthenticatedUser,
  ): Promise<WorkflowTemplateDetailDto> {
    const template = await this.prisma.workflowTemplate.findUnique({ where: { id } });

    if (!template) {
      throw new AppException('NOT_FOUND', { detail: 'Редакция процесса не найдена.' });
    }

    if (template.isActive) {
      throw new AppException('WF_TEMPLATE_NOT_EDITABLE', {
        detail:
          'Редакция действует: по ней ведутся текущие заявки. Создайте черновик ' +
          'следующей редакции и опубликуйте его.',
        meta: { templateId: id, key: template.key, version: template.version },
      });
    }

    // Редакция, уже побывавшая действующей, — запись журнала изменений схемы.
    // Прежде проверялся только признак «действует сейчас», и прошлую редакцию
    // можно было переписать задним числом, а затем опубликовать снова.
    if (template.publishedAt !== null) {
      throw new AppException('WF_TEMPLATE_NOT_EDITABLE', {
        detail:
          'Эта редакция уже публиковалась и хранится как журнал изменений схемы. ' +
          'Чтобы вернуться к ней, создайте новый черновик с тем же определением.',
        meta: { templateId: id, key: template.key, version: template.version },
      });
    }

    const definition = dto.definition ? this.workflow.parseDefinition(dto.definition) : null;

    const updated = await this.prisma.workflowTemplate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.siteSource !== undefined
          ? { siteSource: dto.siteSource === null ? null : projectFromApi(dto.siteSource) }
          : {}),
        ...(definition ? { definition: definition as unknown as Prisma.InputJsonValue } : {}),
      },
    });

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTIONS.WORKFLOW_TEMPLATE_UPDATE,
      entityType: 'WorkflowTemplate',
      entityId: id,
      beforeState: { name: template.name, description: template.description },
      afterState: { name: updated.name, description: updated.description },
    });

    return {
      ...this.toSummary(updated),
      engagementCount: 0,
      definition: updated.definition as Record<string, unknown>,
    };
  }

  /**
   * Предварительный просмотр публикации.
   *
   * Отдаёт ровно то, что должен показать диалог подтверждения: что
   * изменится, сколько заявок это затронет и куда предлагается перевести
   * заявки из исчезающих статусов.
   */
  async previewPublish(id: string): Promise<WorkflowPublishPreviewDto> {
    const context = await this.loadPublishContext(id);
    const { next, current, nextDefinition, currentDefinition } = context;

    const occupancy = await this.stateOccupancy(next.segment);

    if (!current || !currentDefinition) {
      // Первая публикация в сегменте: сравнивать не с чем, переносить нечего.
      return {
        currentTemplateId: null,
        nextTemplateId: next.id,
        addedStates: nextDefinition.states.map((state) => ({
          key: state.key,
          label: state.label,
        })),
        removedStates: [],
        renamedStates: [],
        transitionsChanged: false,
        affectedEngagements: 0,
        relocatedEngagements: 0,
        relocatedNotes: 0,
        relocatedAttachments: 0,
        suggestedMapping: {},
        blockingIssues: [],
      };
    }

    const diff = diffDefinitions(currentDefinition, nextDefinition);
    const stageItems = await this.stageItemsOfOccupants(
      next.segment,
      diff.removedStates.map((removed) => removed.key),
    );

    const suggestedMapping: Record<string, string> = {};
    let relocated = 0;
    const blockingIssues: string[] = [];

    for (const removed of diff.removedStates) {
      const occupied = occupancy.get(removed.key) ?? 0;

      if (occupied === 0) {
        continue;
      }

      relocated += occupied;

      if (removed.suggestedTarget) {
        suggestedMapping[removed.key] = removed.suggestedTarget;
      } else {
        blockingIssues.push(
          `Статус «${removed.label}»: ${occupied} заявок, соседний статус подобрать не удалось — укажите цель переноса вручную`,
        );
      }
    }

    const affected = [...occupancy.values()].reduce((sum, count) => sum + count, 0);

    return {
      currentTemplateId: current.id,
      nextTemplateId: next.id,
      addedStates: diff.addedStates,
      removedStates: diff.removedStates.map((removed) => ({
        key: removed.key,
        label: removed.label,
        engagementCount: occupancy.get(removed.key) ?? 0,
        noteCount: stageItems.get(removed.key)?.notes ?? 0,
        attachmentCount: stageItems.get(removed.key)?.attachments ?? 0,
        suggestedTarget: removed.suggestedTarget,
      })),
      renamedStates: diff.renamedStates,
      transitionsChanged: diff.transitionsChanged,
      affectedEngagements: affected,
      relocatedEngagements: relocated,
      relocatedNotes: [...stageItems.values()].reduce((sum, item) => sum + item.notes, 0),
      relocatedAttachments: [...stageItems.values()].reduce(
        (sum, item) => sum + item.attachments,
        0,
      ),
      suggestedMapping,
      blockingIssues,
    };
  }

  /**
   * Публикация редакции.
   *
   * Последовательность внутри транзакции выбрана не произвольно:
   *   1. блокировка — чтобы вторая публикация дождалась первой;
   *   2. снятие признаков с действующей редакции — раньше установки новых,
   *      иначе частичный уникальный индекс отверг бы вторую «основную»
   *      редакцию сегмента;
   *   3. перевод всех экземпляров на новую редакцию;
   *   4. перенос заявок из исчезнувших статусов с записью в журнал переходов;
   *   5. обновление подписей переименованных статусов в денормализованном
   *      поле заявки — иначе списки и отчёты показывали бы прежние названия.
   */
  async publish(
    id: string,
    dto: PublishWorkflowTemplateDto,
    user: AuthenticatedUser,
  ): Promise<WorkflowPublishResultDto> {
    const preview = await this.previewPublish(id);

    if (!dto.confirm) {
      throw new AppException('WF_PUBLISH_CONFIRMATION_REQUIRED', {
        detail:
          `Публикация затронет ${preview.affectedEngagements} заявок, из них ` +
          `${preview.relocatedEngagements} сменят статус. Подтвердите операцию.`,
        meta: {
          affectedEngagements: preview.affectedEngagements,
          relocatedEngagements: preview.relocatedEngagements,
        },
      });
    }

    const context = await this.loadPublishContext(id);
    const { next, current, nextDefinition, currentDefinition } = context;

    // Сопоставление, заданное администратором, имеет приоритет над
    // предложенным: подсказка — это подсказка, а не решение.
    const mapping: Record<string, string> = { ...preview.suggestedMapping, ...(dto.stateMapping ?? {}) };
    const diff = current && currentDefinition ? diffDefinitions(currentDefinition, nextDefinition) : null;

    if (current && currentDefinition && diff) {
      const occupancy = await this.stateOccupancy(next.segment);
      const occupiedKeys = new Set(
        [...occupancy.entries()].filter(([, count]) => count > 0).map(([key]) => key),
      );

      const issues = validateMapping(diff, nextDefinition, mapping, occupiedKeys);

      if (issues.length > 0) {
        throw new AppException('WF_PUBLISH_MAPPING_REQUIRED', {
          detail: 'Не для всех исчезающих статусов указано, куда перевести заявки.',
          issues,
        });
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PUBLISH_LOCK_ID})`;

      // Сопоставление статусов рассчитано по редакции, действовавшей до
      // взятия блокировки. Если за это время опубликовали другую, перенос
      // пошёл бы по чужой схеме, поэтому операция прерывается и
      // администратор повторяет предварительный просмотр.
      const stillCurrent = await tx.workflowTemplate.findFirst({
        where: { segment: next.segment, isActive: true, isDefault: true },
        select: { id: true },
      });

      if ((stillCurrent?.id ?? null) !== (current?.id ?? null)) {
        throw new AppException('CONFLICT', {
          detail:
            'Действующая редакция процесса изменилась, пока готовилась публикация. ' +
            'Повторите предварительный просмотр и опубликуйте заново.',
        });
      }

      // Заявки, оказавшиеся вне новой схемы, пересчитываются уже под
      // блокировкой. Сопоставление строилось по занятости статусов до неё,
      // и заявка, переведённая в удаляемый статус в эти секунды, осталась бы
      // в статусе, которого в новой редакции нет, — без единого перехода.
      const nextKeys = nextDefinition.states.map((state) => state.key);
      const stranded = await tx.engagement.groupBy({
        by: ['currentStateKey'],
        where: { segment: next.segment, currentStateKey: { notIn: nextKeys } },
        _count: { _all: true },
      });
      const unmapped: Array<{ field: string; message: string }> = [];

      for (const row of stranded) {
        if (mapping[row.currentStateKey] && nextKeys.includes(mapping[row.currentStateKey] as string)) {
          continue;
        }

        const suggested = diff?.removedStates.find((removed) => removed.key === row.currentStateKey)?.suggestedTarget;

        if (suggested) {
          mapping[row.currentStateKey] = suggested;
        } else {
          unmapped.push({
            field: `stateMapping.${row.currentStateKey}`,
            message: `Укажите, куда перевести заявки из статуса ${row.currentStateKey} (${row._count._all})`,
          });
        }
      }

      if (unmapped.length > 0) {
        throw new AppException('WF_PUBLISH_MAPPING_REQUIRED', {
          detail: 'Заявки стоят в статусах, которых нет в новой редакции. Укажите, куда их перевести.',
          issues: unmapped,
        });
      }

      await tx.workflowTemplate.updateMany({
        where: { segment: next.segment, isActive: true },
        data: { isActive: false, isDefault: false },
      });

      await tx.workflowTemplate.update({
        where: { id: next.id },
        data: { isActive: true, isDefault: true, publishedAt: new Date() },
      });

      // Экземпляры переводятся по сегменту, а не по прежней редакции:
      // так на новую схему переходят и заявки, оставшиеся от прошлых
      // редакций, и сосуществование схем становится невозможным.
      const moved = await tx.workflowInstance.updateMany({
        where: { engagement: { segment: next.segment } },
        data: { templateId: next.id },
      });

      let relocated = 0;
      const survivingKeys = new Set(nextDefinition.states.map((state) => state.key));

      for (const [fromKey, toKey] of Object.entries(mapping)) {
        const target = findState(nextDefinition, toKey);

        // Переносим только из статусов, которых в новой редакции нет.
        // Лишняя запись в сопоставлении не должна двигать заявки, стоящие
        // в сохранившемся статусе.
        if (!target || survivingKeys.has(fromKey)) {
          continue;
        }

        const affected = await tx.engagement.findMany({
          where: { segment: next.segment, currentStateKey: fromKey },
          select: {
            id: true,
            currentStateLabel: true,
            workflowInstance: { select: { id: true } },
          },
        });

        if (affected.length === 0) {
          continue;
        }

        const slaDueAt = target.slaDays
          ? new Date(Date.now() + target.slaDays * 24 * 60 * 60 * 1000)
          : null;

        await tx.engagement.updateMany({
          where: { segment: next.segment, currentStateKey: fromKey },
          data: {
            currentStateKey: target.key,
            currentStateLabel: target.label,
            // Версия растёт, чтобы карточка, открытая до переноса, не
            // перезаписала статус по устаревшему значению If-Match.
            version: { increment: 1 },
          },
        });

        // Заявка без экземпляра процесса теоретически возможна только
        // при повреждении данных; такие строки пропускаются, а не роняют
        // публикацию целиком.
        const instanceIds = affected
          .map((row) => row.workflowInstance?.id)
          .filter((value): value is string => typeof value === 'string');

        await tx.workflowInstance.updateMany({
          where: { id: { in: instanceIds } },
          data: {
            currentStateKey: target.key,
            enteredAt: new Date(),
            slaDueAt,
            completedAt: target.isFinal ? new Date() : null,
          },
        });

        const journal = await tx.workflowTransition.createManyAndReturn({
          data: affected
            .filter((row) => row.workflowInstance)
            .map((row) => ({
              instanceId: row.workflowInstance?.id as string,
              fromStateKey: fromKey,
              fromStateLabel: row.currentStateLabel,
              toStateKey: target.key,
              toStateLabel: target.label,
              actorId: user.id,
              comment: RELOCATION_COMMENT,
            })),
          select: { id: true, instanceId: true },
        });

        // Заметки и файлы этапа переезжают вместе с заявкой: для неё это
        // по-прежнему «текущий этап», и без переноса они выпали бы из него,
        // а условие «приложите документ» нового статуса не увидело бы уже
        // приложенный файл. Подпись этапа остаётся прежней — по ней видно,
        // где запись была сделана. Заявки, давно ушедшие с удаляемого этапа,
        // не трогаются: их заметки — история, и переписывать её незачем.
        const affectedIds = affected.map((row) => row.id);

        await tx.engagementNote.updateMany({
          where: { engagementId: { in: affectedIds }, stateKey: fromKey },
          data: { stateKey: target.key },
        });

        await tx.attachment.updateMany({
          where: { entityType: 'ENGAGEMENT', entityId: { in: affectedIds }, stateKey: fromKey },
          data: { stateKey: target.key },
        });

        // Внешние системы узнают о переносе так же, как о любом переходе:
        // иначе после публикации их статус заявки расходился бы с CRM.
        for (const row of affected) {
          await enqueueEngagementEvent(tx, 'engagement.state_changed', {
            engagementId: row.id,
            previousStatus: { key: fromKey, label: row.currentStateLabel },
          });
        }

        const engagementByInstance = new Map(
          affected.map((row) => [row.workflowInstance?.id, row]),
        );

        await recordActivities(
          tx,
          journal.map((entry) => ({
            type: 'STATE_CHANGED' as const,
            source: 'WORKFLOW' as const,
            actorId: user.id,
            engagementId: engagementByInstance.get(entry.instanceId)?.id ?? null,
            stage: { key: target.key, label: target.label },
            transitionId: entry.id,
            details: {
              fromStateKey: fromKey,
              fromStateLabel:
                engagementByInstance.get(entry.instanceId)?.currentStateLabel ?? fromKey,
              toStateKey: target.key,
              toStateLabel: target.label,
              templateId: next.id,
              templateVersion: next.version,
            },
          })),
        );

        relocated += affected.length;
      }

      // Норматив и признак завершения сохранившихся этапов. Изменения
      // применяются ко всем сразу, в том числе к заявкам, которые уже стоят
      // на этапе: прежде у них оставался старый срок, а этап, ставший
      // завершающим, продолжал считаться незавершённым — с просрочкой
      // и напоминаниями о простое.
      if (currentDefinition) {
        for (const state of nextDefinition.states) {
          const before = findState(currentDefinition, state.key);

          if (!before || (before.slaDays === state.slaDays && before.isFinal === state.isFinal)) {
            continue;
          }

          const slaDays = state.slaDays ?? null;

          await tx.$executeRaw`
            UPDATE workflow_instance AS wi
            SET sla_due_at = CASE
                  WHEN ${slaDays}::int IS NULL THEN NULL
                  ELSE wi.entered_at + make_interval(days => ${slaDays}::int)
                END,
                completed_at = CASE
                  WHEN ${state.isFinal} THEN coalesce(wi.completed_at, now())
                  ELSE NULL
                END,
                updated_at = now()
            FROM engagement AS e
            WHERE e.id = wi.engagement_id
              AND e.segment = ${next.segment}::"EngagementSegment"
              AND wi.current_state_key = ${state.key}
          `;
        }
      }

      // Переименования: ключ статуса прежний, поэтому заявки никуда
      // не переезжают, но денормализованная подпись в карточке обязана
      // обновиться вместе со схемой.
      for (const state of nextDefinition.states) {
        await tx.engagement.updateMany({
          where: {
            segment: next.segment,
            currentStateKey: state.key,
            currentStateLabel: { not: state.label },
          },
          data: { currentStateLabel: state.label },
        });
      }

      return { moved: moved.count, relocated };
    });

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTIONS.WORKFLOW_TEMPLATE_PUBLISH,
      entityType: 'WorkflowTemplate',
      entityId: next.id,
      beforeState: current
        ? { templateId: current.id, key: current.key, version: current.version }
        : null,
      afterState: {
        templateId: next.id,
        key: next.key,
        version: next.version,
        segment: next.segment,
        stateMapping: mapping,
        movedEngagements: result.moved,
        relocatedEngagements: result.relocated,
      },
    });

    this.logger.info(
      {
        templateId: next.id,
        segment: next.segment,
        moved: result.moved,
        relocated: result.relocated,
      },
      'Опубликована новая редакция процесса',
    );

    return {
      templateId: next.id,
      version: next.version,
      movedEngagements: result.moved,
      relocatedEngagements: result.relocated,
    };
  }

  /** Загружает публикуемую редакцию вместе с действующей. */
  private async loadPublishContext(id: string): Promise<{
    next: {
      id: string;
      key: string;
      version: number;
      segment: EngagementSegment;
    };
    current: { id: string; key: string; version: number } | null;
    nextDefinition: WorkflowDefinition;
    currentDefinition: WorkflowDefinition | null;
  }> {
    const next = await this.prisma.workflowTemplate.findUnique({ where: { id } });

    if (!next) {
      throw new AppException('NOT_FOUND', { detail: 'Редакция процесса не найдена.' });
    }

    if (next.isActive) {
      throw new AppException('WF_TEMPLATE_NOT_EDITABLE', {
        detail: 'Редакция уже действует, публиковать её повторно не нужно.',
        meta: { templateId: id },
      });
    }

    // Повторная публикация прошлой редакции переписала бы дату её публикации
    // и перемешала журнал изменений. Возврат к старой схеме — это новый
    // черновик с её определением: так в журнале видно, что и когда вернули.
    if (next.publishedAt !== null) {
      throw new AppException('WF_TEMPLATE_NOT_EDITABLE', {
        detail:
          'Эта редакция уже публиковалась. Чтобы вернуться к ней, создайте новый ' +
          'черновик с тем же определением и опубликуйте его.',
        meta: { templateId: id },
      });
    }

    const current = await this.prisma.workflowTemplate.findFirst({
      where: { segment: next.segment, isActive: true, isDefault: true },
    });

    return {
      next: { id: next.id, key: next.key, version: next.version, segment: next.segment },
      current: current
        ? { id: current.id, key: current.key, version: current.version }
        : null,
      nextDefinition: this.workflow.parseDefinition(next.definition),
      currentDefinition: current ? this.workflow.parseDefinition(current.definition) : null,
    };
  }

  /**
   * Сколько заметок и файлов переедет вместе с заявками из удаляемых статусов.
   *
   * Считаются записи только тех заявок, что стоят в удаляемом статусе сейчас:
   * переезжают именно они, а заметки давно ушедших дальше заявок остаются
   * историей на прежнем этапе.
   */
  private async stageItemsOfOccupants(
    segment: EngagementSegment,
    removedKeys: string[],
  ): Promise<Map<string, { notes: number; attachments: number }>> {
    const result = new Map<string, { notes: number; attachments: number }>();

    if (removedKeys.length === 0) {
      return result;
    }

    const occupants = await this.prisma.engagement.findMany({
      where: { segment, currentStateKey: { in: removedKeys } },
      select: { id: true, currentStateKey: true },
    });

    if (occupants.length === 0) {
      return result;
    }

    const stateOf = new Map(occupants.map((row) => [row.id, row.currentStateKey]));
    const ids = occupants.map((row) => row.id);

    const [notes, attachments] = await Promise.all([
      this.prisma.engagementNote.groupBy({
        by: ['engagementId', 'stateKey'],
        where: { engagementId: { in: ids }, stateKey: { in: removedKeys }, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.attachment.groupBy({
        by: ['entityId', 'stateKey'],
        where: {
          entityType: 'ENGAGEMENT',
          entityId: { in: ids },
          stateKey: { in: removedKeys },
          deletedAt: null,
        },
        _count: { _all: true },
      }),
    ]);

    const bucket = (key: string) => {
      const existing = result.get(key) ?? { notes: 0, attachments: 0 };
      result.set(key, existing);
      return existing;
    };

    // Запись переезжает, только если её этап совпадает с текущим статусом
    // заявки: заметка на удаляемом этапе у заявки, стоящей в другом
    // удаляемом этапе, остаётся на месте.
    for (const row of notes) {
      if (row.stateKey && stateOf.get(row.engagementId) === row.stateKey) {
        bucket(row.stateKey).notes += row._count._all;
      }
    }

    for (const row of attachments) {
      if (row.stateKey && stateOf.get(row.entityId) === row.stateKey) {
        bucket(row.stateKey).attachments += row._count._all;
      }
    }

    return result;
  }

  /** Сколько заявок сегмента стоит в каждом статусе. */
  private async stateOccupancy(segment: EngagementSegment): Promise<Map<string, number>> {
    const rows = await this.prisma.engagement.groupBy({
      by: ['currentStateKey'],
      where: { segment },
      _count: { _all: true },
    });

    return new Map(rows.map((row) => [row.currentStateKey, row._count._all]));
  }

  private toSummary(template: {
    id: string;
    key: string;
    version: number;
    name: string;
    description: string | null;
    segment: EngagementSegment;
    siteSource: EducationProject | null;
    isActive: boolean;
    isDefault: boolean;
    publishedAt: Date | null;
    definition: unknown;
  }): Omit<WorkflowTemplateSummaryDto, 'engagementCount'> {
    const states = (template.definition as { states?: unknown[] } | null)?.states;

    return {
      id: template.id,
      key: template.key,
      version: template.version,
      name: template.name,
      description: template.description,
      segment: template.segment,
      siteSource: template.siteSource ? projectToApi(template.siteSource) : null,
      isActive: template.isActive,
      isDefault: template.isDefault,
      publishedAt: template.publishedAt,
      stateCount: Array.isArray(states) ? states.length : 0,
    };
  }
}
