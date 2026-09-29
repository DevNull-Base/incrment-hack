import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { AppException } from '../../../common/errors/app-exception.js';
import { DataScopeService, engagementScopeFilter } from '../../access/data-scope.service.js';
import { recordActivities } from '../../activity/activity-log.js';
import { AUDIT_ACTIONS, AuditService } from '../../audit/audit.service.js';
import type { AuthenticatedUser } from '../../auth/authenticated-user.js';
import { PAID_STATE_KEY } from '../payments/payment-intake.service.js';
import { parseStream } from '../payments/payment-records.js';
import { LmsCandidateDto, LmsCandidateListDto, LmsExportFilterDto, LmsExportRequestDto } from './dto/lms-export.dto.js';
import { buildLmsWorkbook, splitFullName } from './lms-template.js';

/**
 * Предел одной выгрузки. Файл загрузки в LMS — рабочий документ, а не
 * архив: тысячи строк за раз означают, что отбор забыли задать. Остаток
 * уйдёт следующим файлом — выгруженные помечаются и повторно не попадают.
 */
const EXPORT_LIMIT = 2000;

const candidateSelection = {
  id: true,
  studyStream: true,
  paymentConfirmedAt: true,
  lmsExportedAt: true,
  currentStateKey: true,
  currentStateLabel: true,
  program: { select: { name: true } },
  owner: { select: { displayName: true } },
  counterpartyContact: { select: { fullName: true, email: true, phone: true, erasedAt: true } },
} satisfies Prisma.EngagementSelect;

type CandidateRecord = Prisma.EngagementGetPayload<{ select: typeof candidateSelection }>;

export interface LmsExportFile {
  content: Buffer;
  fileName: string;
  exported: number;
  skipped: number;
  /** Сколько подходящих под отбор осталось за пределом одной выгрузки. */
  remaining: number;
}

/**
 * Выгрузка оплативших слушателей для загрузки в LMS.
 *
 * Звено между оплатой и доступом к обучению: оплата с сайта переводит
 * заявку на этап «Договор и оплата», отсюда слушатель уходит в файл по
 * шаблону LMS, а выдачу доступа отмечает уже событие LMS
 * (enrollment.created → «Доступ выдан»).
 *
 * Кандидат — заявка прямой продажи с подтверждённой оплатой, стоящая на
 * этапе оплаты: ушедшие дальше доступ уже получили, закрытые отказом
 * в LMS не нужны. Видимость — по обычным правилам: менеджер выгружает
 * своих слушателей, руководитель — своего подразделения.
 */
