import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module.js';
import { AppConfig } from './config/configuration.js';

/**
 * Точка входа процесса `worker`: фоновые задачи без HTTP-сервера.
 *
 * Здесь выполняется вся ресурсоёмкая работа — формирование отчётов,
 * разбор XLS, синхронизация с внешними системами. Это ключевое
 * архитектурное разделение: рендеринг XLSX или PDF занимает процессор
 * на секунды и в API-процессе заблокировал бы event loop, а вместе с ним
 * и обслуживание всех остальных пользователей.
 *
 * Поднимает WorkerModule — то же приложение плюс обработчики очередей.
 * Процесс api их не содержит вовсе.
 *
 * Масштабируется независимо от API:
 *   docker compose up -d --scale worker=3
 */
async function bootstrap(): Promise<void> {
  // createApplicationContext поднимает DI-контейнер без HTTP-слушателя.
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });

  const logger = app.get(Logger);
  app.useLogger(logger);

  const config = app.get(ConfigService<AppConfig, true>);
  const concurrency = config.get('WORKER_CONCURRENCY', { infer: true });

  app.enableShutdownHooks();

  logger.log(`Worker запущен, параллельных задач на процесс: ${concurrency}`, 'Bootstrap');

  // Процесс живёт, пока его не остановят: обработчики очередей
  // регистрируются модулями через BullMQ.
  const shutdown = async (signal: string) => {
    logger.log(`Получен ${signal}, останавливаем worker...`, 'Bootstrap');
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void bootstrap();
