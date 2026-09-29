import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { PageDto, toPage } from '../../common/dto/pagination.dto.js';
import { DataScope, DataScopeService } from '../access/data-scope.service.js';
import { dateFromDb, dateToDb, isCalendarDate } from '../planner/planner-dates.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { assertUniversityVisible } from './university-access.js';
import {
  CreateLearningStreamDto,
  LearningStreamDto,
  LearningStreamQueryDto,
  UpdateLearningStreamDto,
} from './dto/learning-stream.dto.js';

const streamSelection = {
  id: true,
  programId: true,
  universityId: true,
  name: true,
  startDate: true,
  endDate: true,
  studentsCount: true,
  status: true,
  externalSource: true,
  program: { select: { name: true } },
  university: { select: { name: true, shortName: true } },
} satisfies Prisma.LearningStreamSelect;

type StreamRecord = Prisma.LearningStreamGetPayload<{ select: typeof streamSelection }>;

/**
 * Учебные потоки.
 *
 * По ним ТЗ ранжирует программы: сколько групп идёт параллельно и сколько
 * в них обучается. Поток заводит руководитель или администратор, либо он
 * приходит синхронизацией с LMS (тогда у записи есть внешний ключ).
 *
 * Потоки при вузе подчиняются ограничениям видимости так же, как договоры:
 * кому вуз закрыт, тот не видит и его потоков. Наборы прямых продаж
 * (без вуза) видны всем.
 */
@Injectable()
export class LearningStreamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
  ) {}

  async list(query: LearningStreamQueryDto, user: AuthenticatedUser): Promise<PageDto<LearningStreamDto>> {
    const scope = await this.dataScope.resolve(user);

    const where: Prisma.LearningStreamWhereInput = {
      AND: [
        streamScopeFilter(scope),
        query.programId ? { programId: query.programId } : {},
        query.universityId ? { universityId: query.universityId } : {},
        query.status ? { status: query.status } : {},
        query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { program: { name: { contains: query.search, mode: 'insensitive' } } },
              ],
            }
          : {},
      ],
    };

    const [total, records] = await Promise.all([
      this.prisma.learningStream.count({ where }),
      this.prisma.learningStream.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        // Новые потоки первыми: список читают, чтобы увидеть текущий набор.
        orderBy: [{ startDate: query.sortOrder === 'asc' ? 'asc' : 'desc' }, { id: 'asc' }],
        select: streamSelection,
      }),
    ]);

    return toPage(records.map(toDto), total, query);
  }

  async create(dto: CreateLearningStreamDto, user: AuthenticatedUser): Promise<LearningStreamDto> {
    const data = await this.validated(dto, user);

    const record = await this.prisma.learningStream.create({ data, select: streamSelection });

    return toDto(record);
  }

  async update(id: string, dto: UpdateLearningStreamDto, user: AuthenticatedUser): Promise<LearningStreamDto> {
    await this.findVisible(id, user);
    const data = await this.validated(dto, user);

    const record = await this.prisma.learningStream.update({ where: { id }, data, select: streamSelection });

    return toDto(record);
  }

  /** Удаление — для потока, заведённого по ошибке: на поток ничто не ссылается. */
  async remove(id: string, user: AuthenticatedUser): Promise<void> {
    await this.findVisible(id, user);
    await this.prisma.learningStream.delete({ where: { id } });
  }

  private async findVisible(id: string, user: AuthenticatedUser): Promise<void> {
    const scope = await this.dataScope.resolve(user);
    const found = await this.prisma.learningStream.count({ where: { id, ...streamScopeFilter(scope) } });

    if (found === 0) {
      throw new AppException('NOT_FOUND', { detail: 'Учебный поток не найден либо недоступен.' });
    }
  }

  /** Проверка ссылок и дат до записи — с понятным сообщением, а не нарушением ключа. */
  private async validated(
    dto: CreateLearningStreamDto,
    user: AuthenticatedUser,
  ): Promise<Prisma.LearningStreamUncheckedCreateInput> {
    const program = await this.prisma.itProgram.count({ where: { id: dto.programId } });

    if (program === 0) {
      throw new AppException('NOT_FOUND', {
        detail: `ИТ-программа с идентификатором ${dto.programId} не найдена.`,
        meta: { entity: 'itProgram', id: dto.programId },
      });
    }

    if (dto.universityId) {
      await assertUniversityVisible(this.prisma, dto.universityId, await this.dataScope.resolve(user));
    }

    for (const [field, value] of [
      ['startDate', dto.startDate],
      ['endDate', dto.endDate],
    ] as const) {
      if (value && !isCalendarDate(value)) {
        throw new AppException('VALIDATION_FAILED', {
          detail: 'Такой даты нет в календаре.',
          issues: [{ field, message: 'Несуществующая дата' }],
        });
      }
    }

    if (dto.endDate && dto.endDate < dto.startDate) {
      throw new AppException('VALIDATION_FAILED', {
        detail: 'Поток не может закончиться раньше, чем начался.',
        issues: [{ field: 'endDate', message: 'Окончание раньше начала' }],
      });
    }

    return {
      programId: dto.programId,
      universityId: dto.universityId ?? null,
      name: dto.name?.trim() || null,
      startDate: dateToDb(dto.startDate),
      endDate: dto.endDate ? dateToDb(dto.endDate) : null,
      studentsCount: dto.studentsCount,
      status: dto.status ?? 'PLANNED',
    };
  }
}

/**
 * Потоки, видимые пользователю: наборы без вуза — всем, потоки при вузе —
 * если вуз не закрыт ограничением по вузу или региону.
 */
export function streamScopeFilter(scope: DataScope): Prisma.LearningStreamWhereInput {
  if (scope.universityIds === null && scope.regions === null) {
    return {};
  }

  return {
    OR: [
      { universityId: null },
      {
        university: {
          ...(scope.universityIds !== null ? { id: { in: scope.universityIds } } : {}),
          ...(scope.regions !== null ? { region: { in: scope.regions } } : {}),
        },
      },
    ],
  };
}

function toDto(record: StreamRecord): LearningStreamDto {
  return {
    id: record.id,
    programId: record.programId,
    programName: record.program.name,
    universityId: record.universityId,
    universityName: record.university ? (record.university.shortName ?? record.university.name) : null,
    name: record.name,
    startDate: dateFromDb(record.startDate),
    endDate: record.endDate ? dateFromDb(record.endDate) : null,
    studentsCount: record.studentsCount,
    status: record.status,
    externalSource: record.externalSource,
  };
}
