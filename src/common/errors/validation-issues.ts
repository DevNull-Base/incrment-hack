import type { ValidationError } from 'class-validator';
import type { FieldIssue } from './app-exception.js';

/**
 * Переводит ошибки class-validator в список «поле — сообщение».
 *
 * Стандартный ValidationPipe отдаёт только тексты сообщений, и в ответе
 * оказывалось `field: ""` у каждой ошибки: интерфейс не мог подсветить поле,
 * хотя контракт обещает именно это. Путь строится с учётом вложенности —
 * `filters.periodFrom`, `items.0.title`, — чтобы ошибка во вложенном объекте
 * указывала на конкретное поле, а не на весь объект.
 */
export function toFieldIssues(errors: readonly ValidationError[], parentPath = ''): FieldIssue[] {
  const issues: FieldIssue[] = [];

  for (const error of errors) {
    const field = parentPath ? `${parentPath}.${error.property}` : error.property;

    for (const message of Object.values(error.constraints ?? {})) {
      issues.push({ field, message: humanize(message) });
    }

    if (error.children && error.children.length > 0) {
      issues.push(...toFieldIssues(error.children, field));
    }
  }

  return issues;
}

/**
 * Сообщение о лишнем поле приходит из библиотеки по-английски; остальные
 * заданы в DTO по-русски. Переводится только оно — это единственное
 * сообщение, которое пользователь видит без участия наших DTO.
 */
function humanize(message: string): string {
  const unknown = /^property (.+) should not exist$/.exec(message);
  return unknown ? `Поле «${unknown[1]}» не предусмотрено` : message;
}
