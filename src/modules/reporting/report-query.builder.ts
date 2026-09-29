import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration.js';
import { periodBounds } from '../../common/utils/period.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { DataScope } from '../access/data-scope.service.js';
import { REPORT_COLUMNS, ReportColumnKey, isReportColumn } from './report-columns.js';

/** Фильтры отчёта. Все значения подставляются параметрами, не текстом. */
export interface ReportFilters {
  periodFrom?: string;
  periodTo?: string;
  segments?: string[];
  universityIds?: string[];
  directionIds?: string[];
  productIds?: string[];
  programIds?: string[];
  ownerIds?: string[];
  stateKeys?: string[];
  regions?: string[];
  /** Оценки заинтересованности; UNSET — заявки без оценки. */
  interestLevels?: string[];
  onlyOverdue?: boolean;
  includeArchived?: boolean;
}

export interface BuiltQuery {
  sql: string;
  params: unknown[];
}

/**
 * Псевдонимы таблиц, используемые выражениями колонок.
 *
 * Соединения подключаются всегда, а не по составу выбранных колонок:
 * это на порядок проще и предсказуемее, а PostgreSQL исключает лишние
 * LEFT JOIN из плана, если ни одна колонка из соединяемой таблицы
 * не используется и соединение не влияет на число строк.
 */
const FROM_CLAUSE = `
  FROM engagement e
  -- Соединение внешнее, а не внутреннее: у заявки сегмента B2C вуза нет,
  -- и при INNER JOIN прямые продажи молча исчезли бы из всех отчётов.
  LEFT JOIN university u ON u.id = e.university_id
  JOIN it_direction d ON d.id = e.direction_id
  JOIN app_user o ON o.id = e.owner_id
  LEFT JOIN software_product p ON p.id = e.product_id
  LEFT JOIN vendor v ON v.id = p.vendor_id
  LEFT JOIN it_program pr ON pr.id = e.program_id
  LEFT JOIN workflow_instance wi ON wi.engagement_id = e.id
  LEFT JOIN contract c ON c.university_id = u.id
  LEFT JOIN license l ON l.contract_id = c.id AND l.product_id = e.product_id
`;

