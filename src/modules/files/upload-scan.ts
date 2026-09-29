import type { PinoLogger } from 'nestjs-pino';
import { AppException } from '../../common/errors/app-exception.js';
import { AUDIT_ACTIONS, type AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import type { AntivirusService } from './antivirus.service.js';
import { sanitizeFileName } from './file-validation.js';

/**
 * Антивирусная проверка файла, по которому система загружает данные:
 * таблицы импорта, каталог вендоров, выгрузки оплат.
 *
 * Правило одно для всех каналов: если сканер включён, вердикт обязан быть
 * CLEAN. Недоступность сканера при включённой проверке — отказ, а не
 * разрешение: иначе достаточно было бы дождаться сбоя ClamAV, чтобы провести
 * файл мимо проверки. При выключенном сканере (только разработка: в production
 * это запрещено проверкой конфигурации) загрузка выполняется с предупреждением
 * в журнале.
 */
export async function assertCleanUpload(
  deps: { antivirus: AntivirusService; audit: AuditService; logger: PinoLogger },
  params: { content: Buffer; fileName: string; user: AuthenticatedUser; entityType: string },
): Promise<void> {
  if (!deps.antivirus.enabled) {
    deps.logger.warn({ fileName: params.fileName }, 'Загрузка данных без антивирусной проверки');
    return;
  }

  const verdict = await deps.antivirus.scan(params.content);

  if (verdict.status === 'CLEAN') {
    return;
  }

  await deps.audit.record({
    actorId: params.user.id,
    actorEmail: params.user.email,
    action: AUDIT_ACTIONS.ATTACHMENT_REJECTED,
    entityType: params.entityType,
    afterState: {
      fileName: sanitizeFileName(params.fileName),
      rejected: true,
      verdict: verdict.status,
      signature: verdict.status === 'INFECTED' ? verdict.signature : null,
    },
  });

  if (verdict.status === 'INFECTED') {
    throw new AppException('FILE_INFECTED', {
      detail: `Загрузка отклонена: обнаружена угроза «${verdict.signature}».`,
      meta: { signature: verdict.signature },
    });
  }

  throw new AppException('FILE_NOT_SCANNED', {
    detail: 'Антивирусная проверка файла не выполнена. Загрузка отклонена.',
    meta: { verdict: verdict.status },
  });
}
