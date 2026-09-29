/**
 * Выгрузка спецификации OpenAPI в файл.
 *
 * Фронтенд разрабатывает отдельная команда, поэтому контракт API —
 * самостоятельный артефакт, а не побочный результат работы сервера.
 * Из этого файла генерируется типизированный клиент и поднимается
 * mock-сервер, благодаря чему фронтенд не ждёт готовности реализации.
 *
 * Приложение поднимается без прослушивания порта: документ собирается
 * из метаданных контроллеров.
 *
 * Скрипт живёт внутри src и запускается из скомпилированного кода, а не
 * через tsx: последний собирает проект через esbuild, который не эмитит
 * метаданные декораторов, а на них держится внедрение зависимостей Nest.
 * Запуск из dist попутно гарантирует, что выгруженная спецификация
 * соответствует именно собранному приложению.
 *
 * Запуск: npm run openapi:export
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../app.module.js';
import { OPENAPI_DOCUMENT_OPTIONS, buildOpenApiConfig } from './swagger.js';
import { withStandardErrorResponses } from './openapi-errors.js';

const OUTPUT_PATH = process.argv[2] ?? 'openapi.json';

async function main(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: false,
  });

  app.setGlobalPrefix('api', { exclude: ['health', 'health/live', 'health/ready', 'metrics'] });
  // Префикс и версионирование должны совпадать с main.ts, иначе пути
  // в выгруженной спецификации разойдутся с реальными адресами.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  await app.init();

  const document = withStandardErrorResponses(
    SwaggerModule.createDocument(app, buildOpenApiConfig(), OPENAPI_DOCUMENT_OPTIONS),
  );

  writeFileSync(OUTPUT_PATH, JSON.stringify(document, null, 2), 'utf8');

  const pathCount = Object.keys(document.paths ?? {}).length;
  const schemaCount = Object.keys(document.components?.schemas ?? {}).length;

  console.log(`Спецификация сохранена: ${OUTPUT_PATH}`);
  console.log(`  маршрутов: ${pathCount}`);
  console.log(`  схем:      ${schemaCount}`);
  console.log('');
  console.log('Для фронтенд-команды:');
  console.log('  генерация типов — npx openapi-typescript openapi.json -o src/api/schema.d.ts');
  console.log('  mock-сервер     — npx @stoplight/prism-cli mock openapi.json');

  await app.close();

  // Явное завершение обязательно. Приложение поднимает соединения BullMQ
  // с Redis и сервер Socket.IO; их дескрипторы удерживают цикл событий,
  // и после close() процесс продолжает висеть без признаков работы.
  // Для разового скрипта выгрузки это означает зависший шаг сборки,
  // поэтому выходим сами, дождавшись записи файла.
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error('Не удалось выгрузить спецификацию:', error);
  process.exitCode = 1;
});
