import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { PageDto, PageQueryDto, toPage } from '../../common/dto/pagination.dto.js';
import {
  CreateItDirectionDto,
  CreateItProgramDto,
  CreateSoftwareProductDto,
  CreateVendorDto,
  ItDirectionDto,
  ItProgramDto,
  ItProgramQueryDto,
  SoftwareProductDto,
  SoftwareProductQueryDto,
  UpdateItDirectionDto,
  UpdateItProgramDto,
  UpdateSoftwareProductDto,
  UpdateVendorDto,
  VendorDto,
} from './dto/catalog.dto.js';
import type { EducationProject, ProgramAudience } from '../../generated/prisma/enums.js';
import { audienceFromApi, audienceToApi, projectFromApi, projectToApi } from './catalog-enums.js';

/**
 * Справочники: вендоры, ИТ-продукты, ИТ-направления и ИТ-программы.
 *
 * Собраны в одном сервисе намеренно: это простые связанные между собой
 * справочники с одинаковым жизненным циклом, и дробление их на четыре
 * почти одинаковых сервиса добавило бы файлов, но не ясности.
 * Вуз вынесен отдельно — у него нетривиальная логика поиска дубликатов.
 */
@Injectable()
export class ReferenceService {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------- Вендоры --

  async findVendors(query: PageQueryDto): Promise<PageDto<VendorDto>> {
    const where: Prisma.VendorWhereInput = query.search
      ? { name: { contains: query.search, mode: 'insensitive' } }
      : {};

    const [total, records] = await Promise.all([
      this.prisma.vendor.count({ where }),
      this.prisma.vendor.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { name: query.sortOrder },
        include: { _count: { select: { products: true, contacts: true } } },
      }),
    ]);

    const items = records.map((record) => ({
      id: record.id,
      name: record.name,
      isActive: record.isActive,
      productCount: record._count.products,
      contactCount: record._count.contacts,
    }));

    return toPage(items, total, query);
  }

  async createVendor(dto: CreateVendorDto): Promise<VendorDto> {
    const record = await this.prisma.vendor.create({
      data: { name: dto.name },
      include: { _count: { select: { products: true } } },
    });

    return { id: record.id, name: record.name, isActive: record.isActive, productCount: 0, contactCount: 0 };
  }

  async updateVendor(id: string, dto: UpdateVendorDto): Promise<VendorDto> {
    await this.ensure('vendor', id, 'Вендор');

    const record = await this.prisma.vendor.update({
      where: { id },
      data: { name: dto.name, ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }) },
      include: { _count: { select: { products: true, contacts: true } } },
    });

    return {
      id: record.id,
      name: record.name,
      isActive: record.isActive,
      productCount: record._count.products,
      contactCount: record._count.contacts,
    };
  }

  // -------------------------------------------------------- ИТ-продукты --

  async findProducts(query: SoftwareProductQueryDto): Promise<PageDto<SoftwareProductDto>> {
    const where: Prisma.SoftwareProductWhereInput = {
      ...(query.activeOnly ? { isActive: true } : {}),
      ...(query.vendorId ? { vendorId: query.vendorId } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };

    const [total, records] = await Promise.all([
      this.prisma.softwareProduct.count({ where }),
      this.prisma.softwareProduct.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { name: query.sortOrder },
        include: { vendor: { select: { name: true } } },
      }),
    ]);

    const items = records.map((record) => ({
      id: record.id,
      name: record.name,
      vendorId: record.vendorId,
      vendorName: record.vendor.name,
      description: record.description,
      isActive: record.isActive,
    }));

    return toPage(items, total, query);
  }

  async createProduct(dto: CreateSoftwareProductDto): Promise<SoftwareProductDto> {
    await this.ensure('vendor', dto.vendorId, 'Вендор');

    const record = await this.prisma.softwareProduct.create({
      data: { name: dto.name, vendorId: dto.vendorId, description: dto.description ?? null },
      include: { vendor: { select: { name: true } } },
    });

    return {
      id: record.id,
      name: record.name,
      vendorId: record.vendorId,
      vendorName: record.vendor.name,
      description: record.description,
      isActive: record.isActive,
    };
  }

  async updateProduct(id: string, dto: UpdateSoftwareProductDto): Promise<SoftwareProductDto> {
    await this.ensure('softwareProduct', id, 'ИТ-продукт');
    await this.ensure('vendor', dto.vendorId, 'Вендор');

    const record = await this.prisma.softwareProduct.update({
      where: { id },
      data: {
        name: dto.name,
        vendorId: dto.vendorId,
        description: dto.description ?? null,
        ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
      },
      include: { vendor: { select: { name: true } } },
    });

    return {
      id: record.id,
      name: record.name,
      vendorId: record.vendorId,
      vendorName: record.vendor.name,
      description: record.description,
      isActive: record.isActive,
    };
  }

  // ----------------------------------------------------- ИТ-направления --

  async findDirections(query: PageQueryDto): Promise<PageDto<ItDirectionDto>> {
    const where: Prisma.ItDirectionWhereInput = query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { code: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [total, records] = await Promise.all([
      this.prisma.itDirection.count({ where }),
      this.prisma.itDirection.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { name: query.sortOrder },
        include: { _count: { select: { programs: true } } },
      }),
    ]);

    const items = records.map((record) => ({
      id: record.id,
      name: record.name,
      code: record.code,
      isActive: record.isActive,
      programCount: record._count.programs,
    }));

    return toPage(items, total, query);
  }

  async createDirection(dto: CreateItDirectionDto): Promise<ItDirectionDto> {
    const record = await this.prisma.itDirection.create({
      data: { name: dto.name, code: dto.code ?? null },
    });

    return { id: record.id, name: record.name, code: record.code, isActive: record.isActive, programCount: 0 };
  }

  async updateDirection(id: string, dto: UpdateItDirectionDto): Promise<ItDirectionDto> {
    await this.ensure('itDirection', id, 'ИТ-направление');

    const record = await this.prisma.itDirection.update({
      where: { id },
      data: {
        name: dto.name,
        code: dto.code ?? null,
        ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
      },
      include: { _count: { select: { programs: true } } },
    });

    return {
      id: record.id,
      name: record.name,
      code: record.code,
      isActive: record.isActive,
      programCount: record._count.programs,
    };
  }

  // ------------------------------------------------------- ИТ-программы --

  /**
   * Каталог программ с отбором для каталога курсов.
   *
   * Сортировка по числу обучающихся считается по потокам и не выражается
   * одним запросом Prisma. Программ в каталоге десятки, поэтому порядок
   * для этой сортировки собирается в памяти по идентификаторам, а полные
   * записи читаются только для запрошенной страницы.
   */
  async findPrograms(query: ItProgramQueryDto): Promise<PageDto<ItProgramDto>> {
    const where = programWhere(query);
    const include = {
      direction: { select: { name: true } },
      product: { select: { name: true } },
    } as const;

    if (query.sortBy === 'students') {
      const all = await this.prisma.itProgram.findMany({ where, select: { id: true, name: true } });
      const stats = await this.streamStats(all.map((program) => program.id));
      const sign = query.sortOrder === 'desc' ? -1 : 1;

      const ordered = all.sort(
        (left, right) =>
          sign * ((stats.get(left.id)?.students ?? 0) - (stats.get(right.id)?.students ?? 0)) ||
          left.name.localeCompare(right.name, 'ru'),
      );
      const pageIds = ordered.slice(query.skip, query.skip + query.limit).map((program) => program.id);
      const records = await this.prisma.itProgram.findMany({ where: { id: { in: pageIds } }, include });
      const byId = new Map(records.map((record) => [record.id, record]));

      const items = pageIds.flatMap((id) => {
        const record = byId.get(id);
        return record ? [toProgramDto(record, stats.get(id))] : [];
      });

      return toPage(items, all.length, query);
    }

    const [total, records] = await Promise.all([
      this.prisma.itProgram.count({ where }),
      this.prisma.itProgram.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy:
          query.sortBy === 'hoursTotal'
            ? [{ hoursTotal: { sort: query.sortOrder, nulls: 'last' } }, { name: 'asc' }]
            : [{ name: query.sortOrder }],
        include,
      }),
    ]);

    const stats = await this.streamStats(records.map((record) => record.id));
    const items = records.map((record) => toProgramDto(record, stats.get(record.id)));
    return toPage(items, total, query);
  }

  /** Идущие потоки программ: сколько их и сколько в них обучается. */
  private async streamStats(programIds: string[]): Promise<Map<string, StreamStats>> {
    if (programIds.length === 0) {
      return new Map();
    }

    const rows = await this.prisma.learningStream.groupBy({
      by: ['programId'],
      where: { programId: { in: programIds }, status: 'ACTIVE' },
      _count: { _all: true },
      _sum: { studentsCount: true },
    });

    return new Map(
      rows.map((row) => [row.programId, { streams: row._count._all, students: row._sum.studentsCount ?? 0 }]),
    );
  }

  async createProgram(dto: CreateItProgramDto): Promise<ItProgramDto> {
    await this.ensure('itDirection', dto.directionId, 'ИТ-направление');
    if (dto.productId) {
      await this.ensure('softwareProduct', dto.productId, 'ИТ-продукт');
    }

    const record = await this.prisma.itProgram.create({
      data: {
        name: dto.name,
        directionId: dto.directionId,
        productId: dto.productId ?? null,
        hoursTotal: dto.hoursTotal ?? null,
        ...programCatalogData(dto),
      },
      include: { direction: { select: { name: true } }, product: { select: { name: true } } },
    });

    return toProgramDto(record, undefined);
  }

  async updateProgram(id: string, dto: UpdateItProgramDto): Promise<ItProgramDto> {
    await this.ensure('itProgram', id, 'ИТ-программа');
    await this.ensure('itDirection', dto.directionId, 'ИТ-направление');
    if (dto.productId) {
      await this.ensure('softwareProduct', dto.productId, 'ИТ-продукт');
    }

    const record = await this.prisma.itProgram.update({
      where: { id },
      data: {
        name: dto.name,
        directionId: dto.directionId,
        productId: dto.productId ?? null,
        hoursTotal: dto.hoursTotal ?? null,
        ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
        ...programCatalogData(dto),
      },
      include: { direction: { select: { name: true } }, product: { select: { name: true } } },
    });

    const stats = await this.streamStats([id]);
    return toProgramDto(record, stats.get(id));
  }

  /**
   * Проверяет существование записи справочника.
   *
   * Без этой проверки нарушение внешнего ключа дошло бы до Postgres и
   * вернулось пользователю как «конфликт связей» — сообщение, по которому
   * невозможно понять, какой именно идентификатор указан неверно.
   */
  private async ensure(
    model: 'vendor' | 'softwareProduct' | 'itDirection' | 'itProgram',
    id: string,
    label: string,
  ): Promise<void> {
    // Явный разбор вместо карты делегатов: объединение обобщённых типов
    // Prisma не вызывается напрямую, а приведение через any свело бы
    // на нет типовую проверку аргументов запроса.
    const count = await (async () => {
      switch (model) {
        case 'vendor':
          return this.prisma.vendor.count({ where: { id } });
        case 'softwareProduct':
          return this.prisma.softwareProduct.count({ where: { id } });
        case 'itDirection':
          return this.prisma.itDirection.count({ where: { id } });
        case 'itProgram':
          return this.prisma.itProgram.count({ where: { id } });
      }
    })();

    if (count === 0) {
      throw new AppException('NOT_FOUND', {
        detail: `${label} с идентификатором ${id} не найден.`,
        meta: { entity: model, id },
      });
    }
  }
}

