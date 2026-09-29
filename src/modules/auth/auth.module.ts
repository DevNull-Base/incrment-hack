import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { JwtVerifierService } from './jwt-verifier.service.js';
import { UserProvisioningService } from './user-provisioning.service.js';
import { RolesGuard } from '../access/roles.guard.js';
import { RateLimitGuard } from '../access/rate-limit.guard.js';

/**
 * Аутентификация через Keycloak.
 *
 * Все три guard'а регистрируются глобально, и порядок существенен:
 * JwtAuthGuard помещает пользователя в запрос, RolesGuard проверяет роль,
 * RateLimitGuard считает обращения уже по конкретному пользователю.
 * Nest применяет провайдеры APP_GUARD в порядке объявления.
 */
@Global()
@Module({
  controllers: [AuthController],
  providers: [
    JwtVerifierService,
    UserProvisioningService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Ограничение частоты — третьим: к этому моменту пользователь уже
    // разрешён, и счётчик ведётся по нему, а не по сетевому адресу.
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
  exports: [JwtVerifierService, UserProvisioningService],
})
export class AuthModule {}
