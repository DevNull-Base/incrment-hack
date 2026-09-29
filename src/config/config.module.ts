import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule, ConfigService } from '@nestjs/config';
import { AppConfig, validateConfig } from './configuration.js';

/**
 * Типизированный доступ к конфигурации.
 * `infer: true` во втором параметре даёт строгие типы возвращаемых значений,
 * поэтому обращения вида cfg.get('PORT') типобезопасны.
 */
export type TypedConfigService = ConfigService<AppConfig, true>;

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // .env читается только вне production: там конфигурация приходит
      // из окружения контейнера, а файла .env в образе нет.
      ignoreEnvFile: process.env.NODE_ENV === 'production',
      envFilePath: ['.env'],
      validate: validateConfig,
      expandVariables: true,
    }),
  ],
  exports: [NestConfigModule],
})
export class AppConfigModule {}
