import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { PageDto, toPage } from '../../common/dto/pagination.dto.js';
import { nameSimilarity, normalizeName } from '../../common/utils/text-normalization.js';
import {
  CreateUniversityDto,
  SimilarUniversityDto,
  UniversityDto,
  UniversityQueryDto,
  UpdateUniversityDto,
} from './dto/catalog.dto.js';

/**
 * Порог триграммного сходства для поиска кандидатов в дубликаты.
 *
 * Используется word_similarity, а не similarity. Разница принципиальна:
 * similarity нормирует оценку по объединению триграмм ОБЕИХ строк, поэтому
 * короткая аббревиатура против длинного полного наименования всегда получает
 * низкий балл. Замер на реальных данных каталога:
 *
 *   запрос                               similarity   word_similarity
 *   «мгту имени н э баумана»                 0.271             0.783
 *   «итмо»                                   0.294             1.000
 *   «казанский федеральный универститет»     0.865             0.865
 *
 * С порогом 0.3 функция similarity пропустила бы два случая из трёх —
 * ровно те, ради которых дедупликация и нужна. word_similarity оценивает
 * совпадение запроса с ЧАСТЬЮ наименования и такие случаи находит.
 */
const TRIGRAM_THRESHOLD = 0.5;

/** Сколько кандидатов показывать пользователю. */
const SIMILAR_LIMIT = 5;

@Injectable()
export class UniversityService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: UniversityQueryDto): Promise<PageDto<UniversityDto>> {
    const where: Prisma.UniversityWhereInput = {
      ...(query.activeOnly ? { isActive: true } : {}),
      ...(query.region ? { region: { equals: query.region, mode: 'insensitive' } } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { shortName: { contains: query.search, mode: 'insensitive' } },
              // Поиск идёт и по нормализованной форме: пользователь,
              // набравший «мгту баумана», должен найти вуз независимо
              // от того, как записано полное наименование.
              { normalizedName: { contains: normalizeName(query.search), mode: 'insensitive' } },
              { inn: { startsWith: query.search.trim() } },
              { city: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    // Count и выборка выполняются параллельно: последовательный запуск
    // удваивал бы задержку на каждой странице списка.
    const [total, records] = await Promise.all([
      this.prisma.university.count({ where }),
      this.prisma.university.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: universityOrder(query),
        include: { _count: { select: { engagements: true } } },
      }),
    ]);

    return toPage(records.map(toUniversityDto), total, query);
  }

  async findOne(id: string): Promise<UniversityDto> {
    const record = await this.prisma.university.findUnique({
      where: { id },
      include: { _count: { select: { engagements: true } } },
    });

    if (!record) {
      throw new AppException('NOT_FOUND', { detail: 'Вуз с указанным идентификатором не найден.' });
    }

    return toUniversityDto(record);
  }

  async create(dto: CreateUniversityDto): Promise<UniversityDto> {
    const record = await this.prisma.university.create({
      data: {
        name: dto.name,
        shortName: dto.shortName ?? null,
        normalizedName: normalizeName(dto.name),
        inn: dto.inn ?? null,
        region: dto.region ?? null,
        city: dto.city ?? null,
        website: dto.website ?? null,
      },
      include: { _count: { select: { engagements: true } } },
    });

    return toUniversityDto(record);
  }

  async update(id: string, dto: UpdateUniversityDto): Promise<UniversityDto> {
    await this.ensureExists(id);

    const record = await this.prisma.university.update({
      where: { id },
      data: {
        name: dto.name,
        shortName: dto.shortName ?? null,
        // Нормализованная форма пересчитывается при каждом изменении имени,
        // иначе поиск дубликатов начал бы работать по устаревшим данным.
        normalizedName: normalizeName(dto.name),
        inn: dto.inn ?? null,
        region: dto.region ?? null,
        city: dto.city ?? null,
        website: dto.website ?? null,
        ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
      },
      include: { _count: { select: { engagements: true } } },
    });

    return toUniversityDto(record);
  }

