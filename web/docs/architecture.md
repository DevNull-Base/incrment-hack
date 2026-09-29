# Архитектура LCT-CRM

> Целевая архитектура фронтенда. Бекенд-контракт — `openapi.json`.
> Роли и IA — см. [roles-ui.md](roles-ui.md); интеграция — [roadmap-integration.md](roadmap-integration.md).

## Слои приложения

```
src/
├── main.tsx                  # bootstrap стора → BrowserRouter
├── App.tsx                   # Routes + RequireAuth
├── app/
│   ├── nav-config.tsx        # единый конфиг меню (роль-фильтр: visibleSections/visiblePages)
│   ├── guards/               # RequireAuth, RequireRole (этап 1)
│   └── store/                # zustand: session, engagements, notifications, catalog, …
├── layouts/                  # AppLayout (header+sidebar+split), Header, SidebarV2
├── components/               # SplitContext / SplitScreenLayout / SplitToggle
├── pages/                    # страницы-роуты + dashboard/, admin/ (этапы 1,7)
├── shared/
│   ├── api/                  # types.ts (DTO openapi) + client.ts (api.*) + workflow-definition
│   ├── lib/                  # utils, roles (ROLE_RANK/can)
│   └── ui/                   # канонические реализации UI
├── components/ui/            # публичная точка импорта (re-export shared/ui)
├── mock/data.ts              # только seed стора и сторибук-фикстуры
└── types/index.ts            # доменные алиасы = DTO (University=UniversityDto, …)
```
Мёртвый код и легаси — в `old/` (не удаляется, перенесено по плану Этапа 0).

## Правила данных

1. **Страницы не импортируют моки напрямую** и не вызывают `api.*` — только селекторы/actions стора.
2. **Seed стора** = `structuredClone(mock)`; моки не мутируются.
3. **Actions** — единственная точка вызова `api` из `shared/api/client.ts`. Когда бекенд подключён — меняется тело action, UI не трогается (минимум изменений форматов: моки уже DTO).
4. **SplitContext — только навигация** (`enabled`, `leftPage`, `rightPage`, `activeSide`, перехват `history.pushState`). Данные сущностей в context не класть.

## Стор (zustand) vs SplitContext

| Ответственность | Механизм |
|---|---|
| Какая страница в панели, active side, toggle split | `SplitContext` (React context) |
| Данные сущностей, unread, фильтры, session | `src/app/store` (zustand, module singleton) |
| Персист split-состояния (`?l/?r/?s`) и «недавних страниц» | URL + `localStorage` (`crm_split_recent`) |

### Синхронизация двух split-панелей

```
Panel A (Kanban) ── action transition() ──► zustand store ── selector ──► Panel B (Dashboard-воронка)
                                                    └──── selector ──► Header (badge unread)
```
Обе панели монтируют свой экземпляр страницы, но читают **один** store. Мутация в одной панели
перерисовывает все подписки. UI-состояние фильтров каждой панели — независимые `scopeKey`
(`split.layout`, `engagements.list`…) через серверный workspace API.

Срезы (постепенно): `session` → `notifications` → `engagements` → `catalog` → `workflow`
→ local-first (`licenses`, `documents`, `applications`, `calendar`, `chat`, `streams`).

## Layout экрана

```
┌────────────────────────────────────────────┐
│ Header — на всю ширину                    │
├──────────┬─────────────────────────────────┤
│ Sidebar  │ main → SplitScreenLayout       │
│ (240px / │   single → <Outlet/>           │
│  52px)   │   split  → 2 × SplitPane       │
│          │     каждый: узкий SidebarV2    │
│          │            + <Routes location> │
└──────────┴─────────────────────────────────┘
```
- Широкий сайдбар (single): все пункты сразу, секции с заголовками.
- Узкий (split): vertical-вкладки, flyout-меню справа (overlay).
- В split `history.pushState` перехватывается → навигация внутри панели меняет `leftPage/rightPage`, а не URL браузера.
- Контент панели рендерится через `<Routes location={path}>` — работают `useParams()` detail-роутов.

## Роли

- `SystemRole = USER | MANAGER | ADMIN` (из openapi).
- Guard: route (`RequireRole`) + conditional menu (`visibleSections(role)`).
- Dashboard: одна страница → три конфигурации (`dashboard/Dashboard{User,Manager,Admin}` — этап 1/3).
- Скрытие меню ≠ безопасность: scope режет сервер (`dataScope`).

## Workflow

- Источник этапов — **шаблоны** `WorkflowTemplateDetailDto.definition` (контракт `WorkflowDefinitionV1`,
  см. `src/shared/api/workflow-definition.ts` и этап 5), ровно 2 сегмента: **B2B и B2C**.
- Хардкод `WORKFLOW_STAGES` (14 шагов) — fallback, пока не подключены шаблоны.
- Кнопки переходов берутся из `availableTransitions` **с сервера**, не из редактора.
- Редактор: `/admin/flow-editor` (только ADMIN — так решено на Q&A-сессии) — черновик следующей
  редакции → предпросмотр с переносом заявок → публикация.
- Визуализация пути: карта этапов в карточке взаимодействия (`/interactions/:id`) и страница
  `/workflow` — этапы, сроки и переходы действующей редакции. У B2B и B2C — разные схемы.

## Local-first домены

В openapi **нет** `/licenses`, `/documents`, `/applications`, `/meetings`, KPI/аналитики.
Эти сущности живут в сторе через паттерн «slice + порт» (`mockPort` сегодня, `httpPort` потом) —
см. [local-domains.md](local-domains.md) (этап 6).

## Аутентификация

Keycloak (Authorization Code + PKCE): логин/refresh/logout **вне** openapi; фронт держит access token
и шлёт `Authorization: Bearer` (клиент `configureApi({ getToken })`). Единственный auth-эндпоинт —
`GET /api/v1/auth/me`. Текущий режим — мок (`TEST_ACCOUNTS`); Keycloak — план (см. `TODO(keycloak)` в LoginPage).
