import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { Observable, from, of, switchMap, tap } from 'rxjs';
import { createHash } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AppConfig } from '../../config/configuration.js';
import { AppException } from '../../common/errors/app-exception.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';

interface RequestWithIdempotency {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  user?: AuthenticatedUser;
}

/**
 * Идемпотентность изменяющих запросов.
 *
 * Решает бытовую, но неприятную задачу: пользователь нажал «Сохранить»
 * дважды, или связь оборвалась в момент ответа и клиент повторил запрос.
 * Без защиты возникает второе взаимодействие, второй переход по процессу,
 * второй импорт — и разбирать это приходится вручную.
 *
 * Работает так: клиент присылает заголовок Idempotency-Key. При первом
 * обращении ключ занимается, ответ сохраняется. Повтор с тем же ключом
 * возвращает СОХРАНЁННЫЙ ответ, не выполняя операцию заново.
 *
 * Тело запроса участвует в проверке вместе с методом и адресом: тот же ключ
 * с другим телом или на другом маршруте — почти наверняка ошибка клиента
 * (переиспользование ключа), и такой запрос отклоняется, а не выполняется
 * молча. Прежде адрес не учитывался, и ключ, использованный для «выполнить
 * задачу А», на «выполнить задачу Б» с тем же пустым телом возвращал ответ
 * про задачу А, не выполнив ничего.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(IdempotencyInterceptor.name);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<RequestWithIdempotency>();
    const method = (request.method ?? 'GET').toUpperCase();

    // Читающие методы идемпотентны по определению.
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next.handle();
    }

    const rawKey = request.headers['idempotency-key'];
    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;

    // Заголовок необязателен: без него запрос выполняется как обычно.
    // Делать его обязательным нельзя — это сломало бы клиентов,
    // которым такая гарантия не нужна.
    if (!key || key.trim().length === 0) {
      return next.handle();
    }

    const user = request.user;

    if (!user) {
      return next.handle();
    }

    const path = request.url ?? '';
    const requestHash = hashRequest(method, path, request.body);
    const scopedKey = `${user.id}:${key.trim()}`;
    const reply = context.switchToHttp().getResponse<{ sent?: boolean }>();

    return from(this.claim(scopedKey, user.id, method, path, requestHash)).pipe(
      switchMap((claim) => {
        if (claim.kind === 'replay') {
          this.logger.info({ key: scopedKey }, 'Повторный запрос: возвращён сохранённый результат');
          return of(claim.response);
        }

        return next.handle().pipe(
          tap({
            next: (response: unknown) => {
              // Обработчик, ответивший сам (файл потоком через @Res),
              // сохранить нечего: ответ уже ушёл, а повтор вернул бы пустоту
              // и повис бы — Nest не отправляет ответ за такие обработчики.
              // Ключ освобождается, и повтор выполнится заново.
              if (reply.sent) {
                void this.release(scopedKey);
                return;
              }

              void this.complete(scopedKey, response);
            },
            error: () => {
              // Неудачную операцию повторять МОЖНО: ключ освобождается,
              // иначе клиент не смог бы повторить запрос после сбоя сети.
              void this.release(scopedKey);
            },
          }),
        );
      }),
    );
  }

  /**
   * Занимает ключ.
   *
   * Уникальный индекс по ключу делает захват атомарным: при двух
   * одновременных запросах вставка удастся ровно одному, а второй
   * получит ошибку уникальности. Прежде захват делался через upsert,
   * а тот при конфликте не падает, а обновляет запись, — одновременные
   * запросы с одним ключом проходили оба, и двойное нажатие создавало
   * две записи: ровно то, от чего механизм должен защищать.
   */
  private async claim(
    key: string,
    userId: string,
    method: string,
    path: string,
    requestHash: string,
  ): Promise<{ kind: 'claimed' } | { kind: 'replay'; response: unknown }> {
    const ttl = this.config.get('IDEMPOTENCY_TTL_SEC', { infer: true });
    const expiresAt = new Date(Date.now() + ttl * 1000);

    const existing = await this.prisma.idempotencyKey.findUnique({
      where: { key },
      select: { requestHash: true, inFlight: true, response: true, expiresAt: true },
    });

    if (existing && existing.expiresAt > new Date()) {
      if (existing.requestHash !== requestHash) {
        throw new AppException('IDEMPOTENCY_KEY_REUSED', {
          detail:
            'Этот ключ идемпотентности уже использовался для другого запроса — ' +
            'с другим содержимым либо на другом адресе. Для новой операции требуется новый ключ.',
        });
      }

      if (existing.inFlight) {
        throw new AppException('IDEMPOTENCY_IN_FLIGHT', {
          detail: 'Предыдущий запрос с этим ключом ещё выполняется. Дождитесь его завершения.',
        });
      }

      return { kind: 'replay', response: existing.response };
    }

    if (existing) {
      // Истёкший ключ переиспользуется: срок хранения на то и задан.
      // Условие по сроку входит в UPDATE — из двух одновременных запросов
      // запись обновит только первый, второй увидит свежий срок.
      const renewed = await this.prisma.idempotencyKey.updateMany({
        where: { key, expiresAt: { lte: new Date() } },
        data: { requestHash, inFlight: true, response: Prisma.DbNull, expiresAt, method, path },
      });

      if (renewed.count === 0) {
        throw new AppException('IDEMPOTENCY_IN_FLIGHT', {
          detail: 'Запрос с этим ключом уже обрабатывается.',
        });
      }

      return { kind: 'claimed' };
    }

    try {
      await this.prisma.idempotencyKey.create({
        data: { key, userId, method, path, requestHash, inFlight: true, expiresAt },
      });
    } catch (error) {
      throw new AppException('IDEMPOTENCY_IN_FLIGHT', {
        detail: 'Запрос с этим ключом уже обрабатывается.',
        cause: error,
      });
    }

    return { kind: 'claimed' };
  }

  private async complete(key: string, response: unknown): Promise<void> {
    try {
      await this.prisma.idempotencyKey.update({
        where: { key },
        data: {
          inFlight: false,
          // Ответ сериализуется: поток файла или иной непередаваемый
          // объект сохранить нельзя, и повтор для таких методов
          // просто выполнится заново.
          response: serializable(response),
        },
      });
    } catch (error) {
      this.logger.warn({ err: error, key }, 'Не удалось сохранить результат идемпотентного запроса');
    }
  }

  private async release(key: string): Promise<void> {
    await this.prisma.idempotencyKey.delete({ where: { key } }).catch(() => undefined);
  }
}

/**
 * Отпечаток запроса: метод, адрес и тело.
 * Экспортируется ради модульных тестов.
 */
export function hashRequest(method: string, path: string, body: unknown): string {
  const canonical = JSON.stringify({ method: method.toUpperCase(), path, body: sortKeys(body ?? {}) });
  return createHash('sha256').update(canonical).digest('hex');
}

/** Рекурсивно сортирует ключи — порядок полей в теле не должен влиять на отпечаток. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }

  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      result[key] = sortKeys(source[key]);
    }
    return result;
  }

  return value;
}

/** Приводит ответ к виду, пригодному для хранения в JSONB. */
function serializable(response: unknown): object | undefined {
  if (response === null || response === undefined) {
    return undefined;
  }

  try {
    return JSON.parse(JSON.stringify(response)) as object;
  } catch {
    return undefined;
  }
}
