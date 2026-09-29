import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { StorageService } from '../../infrastructure/storage/storage.service.js';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module.js';
import { acquireRedisLock, type RedisLock } from '../../infrastructure/redis/redis-lock.js';
import { AppConfig } from '../../config/configuration.js';
import { AUDIT_ACTIONS, AuditService } from '../audit/audit.service.js';
import { ERASED_PLACEHOLDER, eraseCopiesOfPerson } from '../admin/personal-data-erasure.js';

/** Итоги одного прогона очистки. */
export interface RetentionSummary {
  /** Обезличенные записи субъектов ПДн. */
  personsErased: number;
  /** Удалённые файлы отчётов. */
  reportFilesRemoved: number;
  /** Физически удалённые вложения. */
  attachmentsPurged: number;
  /** Просроченные ключи идемпотентности. */
  idempotencyKeysRemoved: number;
  /** Черновики, рабочие контексты и записи о недавних объектах. */
  workspaceRecordsRemoved: number;
  /** Записи журнала аудита за пределами срока хранения. */
  auditRecordsRemoved: number;
  /** Исходные сообщения внешних систем, у которых стёрто содержимое. */
  stagingPayloadsCleared: number;
}

/**
 * Сколько хранится содержимое исходного сообщения внешней системы после
 * разбора. Дольше оно не нужно: данные уже перенесены в заявку, а для
 * отсечения повторов достаточно ключа сообщения, который остаётся.
 */
const STAGING_PAYLOAD_RETENTION_DAYS = 30;

/** Ключ распределённой блокировки прогона. */
const LOCK_KEY = 'retention:lock';
/** Срок жизни блокировки: заведомо больше длительности прогона. */
const LOCK_TTL_SEC = 3600;

/** Сколько записей обрабатывается за один заход по каждому виду данных. */
const BATCH_LIMIT = 5000;

/**
 * Соблюдение сроков хранения данных.
 *
 * Требование ч. 7 ст. 5 152-ФЗ: хранение персональных данных допускается
 * не дольше, чем этого требует цель обработки. Срок хранения был предусмотрен
 * в модели данных (Person.retentionUntil, ReportJob.expiresAt), планировщик
 * подключён в корневом модуле, но ни одной регламентной задачи не существовало:
 * поля заполнялись и ни на что не влияли. Файлы отчётов с фамилиями
 * ответственных оставались в хранилище бессрочно.
 *
 * Здесь собраны все виды данных с ограниченным сроком жизни. Собраны в одном
 * месте намеренно: срок хранения — свойство политики обработки, а не отдельных
 * модулей, и при проверке предъявляется целиком.
 *
 * Задача выполняется только в процессе worker и только одной репликой —
 * см. tryLock. Иначе при `--scale worker=3` три процесса одновременно
 * удаляли бы одни и те же объекты.
 */
