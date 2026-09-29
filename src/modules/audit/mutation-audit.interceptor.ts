import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { AUDITED_KEY, type AuditedOptions } from './audited.decorator.js';
import { AuditService } from './audit.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';

interface AuditedRequest {
  method?: string;
  params?: Record<string, string>;
  body?: unknown;
  user?: AuthenticatedUser;
}

/**
 * Протоколирование изменяющих операций, помеченных декоратором @Audited.
 *
 * Записывает событие только при успешном завершении обработчика: отклонённая
 * валидацией или правами попытка изменением не является. Неудачные попытки
 * доступа фиксируются отдельно — там, где это имеет смысл для безопасности
 * (отказ во входе, отклонённая загрузка файла).
 */
@Injectable()
export class MutationAuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.getAllAndOverride<AuditedOptions | undefined>(AUDITED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!options || context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<AuditedRequest>();

    return next.handle().pipe(
      tap({
        next: (payload) => {
          void this.record(options, request, payload);
        },
      }),
    );
  }

  private async record(
    options: AuditedOptions,
    request: AuditedRequest,
    payload: unknown,
  ): Promise<void> {
    const user = request.user;

    if (!user) {
      return;
    }

    const payloadId =
      payload !== null && typeof payload === 'object'
        ? ((payload as { id?: unknown }).id ?? null)
        : null;

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: options.action,
      entityType: options.entityType,
      entityId: typeof payloadId === 'string' ? payloadId : (request.params?.id ?? null),
      // Тело запроса проходит маскирование в AuditService, поэтому
      // персональные данные в журнал не попадают даже отсюда.
      afterState: asRecord(request.body),
    });
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
