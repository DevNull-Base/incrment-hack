import { Injectable } from '@nestjs/common';
import { assertNotArchived } from '../engagement/archive-guard.js';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PinoLogger } from 'nestjs-pino';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { AttachableEntity, ScanStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { StorageService } from '../../infrastructure/storage/storage.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { AppConfig } from '../../config/configuration.js';
import { AUDIT_ACTIONS, AuditService } from '../audit/audit.service.js';
import { DataScopeService, engagementScopeFilter } from '../access/data-scope.service.js';
import { WorkflowService, type EngagementStage } from '../workflow/workflow.service.js';
import { recordActivity } from '../activity/activity-log.js';
import {
  INTERNAL_EVENTS,
  type EngagementActivityEvent,
} from '../realtime/realtime.gateway.js';
import { AntivirusService } from './antivirus.service.js';
import { resolveFileType, sanitizeFileName } from './file-validation.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';

export interface AttachmentDescriptor {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  scanStatus: ScanStatus;
  uploadedByName: string;
  /** Этап процесса, к которому приложен файл. */
  stateKey: string | null;
  /** Подпись этапа на момент загрузки. */
  stateLabel: string | null;
  createdAt: Date;
}

/** Заявка, к которой прикладывается файл, — в объёме, нужном вложениям. */
interface EngagementContext {
  id: string;
  ownerId: string;
  isArchived: boolean;
  currentStateKey: string;
  currentStateLabel: string;
  definition: unknown;
}

@Injectable()
export class AttachmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly antivirus: AntivirusService,
    private readonly audit: AuditService,
    private readonly dataScope: DataScopeService,
    private readonly workflow: WorkflowService,
    private readonly events: EventEmitter2,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AttachmentService.name);
  }

  /**
   * Принимает файл, приложенный к взаимодействию.
   *
   * Порядок шагов обусловлен безопасностью:
   *   1. проверка прав на объект — до любых операций с содержимым;
   *   2. определение типа по сигнатуре — до записи в хранилище;
   *   3. антивирусная проверка — до того, как файл станет доступен другим;
   *   4. и только затем запись в хранилище и в базу.
   * Обратный порядок означал бы, что заражённый или недопустимый файл
   * какое-то время лежит в хранилище и может быть скачан.
   *
   * Файл прикладывается к этапу процесса: по умолчанию к текущему, либо
   * к указанному — например, если скан подписанного договора забыли
   * приложить на подписании и прикладывают позже.
   */
  async upload(
    engagementId: string,
    fileName: string,
    content: Buffer,
    user: AuthenticatedUser,
    requestedStateKey?: string,
  ): Promise<AttachmentDescriptor> {
    const engagement = await this.loadEngagement(engagementId, user);
    assertNotArchived(engagement);
    const stage = this.resolveStage(engagement, requestedStateKey);

    const maxBytes = this.config.get('UPLOAD_MAX_FILE_SIZE_MB', { infer: true }) * 1024 * 1024;
    if (content.length > maxBytes) {
      throw new AppException('FILE_TOO_LARGE', {
        detail: `Размер файла ${formatSize(content.length)} превышает допустимый ${formatSize(maxBytes)}.`,
        meta: { sizeBytes: content.length, maxBytes },
      });
    }

    if (content.length === 0) {
      throw new AppException('FILE_TYPE_NOT_ALLOWED', { detail: 'Файл пуст.' });
    }

    // Динамический импорт: file-type публикуется только как ES-модуль
    // и не может быть загружен статически из скомпилированного CommonJS,
    // если сборка когда-либо переедет обратно.
    const { fileTypeFromBuffer } = await import('file-type');
    const detected = await fileTypeFromBuffer(content);
    const resolved = resolveFileType(detected, fileName);

    const verdict = await this.antivirus.scan(content);

    if (verdict.status === 'INFECTED') {
      // Файл не сохраняется вовсе; факт попытки фиксируется в журнале.
      await this.audit.record({
        actorId: user.id,
        actorEmail: user.email,
        action: AUDIT_ACTIONS.ATTACHMENT_REJECTED,
        entityType: 'Engagement',
        entityId: engagementId,
        afterState: { fileName: sanitizeFileName(fileName), rejected: true, signature: verdict.signature },
      });

      throw new AppException('FILE_INFECTED', {
        detail: `Загрузка отклонена: обнаружена угроза «${verdict.signature}».`,
        meta: { signature: verdict.signature },
      });
    }

    const sha256 = createHash('sha256').update(content).digest('hex');
    const safeName = sanitizeFileName(fileName);

    // Существующий файл с тем же содержимым повторно не загружается:
    // в хранилище остаётся один объект, а карточек создаётся столько,
    // сколько раз файл приложили.
    const duplicate = await this.prisma.attachment.findFirst({
      where: { sha256, deletedAt: null },
      select: { storageKey: true, sizeBytes: true },
    });

    const storageKey =
      duplicate?.storageKey ?? `engagements/${engagementId}/${randomUUID()}.${resolved.extension}`;

    if (!duplicate) {
      await this.storage.upload(
        'attachments',
        storageKey,
        Readable.from(content),
        resolved.mimeType,
      );
    }

    const scanStatus: ScanStatus =
      verdict.status === 'CLEAN' ? 'CLEAN' : verdict.status === 'SKIPPED' ? 'SKIPPED' : 'ERROR';

    const record = await this.prisma.$transaction(async (tx) => {
      const created = await tx.attachment.create({
        data: {
          entityType: AttachableEntity.ENGAGEMENT,
          entityId: engagementId,
          fileName: safeName,
          mimeType: resolved.mimeType,
          sizeBytes: BigInt(content.length),
          sha256,
          storageKey,
          scanStatus,
          scanDetail: verdict.status === 'CLEAN' ? null : describeVerdict(verdict),
          uploadedById: user.id,
          stateKey: stage.key,
          stateLabel: stage.label,
        },
        select: descriptorSelection,
      });

      await recordActivity(tx, {
        type: 'ATTACHMENT_ADDED',
        actorId: user.id,
        engagementId,
        stage,
        attachmentId: created.id,
      });

      return created;
    });

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTIONS.UPLOAD_ATTACHMENT,
      entityType: 'Engagement',
      entityId: engagementId,
      afterState: {
        attachmentId: record.id,
        fileName: safeName,
        sizeBytes: content.length,
        sha256,
        scanStatus,
        stateKey: stage.key,
        deduplicated: Boolean(duplicate),
      },
    });

    this.logger.info(
      { engagementId, attachmentId: record.id, scanStatus, deduplicated: Boolean(duplicate) },
      'Файл приложен к взаимодействию',
    );

    this.emitActivity(engagement, user, 'ATTACHMENT_ADDED');

    return toDescriptor(record);
  }

  /**
   * Список файлов, приложенных к взаимодействию.
   *
   * С указанием этапа — только файлы этого этапа: так карточка показывает
   * документы шага пути, на который нажал пользователь.
   */
  async list(
    engagementId: string,
    user: AuthenticatedUser,
    stateKey?: string,
  ): Promise<AttachmentDescriptor[]> {
    await this.loadEngagement(engagementId, user);

    const records = await this.prisma.attachment.findMany({
      where: {
        entityType: AttachableEntity.ENGAGEMENT,
        entityId: engagementId,
        deletedAt: null,
        ...(stateKey ? { stateKey } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: descriptorSelection,
    });

    return records.map(toDescriptor);
  }

  /**
   * Выдаёт содержимое файла.
   *
   * Отдаётся потоком через API, а не ссылкой с подписью: подписанная ссылка
   * обходит проверку прав и не оставляет записи в журнале, тогда как доступ
   * к приложенным документам подлежит обязательному протоколированию.
   */
  async download(
    attachmentId: string,
    user: AuthenticatedUser,
  ): Promise<{ stream: Readable; fileName: string; mimeType: string; sizeBytes: number }> {
    const record = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
      select: {
        id: true,
        entityId: true,
        entityType: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        storageKey: true,
        scanStatus: true,
        deletedAt: true,
      },
    });

    if (!record || record.deletedAt) {
      throw new AppException('NOT_FOUND', { detail: 'Файл не найден.' });
    }

    if (record.entityType === AttachableEntity.ENGAGEMENT) {
      await this.loadEngagement(record.entityId, user);
    }

    if (record.scanStatus === 'INFECTED') {
      throw new AppException('FILE_INFECTED', {
        detail: 'Файл заблокирован по результатам антивирусной проверки.',
      });
    }

    this.assertScanned(record.scanStatus, user);

    const object = await this.storage.download('attachments', record.storageKey);

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTIONS.DOWNLOAD_ATTACHMENT,
      entityType: 'Attachment',
      entityId: record.id,
      afterState: { fileName: record.fileName, engagementId: record.entityId },
    });

    return {
      stream: object.stream,
      fileName: record.fileName,
      mimeType: record.mimeType,
      sizeBytes: Number(record.sizeBytes),
    };
  }

  /**
   * Помечает файл удалённым.
   *
   * Объект в хранилище не удаляется: одно и то же содержимое может быть
   * приложено к нескольким карточкам (дедупликация по хэшу), и удаление
   * объекта оборвало бы остальные ссылки. Физическая очистка выполняется
   * отдельной задачей для объектов, на которые не осталось ссылок.
   */
  async softDelete(attachmentId: string, user: AuthenticatedUser): Promise<void> {
    const record = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
      select: {
        id: true,
        entityId: true,
        entityType: true,
        fileName: true,
        stateKey: true,
        stateLabel: true,
        deletedAt: true,
      },
    });

    if (!record || record.deletedAt) {
      throw new AppException('NOT_FOUND', { detail: 'Файл не найден.' });
    }

    const engagement =
      record.entityType === AttachableEntity.ENGAGEMENT
        ? await this.loadEngagement(record.entityId, user)
        : null;

    if (engagement) assertNotArchived(engagement);

    await this.prisma.$transaction(async (tx) => {
      await tx.attachment.update({
        where: { id: attachmentId },
        data: { deletedAt: new Date() },
      });

      if (engagement) {
        await recordActivity(tx, {
          type: 'ATTACHMENT_DELETED',
          actorId: user.id,
          engagementId: engagement.id,
          stage: record.stateKey
            ? { key: record.stateKey, label: record.stateLabel ?? record.stateKey }
            : null,
          attachmentId,
        });
      }
    });

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTIONS.DELETE_ATTACHMENT,
      entityType: 'Attachment',
      entityId: attachmentId,
      beforeState: { fileName: record.fileName, deleted: false },
      afterState: { fileName: record.fileName, deleted: true },
    });

    if (engagement) {
      this.emitActivity(engagement, user, 'ATTACHMENT_DELETED');
    }
  }

  /**
   * Не выдаёт файл, не прошедший антивирусную проверку.
   *
   * Различие вердиктов доводится до решения о доступе. Раньше блокировался
   * только вердикт INFECTED, а SKIPPED (сканер отключён) и ERROR (сканер
   * недоступен) свободно скачивались. При выключенном по умолчанию ClamAV
   * это означало, что непроверенным становится КАЖДЫЙ файл, и мера АВЗ
   * существовала только на бумаге.
   *
   * Администратор исключение получает намеренно: без доступа к спорному
   * файлу разобрать инцидент невозможно, а его действия протоколируются.
   */
  private assertScanned(scanStatus: ScanStatus, user: AuthenticatedUser): void {
    if (scanStatus === 'CLEAN') {
      return;
    }

    if (user.role === 'ADMIN' || this.config.get('ALLOW_UNSCANNED_DOWNLOAD', { infer: true })) {
      this.logger.warn(
        { scanStatus, userId: user.id },
        'Выдан файл без успешной антивирусной проверки',
      );
      return;
    }

    throw new AppException('FILE_NOT_SCANNED', {
      detail:
        scanStatus === 'SKIPPED'
          ? 'Файл был загружен при отключённой антивирусной проверке и не может быть выдан.'
          : 'Антивирусная проверка файла завершилась ошибкой. Выдача заблокирована.',
      meta: { scanStatus },
    });
  }

  /**
   * Загружает взаимодействие, проверяя, что оно доступно пользователю.
   * Выполняется перед любой операцией с вложениями: без неё файлы стали бы
   * обходным путём к данным, закрытым областью видимости.
   */
  private async loadEngagement(
    engagementId: string,
    user: AuthenticatedUser,
  ): Promise<EngagementContext> {
    const scope = await this.dataScope.resolve(user);

    const found = await this.prisma.engagement.findFirst({
      where: { id: engagementId, ...engagementScopeFilter(scope) },
      select: {
        id: true,
        ownerId: true,
        isArchived: true,
        currentStateKey: true,
        currentStateLabel: true,
        workflowInstance: { select: { template: { select: { definition: true } } } },
      },
    });

    if (!found) {
      throw new AppException('NOT_FOUND', {
        detail: 'Взаимодействие не найдено либо недоступно текущему пользователю.',
      });
    }

    return {
      id: found.id,
      ownerId: found.ownerId,
      isArchived: found.isArchived,
      currentStateKey: found.currentStateKey,
      currentStateLabel: found.currentStateLabel,
      definition: found.workflowInstance?.template.definition ?? null,
    };
  }

  /**
   * Этап, к которому прикладывается файл.
   *
   * У заявки без экземпляра процесса (возможно лишь при повреждённых данных)
   * этапом считается денормализованный текущий статус: отказывать в загрузке
   * документа из-за этого было бы несоразмерно.
   */
  private resolveStage(engagement: EngagementContext, requestedKey?: string): EngagementStage {
    if (!engagement.definition) {
      return { key: engagement.currentStateKey, label: engagement.currentStateLabel };
    }

    return this.workflow.resolveStage(
      this.workflow.parseDefinition(engagement.definition),
      engagement.currentStateKey,
      requestedKey,
    );
  }

  private emitActivity(
    engagement: EngagementContext,
    user: AuthenticatedUser,
    type: 'ATTACHMENT_ADDED' | 'ATTACHMENT_DELETED',
  ): void {
    const event: EngagementActivityEvent = {
      engagementId: engagement.id,
      recipientIds: [engagement.ownerId, user.id],
      type,
      actorName: user.displayName,
    };

    this.events.emit(INTERNAL_EVENTS.ENGAGEMENT_ACTIVITY, event);
  }
}

