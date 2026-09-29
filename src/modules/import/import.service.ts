import type { ImportJobStatus } from '../../generated/prisma/enums.js';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { StorageService } from '../../infrastructure/storage/storage.service.js';
import { QUEUES } from '../../infrastructure/queue/queue.module.js';
import { AppException } from '../../common/errors/app-exception.js';
import { AppConfig } from '../../config/configuration.js';
import { normalizeName } from '../../common/utils/text-normalization.js';
import {
  joinFullName,
  normalizeNamePart,
  organizationKey,
  titleKey,
} from '../../common/utils/contact-normalization.js';
import { sameName } from '../admin/person-matching.js';
import { findProductByName, findVendorByName } from '../catalog/catalog-matching.js';
import { AUDIT_ACTIONS, AuditService } from '../audit/audit.service.js';
import { AntivirusService } from '../files/antivirus.service.js';
import { resolveSpreadsheetType } from '../files/file-validation.js';
import { assertCleanUpload } from '../files/upload-scan.js';
import { XlsParserService, PREVIEW_ROWS, type ParseResult } from './xls-parser.service.js';
import { ColumnMapping, IMPORT_FIELDS, ImportRow, missingRequiredFields } from './import-fields.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { WorkflowService } from '../workflow/workflow.service.js';
import type { WorkflowDefinition } from '../workflow/workflow-definition.js';
import { assertTemplateStillActive } from '../workflow/workflow-lock.js';
import { enqueueEngagementEvent } from '../integration/outbox.js';
import { recordActivity } from '../activity/activity-log.js';
import {
  decideOwner,
  matchEmployee,
  pickDirection,
  type Direction,
  type Employee,
  type Importer,
} from './import-engagements.js';

/**
 * Порог, начиная с которого вуз ПОКАЗЫВАЕТСЯ пользователю как возможное
 * совпадение. Именно показывается, а не объединяется автоматически.
 *
 * Автоматическое слияние по нечёткому совпадению исключено сознательно.
 * Проверка на реальных данных: «Псковский государственный университет»
 * даёт с «Санкт-Петербургским государственным университетом» оценку 0.82 —
 * общие слова «государственный университет» перевешивают различающиеся.
 * Автоматика объединила бы два разных вуза, и обнаружилось бы это лишь
 * тогда, когда отчёты по ним перестали бы сходиться.
 *
 * Поэтому решение принимает человек: система показывает кандидатов
 * с оценкой, а пользователь подтверждает или отклоняет каждого.
 */
const UNIVERSITY_SUGGEST_THRESHOLD = 0.6;

/** Сколько решений по совпадениям принимается за раз — не больше строк импорта. */
const MAX_RESOLUTIONS = 100_000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Вендор строки, в которой указан продукт, но не производитель. */
const UNKNOWN_VENDOR = 'Не указан';

/** Сколько предупреждений по строкам хранится в сводке. */
const MAX_ROW_WARNINGS = 200;

/** Предупреждение по строке файла: принято с оговоркой либо пропущено. */
interface RowWarning {
  rowNumber: number;
  message: string;
}

/** Всё, что нужно для заявок по колонке «ФИО менеджера». */
interface EngagementPlan {
  importer: Importer;
  employees: Employee[];
  directions: Direction[];
  template: { id: string; definition: WorkflowDefinition } | null;
  /**
   * Заявки, уже заведённые (или намеченные) этим импортом: вуз|продукт →
   * ответственный. Вторая строка той же пары заявку не дублирует.
   */
  planned: Map<string, { ownerId: string; ownerName: string }>;
}

type EngagementDecision =
  | { create: { ownerId: string; directionId: string }; warnings: string[] }
  | { create: null; warnings: string[] };

type EngagementReader = Pick<Prisma.TransactionClient, 'engagement' | 'itProgram'>;

export interface ImportPreview {
  jobId: string;
  status: string;
  fileName: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  detectedMapping: ColumnMapping;
  unmappedHeaders: string[];
  missingRequired: Array<{ key: string; label: string }>;
  /** Сколько совпадений ждут решения пользователя. */
  pendingDecisions: number;
  willCreate: Record<string, number>;
  willUpdate: Record<string, number>;
  duplicateCandidates: Array<{
    rowNumber: number;
    incomingName: string;
    matchedName: string;
    matchedId?: string;
    similarity: number;
    /** Решение пользователя; null — не принято, будет создана новая запись. */
    decision?: string | null;
  }>;
  /**
   * Что по строкам будет принято с оговоркой: менеджер не найден или не
   * в подчинении, заявку по вузу уже ведёт другой, направление не определено.
   */
  warnings: RowWarning[];
  previewRows: Array<Record<string, unknown>>;
  errors: Array<{ rowNumber: number; columnName: string | null; message: string }>;
}

