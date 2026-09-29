# Технологический стек

## Frontend
| Технология | Версия | Назначение |
|---|---|---|
| React | 19.x | UI-фреймворк |
| TypeScript | 6.x | Типизация |
| Vite | 8.x | Сборка и dev-сервер |
| Tailwind CSS | 4.x | Утилитарные стили |
| MynaUI | latest | UI-kit (на базе shadcn/ui + Radix UI) |
| React Router | 7.x | Клиентский роутинг |
| zustand | 5.x | Глобальный стор (session, entities, синхронизация split-панелей) |
| @mynaui/icons-react | 0.4.x | Иконки (1180+ шт.) |
| lucide-react | 1.x | Иконки (дополнительные) |
| @dnd-kit/core + @dnd-kit/sortable | latest | Drag-and-drop канбана |
| @base-ui/react | latest | Примитивы UI (Dialog, Dropdown, Sheet) |
| Vitest | 5.x | Юнит-тесты |
| Storybook | 10.x | Изолированная разработка компонентов |
| Oxlint | 1.x | Линтер |

## Бекенд
**Контракт: `openapi.json`** (OpenAPI 3.0, «CRM ИТ Школа РТК» v1.0, 87 операций).
Аутентификация — Keycloak (bearer JWT). Сейчас UI работает на моках в форматах DTO;
подключение — по [roadmap-integration.md](roadmap-integration.md). Клиент готов: `src/shared/api/client.ts`.
`docs/mockback.md` — исторический документ, источник истины не он.

## Почему MynaUI?
- Основан на **shadcn/ui** + **Radix UI** — проверенные, доступные компоненты
- 1180+ иконок в комплекте
- Tailwind CSS v4 нативно
- Не зависит от внешнего CDN — компоненты копируются в проект
- Современный, минималистичный дизайн
- Figma-файл для дизайнера в комплекте

## Структура проекта
```
lct-crm/
├── openapi.json                # Спецификация бекенда (источник истины)
├── old/                        # Перенесённый мёртвый код (не использовать)
├── docs/                       # Документация (roles-ui, roadmap-integration, architecture, …)
├── public/
├── src/
│   ├── App.tsx                 # Роуты приложения
│   ├── main.tsx                # Точка входа (BrowserRouter)
│   ├── index.css               # Глобальные стили + Tailwind тема
│   ├── app/
│   │   ├── nav-config.tsx      # Меню с фильтром по ролям
│   │   ├── guards/             # RequireAuth / RequireRole
│   │   └── store/              # zustand-store (session, entities, …)
│   ├── components/
│   │   ├── SplitContext.tsx    # Split-screen state + перехват навигации
│   │   ├── SplitScreenLayout.tsx  # Двухпанельный layout
│   │   ├── SplitToggle.tsx  # Кнопка «Разделение экрана» в хедере
│   │   └── ui/                 # Публичная точка импорта (re-export shared/ui)
│   ├── layouts/
│   │   ├── AppLayout.tsx       # Корневой layout (header + sidebar + content)
│   │   ├── Header.tsx          # Полноширинный хедер
│   │   └── SidebarV2.tsx       # Широкий (flat) + узкий (tab) сайдбар
│   ├── hooks/                  # Кастомные хуки (useTheme)
│   ├── shared/                 # api (DTO+client), ui (канон), lib (roles, utils)
│   ├── lib/                    # Утилиты (cn и т.д.)
│   ├── mock/                   # Моковые данные
│   ├── pages/                  # Страницы приложения
│   └── types/                  # Доменные алиасы = DTO openapi
├── components.json             # Конфиг shadcn/ui
├── package.json
├── vite.config.ts
├── vitest.config.ts
└── tsconfig.json
```

## Layout-архитектура

### AppLayout
```
┌─────────────────────────────────────────┐
│  Header (full width)                   │
├──────────┬──────────────────────────────┤
│ Sidebar  │  main → SplitScreenLayout   │
│ (240px)  │       → Outlet (single)     │
│          │       → 2 panels (split)     │
└──────────┴──────────────────────────────┘
```

### Sidebar-режимы
| Режим | Условие | Ширина | Навигация |
|---|---|---|---|
| Широкий | `narrow={false}` (default) | 240px (15rem) | Flat list: секции + пункты через `<NavLink>` |
| Узкий | `narrow={true}` (split) | 52px | File-folder tabs с вертикальным текстом + flyout dropdown |

### Split-screen навигация
1. `SplitContext` перехватывает `history.pushState` / `history.replaceState` при `enabled`
2. Навигация из контента перенаправляется в `leftPage` / `rightPage` (активная панель через `activeSideRef`)
3. URL браузера не меняется в split-режиме
4. Каждая панель рендерит через `<Routes location={path}>` — `useParams()` работает для detail-страниц
