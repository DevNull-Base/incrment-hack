import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

/**
 * Доступ к БД нужен почти каждому модулю, поэтому провайдер объявлен
 * глобальным — это избавляет от импорта PrismaModule в каждом модуле.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
