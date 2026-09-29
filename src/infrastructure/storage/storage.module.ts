import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service.js';

/**
 * Объектное хранилище. Глобальный модуль: им пользуются вложения,
 * отчёты и импорт данных.
 */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
