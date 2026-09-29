import type { SystemRole } from "./types"

// ========================================
// WorkflowDefinitionV1 — клиентский контракт definition
// внутри свободного WorkflowTemplateDetailDto.definition (object).
// Ровно два активных сегмента: B2B и B2C.
// ========================================
export interface WorkflowStateDef {
  key: string
  label: string
  kind: "initial" | "normal" | "final"
  order: number
  slaHours?: number
  meetingRequired?: boolean
  colorToken?: string
  /** Поля определения бэкенда: сохраняются при правке и публикации. */
  description?: string
  slaDays?: number
  requiresAttachment?: boolean
}

export interface WorkflowTransitionDef {
  key: string
  from: string
  to: string
  label: string
  requiresComment?: boolean
  requiresAttachment?: boolean
  allowedRoles?: SystemRole[]
}

export interface WorkflowDefinitionV1 {
  schemaVersion: 1
  states: WorkflowStateDef[]
  transitions: WorkflowTransitionDef[]
  meta?: {
    description?: string
    defaultSlaHours?: number
    layout?: Record<string, { x: number; y: number }>
  }
}

export class WorkflowDefinitionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WorkflowDefinitionError"
  }
}

/** Разбор + валидация definition. Бросает WorkflowDefinitionError. */
export function parseDefinition(raw: unknown): WorkflowDefinitionV1 {
  if (typeof raw !== "object" || raw === null) {
    throw new WorkflowDefinitionError("definition должен быть объектом")
  }
  const def = raw as Partial<WorkflowDefinitionV1>
  if (def.schemaVersion !== 1) {
    throw new WorkflowDefinitionError(`неподдерживаемый schemaVersion: ${String(def.schemaVersion)}`)
  }
  if (!Array.isArray(def.states) || def.states.length === 0) {
    throw new WorkflowDefinitionError("states: минимум один этап")
  }
  if (!Array.isArray(def.transitions)) {
    throw new WorkflowDefinitionError("transitions: ожидается массив")
  }

  const keys = new Set<string>()
  for (const s of def.states) {
    if (!s.key || !s.label) throw new WorkflowDefinitionError("у state нет key/label")
    if (keys.has(s.key)) throw new WorkflowDefinitionError(`дубликат state key: ${s.key}`)
    keys.add(s.key)
  }

  const initials = def.states.filter((s) => s.kind === "initial")
  if (initials.length !== 1) {
    throw new WorkflowDefinitionError(`должен быть ровно 1 initial, найдено ${initials.length}`)
  }

  for (const t of def.transitions) {
    if (!t.key || !t.to || !t.label) {
      throw new WorkflowDefinitionError("у transition нет key/to/label")
    }
    if (t.from !== "*" && !keys.has(t.from)) {
      throw new WorkflowDefinitionError(`transition ссылается на неизвестный from: ${t.from}`)
    }
    if (!keys.has(t.to)) {
      throw new WorkflowDefinitionError(`transition ссылается на неизвестный to: ${t.to}`)
    }
  }

  // Достижимость: все non-initial состояния достижимы из initial (BFS)
  const initialKey = initials[0].key
  const reachable = new Set<string>([initialKey])
  let changed = true
  while (changed) {
    changed = false
    for (const t of def.transitions) {
      if ((t.from === "*" || reachable.has(t.from)) && !reachable.has(t.to)) {
        reachable.add(t.to)
        changed = true
      }
    }
  }
  for (const s of def.states) {
    if (!reachable.has(s.key)) {
      throw new WorkflowDefinitionError(`недостижимое состояние: ${s.key}`)
    }
  }

  return def as WorkflowDefinitionV1
}

// ========================================
// Определение процесса бэкенда (src/modules/workflow/workflow-definition.ts):
// isInitial/isFinal вместо kind, срок в днях, переходы без ключей.
// ========================================
export interface BackendWorkflowState {
  key: string
  label: string
  description?: string
  order: number
  isInitial?: boolean
  isFinal?: boolean
  slaDays?: number
  requiresAttachment?: boolean
}

