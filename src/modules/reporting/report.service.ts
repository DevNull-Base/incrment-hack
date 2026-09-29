import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { ReportFormat, ReportJobStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { StorageService } from '../../infrastructure/storage/storage.service.js';
import { QUEUES } from '../../infrastructure/queue/queue.module.js';
import { AppException } from '../../common/errors/app-exception.js';
import { AppConfig } from '../../config/configuration.js';
import { MetricsService } from '../../common/metrics/metrics.service.js';
import { DataScope, DataScopeService } from '../access/data-scope.service.js';
import { AUDIT_ACTIONS, AuditService } from '../audit/audit.service.js';
import { ReportQueryBuilder, ReportFilters } from './report-query.builder.js';
import { ReportRendererService, RenderContext, RowSupplier } from './report-renderer.service.js';
import { ReportColumnKey, isReportColumn } from './report-columns.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';

/** Размер порции при выборке строк из БД. */
const FETCH_BATCH_SIZE = 500;

/**
 * Предел строк для PDF.
 *
 * Значительно ниже общего: PDF собирается в памяти целиком, поскольку
 * разбиение на страницы требует знания всего содержимого. Многотысячный
 * табличный PDF к тому же нечитаем — для таких объёмов предназначены
 * xlsx и csv.
 */
const PDF_MAX_ROWS = 5000;

export interface ReportRequest {
  title?: string;
  columns: string[];
  filters: ReportFilters;
  format: ReportFormat;
}

export interface SyncReportResult {
  kind: 'sync';
  stream: Readable;
  fileName: string;
  mimeType: string;
  rowCount: number;
}

export interface AsyncReportResult {
  kind: 'async';
  jobId: string;
  status: ReportJobStatus;
  rowCount: number;
  fromCache: boolean;
}

@Injectable()
export class ReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly builder: ReportQueryBuilder,
    private readonly renderer: ReportRendererService,
    private readonly storage: StorageService,
    private readonly dataScope: DataScopeService,
    private readonly audit: AuditService,
    private readonly metrics: MetricsService,
    private readonly events: EventEmitter2,
    private readonly config: ConfigService<AppConfig, true>,
    @InjectQueue(QUEUES.REPORTS) private readonly queue: Queue,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ReportService.name);
  }

  /**
   * Принимает запрос на отчёт и выбирает способ его формирования.
   *
   * Это центральное решение всей подсистемы. Требования ТЗ «отклик не более
   * секунды» и «десять параллельных отчётов» несовместимы при формировании
   * документа прямо в запросе: рендеринг XLSX — работа, занимающая процессор
   * на секунды, и в API-процессе она остановила бы обслуживание ВСЕХ
   * пользователей, а не только заказавшего отчёт.
   *
   * Поэтому выборка сначала пересчитывается (быстро, по индексам), и дальше:
   *   • небольшой отчёт формируется сразу и отдаётся потоком;
   *   • объёмный уходит в очередь, а пользователь получает идентификатор
   *     задачи за доли секунды и следит за ходом по каналу обновлений.
   */
  async request(request: ReportRequest, user: AuthenticatedUser): Promise<SyncReportResult | AsyncReportResult> {
    const columns = this.validateColumns(request.columns);
    const scope = await this.dataScope.resolve(user);

    const { total: rowCount, version: dataVersion } = await this.builder.snapshot(request.filters, scope);
    const maxRows = this.config.get('REPORT_MAX_ROWS', { infer: true });

    if (rowCount > maxRows) {
      throw new AppException('REPORT_TOO_LARGE', {
        detail:
          `Выборка содержит ${rowCount} строк при допустимых ${maxRows}. ` +
          'Сузьте период или уточните фильтры.',
        meta: { rowCount, maxRows },
      });
    }

    if (request.format === 'PDF' && rowCount > PDF_MAX_ROWS) {
      throw new AppException('REPORT_TOO_LARGE', {
        detail:
          `PDF формируется не более чем для ${PDF_MAX_ROWS} строк, в выборке ${rowCount}. ` +
          'Для такого объёма выберите формат xlsx или csv.',
        meta: { rowCount, maxRows: PDF_MAX_ROWS, format: 'PDF' },
      });
    }

    const threshold = this.config.get('REPORT_SYNC_ROW_THRESHOLD', { infer: true });

    if (rowCount <= threshold && request.format !== 'PDF') {
      return this.renderSync(request, columns, scope, user, rowCount);
    }

    return this.enqueue(request, columns, scope, user, rowCount, dataVersion);
  }

  /** Формирует отчёт немедленно и отдаёт потоком. */
  private async renderSync(
    request: ReportRequest,
    columns: ReportColumnKey[],
    scope: DataScope,
    user: AuthenticatedUser,
    rowCount: number,
  ): Promise<SyncReportResult> {
    const startedAt = Date.now();
    const context = this.buildContext(request, columns, user, rowCount);
    const rows = this.createRowSupplier(columns, request.filters, scope);

    const stream = await this.renderStream(request.format, context, rows);

    this.metrics.reportDuration.observe(
      { format: request.format, mode: 'sync' },
      (Date.now() - startedAt) / 1000,
    );
    this.metrics.reportRows.observe(rowCount);

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTIONS.EXPORT_REPORT,
      entityType: 'Report',
      afterState: { format: request.format, rowCount, columns, mode: 'sync' },
    });

    return {
      kind: 'sync',
      stream,
      fileName: this.buildFileName(context.title, request.format),
      mimeType: MIME_BY_FORMAT[request.format],
      rowCount,
    };
  }

  /**
   * Ставит формирование отчёта в очередь.
   *
   * Повторный запрос того же отчёта тем же пользователем по тем же данным
   * отдаётся из кэша: двойное нажатие и повторная выгрузка не пересчитывают
   * документ заново. В ключ кэша входят:
   *   • область видимости — иначе файл администратора достался бы менеджеру;
   *   • версия данных — иначе после смены статуса из кэша приходил файл
   *     со старыми статусами, пока не истечёт час хранения;
   *   • заказчик — в шапке документа стоит его имя, и чужой файл выдавался
   *     бы с подписью «сформировал» другого человека.
   */
  private async enqueue(
    request: ReportRequest,
    columns: ReportColumnKey[],
    scope: DataScope,
    user: AuthenticatedUser,
    rowCount: number,
    dataVersion: string | null,
  ): Promise<AsyncReportResult> {
    const paramsHash = this.hashParams(request, columns, scope, user.id, dataVersion);

    const cached = await this.prisma.reportJob.findFirst({
      where: {
        paramsHash,
        // Заказчик входит и в ключ; условие здесь — страховка: чужую задачу
        // скачивание всё равно отвергло бы, и ссылка оказалась бы нерабочей.
        requestedById: user.id,
        status: 'COMPLETED',
        expiresAt: { gt: new Date() },
        resultKey: { not: null },
      },
      orderBy: { finishedAt: 'desc' },
      select: { id: true, status: true, rowCount: true },
    });

    if (cached) {
      this.metrics.reportCacheHits.inc();

      this.logger.info({ paramsHash, jobId: cached.id }, 'Отчёт отдан из кэша');

      return {
        kind: 'async',
        jobId: cached.id,
        status: cached.status,
        rowCount: cached.rowCount ?? rowCount,
        fromCache: true,
      };
    }

    const ttlSeconds = this.config.get('REPORT_CACHE_TTL_SEC', { infer: true });

    const job = await this.prisma.reportJob.create({
      data: {
        status: 'QUEUED',
        format: request.format,
        paramsSnapshot: {
          title: request.title ?? null,
          columns,
          filters: request.filters as object,
        } as object,
        paramsHash,
        requestedById: user.id,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      },
      select: { id: true, status: true },
    });

    await this.queue.add(
      'generate',
      { reportJobId: job.id, userId: user.id },
      { jobId: `report-${job.id}` },
    );

    return { kind: 'async', jobId: job.id, status: job.status, rowCount, fromCache: false };
  }

  /**
   * Выполняет отложенное формирование отчёта. Вызывается обработчиком очереди.
   *
   * Готовый файл пишется в объектное хранилище потоком: при полумиллионе
   * строк промежуточная сборка в памяти исчерпала бы её задолго до конца.
   */
  async generate(reportJobId: string): Promise<void> {
    const job = await this.prisma.reportJob.findUnique({
      where: { id: reportJobId },
      select: {
        id: true,
        format: true,
        paramsSnapshot: true,
        requestedById: true,
        requestedBy: {
          select: { id: true, keycloakSub: true, email: true, displayName: true, role: true, managerId: true, isActive: true },
        },
      },
    });

    if (!job) {
      throw new AppException('REPORT_JOB_NOT_FOUND', { detail: 'Задача отчёта не найдена.' });
    }

    // Сотрудника могли заблокировать, пока задача ждала очереди. Файл
    // с персональными данными для него не формируется: скачать его он уже
    // не сможет, а лежать в хранилище такому файлу незачем.
    if (!job.requestedBy.isActive) {
      await this.prisma.reportJob.update({
        where: { id: reportJobId },
        data: { status: 'FAILED', errorMessage: 'Учётная запись заказчика отчёта заблокирована', finishedAt: new Date() },
      });
      return;
    }

    const startedAt = Date.now();
    // Приведение через unknown: JSONB возвращается широким типом Prisma,
    // а структура снимка задана нами при постановке задачи.
    const snapshot = job.paramsSnapshot as unknown as {
      title: string | null;
      columns: ReportColumnKey[];
      filters: ReportFilters;
    };

    await this.prisma.reportJob.update({
      where: { id: reportJobId },
      data: { status: 'RUNNING', startedAt: new Date(), progress: 0 },
    });

    this.emitProgress(reportJobId, job.requestedById, 'RUNNING', 0);

    try {
      const scope = await this.dataScope.resolve(job.requestedBy);
      const rowCount = await this.builder.count(snapshot.filters, scope);

      const context = this.buildContext(
        { title: snapshot.title ?? undefined, columns: snapshot.columns, filters: snapshot.filters, format: job.format },
        snapshot.columns,
        job.requestedBy,
        rowCount,
      );

      let processed = 0;
      const rows = this.createRowSupplier(snapshot.columns, snapshot.filters, scope, (count) => {
        processed = count;
        // Прогресс обновляется порциями, а не на каждой строке: событие
        // на строку создало бы больше нагрузки, чем сама выборка.
        const percent = rowCount > 0 ? Math.min(99, Math.floor((count / rowCount) * 100)) : 50;
        this.emitProgress(reportJobId, job.requestedById, 'RUNNING', percent, count);
      });

      const stream = await this.renderStream(job.format, context, rows);
      const storageKey = `reports/${reportJobId}.${EXTENSION_BY_FORMAT[job.format]}`;

      const uploaded = await this.storage.upload(
        'reports',
        storageKey,
        stream,
        MIME_BY_FORMAT[job.format],
      );

      await this.prisma.reportJob.update({
        where: { id: reportJobId },
        data: {
          status: 'COMPLETED',
          progress: 100,
          rowCount,
          resultKey: storageKey,
          resultSize: BigInt(uploaded.sizeBytes),
          finishedAt: new Date(),
        },
      });

      this.metrics.reportDuration.observe(
        { format: job.format, mode: 'async' },
        (Date.now() - startedAt) / 1000,
      );
      this.metrics.reportRows.observe(rowCount);

      this.emitProgress(reportJobId, job.requestedById, 'COMPLETED', 100, rowCount);

      await this.audit.record({
        actorId: job.requestedById,
        actorEmail: job.requestedBy.email,
        action: AUDIT_ACTIONS.EXPORT_REPORT,
        entityType: 'Report',
        entityId: reportJobId,
        afterState: { format: job.format, rowCount, columns: snapshot.columns, mode: 'async' },
      });

      this.logger.info(
        { reportJobId, rowCount, processed, durationMs: Date.now() - startedAt },
        'Отчёт сформирован',
      );
    } catch (error) {
      await this.prisma.reportJob.update({
        where: { id: reportJobId },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          errorCode: error instanceof AppException ? error.definition.code : 'CRM-REP-0004',
          errorDetail: error instanceof AppException ? error.detail : 'Непредвиденная ошибка',
        },
      });

      this.emitProgress(reportJobId, job.requestedById, 'FAILED', 0);
      throw error;
    }
  }

  /** Состояние задачи формирования отчёта. */
  async getJob(reportJobId: string, user: AuthenticatedUser) {
    const job = await this.prisma.reportJob.findUnique({
      where: { id: reportJobId },
      select: {
        id: true,
        status: true,
        format: true,
        progress: true,
        rowCount: true,
        resultSize: true,
        errorCode: true,
        errorDetail: true,
        queuedAt: true,
        startedAt: true,
        finishedAt: true,
        expiresAt: true,
        requestedById: true,
        paramsSnapshot: true,
      },
    });

    // Чужая задача недоступна даже администратору: отчёт строится
    // в границах области видимости заказавшего, и выдача его другому
    // пользователю обошла бы разграничение доступа.
    if (!job || job.requestedById !== user.id) {
      throw new AppException('REPORT_JOB_NOT_FOUND', {
        detail: 'Задача отчёта не найдена либо принадлежит другому пользователю.',
      });
    }

    return {
      id: job.id,
      status: job.status,
      format: job.format,
      progress: job.progress,
      rowCount: job.rowCount,
      sizeBytes: job.resultSize === null ? null : Number(job.resultSize),
      errorCode: job.errorCode,
      errorDetail: job.errorDetail,
      queuedAt: job.queuedAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      expiresAt: job.expiresAt,
    };
  }

  /** Отдаёт готовый файл отчёта. */
  async download(
    reportJobId: string,
    user: AuthenticatedUser,
  ): Promise<{ stream: Readable; fileName: string; mimeType: string }> {
    const job = await this.prisma.reportJob.findUnique({
      where: { id: reportJobId },
      select: {
        id: true,
        status: true,
        format: true,
        resultKey: true,
        requestedById: true,
        paramsSnapshot: true,
      },
    });

    if (!job || job.requestedById !== user.id) {
      throw new AppException('REPORT_JOB_NOT_FOUND', {
        detail: 'Задача отчёта не найдена либо принадлежит другому пользователю.',
      });
    }

    if (job.status !== 'COMPLETED' || !job.resultKey) {
      throw new AppException('REPORT_NOT_READY', {
        detail: `Отчёт ещё не готов. Текущее состояние: ${job.status}.`,
        meta: { status: job.status },
      });
    }

    const object = await this.storage.download('reports', job.resultKey);
    const snapshot = job.paramsSnapshot as unknown as { title: string | null };

    return {
      stream: object.stream,
      fileName: this.buildFileName(snapshot.title ?? 'Отчёт по взаимодействиям', job.format),
      mimeType: MIME_BY_FORMAT[job.format],
    };
  }

  /**
   * Поставщик строк с постраничной выборкой по ключу.
   *
   * Строки поступают порциями и не накапливаются: отчёт формируется
   * с постоянным расходом памяти независимо от числа записей.
   */
  private createRowSupplier(
    columns: ReportColumnKey[],
    filters: ReportFilters,
    scope: DataScope,
    onProgress?: (processed: number) => void,
  ): RowSupplier {
    const builder = this.builder;

    return async function* () {
      let afterId: string | undefined;
      let processed = 0;

      for (;;) {
        const batch = await builder.fetch(columns, filters, scope, {
          limit: FETCH_BATCH_SIZE,
          afterId,
        });

        if (batch.length === 0) {
          return;
        }

        for (const row of batch) {
          yield row;
        }

        processed += batch.length;
        onProgress?.(processed);

        afterId = String(batch[batch.length - 1]?.__id ?? '');
        if (!afterId || batch.length < FETCH_BATCH_SIZE) {
          return;
        }
      }
    };
  }

  private async renderStream(
    format: ReportFormat,
    context: RenderContext,
    rows: RowSupplier,
  ): Promise<Readable> {
    switch (format) {
      case 'XLSX':
        return this.renderer.renderXlsx(context, rows);
      // Настоящий BIFF8, а не xlsx под чужим расширением: старый формат
      // нужен ровно тем системам, которые Office Open XML не читают.
      case 'XLS':
        return this.renderer.renderXls(context, rows);
      case 'CSV':
        return this.renderer.renderCsv(context, rows);
      case 'JSON':
        return this.renderer.renderJson(context, rows);
      case 'PDF':
        return this.renderer.renderPdf(context, rows);
      default:
        throw new AppException('REPORT_FORMAT_UNSUPPORTED', {
          detail: `Формат ${String(format)} не поддерживается.`,
        });
    }
  }

  private validateColumns(columns: string[]): ReportColumnKey[] {
    if (!columns || columns.length === 0) {
      throw new AppException('REPORT_UNKNOWN_COLUMN', {
        detail: 'Не выбрана ни одна колонка отчёта.',
      });
    }

    const unknown = columns.filter((key) => !isReportColumn(key));

    if (unknown.length > 0) {
      throw new AppException('REPORT_UNKNOWN_COLUMN', {
        detail: `Неизвестные колонки: ${unknown.join(', ')}.`,
        meta: { unknown },
      });
    }

    return columns as ReportColumnKey[];
  }

  private buildContext(
    request: ReportRequest,
    columns: ReportColumnKey[],
    user: { displayName: string },
    rowCount: number,
  ): RenderContext {
    return {
      title: request.title?.trim() || 'Отчёт по взаимодействиям с вузами',
      columns,
      filterSummary: describeFilters(request.filters),
      generatedBy: user.displayName,
      generatedAt: new Date(),
      rowCount,
    };
  }

  /**
   * Отпечаток параметров отчёта.
   *
   * Включает область видимости: без неё готовый файл, рассчитанный для
   * пользователя с широкими правами, был бы отдан пользователю с узкими,
   * и кэш превратился бы в канал утечки данных.
   */
  private hashParams(
    request: ReportRequest,
    columns: ReportColumnKey[],
    scope: DataScope,
    requestedById: string,
    dataVersion: string | null,
  ): string {
    const payload = JSON.stringify({
      format: request.format,
      title: request.title ?? null,
      columns: [...columns].sort(),
      filters: sortedFilters(request.filters),
      scope: scope.fingerprint,
      requestedById,
      dataVersion,
    });

    return createHash('sha256').update(payload).digest('hex');
  }

  private buildFileName(title: string, format: ReportFormat): string {
    const date = new Date().toISOString().slice(0, 10);
    const safeTitle = title.replace(/[^\p{L}\p{N}\s-]/gu, '').trim().slice(0, 60) || 'report';
    return `${safeTitle} ${date}.${EXTENSION_BY_FORMAT[format]}`;
  }

  private emitProgress(
    jobId: string,
    requestedById: string,
    status: string,
    progress: number,
    rowCount?: number,
  ): void {
    this.events.emit('report.progress', { jobId, requestedById, status, progress, rowCount });
  }
}

