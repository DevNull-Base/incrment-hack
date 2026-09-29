import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller.js';

@Module({
  imports: [
    TerminusModule.forRoot({
      // Логи health-проб создают постоянный шум: Docker и Kubernetes
      // опрашивают эндпоинт каждые несколько секунд.
      logger: false,
    }),
  ],
  controllers: [HealthController],
})
export class HealthModule {}
