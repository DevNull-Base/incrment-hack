import { Module } from '@nestjs/common';
import { RetentionService } from './retention.service.js';

/**
 * Соблюдение сроков хранения данных.
 *
 * Модуль подключается ТОЛЬКО к процессу worker (см. worker.module.ts).
 * Если бы он входил в общий AppModule, регламентная задача запускалась бы
 * в каждой реплике API, и удаление выполнялось бы столько раз, сколько
 * их поднято. Расписание — свойство фоновой обработки, а не обслуживания
 * запросов.
 */
@Module({
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