@Injectable()
export class RetentionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RetentionService.name);
  }

  /**
   * Регламентный прогон. Расписание задаётся настройкой RETENTION_CRON,
   * по умолчанию — ежедневно в 03:30, когда пользователей нет.
   */
  @Cron(process.env.RETENTION_CRON ?? '0 30 3 * * *', { name: 'retention' })
  async runScheduled(): Promise<void> {
    const lock = await this.tryLock();

    if (!lock) {
      this.logger.debug('Очистка уже выполняется другой репликой — пропуск');
      return;
    }

    try {
      const summary = await this.run();

      this.logger.info({ ...summary }, 'Регламентная очистка завершена');

      // Уничтожение данных — операция, подлежащая учёту: по журналу должно
      // быть видно, что и когда система удалила. Это же служит основой
      // для акта об уничтожении персональных данных.
      await this.audit.record({
        action: AUDIT_ACTIONS.RETENTION_PURGE,
        entityType: 'System',
        afterState: { ...summary },
      });
    } catch (error) {
      this.logger.error({ err: error }, 'Сбой регламентной очистки');
    } finally {
      await lock.release();
    }
  }

  /** Выполняет все виды очистки. Вынесено отдельно — вызывается и вручную. */
  async run(now: Date = new Date()): Promise<RetentionSummary> {
    return {
      personsErased: await this.erasePersonalDataPastRetention(now),
      reportFilesRemoved: await this.removeExpiredReportFiles(now),
      attachmentsPurged: await this.purgeDeletedAttachments(now),
      idempotencyKeysRemoved: await this.removeExpiredIdempotencyKeys(now),
      workspaceRecordsRemoved: await this.removeStaleWorkspaceRecords(now),
      auditRecordsRemoved: await this.trimAuditLog(now),
      stagingPayloadsCleared: await this.clearProcessedStagingPayloads(now),
    };
  }

  /**
   * Обезличивает персональные данные с истёкшим сроком хранения.
   *
   * Строка не удаляется: на неё ссылается история взаимодействий. Удаляются
   * именно персональные данные — после этого запись под действие 152-ФЗ
   * не подпадает. Тот же механизм применяется при исполнении требования
   * субъекта (см. PersonService.erase).
   */
  private async erasePersonalDataPastRetention(now: Date): Promise<number> {
    // Срок по умолчанию действует для записей без явного срока. Прежде
    // настройка PERSONAL_DATA_RETENTION_DAYS была объявлена, но нигде
    // не применялась: у персон из импорта, интеграции и наполнения срок
    // не задан, и регламентная очистка не обезличивала их никогда.
    // Отсчёт — от последнего изменения записи: контакт, которого уточняли
    // недавно, в работе, а не забыт.
    const defaultDays = this.config.get('PERSONAL_DATA_RETENTION_DAYS', { infer: true });
    const defaultThreshold = new Date(now.getTime() - defaultDays * 24 * 60 * 60 * 1000);

    const expired = await this.prisma.person.findMany({
      where: {
        erasedAt: null,
        OR: [
          { retentionUntil: { lt: now } },
          { retentionUntil: null, updatedAt: { lt: defaultThreshold } },
        ],
      },
      select: { id: true, fullName: true, email: true, phone: true },
      take: BATCH_LIMIT,
    });

    for (const person of expired) {
      await this.prisma.$transaction(async (tx) => {
        await tx.person.update({
          where: { id: person.id },
          data: {
            fullName: ERASED_PLACEHOLDER,
            email: null,
            phone: null,
            position: null,
            retentionUntil: null,
            erasedAt: now,
            erasureReason: 'Истёк срок хранения персональных данных',
          },
        });

        await eraseCopiesOfPerson(tx, person);
      });
    }

    if (expired.length > 0) {
      this.logger.info({ count: expired.length }, 'Обезличены данные с истёкшим сроком хранения');
    }

    return expired.length;
  }

  /**
   * Стирает содержимое исходных сообщений внешних систем после разбора.
   *
   * В сообщении — имя и почта обратившегося, и прежде оно хранилось
   * бессрочно: ни очистка по срокам, ни обезличивание его не касались.
   * Строка остаётся ради ключа, по которому отсекаются повторы события.
   *
   * Неразобранные сообщения (отклонённые оплаты, события с ошибкой схемы)
   * очищаются по тому же сроку от момента поступления: месяца достаточно,
   * чтобы разобрать ошибку с отправителем, а бессрочно хранить в них ФИО
   * и телефон нельзя.
   */
  private async clearProcessedStagingPayloads(now: Date): Promise<number> {
    const threshold = new Date(now.getTime() - STAGING_PAYLOAD_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    return this.prisma.$executeRaw`
      UPDATE integration_staging_record
      SET payload = '{}'::jsonb
      WHERE (
          (processed_at IS NOT NULL AND processed_at < (${threshold}::timestamptz AT TIME ZONE 'UTC'))
          OR (processed_at IS NULL AND created_at < (${threshold}::timestamptz AT TIME ZONE 'UTC'))
        )
        AND payload <> '{}'::jsonb
    `;
  }

  /**
   * Удаляет файлы отчётов с истёкшим сроком.
   *
   * Запись о задаче сохраняется — по ней видно, кто и когда формировал отчёт.
   * Удаляется файл: именно он содержит выгруженные данные, включая
   * персональные, и именно он лежал в хранилище неограниченно долго.
   */
  private async removeExpiredReportFiles(now: Date): Promise<number> {
    const expired = await this.prisma.reportJob.findMany({
      where: { expiresAt: { lt: now }, resultKey: { not: null } },
      select: { id: true, resultKey: true },
      take: BATCH_LIMIT,
    });

    let removed = 0;

    for (const job of expired) {
      if (!job.resultKey) {
        continue;
      }

      // Один файл может обслуживать несколько задач: при попадании в кэш
      // второму пользователю заводится собственная задача с тем же ключом
      // результата. Удалять объект можно только когда истекли все они,
      // иначе у второго пользователя ссылка на отчёт перестанет работать.
      const stillInUse = await this.prisma.reportJob.count({
        where: {
          resultKey: job.resultKey,
          id: { not: job.id },
          expiresAt: { gte: now },
        },
      });

      if (stillInUse > 0) {
        await this.prisma.reportJob.update({
          where: { id: job.id },
          data: { resultKey: null, resultSize: null },
        });
        removed += 1;
        continue;
      }

      try {
        await this.storage.remove('reports', job.resultKey);
      } catch (error) {
        // Объекта может не быть — например, хранилище чистили вручную.
        // Это не повод оставлять ссылку в базе, поэтому продолжаем.
        this.logger.warn(
          { err: error, jobId: job.id, key: job.resultKey },
          'Не удалось удалить файл отчёта из хранилища',
        );
      }

      await this.prisma.reportJob.update({
        where: { id: job.id },
        data: { resultKey: null, resultSize: null },
      });

      removed += 1;
    }

    return removed;
  }

  /**
   * Физически удаляет вложения, помеченные удалёнными достаточно давно.
   *
   * Отсрочка нужна, чтобы ошибочное удаление можно было отменить.
   * Объект в хранилище удаляется только тогда, когда на него не осталось
   * ни одной живой ссылки: одно и то же содержимое дедуплицируется и может
   * быть приложено к нескольким карточкам — удаление объекта оборвало бы
   * остальные.
   */
  private async purgeDeletedAttachments(now: Date): Promise<number> {
    const graceDays = this.config.get('ATTACHMENT_PURGE_GRACE_DAYS', { infer: true });
    const threshold = new Date(now.getTime() - graceDays * DAY_MS);

    const candidates = await this.prisma.attachment.findMany({
      where: { deletedAt: { lt: threshold } },
      select: { id: true, storageKey: true },
      take: BATCH_LIMIT,
    });

    let purged = 0;

    for (const attachment of candidates) {
      const stillReferenced = await this.prisma.attachment.count({
        where: {
          storageKey: attachment.storageKey,
          id: { not: attachment.id },
          deletedAt: null,
        },
      });

      if (stillReferenced === 0) {
        try {
          await this.storage.remove('attachments', attachment.storageKey);
        } catch (error) {
          this.logger.warn(
            { err: error, key: attachment.storageKey },
            'Не удалось удалить объект вложения из хранилища',
          );
        }
      }

      await this.prisma.attachment.delete({ where: { id: attachment.id } });
      purged += 1;
    }

    return purged;
  }

  /** Просроченные ключи идемпотентности: служебные данные без ценности после истечения. */
  private async removeExpiredIdempotencyKeys(now: Date): Promise<number> {
    const result = await this.prisma.idempotencyKey.deleteMany({
      where: { expiresAt: { lt: now } },
    });

    return result.count;
  }

  /**
   * Черновики, рабочие контексты и списки недавнего.
   *
   * Данные удобства, а не учёта: содержат фрагменты пользовательского ввода
   * (в том числе персональные данные из недописанных комментариев) и хранить
   * их годами нет ни цели, ни основания.
   */
  private async removeStaleWorkspaceRecords(now: Date): Promise<number> {
    const days = this.config.get('WORKSPACE_RETENTION_DAYS', { infer: true });
    const threshold = new Date(now.getTime() - days * DAY_MS);

    const [drafts, states, recent] = await Promise.all([
      this.prisma.userDraft.deleteMany({ where: { updatedAt: { lt: threshold } } }),
      this.prisma.userWorkspaceState.deleteMany({ where: { updatedAt: { lt: threshold } } }),
      this.prisma.userRecentItem.deleteMany({ where: { visitedAt: { lt: threshold } } }),
    ]);

    return drafts.count + states.count + recent.count;
  }

  /**
   * Ограничивает срок хранения журнала аудита.
   *
   * Журнал тоже содержит сведения о людях (кто, когда, откуда обращался)
   * и бесконечно храниться не должен. Удаление старых записей разрывает
   * хэш-цепочку в начале — это учтено в проверке целостности: она
   * привязывается к первой доступной записи, а не требует, чтобы у неё
   * обязательно отсутствовал предыдущий хэш.
   *
   * UPDATE по журналу запрещён триггером базы, DELETE — разрешён именно
   * ради этой задачи.
   */
  private async trimAuditLog(now: Date): Promise<number> {
    const days = this.config.get('AUDIT_RETENTION_DAYS', { infer: true });
    const threshold = new Date(now.getTime() - days * DAY_MS);

    const result = await this.prisma.auditLog.deleteMany({
      where: { occurredAt: { lt: threshold } },
    });

    if (result.count > 0) {
      this.logger.info(
        { count: result.count, olderThan: threshold.toISOString() },
        'Из журнала аудита удалены записи за пределами срока хранения',
      );
    }

    return result.count;
  }

  /**
   * Занимает блокировку прогона.
   *
   * При недоступности Redis прогон выполняется: пропустить очистку хуже,
   * чем выполнить её дважды, — операции идемпотентны по построению
   * (повторное удаление уже удалённого ничего не меняет).
   */
  private async tryLock(): Promise<RedisLock | null> {
    try {
      return await acquireRedisLock(this.redis, LOCK_KEY, LOCK_TTL_SEC);
    } catch (error) {
      this.logger.warn({ err: error }, 'Кэш недоступен: очистка выполняется без блокировки');
      return { release: async () => undefined };
    }
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
