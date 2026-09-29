import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';
import { PersonalDataInterceptor } from './personal-data.interceptor.js';
import { MutationAuditInterceptor } from './mutation-audit.interceptor.js';

/**
 * Журналирование действий пользователей.
 * Модуль глобальный: события фиксируют почти все прикладные модули.
 *
 * Интерцептор доступа к персональным данным регистрируется глобально и
 * срабатывает только на маршрутах с декоратором @PersonalData. Глобальная
 * регистрация выбрана намеренно: подключать его к каждому модулю пришлось бы
 * вручную, и маршрут, добавленный в новый модуль, остался бы без учёта
 * обращений к ПДн — незаметно и именно там, где это критично.
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [
    AuditService,
    { provide: APP_INTERCEPTOR, useClass: PersonalDataInterceptor },
    { provide: APP_INTERCEPTOR, useClass: MutationAuditInterceptor },
  ],
  exports: [AuditService],
})
export class AuditModule {}
