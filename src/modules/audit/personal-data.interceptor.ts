import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { PERSONAL_DATA_KEY } from '../../common/decorators/personal-data.decorator.js';
import { AUDIT_ACTIONS, AuditService } from './audit.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';

interface RequestWithUser {
  method?: string;
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  user?: AuthenticatedUser;
}

/**
 * Фиксация доступа к персональным данным (152-ФЗ, ч. 1 ст. 19 п. 5).
 *
 * Оператор обязан вести учёт того, кто получал доступ к персональным данным.
 * Раньше константа VIEW_PERSONAL_DATA существовала в реестре действий, но
 * не записывалась ни разу — журнал показывал изменения данных и не показывал
 * их чтение, то есть именно то, что подлежит контролю в первую очередь.
 *
 * Запись делается ПОСЛЕ успешного выполнения обработчика: отказ по правам
 * или отсутствие записи доступом к данным не являются, и засорять ими
 * журнал нельзя — он потеряет доказательную ценность.
 */
@Injectable()
export class PersonalDataInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const entityType = this.reflector.getAllAndOverride<string | undefined>(PERSONAL_DATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!entityType || context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithUser>();
    const response = http.getResponse<{ header?: (name: string, value: string) => unknown }>();

    // Персональные данные не должны оседать в кэше браузера и промежуточных
    // узлов: пользователь вышел из системы, а страница с ФИО и телефонами
    // осталась доступна кнопкой «Назад».
    response.header?.('Cache-Control', 'no-store');

    return next.handle().pipe(
      tap({
        next: (payload) => {
          void this.record(entityType, request, payload);
        },
      }),
    );
  }

  private async record(
    entityType: string,
    request: RequestWithUser,
    payload: unknown,
  ): Promise<void> {
    const user = request.user;

    if (!user) {
      return;
    }

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTIONS.VIEW_PERSONAL_DATA,
      entityType,
      entityId: request.params?.id ?? null,
      // Фиксируется факт и объём доступа, но не сами данные: журнал обязан
      // показывать обращения к ПДн, а не становиться их вторым хранилищем.
      afterState: {
        method: request.method ?? null,
        recordCount: countRecords(payload),
        query: request.query ?? null,
      },
    });
  }
}

/** Оценивает, сколько записей было выдано ответом. */
function countRecords(payload: unknown): number {
  if (Array.isArray(payload)) {
    return payload.length;
  }

  if (payload !== null && typeof payload === 'object') {
    const items = (payload as { items?: unknown }).items;
    if (Array.isArray(items)) {
      return items.length;
    }
    return 1;
  }

  return 0;
}
