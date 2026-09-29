import { Module } from '@nestjs/common';
import { EngagementController } from './engagement.controller.js';
import { EngagementService } from './engagement.service.js';
import { WorkflowModule } from '../workflow/workflow.module.js';

@Module({
  imports: [WorkflowModule],
  controllers: [EngagementController],
  providers: [EngagementService],
  exports: [EngagementService],
})
export class EngagementModule {}
