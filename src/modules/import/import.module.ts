import { Module } from '@nestjs/common';
import { ImportController } from './import.controller.js';
import { ImportService } from './import.service.js';
import { XlsParserService } from './xls-parser.service.js';
import { FilesModule } from '../files/files.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';

/**
 * Импорт данных из XLS/XLSX.
 *
 * Обработчик очереди в этот модуль НЕ входит: он подключается отдельно
 * в процессе worker. Благодаря этому процесс api умеет ставить задачи,
 * но не выполняет их.
 */
@Module({
  // Процесс — ради заявок, которые загрузка заводит по колонке «ФИО менеджера».
  imports: [FilesModule, WorkflowModule],
  controllers: [ImportController],
  providers: [ImportService, XlsParserService],
  exports: [ImportService],
})
export class ImportModule {}
