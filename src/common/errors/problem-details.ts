import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FieldIssue } from './app-exception.js';

/** Базовый URI для ссылок на описание кодов ошибок в документации. */
export const PROBLEM_TYPE_BASE = 'https://crm.rtk-it-school.ru/errors';

/**
 * Тело ответа об ошибке в формате RFC 9457 (Problem Details for HTTP APIs),
 * расширенное полями `code` и `traceId`.
 *
 * Единый формат для всех ошибок API — фронтенду не нужно разбирать
 * разные структуры для разных подсистем.
 */
export class ProblemDetailsDto {
  @ApiProperty({
    description: 'Ссылка на описание кода ошибки в документации',
    example: `${PROBLEM_TYPE_BASE}/CRM-WFL-0001`,
  })
  type!: string;

  @ApiProperty({ description: 'Краткий заголовок ошибки', example: 'Переход недопустим' })
  title!: string;

  @ApiProperty({ description: 'HTTP-статус ответа', example: 409 })
  status!: number;

  @ApiProperty({
    description: 'Развёрнутое пояснение причины',
    example: 'Шаблон workflow не содержит перехода из «Согласование» в «Завершено»',
  })
  detail!: string;

  @ApiProperty({
    description: 'Стабильный код ошибки из реестра системы',
    example: 'CRM-WFL-0001',
  })
  code!: string;

  @ApiProperty({ description: 'Путь запроса, вызвавшего ошибку', example: '/api/v1/engagements/42/transition' })
  instance!: string;

  @ApiProperty({
    description: 'Идентификатор запроса для поиска в логах. Указывайте его при обращении в поддержку.',
    example: '7f3c1a9b-2e44-4d0e-9a1b-55c2f0e8d311',
  })
  traceId!: string;

  @ApiProperty({ description: 'Момент возникновения ошибки (ISO 8601)' })
  timestamp!: string;

  @ApiPropertyOptional({
    description: 'Постатейные ошибки валидации (заполняется для CRM-VAL-0001)',
    type: 'array',
    items: {
      type: 'object',
      properties: {
        field: { type: 'string', example: 'periodFrom' },
        message: { type: 'string', example: 'Дата начала должна быть раньше даты окончания' },
      },
    },
  })
  errors?: FieldIssue[];

  @ApiPropertyOptional({
    description: 'Дополнительные машиночитаемые детали, специфичные для кода ошибки',
    type: 'object',
    additionalProperties: true,
  })
  meta?: Record<string, unknown>;
}
