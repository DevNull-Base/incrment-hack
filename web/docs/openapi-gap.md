# Интеграционный чеклист: подключение фронта к бэкенду

> Контракт: [`openapi.json`](../openapi.json) — 133 операции (обновлён 28.09.2026).
> Бэкенд существует: фронт сейчас работает на мок-слое стора. Вход через Keycloak и
> `GET /auth/me` подключены (`VITE_KEYCLOAK_URL`); запросы за данными включаются
> переменной `VITE_DATA_SOURCE=api`.

## 1. Подключение (одна переменная)
1. `cp .env.example .env` (`VITE_API_TARGET`, `VITE_KEYCLOAK_*`) и `npm run dev` — Vite проксирует `/api/*` (см. `vite.config.ts`).
2. Токен: Keycloak → `localStorage.crm_access_token` → `Authorization: Bearer`, обновление и повтор на 401 — `shared/auth/keycloak.ts` + `configureApi` в сторе.
3. Smoke-порядок: `GET /api/v1/health` → `GET /api/v1/auth/me` → каталоги → engagements.

## 2. Готовый клиент (`src/shared/api/client.ts`) — методы написаны
| Группа | Что даёт | Закрывает |
|---|---|---|
| `calendar`, `calendarTasks` | CRUD задач + complete/reopen | календарь-задачи |
| `notes`, `engagements.timeline/archive/restore/contact` | заметки, история, архив, контакт | карточка взаимодействия |
| `activity.feed` | лента событий (19 типов) | «последние действия» |
| `universities.contacts/contracts` | контакты и контракты вуза | карточка вуза |
| ранее существующие: `engagements.reassign`, `activity` (workspace), `notifications`, `reports`, `workflowTemplates` | заявленные в ТЗ | roadmap |

## 3. Точки замены мок → API (стор-actions, помечены комментариями в коде)
- `calendarSlice.toggleTask` → `api.calendarTasks.complete` / `reopen`
- `engagementSlice.addNote` → `api.notes.create`
- `engagementSlice.archiveInteraction` / `restoreInteraction` → `api.engagements.archive` / `restore`
- сид `catalogSlice.universityContacts/Contracts` → `api.universities.contacts` / `contracts`
- сид `activityEvents` → `api.activity.feed` (маппинг `ActivityItemDto` → ленту)
- сид `adminUsers` → `api.adminUsers.list` (`roleSource` уже в типах)
- ✅ сессия `TEST_ACCOUNTS` → Keycloak (login/refresh/logout — **вне openapi**) + `api.auth.me`

## 4. Чего нет в контракте — уточнить с бэком
- Chat/мессенджер (ТЗ «в идеале»): фронт-моки есть, эндпоинтов нет — реализуется позже.
- Потоки, встречи, заметки по вузу и карточка программы — появились
  28.09.2026, см. [заметки-для-бекендера.md](заметки-для-бекендера.md).
- Нагрузочный тест 50/300+ параллельных — процедурное ТЗ, не API.
- Swagger = сам `openapi.json`; публичный репозиторий и деплой — организационные пункты.

## 5. Рекомендуемый порядок включения
health → auth → каталоги → engagements/переходы → задачи и заметки → activity feed → отчёты/экспорт → интеграции (LMS/платежи — требуют внешних систем).
