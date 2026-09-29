# Roadmap: связка фронт ↔ бекенд

> **Статус (28.09.2026): флоу 1–6 подключены** (`VITE_DATA_SOURCE=api`). Сводка источников
> по разделам — в [README](../README.md#данные-с-бэкенда-vite_data_sourceapi).
> Workspace state (флоу 6) не подключён: фильтры панелей хранятся локально.

> Контракт: `openapi.json`. Клиент уже готов: `src/shared/api/client.ts` (`api.*`).
> **Принцип минимальных изменений форматов:** моки уже в форматах DTO (`src/types/index.ts` — алиасы),
> миграция = подмена источника данных **внутри actions стора** на вызовы `api.*`; UI не переписывается.

## Флоу 1 — Вход (Keycloak + /auth/me) — ✅ сделано

| Шаг | UI | API | Состояния |
|---|---|---|---|
| 1 | LoginPage «Войти» | Keycloak: Authorization Code + PKCE (логин/refresh/logout **вне** openapi) | loading «Перенаправление…» |
| 2 | после redirect | `GET /auth/me` → `CurrentUserDto` | error → сообщение на `/login` |
| 3 | `bootstrap()` стора | `configureApi({ getToken, onUnauthorized, onSessionExpired })` | loading → authenticated/anonymous |
| 4 | logout | clear token + Keycloak `end_session` | |

Код: `src/shared/auth/keycloak.ts`, сессия — `src/app/store/index.ts`.
Режим выбирается сборкой: задан `VITE_KEYCLOAK_URL` — Keycloak, нет — демо-вход по `TEST_ACCOUNTS`.
401 → refresh → retry (один раз) → иначе экран входа «Сессия истекла». Optimistic — нет.

**Источник данных:** `VITE_DATA_SOURCE=mock|api` (`src/shared/config.ts`). Пока `mock`,
точечные вызовы с id из моков (`InteractionDetailPage`, `UniversityDetailPage.handleCreate`)
не отправляются. Переключать на `api` — вместе с переводом слайсов на `api.*`.

## Флоу 2 — Рабочий цикл engagement

| Шаг | Экран | API | UI-состояния | Стратегия |
|---|---|---|---|---|
| 1 | `/interactions` Kanban | `GET /engagements` (фильтры segment/stateKey/ownerId) | skeleton / empty / error+retry | кэш стора |
| 2 | `/interactions/:id` | `GET /engagements/{id}` (ETag) | skeleton / 404 | list + detail |
| 3 | кнопки перехода | `availableTransitions` из detail | disabled + tooltip `blockedReason` | read-only |
| 4 | transition | `POST …/transition` + `If-Match: version` | optimistic move; при 409/412 → toast + refetch | optimistic + rollback |
| 5 | вложения | `GET/POST/DELETE …/attachments` | upload, `scanStatus` badge | refetch |
| 6 | reassign (M/A) | `POST …/reassign` | optimistic ownerName | rollback |
| 7 | уведомление | `GET /notifications/unread-count` | badge ++ | точечный refetch |
| 8 | дашборд | селекторы стора | — | без запроса |

## Флоу 3 — Уведомления и эскалация

- Список: `GET /notifications?channel&onlyUnread`; mark one/all — optimistic (`readAt`).
- Escalation policy: `GET/PUT /notifications/settings` (`escalationDays`, флаги) — вкладка `/settings`.
- Каналы: `PUT …/channels/{channel}`, `POST …/test`; ручной прогон `POST /notifications/escalation/run` (ADMIN).
- TG/VK при застревании — **бекенд** по `slaDueAt`; фронт только policy UI. Realtime нет → после mutation точечный `unread-count`.

## Флоу 4 — Каталоги CRUD

`GET/POST /catalog/{universities,programs,products,directions,vendors}`, `PUT /{id}`.
Table + drawer form; серверная пагинация `PageDto`; optimistic create (temp id) → replace;
`GET /catalog/universities/similar?name=` — warning при создании.
Loading skeleton · empty CTA · error banner+retry.

## Флоу 5 — Админ-цикл

| Фича | Экран | API | Заметки |
|---|---|---|---|
| Users | `/admin/users` | list, PATCH role/status/manager, scope | role = 3 значения; scope dimension multi |
| Audit | `/settings/audit` | `GET /audit`, `GET /audit/verify` | verify → чип intact/broken |
| Интеграции | `/admin/integrations` | sources, runs, sync, resetCursor | poll RUNNING каждые 3s |
| Импорт | `/admin/import` wizard | fields → POST file → mapping → resolutions → apply | стейт-машина в page/importSlice |
| Персоны | `/admin/persons` | list, PATCH, POST erase | erase = confirm «152-ФЗ» |

## Флоу 6 — Workspace state (фильтры панелей)

- mount списка → `GET /activity/workspace/{scopeKey}` → применить filters.
- изменение фильтра → debounce 500ms → `PUT` с произвольным JSON (`SaveStateDto.state`).
- scopeKeys: `split.layout`, `engagements.list`, `notifications.list`, `licenses.list`…
- ошибка сохранения — тихий retry, не блокировать UI.

## Порядок этапов плана

0 (чистка/конфиг/стор-skeleton) → 1 (session+guards) → 2 (notifications) → 3 (engagements+dashboard)
→ 4 (catalog) ; после 1 — 5 (workflow) ; после 3 — 6 (local domains), 7 (admin) ; после 2,3 — 8 (workspace+Keycloak).
**Минимум для демо: 0,1,2,3,5,6.**