/** Идущие потоки программы. */
interface StreamStats {
  streams: number;
  students: number;
}

/** Потоки, которые считаются «есть»: идущие и запланированные. */
const LIVE_STREAM_STATUSES = ['PLANNED', 'ACTIVE'] as const;

export function programWhere(query: ItProgramQueryDto): Prisma.ItProgramWhereInput {
  const conditions: Prisma.ItProgramWhereInput[] = [];

  if (query.activeOnly) conditions.push({ isActive: true });
  if (query.directionId) conditions.push({ directionId: query.directionId });
  if (query.source) conditions.push({ source: projectFromApi(query.source) });
  if (query.audienceCategory) conditions.push({ audienceCategory: audienceFromApi(query.audienceCategory) });
  if (query.hoursMin !== undefined) conditions.push({ hoursTotal: { gte: query.hoursMin } });
  if (query.hoursMax !== undefined) conditions.push({ hoursTotal: { lte: query.hoursMax } });
  if (query.universityId) conditions.push({ streams: { some: { universityId: query.universityId } } });

  if (query.hasStreams !== undefined) {
    const live = { streams: { some: { status: { in: [...LIVE_STREAM_STATUSES] } } } };
    conditions.push(query.hasStreams ? live : { NOT: live });
  }

  if (query.search) {
    conditions.push({
      OR: [
        { name: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ],
    });
  }

  return conditions.length > 0 ? { AND: conditions } : {};
}

/** Поля каталога курсов из запроса: не переданное поле не меняется. */
function programCatalogData(
  dto: CreateItProgramDto,
): Partial<
  Pick<Prisma.ItProgramUncheckedCreateInput, 'source' | 'audienceCategory' | 'description' | 'audience' | 'requirements'>
> {
  const text = (value: string | null | undefined) => (value === undefined ? undefined : value?.trim() || null);

  return {
    ...(dto.source === undefined ? {} : { source: projectFromApi(dto.source) }),
    ...(dto.audienceCategory === undefined ? {} : { audienceCategory: audienceFromApi(dto.audienceCategory) }),
    description: text(dto.description),
    audience: text(dto.audience),
    requirements: text(dto.requirements),
  };
}

type ProgramRecord = {
  id: string;
  name: string;
  directionId: string;
  productId: string | null;
  hoursTotal: number | null;
  isActive: boolean;
  source: EducationProject;
  description: string | null;
  audience: string | null;
  audienceCategory: ProgramAudience;
  requirements: string | null;
  direction: { name: string };
  product: { name: string } | null;
};

function toProgramDto(record: ProgramRecord, stats: StreamStats | undefined): ItProgramDto {
  return {
    id: record.id,
    name: record.name,
    directionId: record.directionId,
    directionName: record.direction.name,
    productId: record.productId,
    productName: record.product?.name ?? null,
    hoursTotal: record.hoursTotal,
    isActive: record.isActive,
    source: projectToApi(record.source),
    description: record.description,
    audience: record.audience,
    audienceCategory: audienceToApi(record.audienceCategory),
    requirements: record.requirements,
    activeStreamCount: stats?.streams ?? 0,
    studentsCount: stats?.students ?? 0,
  };
}
