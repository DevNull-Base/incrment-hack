import type { Prisma } from '../../generated/prisma/client.js';
import { AppException } from '../../common/errors/app-exception.js';

/**
 * Блокировка публикации процесса.
 *
 * Публикация берёт её исключительно: две одновременные публикации в одном
 * сегменте разошлись бы по заявкам. Всё, что переводит заявку по процессу
 * или заводит новую, берёт её в разделяемом режиме — и ждёт, пока идёт
 * публикация, а публикация ждёт завершения начатых переходов.
 *
 * Без разделяемой части переход, проверенный по прежней редакции, мог
 * завершиться в секунды публикации и увести заявку в статус, которого
 * в новой редакции нет: у такой заявки не остаётся ни одного перехода.
 */
export const PUBLISH_LOCK_ID = 774_202;

export async function lockAgainstPublish(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(${PUBLISH_LOCK_ID})`;
}

/**
 * Разделяемая блокировка и проверка, что редакция, по которой готовилась
 * операция, всё ещё действует. Если её сменили, операция отменяется:
 * повторить её — дело одного нажатия, а довести по устаревшей схеме
 * значило бы оставить заявку вне действующего процесса.
 */
export async function assertTemplateStillActive(tx: Prisma.TransactionClient, templateId: string): Promise<void> {
  await lockAgainstPublish(tx);

  const template = await tx.workflowTemplate.findUnique({
    where: { id: templateId },
    select: { isActive: true },
  });

  if (!template?.isActive) {
    throw new AppException('WF_CONCURRENT_TRANSITION', {
      detail: 'Администратор только что опубликовал новую редакцию процесса. Обновите карточку и повторите действие.',
    });
  }
}