@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly parser: XlsParserService,
    private readonly antivirus: AntivirusService,
    private readonly audit: AuditService,
    @InjectQueue(QUEUES.IMPORT) private readonly queue: Queue,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly logger: PinoLogger,
    private readonly workflow: WorkflowService,
  ) {
    this.logger.setContext(ImportService.name);
  }

  /**
   * Принимает файл и ставит задачу предварительного разбора.
   *
   * Разбор не выполняется в запросе: файл на десятки тысяч строк
   * занимает процессор на секунды, и обработка в API-процессе
   * остановила бы обслуживание остальных пользователей.
   */
  async createJob(
    fileName: string,
    content: Buffer,
    user: AuthenticatedUser,
  ): Promise<{ jobId: string; status: string }> {
    const maxBytes = this.config.get('IMPORT_MAX_FILE_SIZE_MB', { infer: true }) * 1024 * 1024;

    if (content.length > maxBytes) {
      throw new AppException('FILE_TOO_LARGE', {
        detail:
          `Размер файла ${(content.length / 1024 / 1024).toFixed(1)} МБ превышает предел ` +
          `${this.config.get('IMPORT_MAX_FILE_SIZE_MB', { infer: true })} МБ для импорта. ` +
          'Разделите выгрузку на части.',
        meta: { sizeBytes: content.length, maxBytes },
      });
    }

    // Тип определяется по сигнатуре содержимого — так же, как для вложений.
    // Динамический импорт: file-type публикуется только как ES-модуль.
    const { fileTypeFromBuffer } = await import('file-type');
    const resolved = resolveSpreadsheetType(await fileTypeFromBuffer(content), fileName);

    await this.assertClean(content, fileName, user);

    const fileSha256 = createHash('sha256').update(content).digest('hex');

    // Повторная загрузка того же файла — частая ошибка при работе
    // с почтой. Сообщаем о ней явно, вместо создания дубликата задачи.
    const existing = await this.prisma.importJob.findFirst({
      where: { fileSha256, status: { in: ['DRY_RUN_READY', 'APPLYING', 'COMPLETED'] } },
      select: { id: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    if (existing && existing.status === 'COMPLETED') {
      throw new AppException('IMPORT_ALREADY_APPLIED', {
        detail: 'Файл с таким содержимым уже был импортирован.',
        meta: { previousJobId: existing.id, appliedAt: existing.createdAt },
      });
    }

    const storageKey = `imports/${randomUUID()}.${resolved.extension}`;
    await this.storage.upload('attachments', storageKey, Readable.from(content), resolved.mimeType);

    const job = await this.prisma.importJob.create({
      data: {
        target: 'UNIVERSITY_CATALOG',
        status: 'PENDING',
        fileName,
        storageKey,
        fileSha256,
        createdById: user.id,
      },
      select: { id: true, status: true },
    });

    await this.queue.add(
      'parse',
      { jobId: job.id, userId: user.id },
      // Идентификатор задачи совпадает с идентификатором записи:
      // повторная постановка того же разбора не создаст вторую задачу.
      { jobId: `import-parse-${job.id}` },
    );

    return { jobId: job.id, status: job.status };
  }

  /**
   * Антивирусная проверка импортируемого файла.
   *
   * Файл XLSX — это ZIP-архив с XML и произвольными вложениями, и приходит он
   * по почте от внешних организаций. Канал импорта раньше не проверялся вовсе,
   * хотя ведёт в то же хранилище, что и вложения.
   *
   * Правило простое: если сканер включён, вердикт обязан быть CLEAN.
   * Недоступность сканера при включённой проверке — отказ, а не разрешение:
   * иначе достаточно было бы дождаться сбоя ClamAV, чтобы провести файл
   * мимо проверки. При выключенном сканере (только разработка: в production
   * это запрещено валидацией конфигурации) импорт выполняется с записью
   * предупреждения в лог.
   */
  private async assertClean(content: Buffer, fileName: string, user: AuthenticatedUser): Promise<void> {
    await assertCleanUpload(
      { antivirus: this.antivirus, audit: this.audit, logger: this.logger },
      { content, fileName, user, entityType: 'ImportJob' },
    );
  }

  /**
   * Предварительный разбор без записи данных.
   *
   * Пользователь должен увидеть, что именно произойдёт, до того как это
   * произойдёт: сколько записей создастся, сколько обновится, какие строки
   * отвергнуты и какие вузы распознаны как уже существующие. Импорт
   * «вслепую» в каталог, на который завязаны отчёты, недопустим.
   */
  async runDryRun(jobId: string, mappingOverride?: ColumnMapping): Promise<void> {
    const job = await this.requireJob(jobId);

    // Пересчёт по новому сопоставлению допустим только до применения
    // и не во время работы над задачей. Прежде статус переписывался
    // безусловно: применённая задача после PUT /mapping снова становилась
    // «готовой к применению» и применялась второй раз — запрет повторного
    // импорта обходился одним запросом. Условие по статусу входит в UPDATE,
    // поэтому одновременные запросы не проскочат между проверкой и записью.
    const allowedFrom: ImportJobStatus[] = mappingOverride
      ? ['DRY_RUN_READY', 'FAILED']
      : ['PENDING', 'PARSING', 'DRY_RUN_READY', 'FAILED'];

    const claimed = await this.prisma.importJob.updateMany({
      where: { id: jobId, status: { in: allowedFrom } },
      data: { status: 'PARSING', startedAt: new Date() },
    });

    if (claimed.count === 0) {
      throw this.stateConflict(job.status);
    }

    try {
      const parsed = await this.parseStoredFile(job.storageKey, mappingOverride);
      const analysis = await this.analyze(parsed, job.createdById);

      await this.prisma.$transaction(async (tx) => {
        // Ошибки предыдущего прогона удаляем: пользователь мог исправить
        // маппинг, и старый список вводил бы в заблуждение.
        await tx.importRowError.deleteMany({ where: { jobId } });

        if (parsed.errors.length > 0) {
          await tx.importRowError.createMany({
            data: parsed.errors.slice(0, 5000).map((error) => ({
              jobId,
              rowNumber: error.rowNumber,
              columnName: error.columnName,
              errorCode: error.errorCode,
              message: error.message,
              rawRow: error.rawRow as object,
            })),
          });
        }

        await tx.importJob.update({
          where: { id: jobId },
          data: {
            status: 'DRY_RUN_READY',
            appliedMapping: parsed.mapping as object,
            stats: analysis as unknown as object,
            finishedAt: new Date(),
          },
        });
      });

      this.logger.info(
        { jobId, total: parsed.totalRows, invalid: parsed.errors.length },
        'Предварительный разбор импорта завершён',
      );
    } catch (error) {
      await this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          stats: {
            error: error instanceof AppException ? error.detail : 'Не удалось разобрать файл',
          } as object,
        },
      });
      throw error;
    }
  }

  /**
   * Применяет импорт.
   *
   * Строки обрабатываются пакетами в транзакциях: одна общая транзакция
   * на сто тысяч строк удерживала бы блокировки минутами и мешала работе
   * остальных пользователей, а построчные транзакции дали бы кратный
   * рост накладных расходов.
   */
  async apply(
    jobId: string,
    user: AuthenticatedUser,
  ): Promise<{ created: number; updated: number; engagementsCreated: number; warnings: RowWarning[] }> {
    const job = await this.requireJob(jobId);

    if (job.status === 'COMPLETED') {
      throw new AppException('IMPORT_ALREADY_APPLIED', {
        detail: 'Эта задача импорта уже применена.',
      });
    }

    if (job.status !== 'DRY_RUN_READY') {
      throw this.stateConflict(job.status);
    }

    // Захват задачи атомарен: при двойном нажатии «Применить» оба запроса
    // прошли бы проверку статуса выше, и импорт выполнился бы дважды.
    const claimed = await this.prisma.importJob.updateMany({
      where: { id: jobId, status: 'DRY_RUN_READY' },
      data: { status: 'APPLYING', startedAt: new Date() },
    });

    if (claimed.count === 0) {
      const current = await this.requireJob(jobId);
      throw this.stateConflict(current.status);
    }

    try {
      const mapping = (job.appliedMapping ?? undefined) as ColumnMapping | undefined;
      const resolutions = (job.resolutions ?? {}) as Record<string, string>;
      const parsed = await this.parseStoredFile(job.storageKey, mapping);

      let created = 0;
      let updated = 0;
      const BATCH_SIZE = 200;

      // Заявки заводятся от имени применяющего: его права на поручение
      // работы и проверяются, а не права того, кто когда-то загрузил файл.
      const plan = hasManagerColumn(parsed)
        ? await this.loadEngagementPlan({ id: user.id, role: user.role })
        : null;
      const warnings: RowWarning[] = [];
      const engagements: Array<{ id: string; universityId: string; ownerId: string; directionId: string }> =
        [];

      for (let offset = 0; offset < parsed.rows.length; offset += BATCH_SIZE) {
        const batch = parsed.rows.slice(offset, offset + BATCH_SIZE);

        await this.prisma.$transaction(async (tx) => {
          // Та же блокировка, что при ручном создании заявки: публикация
          // новой редакции процесса не проскочит между чтением шаблона
          // и созданием экземпляров по нему.
          if (plan?.template) {
            await assertTemplateStillActive(tx, plan.template.id);
          }

          for (const row of batch) {
            const result = await this.applyRow(tx, row.data, resolutions);
            if (result.outcome === 'created') created++;
            else updated++;

            if (plan) {
              const engagement = await this.applyEngagement(tx, plan, row, result, warnings, {
                jobId,
                fileName: job.fileName,
              });

              if (engagement) {
                engagements.push({ ...engagement, universityId: result.universityId });
              }
            }
          }
        });
      }

      await this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          status: 'COMPLETED',
          finishedAt: new Date(),
          stats: {
            ...((job.stats ?? {}) as Record<string, unknown>),
            applied: {
              created,
              updated,
              engagementsCreated: engagements.length,
              warnings: warnings.slice(0, MAX_ROW_WARNINGS),
              at: new Date().toISOString(),
            },
          } as object,
        },
      });

      await this.audit.record({
        actorId: user.id,
        actorEmail: user.email,
        action: AUDIT_ACTIONS.IMPORT_APPLY,
        entityType: 'ImportJob',
        entityId: jobId,
        afterState: {
          fileName: job.fileName,
          created,
          updated,
          rows: parsed.rows.length,
          engagementsCreated: engagements.length,
        },
      });

      // Каждая заведённая заявка — в журнале, как и созданная вручную:
      // по нему восстанавливают, откуда у КАМ взялась работа.
      for (const engagement of engagements) {
        await this.audit.record({
          actorId: user.id,
          actorEmail: user.email,
          action: AUDIT_ACTIONS.ENGAGEMENT_CREATE,
          entityType: 'Engagement',
          entityId: engagement.id,
          afterState: {
            segment: 'B2B',
            universityId: engagement.universityId,
            directionId: engagement.directionId,
            ownerId: engagement.ownerId,
            importJobId: jobId,
          },
        });
      }

      this.logger.info({ jobId, created, updated, engagements: engagements.length }, 'Импорт применён');

      return {
        created,
        updated,
        engagementsCreated: engagements.length,
        warnings: warnings.slice(0, MAX_ROW_WARNINGS),
      };
    } catch (error) {
      await this.prisma.importJob.update({
        where: { id: jobId },
        data: { status: 'FAILED', finishedAt: new Date() },
      });
      throw error;
    }
  }

  /**
   * Сохраняет решения пользователя по неоднозначным совпадениям вузов.
   *
   * Ключ — наименование из файла, значение — идентификатор существующего
   * вуза либо CREATE_NEW. Решения переживают повторный разбор: правка
   * маппинга колонок не отменяет уже принятых решений о том, какие
   * организации считать одной и той же.
   */
  async setResolutions(jobId: string, resolutions: Record<string, string>): Promise<void> {
    const job = await this.requireJob(jobId);

    if (job.status === 'COMPLETED') {
      throw new AppException('IMPORT_ALREADY_APPLIED', {
        detail: 'Импорт уже применён, изменение решений невозможно.',
      });
    }

    if (job.status === 'APPLYING') {
      throw this.stateConflict(job.status);
    }

    // Ключи нормализуем: пользователь передаёт наименования так, как они
    // записаны в файле, а сопоставление при применении идёт по
    // нормализованной форме.
    const normalizedResolutions: Record<string, string> = {};
    const existing = (job.resolutions ?? {}) as Record<string, string>;
    Object.assign(normalizedResolutions, existing);

    const entries = Object.entries(resolutions);

    // Решение — «создать новый» либо идентификатор вуза. Другие значения
    // прежде доходили до базы как есть и роняли запрос внутренней ошибкой.
    const invalid = entries.filter(
      ([, decision]) =>
        typeof decision !== 'string' || (decision !== 'CREATE_NEW' && !UUID_PATTERN.test(decision)),
    );

    if (invalid.length > 0 || entries.length > MAX_RESOLUTIONS) {
      throw new AppException('VALIDATION_FAILED', {
        detail:
          entries.length > MAX_RESOLUTIONS
            ? `Решений больше, чем строк может быть в файле (${MAX_RESOLUTIONS}).`
            : 'Решение по совпадению — CREATE_NEW либо идентификатор вуза.',
        issues: invalid.slice(0, 20).map(([name]) => ({
          field: `resolutions.${name}`,
          message: 'Ожидается CREATE_NEW либо UUID вуза',
        })),
      });
    }

    for (const [incomingName, decision] of entries) {
      if (decision !== 'CREATE_NEW') {
        const exists = await this.prisma.university.count({ where: { id: decision } });
        if (exists === 0) {
          throw new AppException('NOT_FOUND', {
            detail: `Вуз с идентификатором ${decision} не найден.`,
            meta: { incomingName, decision },
          });
        }
      }

      normalizedResolutions[normalizeName(incomingName)] = decision;
    }

    await this.prisma.importJob.update({
      where: { id: jobId },
      data: { resolutions: normalizedResolutions as object },
    });
  }

  /** Сводка предварительного разбора для интерфейса. */
  async getPreview(jobId: string): Promise<ImportPreview> {
    const job = await this.requireJob(jobId);

    const errors = await this.prisma.importRowError.findMany({
      where: { jobId },
      orderBy: { rowNumber: 'asc' },
      take: 100,
      select: { rowNumber: true, columnName: true, message: true },
    });

    const stats = (job.stats ?? {}) as Record<string, unknown>;
    const resolved = (job.resolutions ?? {}) as Record<string, string>;

    const candidates = ((stats.duplicateCandidates as ImportPreview['duplicateCandidates']) ?? []).map(
      (candidate) => ({
        ...candidate,
        decision: resolved[normalizeName(candidate.incomingName)] ?? null,
      }),
    );

    // Итоговые счётчики зависят от принятых решений: подтверждённое
    // совпадение даёт обновление, отклонённое и непринятое — создание.
    const confirmed = candidates.filter(
      (candidate) => candidate.decision && candidate.decision !== 'CREATE_NEW',
    ).length;
    const pending = candidates.length - confirmed;

    const baseCreate = (stats.willCreate as Record<string, number>) ?? {};
    const baseUpdate = (stats.willUpdate as Record<string, number>) ?? {};

    return {
      jobId: job.id,
      status: job.status,
      fileName: job.fileName,
      totalRows: Number(stats.totalRows ?? 0),
      validRows: Number(stats.validRows ?? 0),
      invalidRows: Number(stats.invalidRows ?? 0),
      detectedMapping: (job.appliedMapping ?? {}) as ColumnMapping,
      unmappedHeaders: (stats.unmappedHeaders as string[]) ?? [],
      missingRequired: (stats.missingRequired as Array<{ key: string; label: string }>) ?? [],
      pendingDecisions: pending,
      willCreate: { ...baseCreate, universities: (baseCreate.universities ?? 0) + pending },
      willUpdate: { ...baseUpdate, universities: (baseUpdate.universities ?? 0) + confirmed },
      duplicateCandidates: candidates,
      warnings: (stats.warnings as RowWarning[]) ?? [],
      previewRows: (stats.previewRows as Array<Record<string, unknown>>) ?? [],
      errors,
    };
  }

  /** Отказ, соответствующий текущему состоянию задачи. */
  private stateConflict(status: ImportJobStatus): AppException {
    if (status === 'COMPLETED') {
      return new AppException('IMPORT_ALREADY_APPLIED', {
        detail: 'Эта задача импорта уже применена.',
      });
    }

    if (status === 'APPLYING' || status === 'PARSING') {
      return new AppException('IMPORT_JOB_BUSY', { meta: { status } });
    }

    return new AppException('IMPORT_DRY_RUN_REQUIRED', {
      detail: `Перед применением необходимо выполнить предварительный просмотр. Текущий статус: ${status}.`,
      meta: { status },
    });
  }

  private async requireJob(jobId: string) {
    const job = await this.prisma.importJob.findUnique({ where: { id: jobId } });

    if (!job) {
      throw new AppException('NOT_FOUND', { detail: 'Задача импорта не найдена.' });
    }

    return job;
  }

  private async parseStoredFile(storageKey: string, mapping?: ColumnMapping): Promise<ParseResult> {
    const object = await this.storage.download('attachments', storageKey);
    const maxBytes = this.config.get('IMPORT_MAX_FILE_SIZE_MB', { infer: true }) * 1024 * 1024;
    const content = await readStreamToBuffer(object.stream, maxBytes);

    return this.parser.parse(content, mapping);
  }

  /**
   * Оценивает последствия импорта без записи данных.
   *
   * Все проверки выполняются чтением: ни одна запись не создаётся,
   * поэтому предварительный просмотр безопасно запускать повторно
   * при каждой правке маппинга.
   */
  private async analyze(parsed: ParseResult, importerId: string): Promise<Record<string, unknown>> {
    const willCreate: Record<string, number> = {
      universities: 0,
      vendors: 0,
      products: 0,
      contracts: 0,
      licenses: 0,
      engagements: 0,
    };
    const willUpdate: Record<string, number> = { universities: 0, contracts: 0, licenses: 0 };
    const duplicateCandidates: ImportPreview['duplicateCandidates'] = [];
    const warnings: RowWarning[] = [];

    // Наборы учитывают записи, которые будут созданы в ходе самого импорта:
    // без этого один и тот же новый вуз, встретившийся в файле трижды,
    // посчитался бы как три создания. Вуз и продукт запоминаются вместе
    // с идентификатором; null — запись будет создана.
    const universities = new Map<string, string | null>();
    const seenVendors = new Set<string>();
    const products = new Map<string, string | null>();
    const seenContracts = new Set<string>();

    // Заявки в сводке оцениваются от имени загрузившего: применять, как
    // правило, будет он же, а права на поручение работы у него те же.
    const importer = await this.prisma.appUser.findUnique({
      where: { id: importerId },
      select: { id: true, role: true },
    });
    const plan = importer && hasManagerColumn(parsed) ? await this.loadEngagementPlan(importer) : null;

    for (const row of parsed.rows) {
      const { data } = row;
      const normalized = normalizeName(data.universityName);

      if (!universities.has(normalized)) {
        const match = await this.findUniversity(data.universityName);

        if (match && match.similarity === 1) {
          // Точное совпадение нормализованной формы: запись будет обновлена.
          willUpdate.universities++;
          universities.set(normalized, match.id);
        } else if (match) {
          // Нечёткое совпадение — отдельная категория, а НЕ обновление.
          // Пока пользователь не подтвердит, при применении будет создана
          // новая запись, и сводка обязана показывать именно это: иначе
          // предпросмотр обещал бы одно, а импорт делал другое.
          duplicateCandidates.push({
            rowNumber: row.rowNumber,
            incomingName: data.universityName,
            matchedName: match.name,
            matchedId: match.id,
            similarity: Number(match.similarity.toFixed(3)),
          });
          universities.set(normalized, null);
        } else {
          willCreate.universities++;
          universities.set(normalized, null);
        }
      }

      const universityId = universities.get(normalized) ?? null;
      let productId: string | null | undefined = null;
      let productKey: string | null = null;

      // Вендор и продукт оцениваются ровно так, как их потом запишет
      // applyRow: вендор заводится только вместе с продуктом, компания
      // опознаётся без правовой формы, продукт — в пределах своего вендора.
      // Прежде просмотр сравнивал без учёта регистра, а применение — точно,
      // и «ростелеком» в файле обещал обновление, а создавал двойника.
      if (data.productName) {
        const vendorName = data.vendorName ?? UNKNOWN_VENDOR;
        const vendorKey = organizationKey(vendorName) || vendorName.toLowerCase();
        productKey = `${vendorKey}|${titleKey(data.productName)}`;

        if (!products.has(productKey)) {
          const vendor = await findVendorByName(this.prisma, vendorName);

          if (!vendor && !seenVendors.has(vendorKey)) {
            willCreate.vendors++;
          }
          seenVendors.add(vendorKey);

          const exists = vendor ? await findProductByName(this.prisma, vendor.id, data.productName) : null;
          if (!exists) willCreate.products++;
          products.set(productKey, exists?.id ?? null);
        }

        productId = products.get(productKey) ?? undefined;
      }

      if (data.contractNumber) {
        const key = `${normalized}|${data.contractNumber}`;
        if (!seenContracts.has(key)) {
          seenContracts.add(key);
          // Договор ищется у своего вуза, как и при применении: номера вроде
          // «1» или «Д-1» встречаются у многих вузов, и чужой договор с тем
          // же номером обещал обновление там, где будет создан новый.
          const exists = universityId
            ? await this.prisma.contract.findFirst({
                where: { universityId, number: data.contractNumber },
                select: { id: true },
              })
            : null;
          if (exists) willUpdate.contracts++;
          else willCreate.contracts++;
        }
      }

      if (data.licenseSignedAt || data.licenseValidYears || data.transferStatus) {
        willCreate.licenses++;
      }

      if (plan) {
        const decision = await this.planEngagement(this.prisma, plan, data, {
          key: engagementKey(
            universityId ?? `new:${normalized}`,
            productId ?? (productKey ? `new:${productKey}` : null),
          ),
          universityId,
          productId,
        });

        if (decision.create) {
          willCreate.engagements++;
        }

        for (const message of decision.warnings) {
          if (warnings.length < MAX_ROW_WARNINGS) warnings.push({ rowNumber: row.rowNumber, message });
        }
      }
    }

    const missing = missingRequiredFields(parsed.mapping).map((key) => ({
      key,
      label: IMPORT_FIELDS[key].label,
    }));

    return {
      totalRows: parsed.totalRows,
      validRows: parsed.rows.length,
      invalidRows: parsed.errors.length,
      unmappedHeaders: parsed.unmappedHeaders,
      missingRequired: missing,
      willCreate,
      willUpdate,
      duplicateCandidates: duplicateCandidates.slice(0, 50),
      warnings,
      previewRows: parsed.rows.slice(0, PREVIEW_ROWS).map((row) => ({
        rowNumber: row.rowNumber,
        ...row.data,
        licenseSignedAt: row.data.licenseSignedAt?.toISOString() ?? null,
      })),
    };
  }

  /**
   * Ищет существующий вуз по наименованию.
   *
   * Сначала точное совпадение нормализованной формы, затем нечёткое
   * сравнение. Используется word_similarity, а не similarity: первая
   * оценивает совпадение запроса с ЧАСТЬЮ наименования и потому находит
   * сокращённые записи, тогда как вторая для них даёт низкий балл.
   */
  private async findUniversity(
    name: string,
  ): Promise<{ id: string; name: string; similarity: number } | null> {
    const normalized = normalizeName(name);

    const exact = await this.prisma.university.findFirst({
      where: { normalizedName: normalized },
      select: { id: true, name: true },
    });

    if (exact) {
      return { ...exact, similarity: 1 };
    }

    const fuzzy = await this.prisma.$queryRaw<Array<{ id: string; name: string; score: number }>>`
      SELECT id, name, word_similarity(${normalized}, normalized_name) AS score
      FROM university
      WHERE is_active = true
        AND word_similarity(${normalized}, normalized_name) > ${UNIVERSITY_SUGGEST_THRESHOLD}
      ORDER BY score DESC
      LIMIT 1
    `;

    const best = fuzzy[0];
    return best ? { id: best.id, name: best.name, similarity: Number(best.score) } : null;
  }

  /** Записывает одну строку файла в связанные сущности. */
  private async applyRow(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    data: ImportRow,
    resolutions: Record<string, string>,
  ): Promise<{ outcome: 'created' | 'updated'; universityId: string; productId: string | null }> {
    const normalized = normalizeName(data.universityName);

    let university = await tx.university.findFirst({
      where: { normalizedName: normalized },
      select: { id: true },
    });

    let outcome: 'created' | 'updated' = 'updated';

    if (!university) {
      // Нечёткое совпадение здесь НЕ используется: слияние разных вузов
      // необратимо и обнаруживается слишком поздно. Учитывается только
      // явное решение пользователя, принятое на этапе предпросмотра.
      const decision = resolutions[normalized];

      if (decision && decision !== 'CREATE_NEW') {
        const confirmed = await tx.university.findUnique({
          where: { id: decision },
          select: { id: true },
        });

        if (confirmed) {
          university = confirmed;
        }
      }

      if (!university) {
        // Безопасное поведение по умолчанию: создать новую запись.
        // Лишний дубликат в каталоге администратор объединит вручную;
        // ошибочно слитые вузы разделить уже нельзя.
        university = await tx.university.create({
          data: { name: data.universityName, normalizedName: normalized },
          select: { id: true },
        });
        outcome = 'created';
      }
    }

    let productId: string | null = null;

    if (data.productName) {
      const vendorName = data.vendorName ?? UNKNOWN_VENDOR;
      const vendor =
        (await findVendorByName(tx, vendorName)) ??
        (await tx.vendor.create({ data: { name: vendorName }, select: { id: true, name: true } }));

      const product =
        (await findProductByName(tx, vendor.id, data.productName)) ??
        (await tx.softwareProduct.create({
          data: { name: data.productName, vendorId: vendor.id },
          select: { id: true, name: true },
        }));

      productId = product.id;
    }

    if (data.contractNumber) {
      const contract = await tx.contract.upsert({
        where: {
          universityId_number: { universityId: university.id, number: data.contractNumber },
        },
        create: {
          universityId: university.id,
          number: data.contractNumber,
          signedAt: data.licenseSignedAt,
          comment: data.comment,
        },
        update: {
          ...(data.licenseSignedAt ? { signedAt: data.licenseSignedAt } : {}),
          ...(data.comment ? { comment: data.comment } : {}),
        },
        select: { id: true },
      });

      if (productId) {
        const validUntil =
          data.licenseSignedAt && data.licenseValidYears
            ? addYears(data.licenseSignedAt, data.licenseValidYears)
            : null;

        const existingLicense = await tx.license.findFirst({
          where: { contractId: contract.id, productId },
          select: { id: true, signedAt: true, validYears: true, validUntil: true },
        });

        if (existingLicense) {
          // Повторная загрузка дополняет лицензию, а не заменяет её — так же,
          // как договор выше. Прежде пустая ячейка стирала дату подписания
          // и срок, а пустой статус откатывал «Передано» в «Не начата»:
          // досланная таблица с парой исправленных колонок портила лицензии.
          const signedAt = data.licenseSignedAt ?? existingLicense.signedAt;
          const validYears = data.licenseValidYears ?? existingLicense.validYears;

          await tx.license.update({
            where: { id: existingLicense.id },
            data: {
              ...(data.licenseSignedAt ? { signedAt: data.licenseSignedAt } : {}),
              ...(data.licenseValidYears ? { validYears: data.licenseValidYears } : {}),
              ...(data.transferStatus ? { transferStatus: data.transferStatus } : {}),
              ...(data.comment ? { comment: data.comment } : {}),
              validUntil:
                signedAt && validYears ? addYears(signedAt, validYears) : existingLicense.validUntil,
            },
          });
        } else {
          await tx.license.create({
            data: {
              contractId: contract.id,
              productId,
              signedAt: data.licenseSignedAt,
              validYears: data.licenseValidYears,
              validUntil,
              transferStatus: data.transferStatus ?? 'NOT_STARTED',
              comment: data.comment,
            },
          });
        }
      }
    }

    if (data.universityContacts) {
      // В одной ячейке нередко перечислено несколько человек.
      const names = data.universityContacts
        .split(/[;,\n]/)
        .map((item) => item.trim())
        .filter((item) => item.length > 2);

      // Уже известные ответственные вуза: повторная загрузка той же таблицы,
      // досланный файл или несколько строк одного вуза заводили каждого
      // человека заново — в реестре ПДн и в карточке вуза множились дубли.
      const known = await tx.universityContact.findMany({
        where: { universityId: university.id, person: { erasedAt: null } },
        select: { person: { select: { fullName: true } } },
      });
      const knownNames = known.map((contact) => contact.person.fullName);

      for (const rawName of names.slice(0, 5)) {
        const fullName = joinFullName(rawName.split(/\s+/).map((part) => normalizeNamePart(part)));

        if (fullName.length === 0 || knownNames.some((name) => sameName(name, fullName))) {
          continue;
        }

        knownNames.push(fullName);
        const person = await tx.person.create({ data: { fullName }, select: { id: true } });

        await tx.universityContact.upsert({
          where: { universityId_personId: { universityId: university.id, personId: person.id } },
          create: {
            universityId: university.id,
            personId: person.id,
            role: 'Ответственный от вуза',
          },
          update: {},
        });
      }
    }

    return { outcome, universityId: university.id, productId };
  }

  // --------------------------------------------------- Заявки из таблицы --

  /** Сотрудники, направления и процесс — один раз на прогон. */
  private async loadEngagementPlan(importer: Importer): Promise<EngagementPlan> {
    const [employees, directions] = await Promise.all([
      this.prisma.appUser.findMany({
        select: { id: true, displayName: true, isActive: true, managerId: true },
      }),
      this.prisma.itDirection.findMany({
        where: { isActive: true },
        select: { id: true, name: true, code: true },
      }),
    ]);

    let template: EngagementPlan['template'] = null;

    try {
      template = await this.workflow.getDefaultTemplate('B2B');
    } catch (error) {
      // Без действующего процесса заявку не завести. Договоры и лицензии
      // при этом загрузятся, а по строкам с менеджером будет предупреждение.
      if (!(error instanceof AppException)) throw error;
    }

    return { importer, employees, directions, template, planned: new Map() };
  }

  /**
   * Что делать с заявкой по строке: завести, оставить существующую или
   * пропустить с объяснением. Одни и те же правила для просмотра и для
   * применения — сводка обязана совпасть с результатом.
   *
   * Заявка одна на пару «вуз — продукт»: вторая строка той же пары, как
   * и повторная загрузка таблицы, новой заявки не заводит. Закрытые
   * и архивные заявки в счёт не идут — работа по ним окончена.
   */
  private async planEngagement(
    db: EngagementReader,
    plan: EngagementPlan,
    data: ImportRow,
    target: { key: string; universityId: string | null; productId: string | null | undefined },
  ): Promise<EngagementDecision> {
    const written = data.managerFullName?.trim();

    if (!written) {
      return { create: null, warnings: [] };
    }

    const match = matchEmployee(written, plan.employees);
    let existing = plan.planned.get(target.key) ?? null;

    // Вуз или продукт, которых ещё нет, заявок иметь не могут.
    if (!existing && target.universityId !== null && target.productId !== undefined) {
      const found = await db.engagement.findFirst({
        where: {
          segment: 'B2B',
          universityId: target.universityId,
          productId: target.productId,
          isArchived: false,
          workflowInstance: { completedAt: null },
        },
        select: { ownerId: true, owner: { select: { displayName: true } } },
      });

      existing = found ? { ownerId: found.ownerId, ownerName: found.owner.displayName } : null;
    }

    if (existing) {
      // Ответственного таблица не меняет: переназначение — решение
      // руководителя, и оно не должно откатываться загрузкой старого файла.
      const named = match.kind === 'found' ? match.employee.id : null;

      return {
        create: null,
        warnings:
          named && named !== existing.ownerId
            ? [`Заявку по этому вузу и продукту уже ведёт ${existing.ownerName} — ответственный не изменён`]
            : [],
      };
    }

    if (!plan.template) {
      return { create: null, warnings: ['Нет действующего процесса работы с вузами — заявка не заведена'] };
    }

    const programs = target.productId
      ? await db.itProgram.findMany({
          where: { productId: target.productId, isActive: true },
          select: { directionId: true },
        })
      : [];
    const direction = pickDirection(
      data.directionName ?? null,
      programs.map((program) => program.directionId),
      plan.directions,
    );

    if ('warning' in direction) {
      return { create: null, warnings: [direction.warning] };
    }

    const owner = decideOwner(written, match, plan.importer);
    const ownerName = plan.employees.find((employee) => employee.id === owner.ownerId)?.displayName ?? '';
    plan.planned.set(target.key, { ownerId: owner.ownerId, ownerName });

    return {
      create: { ownerId: owner.ownerId, directionId: direction.directionId },
      warnings: owner.warning ? [owner.warning] : [],
    };
  }

  /**
   * Заявка по строке при применении — в транзакции пакета, вместе с
   * экземпляром процесса, событием для внешних систем и записью в ленте:
   * так же, как при создании заявки вручную.
   */
  private async applyEngagement(
    tx: Prisma.TransactionClient,
    plan: EngagementPlan,
    row: ParseResult['rows'][number],
    target: { universityId: string; productId: string | null },
    warnings: RowWarning[],
    source: { jobId: string; fileName: string },
  ): Promise<{ id: string; ownerId: string; directionId: string } | null> {
    const decision = await this.planEngagement(tx, plan, row.data, {
      key: engagementKey(target.universityId, target.productId),
      universityId: target.universityId,
      productId: target.productId,
    });

    for (const message of decision.warnings) {
      if (warnings.length < MAX_ROW_WARNINGS) warnings.push({ rowNumber: row.rowNumber, message });
    }

    if (!decision.create || !plan.template) {
      return null;
    }

    const { ownerId, directionId } = decision.create;
    const initial = this.workflow.getInitialState(plan.template.definition);

    const engagement = await tx.engagement.create({
      data: {
        segment: 'B2B',
        universityId: target.universityId,
        counterpartyType: 'UNIVERSITY',
        directionId,
        productId: target.productId,
        ownerId,
        currentStateKey: initial.key,
        currentStateLabel: initial.label,
      },
      select: { id: true },
    });

    await tx.workflowInstance.create({
      data: {
        engagementId: engagement.id,
        templateId: plan.template.id,
        currentStateKey: initial.key,
        slaDueAt: initial.slaDueAt,
      },
    });

    await enqueueEngagementEvent(tx, 'engagement.created', { engagementId: engagement.id });

    await recordActivity(tx, {
      type: 'ENGAGEMENT_CREATED',
      actorId: plan.importer.id,
      engagementId: engagement.id,
      stage: { key: initial.key, label: initial.label },
      details: { segment: 'B2B', ownerId, importJobId: source.jobId, importFile: source.fileName },
    });

    return { id: engagement.id, ownerId, directionId };
  }
}

/** Размечена ли в файле колонка «ФИО менеджера». */
function hasManagerColumn(parsed: ParseResult): boolean {
  return Object.values(parsed.mapping).includes('managerFullName');
}

/** Ключ пары «вуз — продукт», по которой заводится одна заявка. */
function engagementKey(university: string, product: string | null): string {
  return `${university}|${product ?? ''}`;
}

/**
 * Считывает поток в буфер с ограничением размера.
 *
 * Предел проверяется по мере чтения, а не после: файл, превышающий лимит,
 * иначе успел бы полностью оказаться в памяти — то есть ровно то, от чего
 * ограничение и защищает.
 */
async function readStreamToBuffer(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;

    if (size > maxBytes) {
      stream.destroy();
      throw new AppException('FILE_TOO_LARGE', {
        detail: `Файл превышает допустимый для импорта размер ${Math.round(maxBytes / 1024 / 1024)} МБ.`,
        meta: { maxBytes },
      });
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

/**
 * Дата через заданное число лет. 29 февраля переходит в 28-е: Date.UTC
 * перенёс бы его на 1 марта, и лицензия считалась бы действующей лишний день.
 */
function addYears(date: Date, years: number): Date {
  const year = date.getUTCFullYear() + years;
  const month = date.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay)));
}