@Injectable()
export class LmsExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly audit: AuditService,
  ) {}

  async candidates(filter: LmsExportFilterDto, user: AuthenticatedUser): Promise<LmsCandidateListDto> {
    const { records, total } = await this.load(filter, user);
    const items = records.map(toCandidate);

    return {
      items,
      total,
      ready: items.filter((item) => item.ready).length,
      truncated: total > records.length,
    };
  }

  async export(request: LmsExportRequestDto, user: AuthenticatedUser): Promise<LmsExportFile> {
    const { records, total } = await this.load(request, user, request.engagementIds);
    const candidates = records.map((record) => ({ record, candidate: toCandidate(record) }));
    const ready = candidates.filter((item) => item.candidate.ready);
    const skipped = candidates.length - ready.length;

    if (ready.length === 0) {
      throw new AppException('LMS_EXPORT_EMPTY', {
        detail:
          skipped > 0
            ? `Подходят ${skipped} слушателей, но ни один не готов к выгрузке: ` +
              'не хватает почты либо ФИО. Список кандидатов покажет, чего именно.'
            : 'Нет оплаченных слушателей, ожидающих выгрузки в LMS, по заданному отбору.',
        meta: { skipped },
      });
    }

    const now = new Date();
    const markExported = request.markExported ?? true;

    // Слушатели сначала «забираются» одним UPDATE с условием, и в файл
    // попадают только забранные. Иначе два руководителя, нажавшие
    // «Выгрузить» одновременно, получили бы два файла с одними и теми же
    // людьми — и LMS завела бы им по две учётные записи.
    const exported = markExported
      ? await this.claim(ready, now, user, request.includeExported ?? false)
      : ready;

    if (exported.length === 0) {
      throw new AppException('LMS_EXPORT_EMPTY', {
        detail: 'Эти слушатели только что выгружены другим пользователем.',
      });
    }

    exported.sort((left, right) =>
      `${left.candidate.lastName} ${left.candidate.firstName}`.localeCompare(
        `${right.candidate.lastName} ${right.candidate.firstName}`,
        'ru',
      ),
    );

    const content = await buildLmsWorkbook(
      exported.map(({ candidate }) => ({
        lastName: candidate.lastName as string,
        firstName: candidate.firstName as string,
        middleName: candidate.middleName,
        phone: candidate.phone,
        email: candidate.email as string,
      })),
    );

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTIONS.EXPORT_REPORT,
      entityType: 'LmsExport',
      afterState: {
        rowCount: exported.length,
        skipped,
        markExported,
        programId: request.programId ?? null,
        stream: request.stream ?? null,
        includeExported: request.includeExported ?? false,
      },
    });

    return {
      content,
      fileName: `Загрузка пользователей ${now.toISOString().slice(0, 10)}.xlsx`,
      exported: exported.length,
      skipped,
      remaining: Math.max(0, total - records.length),
    };
  }

  /**
   * Отмечает слушателей выгруженными и возвращает тех, кого удалось отметить.
   *
   * Условие «ещё не выгружен» проверяется в самом UPDATE, поэтому из двух
   * одновременных выгрузок каждого слушателя получает ровно одна.
   */
  private async claim<T extends { record: CandidateRecord }>(
    ready: T[],
    now: Date,
    user: AuthenticatedUser,
    includeExported: boolean,
  ): Promise<T[]> {
    const ids = ready.map(({ record }) => record.id);

    // Время приводится к UTC явно: столбцы хранят UTC без пояса, а в сыром
    // запросе значение иначе пересчиталось бы в пояс сеанса PostgreSQL.
    return this.prisma.$transaction(async (tx) => {
      const claimed = includeExported
        ? await tx.$queryRaw<Array<{ id: string }>>`
            UPDATE engagement SET lms_exported_at = (${now}::timestamptz AT TIME ZONE 'UTC'), version = version + 1
            WHERE id = ANY(${ids}::uuid[])
            RETURNING id`
        : await tx.$queryRaw<Array<{ id: string }>>`
            UPDATE engagement SET lms_exported_at = (${now}::timestamptz AT TIME ZONE 'UTC'), version = version + 1
            WHERE id = ANY(${ids}::uuid[]) AND lms_exported_at IS NULL
            RETURNING id`;

      const claimedIds = new Set(claimed.map((row) => row.id));
      const result = ready.filter(({ record }) => claimedIds.has(record.id));

      await recordActivities(
        tx,
        result.map(({ record }) => ({
          type: 'LMS_EXPORTED' as const,
          actorId: user.id,
          engagementId: record.id,
          stage: { key: record.currentStateKey, label: record.currentStateLabel },
          details: { stream: record.studyStream, repeated: record.lmsExportedAt !== null },
        })),
      );

      return result;
    });
  }

  private async load(
    filter: LmsExportFilterDto,
    user: AuthenticatedUser,
    engagementIds?: string[],
  ): Promise<{ records: CandidateRecord[]; total: number }> {
    const scope = await this.dataScope.resolve(user);
    const stream = filter.stream ? parseStream(filter.stream) : null;

    const where: Prisma.EngagementWhereInput = {
      AND: [
        engagementScopeFilter(scope),
        {
          segment: 'B2C',
          isArchived: false,
          paymentConfirmedAt: { not: null },
          currentStateKey: PAID_STATE_KEY,
          ...(filter.includeExported ? {} : { lmsExportedAt: null }),
          ...(filter.programId ? { programId: filter.programId } : {}),
          ...(stream ? { studyStream: stream } : {}),
          ...(engagementIds && engagementIds.length > 0 ? { id: { in: engagementIds } } : {}),
        },
      ],
    };

    const [records, total] = await Promise.all([
      this.prisma.engagement.findMany({
        where,
        orderBy: [{ paymentConfirmedAt: 'asc' }, { id: 'asc' }],
        take: EXPORT_LIMIT,
        select: candidateSelection,
      }),
      this.prisma.engagement.count({ where }),
    ]);

    return { records, total };
  }
}

function toCandidate(record: CandidateRecord): LmsCandidateDto {
  const contact = record.counterpartyContact;
  const issues: string[] = [];
  const available = contact && !contact.erasedAt;
  const name = available ? splitFullName(contact.fullName) : null;

  if (!available) {
    issues.push(contact ? 'Данные слушателя обезличены' : 'К заявке не привязан слушатель');
  } else {
    if (!name) issues.push(`ФИО «${contact.fullName}» не делится на фамилию и имя`);
    if (!contact.email) issues.push('Нет почты — учётную запись LMS не завести');
    if (!contact.phone) issues.push('Нет телефона');
  }

  return {
    engagementId: record.id,
    lastName: name?.lastName ?? null,
    firstName: name?.firstName ?? null,
    middleName: name?.middleName ?? null,
    phone: available ? contact.phone : null,
    email: available ? contact.email : null,
    programName: record.program?.name ?? null,
    stream: record.studyStream,
    ownerName: record.owner.displayName,
    paymentConfirmedAt: (record.paymentConfirmedAt as Date).toISOString(),
    lmsExportedAt: record.lmsExportedAt?.toISOString() ?? null,
    ready: Boolean(available && name && contact.email),
    issues,
  };
}
