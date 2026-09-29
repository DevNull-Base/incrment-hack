import { Module } from '@nestjs/common';
import { GuidesController } from './guides.controller.js';
import { GuidesService } from './guides.service.js';

/** Встроенные руководства пользователя и администратора. */
@Module({
  controllers: [GuidesController],
  providers: [GuidesService],
})
export class GuidesModule {}