@Injectable()
export class ReportQueryBuilder {
  /** Часовой пояс организации: в нём считаются календарные границы периода. */
  private readonly timeZone: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.timeZone = config.get('APP_TIMEZONE', { infer: true });
  }

  /**
   * Собирает запрос отчёта.
   *
   * Выражения колонок берутся из белого списка по ключу; значения фильтров
   * передаются нумерованными параметрами. Строка запроса не содержит ни
   * одного фрагмента, пришедшего от клиента, — это ключевое свойство,
   * поскольку конструктор отчётов доступен любому пользователю системы.
   */
  build(
    columns: ReportColumnKey[],
    filters: ReportFilters,
    scope: DataScope,
    options: { limit?: number; afterId?: string; countOnly?: boolean; withVersion?: boolean } = {},
  ): BuiltQuery {
    const params: unknown[] = [];
    const param = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };

    const conditions: string[] = [];

    if (!filters.includeArchived) {
      conditions.push('e.is_archived = false');
    }

    // Столбцы хранят UTC без пояса; без явного приведения граница периода
    // пересчитывалась бы в пояс сеанса PostgreSQL и сдвигалась на часы.
    // Дата без времени — календарный день организации целиком (periodBounds).
    const period = periodBounds(filters.periodFrom, filters.periodTo, this.timeZone);

    if (period.gte) {
      conditions.push(`e.created_at >= (${param(period.gte)}::timestamptz AT TIME ZONE 'UTC')`);
    }
    if (period.lt) {
      conditions.push(`e.created_at < (${param(period.lt)}::timestamptz AT TIME ZONE 'UTC')`);
    }
    if (period.lte) {
      conditions.push(`e.created_at <= (${param(period.lte)}::timestamptz AT TIME ZONE 'UTC')`);
    }

    // Фильтры пользователя.
    this.addInCondition(conditions, 'e.segment', filters.segments, param);
    this.addInCondition(conditions, 'e.university_id', filters.universityIds, param);
    this.addInCondition(conditions, 'e.direction_id', filters.directionIds, param);
    this.addInCondition(conditions, 'e.product_id', filters.productIds, param);
    this.addInCondition(conditions, 'e.program_id', filters.programIds, param);
    this.addInCondition(conditions, 'e.owner_id', filters.ownerIds, param);
    this.addInCondition(conditions, 'e.current_state_key', filters.stateKeys, param);
    this.addInCondition(conditions, 'u.region', filters.regions, param);

    // Отсутствие оценки в перечислении не выражается — это NULL, поэтому
    // значение UNSET превращается в отдельное условие, а не в элемент IN.
    if (filters.interestLevels && filters.interestLevels.length > 0) {
      const levels = filters.interestLevels.filter((value) => value !== 'UNSET');
      const alternatives: string[] = [];

      if (levels.length > 0) {
        alternatives.push(
          `e.interest_level IN (${levels.map((value) => `${param(value)}::"InterestLevel"`).join(', ')})`,
        );
      }
      if (filters.interestLevels.includes('UNSET')) {
        alternatives.push('e.interest_level IS NULL');
      }

      conditions.push(`(${alternatives.join(' OR ')})`);
    }

    // Постраничная выборка по ключу, а не по OFFSET: смещение заставляет
    // БД каждый раз пересчитывать и отбрасывать пройденные строки, и на
    // отчёте в полмиллиона строк последние порции обходятся кратно дороже
    // первых. Условие по идентификатору такого эффекта не даёт.
    if (options.afterId) {
      conditions.push(`e.id > ${param(options.afterId)}`);
    }

    if (filters.onlyOverdue) {
      conditions.push(
        '(wi.completed_at IS NULL AND wi.sla_due_at IS NOT NULL AND wi.sla_due_at < now())',
      );
    }

    // Ограничения области видимости добавляются ПОСЛЕ пользовательских
    // фильтров и независимо от них: пользователь не может расширить
    // выборку, указав в фильтре чужие идентификаторы.
    this.addInCondition(conditions, 'e.owner_id', scope.ownerIds ?? undefined, param);
    this.addInCondition(conditions, 'e.direction_id', scope.directionIds ?? undefined, param);
    this.addInCondition(conditions, 'e.product_id', scope.productIds ?? undefined, param);

    // Ограничения по вузу и региону применяются только к сегменту B2B —
    // ровно так же, как в engagementScopeFilter. У прямых продаж вуза нет,
    // и безусловное условие по university_id убрало бы из отчёта все
    // заявки B2C, включая собственные заявки пользователя.
    const universityScope: string[] = [];

    if (scope.universityIds) {
      universityScope.push(this.inOrNothing('e.university_id', scope.universityIds, param));
    }
    if (scope.regions) {
      universityScope.push(this.inOrNothing('u.region', scope.regions, param));
    }

    if (universityScope.length > 0) {
      conditions.push(`(e.segment = 'B2C' OR (${universityScope.join(' AND ')}))`);
    }

    // Пустой список в области видимости означает «не видно ничего».
    // Условие 1=0 надёжнее, чем пустой IN (), который в SQL некорректен.
    // Вуз и регион в перечень не входят: они обработаны выше вместе
    // с исключением для сегмента B2C.
    for (const list of [scope.ownerIds, scope.directionIds, scope.productIds]) {
      if (list !== null && list !== undefined && list.length === 0) {
        conditions.push('1 = 0');
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    if (options.countOnly) {
      // DISTINCT обязателен: соединение с договорами и лицензиями
      // размножает строки, и без него счётчик показал бы больше записей,
      // чем окажется в отчёте.
      //
      // Версия выборки — момент последнего изменения её заявок и их
      // процессов. Входит в ключ кэша отчётов: без неё менеджер, сменивший
      // статус, получал из кэша файл часовой давности со старыми статусами.
      const version = options.withVersion
        ? `, max(greatest(e.updated_at, wi.updated_at)) AS version`
        : '';

      return {
        sql: `SELECT count(DISTINCT e.id)::int AS total${version} ${FROM_CLAUSE} ${where}`,
        params,
      };
    }

    const selectList = columns
      .map((key) => {
        if (!isReportColumn(key)) {
          throw new AppException('REPORT_UNKNOWN_COLUMN', {
            detail: `Колонка «${key}» отсутствует в перечне доступных.`,
            meta: { column: key },
          });
        }
        // Псевдоним берётся из ключа белого списка, а не из ввода клиента.
        return `${REPORT_COLUMNS[key].expression} AS "${key}"`;
      })
      .join(',\n    ');

    const limit = options.limit !== undefined ? `LIMIT ${Number(options.limit)}` : '';

    // DISTINCT ON по идентификатору взаимодействия: соединения с договорами
    // и лицензиями могут дать несколько строк на одно взаимодействие,
    // а отчёт должен содержать по строке на взаимодействие.
    const sql = `
      SELECT DISTINCT ON (e.id)
        e.id AS "__id",
        ${selectList}
      ${FROM_CLAUSE}
      ${where}
      ORDER BY e.id, c.signed_at DESC NULLS LAST
      ${limit}
    `;

    return { sql, params };
  }

  /** Считает строки будущего отчёта — по этому числу выбирается способ формирования. */
  async count(filters: ReportFilters, scope: DataScope): Promise<number> {
    const { sql, params } = this.build([], filters, scope, { countOnly: true });
    const result = await this.prisma.$queryRawUnsafe<Array<{ total: number }>>(sql, ...params);
    return result[0]?.total ?? 0;
  }

  /**
   * Число строк и версия выборки одним запросом.
   * Версия — ISO-строка момента последнего изменения; пусто, если строк нет.
   */
  async snapshot(
    filters: ReportFilters,
    scope: DataScope,
  ): Promise<{ total: number; version: string | null }> {
    const { sql, params } = this.build([], filters, scope, { countOnly: true, withVersion: true });
    const result = await this.prisma.$queryRawUnsafe<Array<{ total: number; version: Date | null }>>(
      sql,
      ...params,
    );

    return {
      total: result[0]?.total ?? 0,
      version: result[0]?.version ? new Date(result[0].version).toISOString() : null,
    };
  }

  /** Выполняет запрос и возвращает строки отчёта. */
  async fetch(
    columns: ReportColumnKey[],
    filters: ReportFilters,
    scope: DataScope,
    options: { limit?: number; afterId?: string } = {},
  ): Promise<Array<Record<string, unknown>>> {
    const { sql, params } = this.build(columns, filters, scope, options);
    return this.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(sql, ...params);
  }

  /**
   * Условие принадлежности списку для ограничения, которое задано явно.
   *
   * В отличие от addInCondition пустой список здесь означает не «условия нет»,
   * а «не подходит ничего»: администратор, оставивший разрешённый перечень
   * пустым, закрыл доступ, и молчаливое снятие ограничения было бы утечкой.
   */
  private inOrNothing(
    column: string,
    values: string[],
    param: (value: unknown) => string,
  ): string {
    if (values.length === 0) {
      return '1 = 0';
    }

    return `${column} IN (${values.map((value) => param(value)).join(', ')})`;
  }

  private addInCondition(
    conditions: string[],
    column: string,
    values: string[] | undefined,
    param: (value: unknown) => string,
  ): void {
    if (!values || values.length === 0) {
      return;
    }

    const placeholders = values.map((value) => param(value)).join(', ');
    conditions.push(`${column} IN (${placeholders})`);
  }
}