const MIME_BY_FORMAT: Record<ReportFormat, string> = {
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  XLS: 'application/vnd.ms-excel',
  PDF: 'application/pdf',
  CSV: 'text/csv; charset=utf-8',
  JSON: 'application/json; charset=utf-8',
};

const EXTENSION_BY_FORMAT: Record<ReportFormat, string> = {
  XLSX: 'xlsx',
  XLS: 'xls',
  PDF: 'pdf',
  CSV: 'csv',
  JSON: 'json',
};

/** Сортирует поля фильтра — одинаковые по смыслу наборы дают один отпечаток. */
function sortedFilters(filters: ReportFilters): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(filters).sort()) {
    const value = (filters as Record<string, unknown>)[key];
    result[key] = Array.isArray(value) ? [...value].sort() : value;
  }

  return result;
}

/** Человекочитаемое описание фильтров для шапки отчёта. */
function describeFilters(filters: ReportFilters): string[] {
  const lines: string[] = [];

  if (filters.periodFrom || filters.periodTo) {
    const from = filters.periodFrom ? formatRuDate(filters.periodFrom) : 'начала';
    const to = filters.periodTo ? formatRuDate(filters.periodTo) : 'настоящего момента';
    lines.push(`Период: с ${from} по ${to}`);
  }

  if (filters.segments && filters.segments.length === 1) {
    lines.push(
      filters.segments[0] === 'B2C' ? 'Сегмент: прямые продажи' : 'Сегмент: работа с вузами',
    );
  }

  const counts: Array<[string, unknown[] | undefined]> = [
    ['вузов', filters.universityIds],
    ['направлений', filters.directionIds],
    ['продуктов', filters.productIds],
    ['программ', filters.programIds],
    ['ответственных', filters.ownerIds],
    ['статусов', filters.stateKeys],
    ['регионов', filters.regions],
  ];

  const applied = counts
    .filter(([, value]) => value && value.length > 0)
    .map(([label, value]) => `${label}: ${value?.length}`);

  if (applied.length > 0) {
    lines.push(`Отбор по — ${applied.join(', ')}`);
  }

  if (filters.interestLevels && filters.interestLevels.length > 0) {
    const labels: Record<string, string> = {
      HIGH: 'высокая',
      MEDIUM: 'средняя',
      LOW: 'низкая',
      UNSET: 'без оценки',
    };

    lines.push(
      `Заинтересованность: ${filters.interestLevels.map((value) => labels[value] ?? value).join(', ')}`,
    );
  }

  if (filters.onlyOverdue) {
    lines.push('Только просроченные по нормативу');
  }

  if (lines.length === 0) {
    lines.push('Фильтры не применялись: выгружены все доступные записи');
  }

  return lines;
}

function formatRuDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' });
}
