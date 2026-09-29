import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { AppConfig } from '../../../config/configuration.js';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { AppException } from '../../../common/errors/app-exception.js';
import { recordActivity, type ActivitySource } from '../../activity/activity-log.js';
import { findKnownPerson, mergeIntoPerson, personSelection } from '../../admin/person-matching.js';
import { AUDIT_ACTIONS, AuditService } from '../../audit/audit.service.js';
import type { AuthenticatedUser } from '../../auth/authenticated-user.js';
import { AntivirusService } from '../../files/antivirus.service.js';
import { assertCleanUpload } from '../../files/upload-scan.js';
import { SystemTransitionResult, WorkflowService } from '../../workflow/workflow.service.js';
import { WorkflowDefinition, WorkflowState, initialState } from '../../workflow/workflow-definition.js';
import { pickLeastLoadedOwner } from '../owner-assignment.js';
import { assertTemplateStillActive } from '../../workflow/workflow-lock.js';
import { verifyWebhookSignature } from '../webhook-signature.js';
import { PaymentIntakeResultDto, PaymentItemDto, PaymentTotalsDto } from './dto/payment-intake.dto.js';
import { parsePaymentRecords, type PaymentRecord, type RejectedPayment } from './payment-records.js';
import { readPaymentFile } from './payment-source.js';
import { createProgramMatcher, type CatalogProgram, type ProgramMatch } from './program-matching.js';

/** Вид записи в промежуточном хранилище. */
const PAYMENT_KIND = 'payment';

/**
 * Статус прямой продажи, соответствующий подтверждённой оплате: «Договор
 * и оплата». Доступ в LMS ещё не выдан — слушатель ждёт выгрузки, и выдачу
 * доступа отметит уже событие LMS.
 */
export const PAID_STATE_KEY = 'CONTRACT';

/** Сигнал отката предварительного просмотра: транзакция отменяется целиком. */
class DryRunRollback extends Error {}

/**
 * Блокировка приёма оплат. Две пачки, разбираемые одновременно (вызов сайта
 * и загрузка файла руководителем), иначе не видели бы людей и заявки,
 * заведённые друг другом, — и один человек оказывался бы в реестре дважды.
 */
const PAYMENT_INTAKE_LOCK_ID = 774_201;

const engagementSelection = {
  id: true,
  segment: true,
  programId: true,
  counterpartyContactId: true,
  currentStateKey: true,
  currentStateLabel: true,
  externalId: true,
  externalSource: true,
  paymentConfirmedAt: true,
  paymentReference: true,
  studyStream: true,
  program: { select: { name: true } },
  workflowInstance: { select: { completedAt: true } },
} satisfies Prisma.EngagementSelect;

type FoundEngagement = Prisma.EngagementGetPayload<{ select: typeof engagementSelection }>;

/** Всё, что общее для записей одной пачки. */
interface BatchContext {
  sourceName: string;
  definition: WorkflowDefinition;
  templateId: string;
  paidState: WorkflowState | null;
  matchProgram: (course: string) => ProgramMatch;
  /** Кто действует: пользователь при загрузке файла, система при вызове сайта. */
  actor: { source: ActivitySource; actorId: string | null };
  totals: PaymentTotalsDto;
  /** Системные переходы — аудит и уведомления после фиксации транзакции. */
  moved: SystemTransitionResult[];
}

/**
 * Приём оплат прямых продаж с сайта.
 *
 * Оплата — это факт, после которого слушатель должен попасть в LMS.
 * Здесь он превращается в состояние заявки: оплата отмечается в заявке
 * слушателя, заявка переходит на этап «Договор и оплата», а слушатель
 * появляется в выгрузке для загрузки в LMS.
 *
 * Два канала с одной логикой:
 *   • вызов сайта с подписью — оплаты по мере поступления;
 *   • загрузка файла руководителем — выгрузка оплат за период, в том
 *     числе в виде таблицы; сначала предварительный просмотр.
 *
 * Данные сайта грязные, и это учтено на каждом шаге: запись с ошибкой
 * отклоняется с причиной, не мешая остальным, а всё, что принято
 * с оговоркой, видно в отчёте по записи.
 */
