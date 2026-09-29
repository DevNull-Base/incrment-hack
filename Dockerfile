# =============================================================================
#  CRM «ИТ Школа РТК» — многостадийная сборка
#
#  Цели (targets):
#    runtime  — рабочий образ для процессов api и worker (по умолчанию)
#    migrator — образ с Prisma CLI для применения миграций отдельной задачей
#
#  Один образ обслуживает обе роли процесса; роль задаётся командой запуска
#  и переменной APP_ROLE.
# =============================================================================

ARG NODE_VERSION=24-alpine

# --- Стадия 1: зависимости для сборки ---------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

COPY package.json package-lock.json ./
# Полный набор зависимостей: для сборки нужны TypeScript, Nest CLI и Prisma CLI.
RUN npm ci --no-audit --no-fund

# --- Стадия 2: сборка --------------------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json tsconfig.build.json nest-cli.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src

# Prisma 7 генерирует клиент как исходники TypeScript, поэтому генерация
# обязательно предшествует компиляции.
RUN npx prisma generate && npm run build

# --- Стадия 3: production-зависимости ---------------------------------------
FROM node:${NODE_VERSION} AS prod-deps
WORKDIR /app

COPY package.json package-lock.json ./

# --legacy-peer-deps здесь принципиален.
#
# @prisma/client объявляет CLI `prisma` ОПЦИОНАЛЬНОЙ peer-зависимостью,
# и npm устанавливает её автоматически. В образ при этом попадают Prisma
# Studio с React, драйвер mysql2 и компилятор TypeScript — примерно
# 270 МБ кода, который в production не исполняется никогда, но приносит
# с собой известные уязвимости.
#
# Флаг --omit=peer эту задачу НЕ решает: npm ci воспроизводит дерево
# из файла блокировки, где CLI уже зафиксирован как peer-запись.
# Замеры на этом проекте: --omit=dev даёт 353 пакета и 684 МБ,
# добавление --omit=peer — 350 пакетов и 676 МБ, то есть почти ничего.
#
# Сочетание --omit=peer --omit=optional сработало бы (253 пакета, 409 МБ),
# но отбрасывает и платформенные бинарники: у @resvg/resvg-js пропадают
# resvg-js-linux-x64-gnu и -musl, и рендеринг диаграмм отказал бы
# в рантайме. Поэтому выбран --legacy-peer-deps: он отключает
# автоустановку peer-зависимостей, сохраняя опциональные.
# Результат — 259 пакетов и 419 МБ.
RUN npm ci --omit=dev --legacy-peer-deps --no-audit --no-fund && npm cache clean --force

# --- Стадия 4: рабочий образ -------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false

# tini корректно обрабатывает сигналы и не оставляет процессов-зомби:
# без него SIGTERM не доходит до Node и graceful shutdown не срабатывает.
RUN apk add --no-cache tini

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# Встроенная документация: требование ТЗ — руководства открываются из самой
# системы, поэтому они часть образа, а не отдельного сайта.
COPY docs/guides ./docs/guides

# Работаем от непривилегированного пользователя (образ node его уже содержит).
USER node

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
# --enable-source-maps даёт осмысленные стек-трейсы в логах production.
CMD ["node", "--enable-source-maps", "dist/main.js"]

# --- Стадия 5: применение миграций ------------------------------------------
# Отдельный образ: Prisma CLI нужен только для миграций и не должен
# присутствовать в рабочем образе. Запускается разовой задачей перед
# стартом приложения — так несколько реплик api не устроят гонку миграций.
FROM node:${NODE_VERSION} AS migrator
WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma

# Исходники берутся из стадии сборки, а не из контекста: там уже сгенерирован
# клиент Prisma. Без них образ умеет только применять миграции, а наполнение
# демонстрационными данными (prisma/seed.ts) импортирует и клиент, и описания
# базовых процессов — на стенде запускать его было бы нечем.
COPY --from=build /app/src ./src

USER node

CMD ["npx", "prisma", "migrate", "deploy"]
