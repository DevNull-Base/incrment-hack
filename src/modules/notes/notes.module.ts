import { Module } from '@nestjs/common';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { NotesController } from './notes.controller.js';
import { NotesService } from './notes.service.js';

/**
 * Заметки к заявкам и этапам.
 *
 * Движок процессов нужен, чтобы проверить этап, к которому привязывается
 * заметка, и подставить текущий, если этап не указан.
 */
@Module({
  imports: [WorkflowModule],
  controllers: [NotesController],
  providers: [NotesService],
})
export class NotesModule {}
