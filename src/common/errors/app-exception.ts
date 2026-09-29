import { HttpException } from '@nestjs/common';
import { ERRORS, ErrorDefinition, ErrorKey } from './error-codes.js';

/** Детализация одной проблемы валидации (поле → сообщение). */
export interface FieldIssue {
  field: string;
  message: string;
}

export interface AppExceptionOptions {
  /** Уточняющее сообщение, перекрывающее описание по умолчанию. */
  detail?: string;
  /** Постатейные ошибки валидации. */
  issues?: FieldIssue[];
  /** Произвольные машиночитаемые детали (например, id конфликтующего объекта). */
  meta?: Record<string, unknown>;
  /** Исходная ошибка — попадает в лог, но не в ответ клиенту. */
  cause?: unknown;
}

/**
 * Доменное исключение приложения.
 *
 * Всегда несёт стабильный код из реестра ERRORS, поэтому клиент может
 * реагировать на ошибку программно, не разбирая текст сообщения.
 *
 * @example
 * throw new AppException('WF_TRANSITION_NOT_ALLOWED', {
 *   detail: 'Из статуса «Согласование» нельзя перейти в «Завершено»',
 *   meta: { from: 'APPROVAL', to: 'DONE' },
 * });
 */
export class AppException extends HttpException {
  readonly definition: ErrorDefinition;
  readonly issues?: FieldIssue[];
  readonly meta?: Record<string, unknown>;

  constructor(key: ErrorKey, options: AppExceptionOptions = {}) {
    const definition = ERRORS[key];

    super(
      {
        code: definition.code,
        title: definition.title,
        detail: options.detail ?? definition.description,
      },
      definition.status,
      { cause: options.cause },
    );

    this.definition = definition;
    this.issues = options.issues;
    this.meta = options.meta;
  }

  /** Текст, отдаваемый клиенту в поле `detail`. */
  get detail(): string {
    const response = this.getResponse() as { detail?: string };
    return response.detail ?? this.definition.description;
  }
}
