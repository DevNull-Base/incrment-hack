import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { AppException } from '../../common/errors/app-exception.js';
import type { AuthenticatedUser } from './authenticated-user.js';

/**
 * Внедряет текущего пользователя в параметр метода контроллера.
 *
 * @example
 * findAll(@CurrentUser() user: AuthenticatedUser) { ... }
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();

    if (!request.user) {
      // Сюда можно попасть, только если маршрут помечен @Public(), но при этом
      // запрашивает текущего пользователя. Это ошибка программирования,
      // и лучше обнаружить её явно, чем работать с undefined.
      throw new AppException('UNAUTHENTICATED', {
        detail: 'Маршрут требует аутентифицированного пользователя, но помечен как публичный.',
      });
    }

    return request.user;
  },
);
