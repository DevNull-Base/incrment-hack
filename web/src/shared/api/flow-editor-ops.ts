import {
  diffStates,
  type WorkflowDefinitionV1,
  type WorkflowStateDef,
  type WorkflowTransitionDef,
} from "@/shared/api/workflow-definition"
import type { WorkflowPublishPreviewDto } from "@/shared/api"

// ========================================
// Чистая логика редактора flow: вставка/удаление
// этапов с перестыковкой переходов и мок-preview
// публикации. Без React и без стора — юнит-тестируется.
// ========================================

export interface ToolBlock {
  id: string
  label: string
  description: string
  payload: Partial<WorkflowStateDef>
}

export interface StateCounts {
  engagementCount: number
  noteCount: number
  attachmentCount: number
}

/**
 * Детерминированные демо-счётчики для стенда: сколько заявок/заметок/вложений
 * висит на каждом этапе. Нужны, чтобы показать миграцию при удалении.
 * Демо-режим; в режиме API эти данные отдаёт GET /workflow/templates/{id}/publish/preview.
 */
export function mockStateCounts(states: WorkflowStateDef[]): Record<string, StateCounts> {
  const out: Record<string, StateCounts> = {}
  for (const s of states) {
    let h = 0
    for (let i = 0; i < s.key.length; i += 1) h = (h * 31 + s.key.charCodeAt(i)) % 997
    const engagementCount = 2 + (h % 13)
    out[s.key] = {
      engagementCount,
      noteCount: engagementCount % 6,
      attachmentCount: engagementCount % 3,
    }
  }
  return out
}

export interface MatchResult {
  /** Ключи, есть и в base, и в draft. */
  matched: string[]
  /** Ключи только в draft (новые). */
  added: string[]
  /** Ключи только в base (будут удалены). */
  removed: string[]
  /** Ключи с изменённым label. */
  renamed: string[]
}

/** Палитра tool-blocks редактора (данные, без UI-зависимостей). */
export const TOOL_BLOCKS: ToolBlock[] = [
  {
    id: "tool-state",
    label: "Новый этап",
    description: "Обычный этап процесса",
    payload: { kind: "normal" },
  },
  {
    id: "tool-meeting",
    label: "Этап с встречей",
    description: "Требуется встреча, SLA 72ч",
    payload: { kind: "normal", meetingRequired: true, slaHours: 72 },
  },
  {
    id: "tool-docs",
    label: "Этап с документами",
    description: "Документооборот, SLA 48ч",
    payload: { kind: "normal", slaHours: 48 },
  },
  {
    id: "tool-final",
    label: "Финальный этап",
    description: "Завершает процесс (ставьте в конец)",
    payload: { kind: "final" },
  },
]

const TRANSLIT: Record<string, string> = {
  А: "A", Б: "B", В: "V", Г: "G", Д: "D", Е: "E", Ё: "E", Ж: "ZH", З: "Z", И: "I", Й: "Y",
  К: "K", Л: "L", М: "M", Н: "N", О: "O", П: "P", Р: "R", С: "S", Т: "T", У: "U", Ф: "F",
  Х: "KH", Ц: "TS", Ч: "CH", Ш: "SH", Щ: "SHCH", Ъ: "", Ы: "Y", Ь: "", Э: "E", Ю: "YU", Я: "YA",
}

/**
 * Уникальный key вида <SLUG>_<n> (parseDefinition падает на дубликатах).
 * Бэкенд принимает только ^[A-Z][A-Z0-9_]*$, поэтому кириллица подписи
 * транслитерируется: «Новый этап» → NOVYY_ETAP_1.
 */
export function genKey(label: string, existing: string[]): string {
  const latin = [...label.toUpperCase()].map((ch) => TRANSLIT[ch] ?? ch).join("")
  const cleaned = latin
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24)
  const slug = /^[A-Z]/.test(cleaned) ? cleaned : cleaned ? `S_${cleaned}` : "STATE"
  const taken = new Set(existing)
  let n = 1
  let key = `${slug}_${n}`
  while (taken.has(key)) {
    n += 1
    key = `${slug}_${n}`
  }
  return key
}

/** order = индекс + 1 для всех состояний. */
export function renumberOrders(states: WorkflowStateDef[]): WorkflowStateDef[] {
  return states.map((s, i) => ({ ...s, order: i + 1 }))
}

/** Переупорядочивание состояний (эквивалент arrayMove). */
export function reorderStates(
  states: WorkflowStateDef[],
  from: number,
  to: number,
): WorkflowStateDef[] {
  const next = [...states]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return renumberOrders(next)
}

/** Сопоставление этапов base↔draft по key (жадное, позиции не учитываются). */
export function matchStates(
  base: WorkflowDefinitionV1,
  draft: WorkflowDefinitionV1,
): MatchResult {
  const { added, removed, renamed } = diffStates(base, draft)
  const baseKeys = new Set(base.states.map((s) => s.key))
  const draftKeys = new Set(draft.states.map((s) => s.key))
  return {
    matched: [...baseKeys].filter((k) => draftKeys.has(k)),
    added: added.map((s) => s.key),
    removed: removed.map((s) => s.key),
    renamed: renamed.map((s) => s.key),
  }
}

