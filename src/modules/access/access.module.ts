import { Global, Module } from '@nestjs/common';
import { DataScopeService } from './data-scope.service.js';

/**
 * Разграничение доступа к данным.
 *
 * Глобальный модуль: областью видимости пользуются почти все прикладные
 * модули — каталоги, взаимодействия, отчёты и аналитика.
 */
@Global()
@Module({
  providers: [DataScopeService],
  exports: [DataScopeService],
})
export class AccessModule {}
