import { Module } from '@nestjs/common';
import { FilesController } from './files.controller.js';
import { AttachmentService } from './attachment.service.js';
import { AntivirusService } from './antivirus.service.js';
import { WorkflowModule } from '../workflow/workflow.module.js';

/**
 * Работа с файлами.
 *
 * AntivirusService экспортируется: проверке подлежит каждый файл, попадающий
 * в систему, а не только вложения. Импорт таблиц пользуется тем же сервисом —
 * иначе рядом с проверяемым каналом загрузки существовал бы непроверяемый.
 */
@Module({
  // Движок процессов нужен, чтобы определить этап, к которому прикладывается файл.
  imports: [WorkflowModule],
  controllers: [FilesController],
  providers: [AttachmentService, AntivirusService],
  exports: [AttachmentService, AntivirusService],
})
export class FilesModule {}
