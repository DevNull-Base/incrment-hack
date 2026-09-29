import { useMemo } from "react"
import { cn } from "cn"
import type {
  WorkflowDefinitionV1,
  WorkflowStateDef,
} from "@/shared/api/workflow-definition"

interface ChangeListProps {
  base: WorkflowDefinitionV1
  draft: WorkflowDefinitionV1
  /** Результат diffStates(base, draft). */
  diff: {
    added: WorkflowStateDef[]
    removed: WorkflowStateDef[]
    renamed: WorkflowStateDef[]
  }
  engagementCounts: Record<string, number>
  /** Выбранный перенос (заполняется в предпросмотре публикации). */
  mapping: Record<string, string>
  /** Клик по строке прокручивает канвас к узлу. */
  onJump: (row: "base" | "draft", key: string) => void
}

type Tone = "add" | "remove" | "edit" | "move" | "info"

interface ChangeRow {
  id: string
  tone: Tone
  glyph: string
  text: string
  jump?: { row: "base" | "draft"; key: string }
}

const TONE_CLASS: Record<Tone, string> = {
  add: "text-success",
  remove: "text-destructive",
  edit: "text-info",
  move: "text-muted-foreground",
  info: "text-primary",
}

/**
 * Текстовый список изменений под diff-канвасом: быстрый скан правок
 * без визуального сопоставления узлов. Клик по строке — прокрутка
 * к соответствующему узлу в канвасе.
 */
export function ChangeList({
  base,
  draft,
  diff,
  engagementCounts,
  mapping,
  onJump,
}: ChangeListProps) {
  const rows = useMemo(() => {
    const out: ChangeRow[] = []
    const baseKeys = new Set(base.states.map((s) => s.key))
    const draftKeys = new Set(draft.states.map((s) => s.key))
    const draftIndex = (key: string) => draft.states.findIndex((s) => s.key === key)
    const baseIndex = (key: string) => base.states.findIndex((s) => s.key === key)

    // Куда перенесутся заявки удаляемого этапа, если маппинг ещё не выбирали.
    const suggestTarget = (key: string): string | undefined => {
      const idx = baseIndex(key)
      const neighbours = [base.states[idx + 1], base.states[idx - 1]].filter(
        Boolean,
      ) as WorkflowStateDef[]
      return neighbours.find((n) => draftKeys.has(n.key))?.key ?? draft.states[0]?.key
    }

    for (const s of diff.added) {
      const idx = draftIndex(s.key)
      const after = idx > 0 ? draft.states[idx - 1].label : null
      out.push({
        id: `add:${s.key}`,
        tone: "add",
        glyph: "+",
        text: after
          ? `Добавлен этап «${s.label}» (после «${after}»)`
          : `Добавлен этап «${s.label}» (в начало)`,
        jump: { row: "draft", key: s.key },
      })
    }

    for (const s of diff.removed) {
      const count = engagementCounts[s.key] ?? 0
      const targetKey = mapping[s.key] ?? suggestTarget(s.key)
      const targetLabel = draft.states.find((x) => x.key === targetKey)?.label
      let suffix = ""
      if (count > 0) {
        suffix = targetLabel
          ? ` → заявки будут перенесены на «${targetLabel}»`
          : " → цель переноса выберите при публикации"
      } else {
        suffix = " · заявок нет"
      }
      out.push({
        id: `rem:${s.key}`,
        tone: "remove",
        glyph: "−",
        text: `Удалён этап «${s.label}»${suffix}`,
        jump: { row: "base", key: s.key },
      })
    }

    for (const s of diff.renamed) {
      const old = base.states.find((x) => x.key === s.key)
      out.push({
        id: `rename:${s.key}`,
        tone: "edit",
        glyph: "✎",
        text: `«${old?.label ?? s.key}»: название → «${s.label}»`,
        jump: { row: "draft", key: s.key },
      })
    }

    // Свойства переименованных выше не показываем повторно.
    const renamedKeys = new Set(diff.renamed.map((s) => s.key))
    for (const d of draft.states) {
      if (!baseKeys.has(d.key) || renamedKeys.has(d.key)) continue
      const b = base.states.find((x) => x.key === d.key)
      if (!b) continue
      if (b.slaHours !== d.slaHours) {
        out.push({
          id: `sla:${d.key}`,
          tone: "edit",
          glyph: "✎",
          text: `«${d.label}»: SLA ${b.slaHours ?? "—"}ч → ${d.slaHours ?? "—"}ч`,
          jump: { row: "draft", key: d.key },
        })
      }
      if (Boolean(b.meetingRequired) !== Boolean(d.meetingRequired)) {
        out.push({
          id: `meeting:${d.key}`,
          tone: "edit",
          glyph: "✎",
          text: `«${d.label}»: встреча ${b.meetingRequired ? "была включена" : "не была обязательна"} → ${d.meetingRequired ? "обязательна" : "не обязательна"}`,
          jump: { row: "draft", key: d.key },
        })
      }
    }

    // Позиции: сравниваем порядок только общих этапов, чтобы вставка
    // нового этапа не рождала строку «↕» для каждой последующей карточки.
    const matchedBase = base.states.filter((s) => draftKeys.has(s.key)).map((s) => s.key)
    const matchedDraft = draft.states.filter((s) => baseKeys.has(s.key)).map((s) => s.key)
    matchedDraft.forEach((key, newIndex) => {
      const oldIndex = matchedBase.indexOf(key)
      if (oldIndex === newIndex) return
      const label = draft.states.find((s) => s.key === key)?.label ?? key
      out.push({
        id: `pos:${key}`,
        tone: "move",
        glyph: "↕",
        text: `«${label}»: позиция ${baseIndex(key) + 1} → ${draftIndex(key) + 1}`,
        jump: { row: "draft", key },
      })
    })

    const transitionKey = (t: { from: string; to: string }) => `${t.from}->${t.to}`
    const baseTransitions = new Set(base.transitions.map(transitionKey))
    const draftTransitions = new Set(draft.transitions.map(transitionKey))
    let changed = 0
    for (const key of baseTransitions) if (!draftTransitions.has(key)) changed += 1
    for (const key of draftTransitions) if (!baseTransitions.has(key)) changed += 1
    if (changed > 0) {
      out.push({
        id: "transitions",
        tone: "info",
        glyph: "⇄",
        text: `переходы изменены: ${changed}`,
      })
    }

    return out
  }, [base, diff, draft, engagementCounts, mapping])

  return (
    <section className="rounded-xl border bg-card p-4">
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Список изменений
        </h3>
        <span className="rounded-4xl border px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
          {rows.length}
        </span>
      </header>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Изменений нет — черновик совпадает с действующей редакцией.
        </p>
      ) : (
        <ul className="space-y-0.5">
          {rows.map((row) => {
            const body = (
              <>
                <span
                  aria-hidden
                  className={cn("w-4 shrink-0 text-center font-mono font-bold", TONE_CLASS[row.tone])}
                >
                  {row.glyph}
                </span>
                <span className="min-w-0 flex-1">{row.text}</span>
              </>
            )
            return (
              <li key={row.id}>
                {row.jump ? (
                  <button
                    type="button"
                    onClick={() => row.jump && onJump(row.jump.row, row.jump.key)}
                    title="Показать этап на канвасе"
                    className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs leading-snug transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  >
                    {body}
                  </button>
                ) : (
                  <div className="flex w-full items-start gap-2 px-2 py-1.5 text-xs leading-snug">
                    {body}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