/**
 * Вставка состояния после states[afterIndex] (null = в конец).
 * Перестыковка: ровно один out-переход A→B заменяется на A→N + N→B.
 * Вставка «в конец» после final вставляет НЕРЕД final (split его in-перехода).
 */
export function insertStateAfter(
  draft: WorkflowDefinitionV1,
  afterIndex: number | null,
  block: ToolBlock,
): { ok: true; def: WorkflowDefinitionV1 } | { ok: false; error: string } {
  const states = [...draft.states]
  const transitions = [...draft.transitions]
  if (states.length === 0) return { ok: false, error: "Нет этапов для вставки" }

  const newState: WorkflowStateDef = {
    key: genKey(block.label, states.map((s) => s.key)),
    label: block.label,
    kind: block.payload.kind ?? "normal",
    order: 0,
    ...(block.payload.slaHours !== undefined ? { slaHours: block.payload.slaHours } : {}),
    ...(block.payload.meetingRequired !== undefined
      ? { meetingRequired: block.payload.meetingRequired }
      : {}),
  }

  // Якорь — существующий узел, ПОСЛЕ которого (или перед final) идёт вставка.
  let anchorIdx: number
  let insertAt: number
  if (afterIndex === null) {
    const lastIdx = states.length - 1
    if (states[lastIdx].kind === "final") {
      // В конец нельзя после final — вставляем перед последним final.
      if (lastIdx === 0) {
        return { ok: false, error: "Нельзя вставить этап перед единственным этапом" }
      }
      anchorIdx = lastIdx - 1
      insertAt = lastIdx
    } else {
      anchorIdx = lastIdx
      insertAt = states.length
    }
  } else {
    if (afterIndex < 0 || afterIndex >= states.length) {
      return { ok: false, error: "Некорректная позиция вставки" }
    }
    anchorIdx = afterIndex
    insertAt = afterIndex + 1
  }
  const anchor = states[anchorIdx]

  if (anchor.kind === "final") {
    return { ok: false, error: "После финального этапа нельзя добавить этап" }
  }
  const outIdx = transitions.findIndex((t) => t.from === anchor.key)
  if (outIdx === -1) {
    // Хвост без исходов — new становится новым хвостом.
    transitions.push({
      key: `t-${anchor.key.toLowerCase()}-${newState.key.toLowerCase()}`,
      from: anchor.key,
      to: newState.key,
      label: `→ ${newState.label}`,
    })
  } else {
    // Ровно один out-переход A→B перешиваем через новый узел: A→N, N→B.
    const out = transitions[outIdx]
    transitions[outIdx] = { ...out, to: newState.key }
    transitions.push({
      key: `t-${newState.key.toLowerCase()}-${out.to.toLowerCase()}`,
      from: newState.key,
      to: out.to,
      label: out.label,
      ...(out.requiresComment !== undefined ? { requiresComment: out.requiresComment } : {}),
      ...(out.requiresAttachment !== undefined
        ? { requiresAttachment: out.requiresAttachment }
        : {}),
      ...(out.allowedRoles ? { allowedRoles: out.allowedRoles } : {}),
    })
  }

  states.splice(insertAt, 0, newState)

  // Страховка: убрать переходы на несуществующие ключи и петли.
  const keys = new Set(states.map((s) => s.key))
  const cleaned = transitions.filter(
    (t) => keys.has(t.to) && (t.from === "*" || keys.has(t.from)) && t.from !== t.to,
  )

  return {
    ok: true,
    def: { ...draft, states: renumberOrders(states), transitions: cleaned },
  }
}

/**
 * Удаление состояния с перенаправлением переходов.
 * - initial удалять нельзя;
 * - ин-переходы композируются с out-переходами (P→X, X→S ⇒ P→S);
 * - переходы `→key` перенаправляются на targetKey (без дублей).
 */
