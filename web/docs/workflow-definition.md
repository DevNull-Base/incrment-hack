# WorkflowDefinitionV1 — контракт флоу

> Хранится внутри свободного `WorkflowTemplateDetailDto.definition` (object) из `openapi.json`.
> Клиентский тип и валидатор: `src/shared/api/workflow-definition.ts`.
> Ровно два активных сегмента: **B2B** и **B2C** (`WorkflowTemplateSummaryDto.segment`).

## Схема

```ts
interface WorkflowDefinitionV1 {
  schemaVersion: 1
  states: Array<{
    key: string                 // "SIGNING"
    label: string               // "Подписание документов"
    kind: "initial" | "normal" | "final"
    order: number               // порядок в воронке/kanban
    slaHours?: number           // SLA → engagement.slaDueAt
    meetingRequired?: boolean   // точка для встречи (календарь)
    colorToken?: string
  }>
  transitions: Array<{
    key: string
    from: string                // key | "*"
    to: string
    label: string
    requiresComment?: boolean
    requiresAttachment?: boolean
    allowedRoles?: Array<"USER" | "MANAGER" | "ADMIN">  // UI-подсказка; сервер — истина
  }>
  meta?: {
    description?: string
    defaultSlaHours?: number
    layout?: Record<string, { x: number; y: number }>  // позиции для графа (не влияет на бек)
  }
}
```

## Валидация (`parseDefinition`)

- `schemaVersion === 1`
- ≥1 state, без дубликатов `key`, у каждого `key` и `label`
- ровно **1** `kind: "initial"`
- переходы ссылаются только на существующие state
- все non-initial состояния достижимы из initial (BFS)

Ошибки → `WorkflowDefinitionError` → в UI как `message.kind = "err"`.

## Соответствие openapi publish

| openapi | Клиент |
|---|---|
| `AddedStateDto { key, label }` | `diffStates(prev, next).added` |
| `RemovedStateDto { key, label, engagementCount, suggestedTarget }` | `.removed` (+ данные бека) |
| `RenamedStateDto { key, fromLabel, toLabel }` | `.renamed` |
| `PublishWorkflowTemplateDto.stateMapping` | `Record<removedKey, keptKey>` на publish |
| `AvailableTransitionDto` | **с сервера** в engagement detail — не из редактора |

## Использование в UI

- Сорс: `workflowSlice.definitionFor(templateId)`, активный шаблон `templateForSegment(segment)`.
- Kanban и страница `/workflow`: колонки и шаги = `states` по `order`, переходы — `transitions`
  действующей редакции; fallback демо-режима — `WORKFLOW_STAGES`.
- Редактор: `/admin/flow-editor` (ADMIN) — `FlowEditorPage`: процесс → черновик следующей редакции →
  предпросмотр с переносом заявок → публикация.
- Путь заявки: карта этапов в карточке `/interactions/:id` — solid по истории, dashed для остальных переходов.
