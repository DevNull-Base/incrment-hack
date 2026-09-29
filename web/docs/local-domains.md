# Local-first домены

> Раздел лицензий удалён 28.09.2026: он появился до публикации ТЗ; лицензии видны
> в договорах вуза. Встречи и потоки получили API — см. [заметки-для-бекендера.md](заметки-для-бекендера.md).

В `openapi.json` **нет** эндпоинтов для этих сущностей. Они живут в UI на моках
и подключаются через паттерн «slice + порт», чтобы позже сменить источник без правки страниц.

## Список доменов

| Домен | Модель (`src/types`) | Страницы | План бекенда |
|---|---|---|---|
| **Документы** | `Document` — внутренний документооборот (draft→review→signed) | `/documents(/:id)` | вложения engagement есть (`attachments`); отдельный CRUD — TBD |
| **Заявки** | `Application` — источник website/university/lms | `/applications` | назначение страницы уточняется; интеграция `website/events` частично |
| **Календарь** | `CalendarEvent` + `Meeting` — встречи и таски из флоу | `/calendar` | режим API: `GET /calendar` (задачи, сроки этапов, встречи), встречи — `/engagements/{id}/meetings`; ниже — демо-режим |

## Паттерн порта

```ts
// src/app/store/licenseSlice.ts (этап 6)
interface LicenseSlice {
  licenses: License[]
  load: () => Promise<void>
  revoke: (id: string, reason: string) => Promise<void>
}

// порт выбора источника
// src/shared/api (порт будет добавлен при интеграции)
export interface LicensePort {
  list(): Promise<License[]>
  update(id: string, patch: Partial<License>): Promise<License>
}
export const mockLicensePort: LicensePort = { /* seed из @/mock/data */ }
// позже: export const httpLicensePort: LicensePort = { ... fetch('/api/v1/licenses') }
// выбор: VITE_LICENSES_API === 'http' ? http : mock
```

**Правила:**
1. Страницы импортируют **только** селекторы/actions стора — не моки, не порт напрямую.
2. Seed = `structuredClone(mock)`.
3. Статусы `License` расширяются: `active | expired | revoked | pending | rejected` +
   поля `revokedAt?`, `revokedBy?`, `moderationNote?` — UI модерации и отзывов.
4. При появлении эндпоинтов — добавить `http*Port`, включить через env, формат DTO уточнить
   (минимум изменений: UI уже не знает об источнике).

## Календарь ↔ workflow

- `CalendarPage` читает `calendarSlice.events` = meetings ∪ SLA-дедлайны engagements ∪ ручные заметки.
- Точки создания встречи: state с `meetingRequired: true` в `WorkflowDefinitionV1`.
- Пока бекенда нет — все события локальные; UI-клик по событию → `/interactions/:id`.
