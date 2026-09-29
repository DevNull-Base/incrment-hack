import { Module } from '@nestjs/common';
import { WorkflowController } from './workflow.controller.js';
import { WorkflowService } from './workflow.service.js';
import { WorkflowTemplateService } from './workflow-template.service.js';

/**
 * Движок процессов взаимодействия и редактор их схем.
 *
 * WorkflowService экспортируется, поскольку переходы инициируются модулем
 * взаимодействий, а определения процессов нужны и модулю отчётов для
 * расшифровки статусов. Редактор наружу не отдаётся: схему меняет только
 * администратор через собственный контроллер.
 */
@Module({
  controllers: [WorkflowController],
  providers: [WorkflowService, WorkflowTemplateService],
  exports: [WorkflowService],
})
export class WorkflowModule {}