export interface BackendWorkflowTransition {
  from: string
  to: string
  label: string
  requiresComment?: boolean
  allowedRoles?: SystemRole[]
}

export interface BackendWorkflowDefinition {
  states: BackendWorkflowState[]
  transitions: BackendWorkflowTransition[]
}

/** Определение бэкенда → клиентский WorkflowDefinitionV1 (редактор, этапы). */
export function fromBackendDefinition(raw: unknown): WorkflowDefinitionV1 {
  const def = raw as Partial<BackendWorkflowDefinition> | null
  const states = [...(def?.states ?? [])].sort((a, b) => a.order - b.order)
  return {
    schemaVersion: 1,
    states: states.map((s, index) => ({
      key: s.key,
      label: s.label,
      kind: s.isInitial ? "initial" : s.isFinal ? "final" : "normal",
      order: index + 1,
      slaDays: s.slaDays,
      slaHours: s.slaDays ? s.slaDays * 24 : undefined,
      description: s.description,
      requiresAttachment: s.requiresAttachment ?? false,
    })),
    transitions: (def?.transitions ?? []).map((t) => ({
      key: `${t.from}->${t.to}`,
      from: t.from,
      to: t.to,
      label: t.label,
      requiresComment: t.requiresComment ?? false,
      allowedRoles: t.allowedRoles ?? [],
    })),
  }
}

/**
 * Клиентский definition → формат бэкенда. Переход «из любого» (from: "*")
 * бэкенд не поддерживает — он разворачивается в переходы из каждого
 * незавершающего состояния. Из завершающих состояний переходов быть
 * не может: бэкенд такой процесс отвергнет.
 */
export function toBackendDefinition(def: WorkflowDefinitionV1): BackendWorkflowDefinition {
  const states = [...def.states].sort((a, b) => a.order - b.order)
  const finalKeys = new Set(states.filter((s) => s.kind === "final").map((s) => s.key))
  const transitions: BackendWorkflowTransition[] = []
  const seen = new Set<string>()

  for (const t of def.transitions) {
    const sources = t.from === "*" ? states.map((s) => s.key).filter((k) => k !== t.to) : [t.from]
    for (const from of sources) {
      if (finalKeys.has(from) || seen.has(`${from}->${t.to}`)) continue
      seen.add(`${from}->${t.to}`)
      transitions.push({
        from,
        to: t.to,
        label: t.label,
        requiresComment: t.requiresComment ?? false,
        allowedRoles: t.allowedRoles ?? [],
      })
    }
  }

  return {
    states: states.map((s, index) => ({
      key: s.key,
      label: s.label,
      ...(s.description ? { description: s.description } : {}),
      order: index,
      isInitial: s.kind === "initial",
      isFinal: s.kind === "final",
      // Редактор правит срок в часах; дни бэкенда — производные от них.
      ...(s.slaHours || s.slaDays
        ? { slaDays: Math.min(365, Math.max(1, s.slaHours ? Math.round(s.slaHours / 24) : (s.slaDays ?? 1))) }
        : {}),
      requiresAttachment: s.requiresAttachment ?? false,
    })),
    transitions,
  }
}

/** Diff состояний двух definition — для publish-preview. */
export function diffStates(prev: WorkflowDefinitionV1, next: WorkflowDefinitionV1) {
  const prevKeys = new Map(prev.states.map((s) => [s.key, s]))
  const nextKeys = new Map(next.states.map((s) => [s.key, s]))
  const added = next.states.filter((s) => !prevKeys.has(s.key))
  const removed = prev.states.filter((s) => !nextKeys.has(s.key))
  const renamed = next.states.filter((s) => {
    const old = prevKeys.get(s.key)
    return old && old.label !== s.label
  })
  return { added, removed, renamed }
}
