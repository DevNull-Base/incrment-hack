import { AppException } from '../../common/errors/app-exception.js';

/**
 * Архивная заявка доступна только для чтения: по ней не выполняются
 * переходы, её не правят, к ней не добавляют заметок и файлов. Иначе
 * «архив» был бы лишь фильтром списка, а работа по заявке продолжалась бы
 * незаметно для руководителя.
 */
export function assertNotArchived(engagement: { isArchived: boolean }): void {
  if (engagement.isArchived) {
    throw new AppException('ENGAGEMENT_ARCHIVED');
  }
}