export function removeStateWithRemap(
  draft: WorkflowDefinitionV1,
  key: string,
  targetKey?: string,
): { ok: true; def: WorkflowDefinitionV1 } | { ok: false; error: string } {
  const victim = draft.states.find((s) => s.key === key)
  if (!victim) return { ok: false, error: "Этап не найден" }
  if (victim.kind === "initial") {
    return { ok: false, error: "Нельзя удалить начальный этап" }
  }
  if (targetKey && targetKey === key) {
    return { ok: false, error: "Цель переноса совпадает с удаляемым этапом" }
  }

  const states = draft.states.filter((s) => s.key !== key)
  const keys = new Set(states.map((s) => s.key))
  if (targetKey && !keys.has(targetKey)) {
    return { ok: false, error: "Целевой этап не найден" }
  }

  const ins = draft.transitions.filter((t) => t.to === key && t.from !== "*")
  const outs = draft.transitions.filter((t) => t.from === key)
  const wildcardIns = draft.transitions.filter((t) => t.to === key && t.from === "*")
  const others = draft.transitions.filter((t) => t.from !== key && t.to !== key)

  // Сквозные переходы: каждая пара (in × out) → in.from → out.to.
  const bridged: WorkflowTransitionDef[] = []
  for (const i of [...ins, ...wildcardIns]) {
    for (const o of outs) {
      // Граф композируется по out-переходу; targetKey — это маппинг КАРТОЧЕК
      // для publish (stateMapping), он не перекраивает переходы, пока у жертвы
      // есть исход.
      const to = o.to
      if (i.from === "*" || to !== i.from) {
        bridged.push({
          key: `t-${i.from.toLowerCase()}-${to.toLowerCase()}`,
          from: i.from,
          to,
          label: `→ ${states.find((s) => s.key === to)?.label ?? to}`,
          ...(o.requiresComment !== undefined ? { requiresComment: o.requiresComment } : {}),
          ...(o.requiresAttachment !== undefined
            ? { requiresAttachment: o.requiresAttachment }
            : {}),
          ...(o.allowedRoles ? { allowedRoles: o.allowedRoles } : {}),
        })
      }
    }
  }
  // Жертва без out (хвост/финал): ин-переходы перенаправляем на target,
  // иначе предшественники останутся без исхода.
  if (outs.length === 0 && targetKey) {
    for (const i of [...ins, ...wildcardIns]) {
      bridged.push({
        key: `t-${i.from.toLowerCase()}-${targetKey.toLowerCase()}`,
        from: i.from,
        to: targetKey,
        label: `→ ${states.find((s) => s.key === targetKey)?.label ?? targetKey}`,
      })
    }
  }

  // Страховка: не оставить переходов на удалённый ключ и не задублировать.
  const seen = new Set<string>()
  const merged = [...others, ...bridged].filter((t) => {
    if (!keys.has(t.to) || (t.from !== "*" && !keys.has(t.from)) || t.from === t.to) return false
    const sig = `${t.from}->${t.to}`
    if (seen.has(sig)) return false
    seen.add(sig)
    return true
  })

  return {
    ok: true,
    def: { ...draft, states: renumberOrders(states), transitions: merged },
  }
}

/**
 * Демо-эквивалент GET /publish/preview (режим API — api.workflowTemplates.publishPreview).
 * counts — сколько заявок/заметок/вложений сейчас на каждом состоянии.
 */
export function mockPublishPreview(
  base: WorkflowDefinitionV1,
  draft: WorkflowDefinitionV1,
  counts: Record<string, Partial<StateCounts>> = {},
): WorkflowPublishPreviewDto {
  const { added, removed, renamed } = diffStates(base, draft)
  const baseIndex = new Map(base.states.map((s, i) => [s.key, i]))

  const removedStates = removed.map((s) => {
    const i = baseIndex.get(s.key) ?? 0
    const neighbour = base.states[i + 1] ?? base.states[i - 1]
    const c = counts[s.key] ?? {}
    return {
      key: s.key,
      label: s.label,
      engagementCount: c.engagementCount ?? 0,
      ...(c.noteCount !== undefined ? { noteCount: c.noteCount } : {}),
      ...(c.attachmentCount !== undefined ? { attachmentCount: c.attachmentCount } : {}),
      suggestedTarget: neighbour && neighbour.key !== s.key ? neighbour.key : "",
    }
  })

  const blockingIssues: string[] = []
  const suggestedMapping: Record<string, string> = {}
  for (const r of removedStates) {
    if (r.engagementCount > 0) {
      if (r.suggestedTarget && draft.states.some((s) => s.key === r.suggestedTarget)) {
        suggestedMapping[r.key] = r.suggestedTarget
      } else {
        blockingIssues.push(
          `Для этапа «${r.label}» (${r.engagementCount} заявок) не подобрана цель переноса`,
        )
      }
    }
  }

  const affected = removedStates.reduce((sum, r) => sum + r.engagementCount, 0)
  return {
    currentTemplateId: "active",
    nextTemplateId: "00000000-0000-0000-0000-000000000000",
    addedStates: added.map((s) => ({ key: s.key, label: s.label })),
    removedStates,
    renamedStates: renamed.map((s) => {
      const old = base.states.find((b) => b.key === s.key)
      return {
        key: s.key,
        fromLabel: old?.label ?? s.key,
        toLabel: s.label,
      }
    }),
    transitionsChanged:
      JSON.stringify(base.transitions.map((t) => `${t.from}->${t.to}`)) !==
      JSON.stringify(draft.transitions.map((t) => `${t.from}->${t.to}`)),
    affectedEngagements: affected,
    relocatedEngagements: affected,
    suggestedMapping,
    blockingIssues,
  }
}
