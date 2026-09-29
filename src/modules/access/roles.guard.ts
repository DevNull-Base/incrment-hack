import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../generated/prisma/enums.js';
import { AppException } from '../../common/errors/app-exception.js';
import { ROLES_KEY } from './roles.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';

/**
 * Проверка роли пользователя.
 *
 * Работает после JwtAuthGuard, поэтому рассчитывает на уже разрешённого
 * пользователя в запросе. Маршруты без @Roles() доступны любому
 * аутентифицированному пользователю — разграничение данных для них
 * обеспечивает DataScope, а не роль.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    if (context.getType() !== 'http') {
      return true;
    }

    const user = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;

    if (!user) {
      throw new AppException('UNAUTHENTICATED');
    }

    if (!required.includes(user.role)) {
      throw new AppException('FORBIDDEN', {
        detail: `Операция доступна ролям: ${required.join(', ')}. Ваша роль: ${user.role}.`,
        meta: { requiredRoles: required, actualRole: user.role },
      });
    }

    return true;
  }
}