const descriptorSelection = {
  id: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  sha256: true,
  scanStatus: true,
  stateKey: true,
  stateLabel: true,
  createdAt: true,
  uploadedBy: { select: { displayName: true } },
} as const;

type AttachmentRecord = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: bigint;
  sha256: string;
  scanStatus: ScanStatus;
  stateKey: string | null;
  stateLabel: string | null;
  createdAt: Date;
  uploadedBy: { displayName: string };
};

function toDescriptor(record: AttachmentRecord): AttachmentDescriptor {
  return {
    id: record.id,
    fileName: record.fileName,
    mimeType: record.mimeType,
    // BigInt не сериализуется в JSON — приводим к числу.
    sizeBytes: Number(record.sizeBytes),
    sha256: record.sha256,
    scanStatus: record.scanStatus,
    uploadedByName: record.uploadedBy.displayName,
    stateKey: record.stateKey,
    stateLabel: record.stateLabel,
    createdAt: record.createdAt,
  };
}

function describeVerdict(verdict: { status: string; reason?: string; signature?: string }): string {
  if (verdict.status === 'SKIPPED') return `Проверка не проводилась: ${verdict.reason}`;
  if (verdict.status === 'ERROR') return `Ошибка проверки: ${verdict.reason}`;
  return verdict.status;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}
