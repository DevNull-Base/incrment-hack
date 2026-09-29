import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { AppConfig } from '../../config/configuration.js';
import { Prisma } from '../../generated/prisma/client.js';
import { IntegrationSourceType } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { QUEUES } from '../../infrastructure/queue/queue.module.js';
import { AppException } from '../../common/errors/app-exception.js';
import { WorkflowService } from '../workflow/workflow.service.js';
import { initialState } from '../workflow/workflow-definition.js';
import { recordActivity } from '../activity/activity-log.js';
import { pickLeastLoadedOwner } from './owner-assignment.js';
import { assertTemplateStillActive } from '../workflow/workflow-lock.js';
import { verifyWebhookSignature } from './webhook-signature.js';
import {
  EngagementPayload,
  InboundEvent,
  engagementPayloadSchema,
  inboundEventSchema,
} from './contracts/engagement-contract.js';
import {
  HttpIntegrationAdapter,
  IntegrationAdapter,
  StubIntegrationAdapter,
} from './adapters/integration-adapter.js';
import { LMS_STUB_EVENTS, WEBSITE_STUB_EVENTS } from './adapters/stub-fixtures.js';
import { IntegrationSourceDto, IntegrationSyncRunDto } from './dto/integration.dto.js';

/** Вид записи в промежуточном хранилище. */
const INBOUND_KIND = 'inbound-event';

/** Сколько исходящих событий отправляется за один заход. */
const OUTBOX_BATCH = 100;

/** После скольких неудач событие перестаёт отправляться. */
const OUTBOX_MAX_ATTEMPTS = 10;

/**
 * Обмен с LMS и сайтом.
 *
 * Обмен двусторонний: CRM забирает события внешних систем и отправляет им
 * изменения по своим заявкам. Оба направления работают и в режиме заглушек,
 * и по HTTP — контракт внешних систем ещё не передан, поэтому режим по
 * умолчанию stub, а переключение на боевой обмен не меняет логику.
 *
 * Входящие данные сначала попадают в промежуточное хранилище в исходном
 * виде и только потом разбираются. Это позволяет разобрать инцидент
 * и повторно проиграть синхронизацию, не обращаясь к внешней системе,
 * которая к тому моменту может отдавать уже другие данные.
 */
