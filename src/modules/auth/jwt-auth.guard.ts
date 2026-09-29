import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration.js';
import { AppException } from '../../common/errors/app-exception.js';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator.js';
import { JwtVerifierService } from './jwt-verifier.service.js';
import { UserProvisioningService } from './user-provisioning.service.js';
import type { AuthenticatedUser } from './authenticated-user.js';

/** Запрос с уже разрешённым пользователем. */
export interface RequestWithUser {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthenticatedUser;
}

/**
 * Глобальная проверка аутентификации.
 *
 * Модель «по умолчанию закрыто»: guard применяется ко всем маршрутам,
 * и только помеченные @Public() остаются открытыми. Поэтому новый
 * контроллер не может по забывчивости оказаться доступным без токена —
 * ошибка проявится сразу, а не утечкой данных.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly verifier: JwtVerifierService,
    private readonly provisioning: UserProvisioningService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    // WebSocket-подключения аутентифицируются отдельно, в handshake.
    if (context.getType() !== 'http') {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();

    if (this.config.get('AUTH_DEV_BYPASS', { infer: true })) {
      request.user = await this.provisioning.devBypassUser();
      return true;
    }

    const token = this.extractBearerToken(request);
    const claims = await this.verifier.verify(token);
    request.user = await this.provisioning.resolve(claims);

    return true;
  }

  private extractBearerToken(request: RequestWithUser): string {
    const header = request.headers?.authorization;
    const value = Array.isArray(header) ? header[0] : header;

    if (!value) {
      throw new AppException('UNAUTHENTICATED', {
        detail: 'Отсутствует заголовок Authorization.',
      });
    }

    const [scheme, token] = value.split(' ');

    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new AppException('UNAUTHENTICATED', {
        detail: 'Ожидается заголовок вида «Authorization: Bearer <токен>».',
      });
    }

    return token;
  }
}
