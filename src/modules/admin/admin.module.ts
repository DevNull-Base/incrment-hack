import { Module } from '@nestjs/common';
import { PersonController, UserAdminController } from './admin.controller.js';
import { UserAdminService } from './user-admin.service.js';
import { PersonService } from './person.service.js';

/**
 * Администрирование системы.
 *
 * Два направления, объединённые ролью исполнителя: управление учётными
 * записями и правами (требование ТЗ к роли «Администратор») и обработка
 * требований субъектов персональных данных (152-ФЗ).
 *
 * AuthModule и AccessModule объявлены глобальными, поэтому UserProvisioningService
 * и DataScopeService доступны без явного импорта — они нужны здесь для
 * принудительного сброса кэшей при изменении прав.
 */
@Module({
  controllers: [UserAdminController, PersonController],
  providers: [UserAdminService, PersonService],
  exports: [PersonService],
})
export class AdminModule {}