@Injectable()
export class IntegrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: WorkflowService,
    private readonly config: ConfigService<AppConfig, true>,
    @InjectQueue(QUEUES.INTEGRATION) private readonly queue: Queue,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(IntegrationService.name);
  }

  async listSources(): Promise<IntegrationSourceDto[]> {
    const sources = await this.prisma.integrationSource.findMany({ orderBy: { name: 'asc' } });
    const mode = this.config.get('INTEGRATION_MODE', { infer: true });

    return sources.map((source) => ({
      id: source.id,
      type: source.type,
      name: source.name,
      baseUrl: source.baseUrl,
      isEnabled: source.isEnabled,
      syncCursor: source.syncCursor,
      cronSchedule: source.cronSchedule,
      mode,
    }));
  }

  async listRuns(sourceId?: string): Promise<IntegrationSyncRunDto[]> {
    const runs = await this.prisma.integrationSyncRun.findMany({
      where: sourceId ? { sourceId } : {},
      orderBy: { startedAt: 'desc' },
      take: 50,
    });

    return runs.map((run) => ({
      id: run.id,
      sourceId: run.sourceId,
      status: run.status,
      fetched: run.fetched,
      created: run.created,
      updated: run.updated,
      skipped: run.skipped,
      failed: run.failed,
      errorDetail: run.errorDetail,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    }));
  }

  /**
   * Постановка синхронизации в очередь.
   *
   * Запись о прогоне создаётся сразу, до выполнения: иначе между нажатием
   * кнопки и началом работы обработчика администратор не видел бы ничего
   * и запускал бы синхронизацию повторно.
   */
  async requestSync(sourceId: string): Promise<IntegrationSyncRunDto> {
    const source = await this.prisma.integrationSource.findUnique({ where: { id: sourceId } });

    if (!source) {
      throw new AppException('NOT_FOUND', { detail: 'Источник интеграции не найден.' });
    }

    if (!source.isEnabled) {
      throw new AppException('VALIDATION_FAILED', {
        detail: `Источник «${source.name}» выключен. Включите его перед синхронизацией.`,
      });
    }

    const running = await this.prisma.integrationSyncRun.findFirst({
      where: { sourceId, status: 'RUNNING' },
    });

    if (running) {
      throw new AppException('INTEGRATION_SYNC_IN_PROGRESS', {
        detail: `Синхронизация источника «${source.name}» уже выполняется.`,
        meta: { runId: running.id, startedAt: running.startedAt.toISOString() },
      });
    }

    const run = await this.prisma.integrationSyncRun.create({
      data: { sourceId, status: 'RUNNING' },
    });

    await this.queue.add('sync', { runId: run.id, sourceId });

    return {
      id: run.id,
      sourceId: run.sourceId,
      status: run.status,
      fetched: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      errorDetail: null,
      startedAt: run.startedAt,
      finishedAt: null,
    };
  }

  /**
   * Сброс курсора выборки.
   *
   * Нужен при разборе инцидентов: после сброса система заново читает события
   * внешней системы с начала. Дублей это не создаёт — уже применённые
   * события опознаются по их идентификатору в промежуточном хранилище
   * и пропускаются.
   */
  async resetCursor(sourceId: string): Promise<IntegrationSourceDto> {
    const source = await this.prisma.integrationSource.findUnique({ where: { id: sourceId } });

    if (!source) {
      throw new AppException('NOT_FOUND', { detail: 'Источник интеграции не найден.' });
    }

    const updated = await this.prisma.integrationSource.update({
      where: { id: sourceId },
      data: { syncCursor: null },
    });

    this.logger.info({ sourceId }, 'Курсор синхронизации сброшен');

    return {
      id: updated.id,
      type: updated.type,
      name: updated.name,
      baseUrl: updated.baseUrl,
      isEnabled: updated.isEnabled,
      syncCursor: updated.syncCursor,
      cronSchedule: updated.cronSchedule,
      mode: this.config.get('INTEGRATION_MODE', { infer: true }),
    };
  }

  /** Выполнение синхронизации. Вызывается обработчиком очереди. */
  async runSync(runId: string, sourceId: string): Promise<void> {
    const source = await this.prisma.integrationSource.findUnique({ where: { id: sourceId } });

    if (!source) {
      await this.prisma.integrationSyncRun.update({
        where: { id: runId },
        data: { status: 'FAILED', errorDetail: 'Источник удалён', finishedAt: new Date() },
      });
      return;
    }

    const adapter = this.buildAdapter(source.type, source.baseUrl);
    const counters = { fetched: 0, created: 0, updated: 0, skipped: 0, failed: 0 };

    try {
      const { events, cursor } = await adapter.fetchEvents(source.syncCursor);
      counters.fetched = events.length;

      for (const raw of events) {
        const outcome = await this.stageAndApply(source.id, source.name, raw);
        counters[outcome] += 1;
      }

      await this.prisma.integrationSource.update({
        where: { id: source.id },
        data: { syncCursor: cursor },
      });

      await this.prisma.integrationSyncRun.update({
        where: { id: runId },
        data: {
          ...counters,
          status: counters.failed > 0 ? 'PARTIAL' : 'SUCCESS',
          finishedAt: new Date(),
        },
      });

      this.logger.info({ sourceId, ...counters }, 'Синхронизация с внешней системой завершена');
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : 'Неизвестная ошибка';

      await this.prisma.integrationSyncRun.update({
        where: { id: runId },
        data: { ...counters, status: 'FAILED', errorDetail: detail, finishedAt: new Date() },
      });

      this.logger.error({ err: error, sourceId }, 'Сбой синхронизации с внешней системой');
    }
  }

  /**
   * Приём события, отправленного внешней системой.
   *
   * Это вторая половина двустороннего обмена: LMS и сайт не только отдают
   * данные по запросу, но и сообщают о событиях сами. Подпись проверяется
   * до разбора содержимого — неподписанный вызов не должен доходить до
   * создания записей.
   */
  async acceptInboundEvent(
    type: IntegrationSourceType,
    rawBody: string,
    signature: string | undefined,
  ): Promise<{ accepted: boolean; outcome: 'created' | 'updated' | 'skipped' | 'failed' }> {
    this.verifySignature(rawBody, signature);

    const source = await this.prisma.integrationSource.findFirst({ where: { type } });

    if (!source) {
      throw new AppException('NOT_FOUND', {
        detail: `Источник интеграции типа ${type} не настроен.`,
      });
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new AppException('MALFORMED_JSON', { detail: 'Тело запроса не является JSON.' });
    }

    const outcome = await this.stageAndApply(source.id, source.name, parsed);

    return { accepted: outcome !== 'failed', outcome };
  }

  /**
   * Отправка накопленных исходящих событий.
   *
   * Вызывается обработчиком по расписанию. События отправляются в порядке
   * возникновения: внешняя система должна видеть переходы заявки в том же
   * порядке, в каком они происходили, иначе её состояние разойдётся с CRM.
   */
  async drainOutbox(options: { deadline?: number } = {}): Promise<{ sent: number; failed: number }> {
    const pending = await this.prisma.outboxEvent.findMany({
      where: { publishedAt: null, attempts: { lt: OUTBOX_MAX_ATTEMPTS } },
      orderBy: { id: 'asc' },
      take: OUTBOX_BATCH,
    });

    if (pending.length === 0) {
      return { sent: 0, failed: 0 };
    }

    const sources = await this.prisma.integrationSource.findMany({ where: { isEnabled: true } });
    const adapters = sources.map((source) => this.buildAdapter(source.type, source.baseUrl));

    let sent = 0;
    let failed = 0;

    for (const event of pending) {
      // Остаток пачки дождётся следующего запуска: отправка, начатая после
      // истечения блокировки, шла бы параллельно следующему запуску.
      if (options.deadline !== undefined && Date.now() > options.deadline) {
        break;
      }

      const data = event.payload as { engagementId?: string; previousStatus?: unknown };

      try {
        if (!data.engagementId) {
          throw new Error('В событии отсутствует идентификатор заявки');
        }

        const payload = await this.buildPayload(
          data.engagementId,
          event.eventType === 'engagement.created'
            ? 'engagement.created'
            : 'engagement.state_changed',
          data.previousStatus as { key: string; label: string } | null,
        );

        for (const adapter of adapters) {
          await adapter.push(payload);
        }

        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { publishedAt: new Date(), attempts: { increment: 1 }, lastError: null },
        });

        sent += 1;
      } catch (error: unknown) {
        failed += 1;

        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            attempts: { increment: 1 },
            lastError: error instanceof Error ? error.message : 'Неизвестная ошибка',
          },
        });
      }
    }

    if (sent > 0 || failed > 0) {
      this.logger.info({ sent, failed }, 'Отправка исходящих событий завершена');
    }

    return { sent, failed };
  }

  /**
   * Состояние заявки в формате контракта engagement.v1.
   *
   * Собирается по актуальным данным в момент отправки и здесь же проверяется
   * собственной схемой: сообщение, не соответствующее опубликованному
   * контракту, не должно уходить наружу — иначе контракт перестаёт быть
   * обязательством.
   */
  async buildPayload(
    engagementId: string,
    event: EngagementPayload['event'],
    previousStatus: { key: string; label: string } | null,
  ): Promise<EngagementPayload> {
    const engagement = await this.prisma.engagement.findUnique({
      where: { id: engagementId },
      select: {
        id: true,
        segment: true,
        counterpartyType: true,
        counterpartyName: true,
        currentStateKey: true,
        currentStateLabel: true,
        universityId: true,
        directionId: true,
        productId: true,
        programId: true,
        ownerId: true,
        university: { select: { id: true, name: true, region: true } },
        direction: { select: { id: true, name: true } },
        product: { select: { id: true, name: true } },
        program: { select: { id: true, name: true } },
        owner: { select: { id: true, displayName: true, email: true } },
        workflowInstance: {
          select: {
            id: true,
            enteredAt: true,
            slaDueAt: true,
            completedAt: true,
            template: { select: { definition: true } },
          },
        },
      },
    });

    if (!engagement) {
      throw new AppException('NOT_FOUND', { detail: 'Заявка не найдена.' });
    }

    const attachments = await this.prisma.attachment.findMany({
      where: {
        entityType: 'ENGAGEMENT',
        entityId: engagementId,
        deletedAt: null,
        // Файл, не прошедший антивирусную проверку, наружу не анонсируется.
        scanStatus: { in: ['CLEAN', 'SKIPPED'] },
      },
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        sha256: true,
        storageKey: true,
      },
    });

    const bucket = this.config.get('S3_BUCKET_ATTACHMENTS', { infer: true });

    const definition = engagement.workflowInstance
      ? this.workflow.parseDefinition(engagement.workflowInstance.template.definition)
      : null;
    const currentState = definition?.states.find(
      (state) => state.key === engagement.currentStateKey,
    );

    const payload: EngagementPayload = {
      contract: 'engagement.v1',
      event,
      occurredAt: new Date().toISOString(),
      segment: engagement.segment,
      counterparty: {
        type: engagement.counterpartyType,
        name: engagement.university?.name ?? engagement.counterpartyName ?? '',
      },
      university: engagement.university
        ? {
            id: engagement.university.id,
            name: engagement.university.name,
            region: engagement.university.region,
          }
        : null,
      direction: { id: engagement.direction.id, name: engagement.direction.name },
      product: engagement.product
        ? { id: engagement.product.id, name: engagement.product.name }
        : null,
      program: engagement.program
        ? { id: engagement.program.id, name: engagement.program.name }
        : null,
      status: {
        key: engagement.currentStateKey,
        label: engagement.currentStateLabel,
        enteredAt: engagement.workflowInstance?.enteredAt.toISOString() ?? null,
        slaDueAt: engagement.workflowInstance?.slaDueAt?.toISOString() ?? null,
        isFinal: currentState?.isFinal ?? engagement.workflowInstance?.completedAt != null,
      },
      previousStatus,
      owner: {
        id: engagement.owner.id,
        displayName: engagement.owner.displayName,
        email: engagement.owner.email,
      },
      keys: {
        engagementId: engagement.id,
        workflowInstanceId: engagement.workflowInstance?.id ?? null,
        universityId: engagement.universityId,
        directionId: engagement.directionId,
        productId: engagement.productId,
        programId: engagement.programId,
        ownerId: engagement.ownerId,
      },
      attachments: attachments.map((item) => ({
        id: item.id,
        fileName: item.fileName,
        mimeType: item.mimeType,
        sizeBytes: Number(item.sizeBytes),
        sha256: item.sha256,
        bucket,
        objectKey: item.storageKey,
      })),
    };

    const validated = engagementPayloadSchema.safeParse(payload);

    if (!validated.success) {
      throw new AppException('INTEGRATION_CONTRACT_MISMATCH', {
        detail: 'Сообщение не соответствует контракту engagement.v1.',
        issues: validated.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    return validated.data;
  }

  /**
   * Сохраняет исходное сообщение и применяет его.
   *
   * Разделение на «сохранить» и «применить» принципиально: сохранённое
   * сообщение остаётся в системе, даже если разбор не удался, и ошибку
   * можно разобрать по факту, а не по описанию из журнала.
   */
  private async stageAndApply(
    sourceId: string,
    sourceName: string,
    raw: unknown,
  ): Promise<'created' | 'updated' | 'skipped' | 'failed'> {
    const parsed = inboundEventSchema.safeParse(raw);

    if (!parsed.success) {
      const externalId =
        typeof (raw as { externalId?: unknown })?.externalId === 'string'
          ? ((raw as { externalId: string }).externalId)
          : `malformed-${Date.now().toString(36)}`;

      await this.prisma.integrationStagingRecord.upsert({
        where: {
          sourceId_entityKind_externalId: { sourceId, entityKind: INBOUND_KIND, externalId },
        },
        create: {
          sourceId,
          entityKind: INBOUND_KIND,
          externalId,
          payload: raw as Prisma.InputJsonValue,
          validationError: parsed.error.issues.map((issue) => issue.message).join('; '),
        },
        update: {
          payload: raw as Prisma.InputJsonValue,
          validationError: parsed.error.issues.map((issue) => issue.message).join('; '),
        },
      });

      return 'failed';
    }

    const event = parsed.data;

    const staged = await this.prisma.integrationStagingRecord.upsert({
      where: {
        sourceId_entityKind_externalId: {
          sourceId,
          entityKind: INBOUND_KIND,
          externalId: event.externalId,
        },
      },
      create: {
        sourceId,
        entityKind: INBOUND_KIND,
        externalId: event.externalId,
        payload: raw as Prisma.InputJsonValue,
      },
      update: { payload: raw as Prisma.InputJsonValue, validationError: null },
    });

    // Повторная доставка того же события — норма для внешних систем:
    // уже применённое событие пропускается, а не создаёт вторую заявку.
    if (staged.processedAt) {
      return 'skipped';
    }

    try {
      const outcome = await this.applyInboundEvent(sourceName, event);

      await this.prisma.integrationStagingRecord.update({
        where: { id: staged.id },
        data: { processedAt: new Date() },
      });

      return outcome;
    } catch (error: unknown) {
      await this.prisma.integrationStagingRecord.update({
        where: { id: staged.id },
        data: {
          validationError: error instanceof Error ? error.message : 'Ошибка применения события',
        },
      });

      return 'failed';
    }
  }

  /**
   * Применяет событие внешней системы к заявкам.
   *
   * Техническое задание требует добавления данных «в существующий или новый
   * workflow», и порядок поиска именно такой: сначала заявка ищется, и лишь
   * затем заводится. Иначе запись на обучение и её завершение превращались
   * бы в две заявки на одного человека.
   *
   * Заявка опознаётся по идентификатору обращения внешней системы, а при
   * его отсутствии — по почте контрагента и направлению: сайт не всегда
   * умеет отдавать собственные идентификаторы, а терять связь из-за этого
   * не стоит.
   */
  private async applyInboundEvent(
    sourceName: string,
    event: InboundEvent,
  ): Promise<'created' | 'updated' | 'skipped'> {
    const direction = await this.prisma.itDirection.findFirst({
      where: { code: event.directionCode },
      select: { id: true },
    });

    if (!direction) {
      throw new Error(`Направление с кодом ${event.directionCode} отсутствует в каталоге`);
    }

    const template = await this.workflow.getDefaultTemplate('B2C');
    const definition = template.definition;
    const initial = initialState(definition);

    // Событие сообщает, на какой стадии находится обращение. Если статуса
    // с таким ключом в действующей схеме нет — администратор её изменил, —
    // заявка заводится в начальном статусе: терять обращение нельзя.
    const desiredKey = STATE_BY_EVENT[event.event];
    const state = definition.states.find((item) => item.key === desiredKey) ?? initial;

    const existing = await this.findExistingEngagement(sourceName, event, direction.id);

    if (existing) {
      const moved = await this.workflow.applySystemTransition(
        existing.id,
        state.key,
        `Получено от внешней системы «${sourceName}»: ${describeInboundEvent(event.event)}`,
      );

      // Внешний ключ проставляется и задним числом: заявка могла быть
      // заведена вручную либо прежним событием без идентификатора обращения.
      if (event.caseId && !existing.externalId) {
        await this.prisma.engagement.update({
          where: { id: existing.id },
          data: { externalId: event.caseId, externalSource: sourceName },
        });
      }

      return moved ? 'updated' : 'skipped';
    }

    const ownerId = await pickLeastLoadedOwner(this.prisma);

    await this.prisma.$transaction(async (tx) => {
      await assertTemplateStillActive(tx, template.id);

      // Персона заводится в той же транзакции, что и заявка: при сбое
      // создания заявки в базе не должна остаться запись с персональными
      // данными, ни к чему не привязанная.
      const contact =
        event.counterparty.type === 'PERSON'
          ? await tx.person.create({
              data: {
                fullName: event.counterparty.name,
                email: event.counterparty.email ?? null,
                // Обращение подано самим человеком — основание обработки
                // именно согласие, а не договор с вузом.
                lawfulBasis: 'CONSENT',
              },
              select: { id: true },
            })
          : null;

      const engagement = await tx.engagement.create({
        data: {
          segment: 'B2C',
          counterpartyType: event.counterparty.type,
          counterpartyName: event.counterparty.name,
          counterpartyContactId: contact?.id ?? null,
          directionId: direction.id,
          ownerId,
          title: event.comment ?? null,
          currentStateKey: state.key,
          currentStateLabel: state.label,
          externalId: event.caseId ?? null,
          externalSource: event.caseId ? sourceName : null,
        },
        select: { id: true },
      });

      await tx.workflowInstance.create({
        data: {
          engagementId: engagement.id,
          templateId: template.id,
          currentStateKey: state.key,
          slaDueAt: state.slaDays
            ? new Date(Date.now() + state.slaDays * 24 * 60 * 60 * 1000)
            : null,
          completedAt: state.isFinal ? new Date() : null,
        },
      });

      // Исходящее событие здесь НЕ создаётся намеренно: заявка заведена
      // по сообщению внешней системы, и ответное сообщение вернулось бы
      // её же отправителю. Дальнейшие переходы по такой заявке наружу
      // уходят обычным порядком.

      // В ленте автора нет: заявку завела система, а не назначенный
      // ответственный, и в его списке «что я делал» её быть не должно.
      await recordActivity(tx, {
        type: 'ENGAGEMENT_CREATED',
        source: 'INTEGRATION',
        actorId: null,
        engagementId: engagement.id,
        stage: { key: state.key, label: state.label },
        details: { source: sourceName, event: event.event },
      });
    });

    return 'created';
  }

  /**
   * Ищет заявку, к которой относится событие.
   *
   * Поиск по почте ограничен сегментом прямых продаж и незавершёнными
   * заявками: обращение того же человека спустя год по тому же направлению —
   * это новая история, и дописывать её в закрытую заявку неверно.
   */
  private async findExistingEngagement(
    sourceName: string,
    event: InboundEvent,
    directionId: string,
  ): Promise<{ id: string; externalId: string | null } | null> {
    if (event.caseId) {
      const byKey = await this.prisma.engagement.findFirst({
        where: { externalSource: sourceName, externalId: event.caseId },
        select: { id: true, externalId: true },
      });

      if (byKey) {
        return byKey;
      }
    }

    const email = event.counterparty.email;

    if (!email) {
      return null;
    }

    return this.prisma.engagement.findFirst({
      where: {
        segment: 'B2C',
        directionId,
        isArchived: false,
        workflowInstance: { completedAt: null },
        counterpartyContact: { email },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, externalId: true },
    });
  }

  /** Собирает адаптер согласно режиму работы. */
  private buildAdapter(type: IntegrationSourceType, baseUrl: string): IntegrationAdapter {
    const kind = type === 'LMS' ? 'LMS' : 'WEBSITE';
    const mode = this.config.get('INTEGRATION_MODE', { infer: true });

    if (mode === 'stub') {
      return new StubIntegrationAdapter(
        kind,
        kind === 'LMS' ? LMS_STUB_EVENTS : WEBSITE_STUB_EVENTS,
        this.logger,
      );
    }

    return new HttpIntegrationAdapter(
      kind,
      baseUrl,
      kind === 'LMS'
        ? this.config.get('LMS_TOKEN', { infer: true })
        : this.config.get('CMS_TOKEN', { infer: true }),
      this.config.get('INTEGRATION_HTTP_TIMEOUT_MS', { infer: true }),
      this.logger,
    );
  }

  private verifySignature(rawBody: string, signature: string | undefined): void {
    verifyWebhookSignature(this.config, this.logger, rawBody, signature);
  }
}

/** Человеческое название входящего события — попадает в историю заявки. */
function describeInboundEvent(event: InboundEvent['event']): string {
  switch (event) {
    case 'request.created':
      return 'поступило обращение';
    case 'enrollment.created':
      return 'оформлена запись на обучение';
    case 'enrollment.completed':
      return 'обучение завершено';
    default:
      return 'событие обработано';
  }
}

/**
 * Соответствие события внешней системы статусу заявки.
 *
 * Ключи взяты из поставляемой схемы прямых продаж. Если администратор
 * переименовал или удалил статус, соответствие перестаёт находиться —
 * и заявка заводится в начальном статусе, а не теряется.
 */
const STATE_BY_EVENT: Record<InboundEvent['event'], string> = {
  'request.created': 'REQUEST',
  'enrollment.created': 'ACCESS_GRANTED',
  'enrollment.completed': 'COMPLETED',
};
