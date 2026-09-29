import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

/**
 * Конфигурация Prisma CLI (Prisma 7).
 *
 * Начиная с 7-й версии строка подключения не задаётся в schema.prisma:
 * здесь она используется инструментами миграций, а в рантайме приложение
 * подключается через драйверный адаптер PrismaPg.
 */
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),

  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },

  datasource: {
    url: process.env.DATABASE_URL,
  },
});
