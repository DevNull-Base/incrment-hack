# API-контракты

> **Источник истины: [`openapi.json`](../openapi.json)** — OpenAPI 3.0,
> «CRM «ИТ Школа РТК»» v1.0. Файл скопирован из выгрузки бекенда в корень проекта.
>
> Старые выдуманные контракты (`/api/universities` и т.п.) удалены.

> **Аутентификация (Keycloak):** в спеке есть только `GET /auth/me` и security-scheme
> `keycloak` (bearer JWT). Логин/refresh/logout — на стороне Keycloak-клиента фронта
> (Authorization Code + PKCE) и в спецификацию **не входят**. Роль в токене: `USER|MANAGER|ADMIN`.
>
> **Эндпоинтов нет для:** meetings/календарь, licenses, documents (отдельным CRUD),
> applications, analytics-KPI (тег «Аналитика» пуст), chat — эти домены local-first
> (см. roadmap-integration.md). Единственный числовой агрегат — `GET /notifications/unread-count`.
>
> **Concurrency:** `POST /engagements/{id}/transition` требует заголовок `If-Match: <version>`
> (ETag из `GET /engagements/{id}`); конфликт → ошибка `CRM-WFL-0005`.

## Как фронт использует API

| Слой | Файл | Назначение |
|---|---|---|
| DTO-типы | [`src/shared/api/types.ts`](../src/shared/api/types.ts) | TypeScript-типы всех схем спецификации |
| Клиент | [`src/shared/api/client.ts`](../src/shared/api/client.ts) | Типизированные обёртки всех эндпоинтов |
| Доменные алиасы | [`src/types/index.ts`](../src/types/index.ts) | `University`, `Interaction` и др. = DTO из спецификации |
| Моки | [`src/mock/data.ts`](../src/mock/data.ts) | Данные в форматах DTO (работа без бекенда) |

Базовый путь клиента: `/api/v1` (настраивается через `configureApi({ baseUrl })`).
Авторизация: `Authorization: Bearer <token>`, токен читается из
`localStorage.crm_access_token` (можно переопределить `getToken`).

## Основные группы эндпоинтов (122 шт.)

Обновление 26.09.2026: добавлены calendar/tasks (CRUD + complete/reopen), engagement notes/timeline/archive/restore/contact, activity/feed, контакты вузов/вендоров и контракты вузов, interest-summary, LMS-export/payments; у схем появились `roleSource`, `interestLevel`, поля архива и платежей. Подробный план подключения — [openapi-gap.md](openapi-gap.md).

### Auth и здоровье

### Каталоги

Списки поддерживают `page`, `limit`, `search`, `sortOrder` и возвращают
`PageDto<T> = { items: T[], meta: PageMetaDto }`.

### Взаимодействия (Engagements)

Ключевое отличие от старой модели: не 14 жёстких этапов, а **состояния
workflow из шаблонов** — `currentStateKey` / `currentStateLabel`
(например `SIGNING` → «Подписание документов»), доступные переходы
`availableTransitions`, история `history`, SLA `slaDueAt` + `isOverdue`.

### Workflow-шаблоны

### Уведомления

Прочитанность: `readAt === null` → непрочитанное.

### Остальные группы
- **Импорт**: `POST /api/v1/import`, mapping/resolutions/apply
- **Отчёты**: `GET /api/v1/reports/columns`, `POST /api/v1/reports`, download
- **Рабочий контекст**: workspace state, drafts, recent visits
- **Администрирование**: users, роли, статусы, scope-rules
- **Персоны (152-ФЗ)**: list/update/erase персональных данных
- **Интеграции**: LMS/website sources, sync runs, inbound events, контракты
- **Аудит**: `GET /api/v1/audit`, `GET /api/v1/audit/verify` (hash-chain)
- **Справочники**: `GET /api/v1/guides`, `/api/v1/guides/{slug}`

## Формат ошибок
```json
{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.1",
  "title": "One or more validation errors occurred.",
  "status": 400,
  "detail": "...",
  "code": "VALIDATION_ERROR",
  "instance": "/api/v1/...",
  "traceId": "...",
  "timestamp": "2025-09-23T12:00:00Z",
  "errors": []
}
```
Клиент превращает это в `ApiError { status, code, message, traceId }`.

## Полная спецификация
Смежные детали (все схемы, параметры, примеры) — в [`openapi.json`](../openapi.json).