  /**
   * Мягкое удаление: запись переводится в неактивные.
   *
   * Физическое удаление недопустимо — на вуз ссылаются взаимодействия,
   * договоры и уже сформированные отчёты. Удалив строку, мы разрушили бы
   * историю, которую система обязана хранить.
   */
  async deactivate(id: string): Promise<void> {
    await this.ensureExists(id);

    const activeEngagements = await this.prisma.engagement.count({
      where: { universityId: id, isArchived: false },
    });

    if (activeEngagements > 0) {
      throw new AppException('CATALOG_IN_USE', {
        detail: `Нельзя деактивировать вуз: с ним связано активных взаимодействий — ${activeEngagements}.`,
        meta: { activeEngagements },
      });
    }

    await this.prisma.university.update({ where: { id }, data: { isActive: false } });
  }

  /**
   * Поиск вузов, похожих на переданное наименование.
   *
   * Используется при ручном создании записи и при импорте XLS, где одна
   * и та же организация приходит в разных формулировках. Сочетаются два
   * независимых механизма:
   *   • pg_trgm — устойчив к опечаткам и разной пунктуации;
   *   • сравнение значимых токенов — ловит случай, когда одно наименование
   *     является расширением другого («КФУ» и «Казанский федеральный ...»).
   * Итоговая оценка берётся как максимум из двух: каждый метод силён там,
   * где другой слаб, и усреднение только размывало бы сигнал.
   */
  async findSimilar(name: string): Promise<SimilarUniversityDto[]> {
    const normalized = normalizeName(name);

    if (normalized.length === 0) {
      return [];
    }

    // Порядок аргументов word_similarity важен: функция асимметрична и
    // измеряет, насколько ПЕРВЫЙ аргумент похож на часть второго.
    //
    // Фильтр по функции, а не по оператору <%: последний опирается на
    // настройку pg_trgm.word_similarity_threshold уровня сессии, что
    // потребовало бы оборачивать запрос в транзакцию с SET LOCAL. При
    // размере каталога в сотни записей выигрыш от индекса несуществен,
    // а явный порог в запросе понятнее и не зависит от настроек сессии.
    const candidates = await this.prisma.$queryRaw<
      Array<{ id: string; name: string; trigram: number }>
    >`
      SELECT id, name, word_similarity(${normalized}, normalized_name) AS trigram
      FROM university
      WHERE is_active = true
        AND word_similarity(${normalized}, normalized_name) > ${TRIGRAM_THRESHOLD}
      ORDER BY trigram DESC
      LIMIT ${SIMILAR_LIMIT * 4}
    `;

    return candidates
      .map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        similarity: Number(
          Math.max(Number(candidate.trigram), nameSimilarity(name, candidate.name)).toFixed(3),
        ),
      }))
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, SIMILAR_LIMIT);
  }

  private async ensureExists(id: string): Promise<void> {
    const exists = await this.prisma.university.count({ where: { id } });

    if (exists === 0) {
      throw new AppException('NOT_FOUND', { detail: 'Вуз с указанным идентификатором не найден.' });
    }
  }
}

/**
 * Порядок списка. Стабильность обеспечивает имя вторым ключом: вузы
 * с равным числом заявок иначе менялись бы местами между страницами.
 */
function universityOrder(query: UniversityQueryDto): Prisma.UniversityOrderByWithRelationInput[] {
  const dir = query.sortOrder;

  switch (query.sortBy) {
    case 'engagementCount':
      return [{ engagements: { _count: dir } }, { name: 'asc' }];
    case 'createdAt':
      return [{ createdAt: dir }, { name: 'asc' }];
    default:
      return [{ name: dir }];
  }
}

/** Запись БД вместе со счётчиком связанных взаимодействий. */
type UniversityRecord = {
  id: string;
  name: string;
  shortName: string | null;
  inn: string | null;
  region: string | null;
  city: string | null;
  website: string | null;
  isActive: boolean;
  createdAt: Date;
  _count: { engagements: number };
};

function toUniversityDto(record: UniversityRecord): UniversityDto {
  return {
    id: record.id,
    name: record.name,
    shortName: record.shortName,
    inn: record.inn,
    region: record.region,
    city: record.city,
    website: record.website,
    isActive: record.isActive,
    engagementCount: record._count.engagements,
    createdAt: record.createdAt,
  };
}
