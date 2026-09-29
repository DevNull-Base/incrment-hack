import { ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { applyDecorators, Type as NestType } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse } from '@nestjs/swagger';

/** Предел страницы. Защищает от запроса «отдай всё» и деградации отклика. */
export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 25;

/**
 * Базовые параметры постраничного вывода.
 *
 * Ограничение размера страницы обязательно: без него один запрос
 * с limit=1000000 удерживал бы соединение с БД и память процесса,
 * нарушая требование к времени отклика для всех остальных пользователей.
 */
export class PageQueryDto {
  @ApiPropertyOptional({ description: 'Номер страницы, начиная с 1', minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Номер страницы должен быть целым числом' })
  @Min(1, { message: 'Номер страницы не может быть меньше 1' })
  page: number = 1;

  @ApiPropertyOptional({
    description: `Размер страницы (не более ${MAX_PAGE_SIZE})`,
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: DEFAULT_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Размер страницы должен быть целым числом' })
  @Min(1, { message: 'Размер страницы не может быть меньше 1' })
  @Max(MAX_PAGE_SIZE, { message: `Размер страницы не может превышать ${MAX_PAGE_SIZE}` })
  limit: number = DEFAULT_PAGE_SIZE;

  @ApiPropertyOptional({ description: 'Поиск по наименованию (подстрока, регистр не учитывается)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ description: 'Направление сортировки', enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'Допустимые значения: asc, desc' })
  sortOrder: 'asc' | 'desc' = 'asc';

  /** Смещение для SQL. */
  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}

/** Сведения о странице выборки. */
export class PageMetaDto {
  @ApiProperty({ description: 'Номер текущей страницы', example: 1 })
  page!: number;

  @ApiProperty({ description: 'Размер страницы', example: 25 })
  limit!: number;

  @ApiProperty({ description: 'Всего записей, удовлетворяющих фильтру', example: 137 })
  total!: number;

  @ApiProperty({ description: 'Всего страниц', example: 6 })
  totalPages!: number;

  @ApiProperty({ description: 'Есть ли следующая страница', example: true })
  hasNext!: boolean;
}

/** Ответ с постраничной выборкой. */
export class PageDto<T> {
  @ApiProperty({ description: 'Записи текущей страницы', isArray: true })
  items!: T[];

  @ApiProperty({ description: 'Сведения о странице', type: PageMetaDto })
  meta!: PageMetaDto;
}

/** Собирает ответ с метаданными страницы. */
export function toPage<T>(items: T[], total: number, query: PageQueryDto): PageDto<T> {
  const totalPages = query.limit > 0 ? Math.ceil(total / query.limit) : 0;

  return {
    items,
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasNext: query.page < totalPages,
    },
  };
}

/**
 * Описывает в Swagger ответ вида PageDto<Модель>.
 * @nestjs/swagger не выводит обобщённые типы автоматически,
 * поэтому схема собирается явно.
 */
export function ApiPageResponse<TModel extends NestType<unknown>>(model: TModel, description?: string) {
  return applyDecorators(
    ApiExtraModels(PageDto, PageMetaDto, model),
    ApiOkResponse({
      description: description ?? 'Постраничная выборка',
      schema: {
        allOf: [
          {
            properties: {
              items: { type: 'array', items: { $ref: getSchemaPath(model) } },
              meta: { $ref: getSchemaPath(PageMetaDto) },
            },
            required: ['items', 'meta'],
          },
        ],
      },
    }),
  );
}