@Injectable()
export class PaymentIntakeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: WorkflowService,
    private readonly antivirus: AntivirusService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PaymentIntakeService.name);
  }

  /**
   * Оплаты, присланные сайтом. Подпись проверяется до разбора содержимого:
   * неподписанный вызов не должен доходить до записей о людях.
   */
  async acceptWebhook(rawBody: string, signature: string | undefined): Promise<PaymentIntakeResultDto> {
    verifyWebhookSignature(this.config, this.logger, rawBody, signature);

    let raw: unknown;

    try {
      raw = JSON.parse(rawBody.replace(/^\uFEFF/, ''));
    } catch {
      throw new AppException('MALFORMED_JSON', { detail: 'Тело запроса не является JSON.' });
    }

    const source = await this.requireWebsiteSource();
    const parsed = parsePaymentRecords(raw);

    const result = await this.process(parsed, {
      source,
      dryRun: false,
      actor: { source: 'INTEGRATION', actorId: null },
      stage: true,
    });

    this.logger.info({ totals: result.totals }, 'Приняты оплаты с сайта');
    return result;
  }

  /** Файл оплат, загруженный руководителем: JSON сайта либо таблица. */
  async importFile(
    fileName: string,
    content: Buffer,
    dryRun: boolean,
    user: AuthenticatedUser,
  ): Promise<PaymentIntakeResultDto> {
    await assertCleanUpload(
      { antivirus: this.antivirus, audit: this.audit, logger: this.logger },
      { content, fileName, user, entityType: 'Payment' },
    );

    const file = await readPaymentFile(fileName, content);
    const parsed = parsePaymentRecords(file.raw, { positions: file.positions });

    if (parsed.total === 0) {
      throw new AppException('IMPORT_NO_ROWS', { detail: 'В файле нет ни одной записи об оплате.' });
    }

    const source = await this.requireWebsiteSource();

    const result = await this.process(parsed, {
      source,
      dryRun,
      actor: { source: 'USER', actorId: user.id },
      stage: false,
    });

    if (!dryRun) {
      await this.audit.record({
        actorId: user.id,
        actorEmail: user.email,
        action: AUDIT_ACTIONS.IMPORT_APPLY,
        entityType: 'Payment',
        afterState: { fileName, ...result.totals },
      });
    }

    return result;
  }

  // ------------------------------------------------------------ Обработка --

  private async process(
    parsed: ReturnType<typeof parsePaymentRecords>,
    options: {
      source: { id: string; name: string };
      dryRun: boolean;
      actor: BatchContext['actor'];
      /** Сохранять ли записи в промежуточное хранилище — для вызовов сайта. */
      stage: boolean;
    },
  ): Promise<PaymentIntakeResultDto> {
    const template = await this.workflow.getDefaultTemplate('B2C');
    const programs: CatalogProgram[] = await this.prisma.itProgram.findMany({
      where: { isActive: true },
      select: { id: true, name: true, directionId: true, productId: true },
    });

    const context: BatchContext = {
      sourceName: options.source.name,
      definition: template.definition,
      templateId: template.id,
      paidState: template.definition.states.find((state) => state.key === PAID_STATE_KEY) ?? null,
      matchProgram: createProgramMatcher(programs),
      actor: options.actor,
      totals: {
        records: parsed.total,
        created: 0,
        updated: 0,
        unchanged: 0,
        rejected: 0,
        personsCreated: 0,
      },
      moved: [],
    };

    const items: PaymentItemDto[] = parsed.rejected.map(rejectedItem);

    try {
      await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PAYMENT_INTAKE_LOCK_ID})`;
          // Новые заявки заводятся по редакции, прочитанной до транзакции:
          // публикация в эти секунды оставила бы их на отменённой схеме.
          await assertTemplateStillActive(tx, context.templateId);

          for (const record of parsed.records) {
            const item = await this.applyRecord(tx, record, context);
            items.push(item);

            if (options.stage && item.outcome !== 'REJECTED') {
              await stageRecord(tx, options.source.id, record, null);
            }
          }

          if (options.dryRun) {
            throw new DryRunRollback();
          }
        },
        { timeout: 60_000 },
      );
    } catch (error: unknown) {
      if (!(error instanceof DryRunRollback)) {
        throw error;
      }
    }

    // Отклонённое тоже сохраняется: по нему на стороне сайта разбирают,
    // что именно было отправлено. Пишется после основной транзакции —
    // отказ в разборе не должен зависеть от её судьбы.
    if (options.stage) {
      await this.stageRejected(options.source.id, parsed, items);
    }

    if (!options.dryRun) {
      for (const moved of context.moved) {
        await this.workflow.publishSystemTransition(moved);
      }
    }

    items.sort((left, right) => left.position - right.position);

    for (const item of items) {
      if (item.outcome === 'CREATED') context.totals.created++;
      else if (item.outcome === 'UPDATED') context.totals.updated++;
      else if (item.outcome === 'UNCHANGED') context.totals.unchanged++;
      else context.totals.rejected++;
    }

    return { dryRun: options.dryRun, totals: context.totals, items };
  }

  /**
   * Одна оплата.
   *
   * Заявка ищется в порядке надёжности ключа:
   *   1. по номеру оплаченного заказа — повторная доставка той же оплаты;
   *   2. по номеру обращения сайта, если сайт использует один номер
   *      и для обращения, и для заказа;
   *   3. незавершённая заявка того же человека по той же программе
   *      (либо по её направлению, пока программа не выбрана), ещё не
   *      оплаченная, — обращение, которое менеджер вёл до оплаты.
   * И только затем заводится новая: иначе у человека, который сначала
   * оставил обращение, а потом оплатил, оказалось бы две заявки.
   */
  private async applyRecord(
    tx: Prisma.TransactionClient,
    record: PaymentRecord,
    context: BatchContext,
  ): Promise<PaymentItemDto> {
    const warnings = [...record.warnings];
    const programMatch = context.matchProgram(record.course);

    if (!programMatch.program) {
      return {
        ...baseItem(record),
        programName: null,
        engagementId: null,
        outcome: 'REJECTED',
        warnings,
        errors: [programMatch.reason],
      };
    }

    const program = programMatch.program;
    if (programMatch.warning) warnings.push(programMatch.warning);

    const byKey =
      (await tx.engagement.findUnique({
        where: { paymentReference: record.orderNumber },
        select: engagementSelection,
      })) ??
      (await tx.engagement.findFirst({
        where: { externalSource: context.sourceName, externalId: record.orderNumber },
        select: engagementSelection,
      }));

    if (byKey && byKey.segment !== 'B2C') {
      return {
        ...baseItem(record),
        programName: program.name,
        engagementId: null,
        outcome: 'REJECTED',
        warnings,
        errors: [`Номер заказа ${record.orderNumber} принадлежит заявке вузовского сегмента — оплата не отнесена`],
      };
    }

    const personId = await this.resolvePerson(tx, record, byKey, warnings, context);

    const engagement =
      byKey ??
      (await tx.engagement.findFirst({
        where: {
          segment: 'B2C',
          isArchived: false,
          counterpartyContactId: personId,
          paymentReference: null,
          workflowInstance: { completedAt: null },
          OR: [{ programId: program.id }, { programId: null, directionId: program.directionId }],
        },
        orderBy: { createdAt: 'desc' },
        select: engagementSelection,
      }));

    if (!engagement) {
      const created = await this.createEngagement(tx, record, program, personId, context);
      return { ...baseItem(record), programName: program.name, engagementId: created, outcome: 'CREATED', warnings, errors: [] };
    }

    const outcome = await this.confirmOnEngagement(tx, engagement, record, program, personId, warnings, context);
    return { ...baseItem(record), programName: program.name, engagementId: engagement.id, outcome, warnings, errors: [] };
  }

  /**
   * Человек, оплативший обучение.
   *
   * Если заявка уже найдена и контакт в ней есть, сведения дополняют этот
   * контакт: сопоставлять заново — значит рисковать завести второго
   * человека из-за опечатки в почте. Иначе человек ищется по почте, затем
   * по телефону вместе с ФИО и только потом заводится.
   *
   * Правовое основание — договор: оплата означает заключённый договор
   * оказания услуг, а не одно лишь согласие на обратную связь.
   */
  private async resolvePerson(
    tx: Prisma.TransactionClient,
    record: PaymentRecord,
    engagement: FoundEngagement | null,
    warnings: string[],
    context: BatchContext,
  ): Promise<string> {
    const incoming = { fullName: record.fullName, email: record.email, phone: record.phone };

    if (engagement?.counterpartyContactId) {
      const contact = await tx.person.findFirst({
        where: { id: engagement.counterpartyContactId, erasedAt: null },
        select: personSelection,
      });

      if (contact) {
        warnings.push(...(await mergeIntoPerson(tx, contact, incoming)));
        return contact.id;
      }
    }

    const known = await findKnownPerson(tx, incoming);

    if (known) {
      warnings.push(...(await mergeIntoPerson(tx, known, incoming)));
      return known.id;
    }

    const created = await tx.person.create({
      data: { ...incoming, lawfulBasis: 'CONTRACT' },
      select: { id: true },
    });

    context.totals.personsCreated++;
    return created.id;
  }

  /** Новая заявка прямой продажи — сразу на этапе оплаты. */
  private async createEngagement(
    tx: Prisma.TransactionClient,
    record: PaymentRecord,
    program: CatalogProgram,
    personId: string,
    context: BatchContext,
  ): Promise<string> {
    const state = context.paidState ?? initialState(context.definition);
    const ownerId = await pickLeastLoadedOwner(tx);
    const now = new Date();

    const engagement = await tx.engagement.create({
      data: {
        segment: 'B2C',
        counterpartyType: 'PERSON',
        counterpartyName: record.fullName,
        counterpartyContactId: personId,
        directionId: program.directionId,
        programId: program.id,
        productId: program.productId,
        ownerId,
        currentStateKey: state.key,
        currentStateLabel: state.label,
        externalId: record.orderNumber,
        externalSource: context.sourceName,
        paymentReference: record.orderNumber,
        paymentConfirmedAt: now,
        studyStream: record.stream,
      },
      select: { id: true },
    });

    await tx.workflowInstance.create({
      data: {
        engagementId: engagement.id,
        templateId: context.templateId,
        currentStateKey: state.key,
        slaDueAt: state.slaDays ? new Date(now.getTime() + state.slaDays * 24 * 60 * 60 * 1000) : null,
        completedAt: state.isFinal ? now : null,
      },
    });

    // Исходящее событие не создаётся: заявка заведена по сообщению сайта,
    // и ответ ушёл бы ему же. Дальнейшие переходы уходят обычным порядком.
    await recordActivity(tx, {
      type: 'ENGAGEMENT_CREATED',
      ...context.actor,
      engagementId: engagement.id,
      stage: { key: state.key, label: state.label },
      details: { source: context.sourceName, event: 'payment.confirmed' },
    });

    await recordPaymentActivity(tx, engagement.id, state, record, context);
    return engagement.id;
  }

  /** Оплата по уже существующей заявке. */
  private async confirmOnEngagement(
    tx: Prisma.TransactionClient,
    engagement: FoundEngagement,
    record: PaymentRecord,
    program: CatalogProgram,
    personId: string,
    warnings: string[],
    context: BatchContext,
  ): Promise<'UPDATED' | 'UNCHANGED'> {
    const data: Prisma.EngagementUpdateInput = {};
    const alreadyPaid = engagement.paymentConfirmedAt !== null;

    if (!alreadyPaid) {
      data.paymentConfirmedAt = new Date();
    }

    if (!engagement.paymentReference) {
      data.paymentReference = record.orderNumber;
    }

    if (!engagement.externalId) {
      data.externalId = record.orderNumber;
      data.externalSource = context.sourceName;
    }

    if (record.stream && record.stream !== engagement.studyStream) {
      data.studyStream = record.stream;

      if (engagement.studyStream) {
        warnings.push(`Поток изменён: ${engagement.studyStream} → ${record.stream}`);
      }
    }

    if (!engagement.programId) {
      data.program = { connect: { id: program.id } };
    } else if (engagement.programId !== program.id) {
      warnings.push(
        `В заявке указана программа «${engagement.program?.name ?? '—'}», а оплачен курс ` +
          `«${record.course}» — программа заявки не изменена`,
      );
    }

    if (!engagement.counterpartyContactId) {
      data.counterpartyContact = { connect: { id: personId } };
    }

    if (Object.keys(data).length === 0) {
      return 'UNCHANGED';
    }

    await tx.engagement.update({
      where: { id: engagement.id },
      data: { ...data, version: { increment: 1 } },
    });

    let stage = { key: engagement.currentStateKey, label: engagement.currentStateLabel };

    if (!alreadyPaid) {
      stage = await this.moveToPaidState(tx, engagement, record, warnings, context) ?? stage;
      await recordPaymentActivity(tx, engagement.id, stage, record, context);
    }

    return 'UPDATED';
  }

  /**
   * Перевод на этап оплаты — только вперёд.
   *
   * Заявку, ушедшую дальше (доступ выдан, идёт обучение), оплата назад не
   * возвращает. Закрытую — не открывает: оплата после отказа означает
   * разговор со слушателем, и решение за ответственным, а не за системой.
   */
  private async moveToPaidState(
    tx: Prisma.TransactionClient,
    engagement: FoundEngagement,
    record: PaymentRecord,
    warnings: string[],
    context: BatchContext,
  ): Promise<{ key: string; label: string } | null> {
    const current = context.definition.states.find((state) => state.key === engagement.currentStateKey);
    const target = context.paidState;

    if (engagement.workflowInstance?.completedAt || current?.isFinal) {
      warnings.push(
        `Заявка закрыта в статусе «${engagement.currentStateLabel}» — оплата отмечена, ` +
          'дальнейшее решение за ответственным',
      );
      return null;
    }

    if (!target || !current || current.order >= target.order) {
      return null;
    }

    const moved = await this.workflow.applySystemTransitionInTx(
      tx,
      engagement.id,
      target.key,
      `Оплата подтверждена сайтом: заказ ${record.orderNumber}`,
    );

    if (!moved) {
      return null;
    }

    context.moved.push(moved);
    return { key: moved.toStateKey, label: moved.toStateLabel };
  }

  private async requireWebsiteSource(): Promise<{ id: string; name: string }> {
    const source = await this.prisma.integrationSource.findFirst({
      where: { type: 'WEBSITE' },
      select: { id: true, name: true },
    });

    if (!source) {
      throw new AppException('NOT_FOUND', {
        detail: 'Источник интеграции «сайт» не настроен — оплаты не к чему отнести.',
      });
    }

    return source;
  }

  private async stageRejected(
    sourceId: string,
    parsed: ReturnType<typeof parsePaymentRecords>,
    items: PaymentItemDto[],
  ): Promise<void> {
    const rejectedByPosition = new Map(
      items.filter((item) => item.outcome === 'REJECTED').map((item) => [item.position, item]),
    );

    for (const record of parsed.records) {
      const item = rejectedByPosition.get(record.position);
      if (item) await stageRecord(this.prisma, sourceId, record, item.errors.join('; '));
    }

    for (const rejected of parsed.rejected) {
      await stageRecord(this.prisma, sourceId, rejected, rejected.reasons.join('; '));
    }
  }
}

function baseItem(record: PaymentRecord) {
  return {
    position: record.position,
    orderNumber: record.orderNumber,
    fullName: record.fullName,
    course: record.course,
    stream: record.stream,
  };
}

function rejectedItem(rejected: RejectedPayment): PaymentItemDto {
  return {
    position: rejected.position,
    orderNumber: rejected.orderNumber,
    fullName: rejected.fullName,
    course: null,
    programName: null,
    stream: null,
    engagementId: null,
    outcome: 'REJECTED',
    warnings: [],
    errors: rejected.reasons,
  };
}

async function recordPaymentActivity(
  tx: Prisma.TransactionClient,
  engagementId: string,
  stage: { key: string; label: string },
  record: PaymentRecord,
  context: BatchContext,
): Promise<void> {
  await recordActivity(tx, {
    type: 'PAYMENT_CONFIRMED',
    ...context.actor,
    engagementId,
    stage,
    details: { orderNumber: record.orderNumber, stream: record.stream, course: record.course },
  });
}

/**
 * Запись в промежуточное хранилище.
 *
 * Сохраняется приведённый вид, а не исходный: в исходном ключи у каждого
 * источника свои, и обезличивание по требованию субъекта не нашло бы в нём
 * имени и почты. Приведённый вид устроен так же, как входящие события
 * (counterparty.name / email / phone), и стирается тем же запросом.
 */
async function stageRecord(
  db: Pick<Prisma.TransactionClient, 'integrationStagingRecord'>,
  sourceId: string,
  record: PaymentRecord | RejectedPayment,
  validationError: string | null,
): Promise<void> {
  const payload: Prisma.InputJsonValue =
    'reasons' in record
      ? { orderNumber: record.orderNumber, counterparty: { name: record.fullName } }
      : {
          orderNumber: record.orderNumber,
          course: record.course,
          stream: record.stream,
          counterparty: { name: record.fullName, email: record.email, phone: record.phone },
        };

  const externalId = record.orderNumber ?? `rejected-${Date.now().toString(36)}-${record.position}`;
  const processedAt = validationError ? null : new Date();

  await db.integrationStagingRecord.upsert({
    where: { sourceId_entityKind_externalId: { sourceId, entityKind: PAYMENT_KIND, externalId } },
    create: { sourceId, entityKind: PAYMENT_KIND, externalId, payload, validationError, processedAt },
    update: { payload, validationError, processedAt },
  });
}
