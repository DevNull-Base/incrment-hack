import { useEffect, useState } from "react"
import { Info, X } from "lucide-react"
import { cn } from "cn"
import { useWorkspaceState } from "@/shared/lib/workspace"
import type { NodeSpotlight } from "./CanvasNode"

export type SpotlightTarget = NodeSpotlight | "insert"

interface EditorHintBannerProps {
  /** Передаёт подсвечиваемую часть UI наверх, в редактор. */
  onSpotlight: (target: SpotlightTarget | null) => void
}

const STEPS: { id: Exclude<SpotlightTarget, null>; title: string; body: string }[] = [
  {
    id: "order",
    title: "Порядок",
    body: "перетащите карточку этапа за ручку в нужное место.",
  },
  {
    id: "insert",
    title: "Новый этап",
    body: "возьмите блок в палитре «Инструменты» и бросьте в полосу между этапами — или выберите блок и кликните полосу.",
  },
  {
    id: "props",
    title: "Свойства",
    body: "кликните по карточке этапа — раскроются название, ключ и SLA.",
  },
]

/**
 * Контекстная инструкция режима «Редактирование»: показывается при первом
 * входе, скрывается через workspace-state (localStorage в демо, сервер в API).
 * Наведение на шаг подсвечивает реальный элемент интерфейса.
 */
export function EditorHintBanner({ onSpotlight }: EditorHintBannerProps) {
  const [state, setState, loaded] = useWorkspaceState<{ hidden: boolean }>(
    "flow-editor.hint",
    { hidden: false },
  )
  const [hovered, setHovered] = useState<SpotlightTarget | null>(null)
  const [sticky, setSticky] = useState<Exclude<SpotlightTarget, null> | null>(null)
  const active = hovered ?? sticky

  useEffect(() => {
    onSpotlight(active)
  }, [active, onSpotlight])

  // При уходе из режима «Редактирование» подсветка не должна остаться.
  useEffect(() => () => onSpotlight(null), [onSpotlight])

  if (!loaded || state.hidden) return null

  return (
    <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/5 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
      <Info className="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="mb-1.5 font-medium text-foreground">
          Как работать с редактором — наведите на шаг, чтобы подсветить элемент:
        </p>
        <ol className="flex flex-wrap gap-1.5">
          {STEPS.map((step, i) => (
            <li key={step.id}>
              <button
                type="button"
                onMouseEnter={() => setHovered(step.id)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(step.id)}
                onBlur={() => setHovered(null)}
                onClick={() => setSticky((cur) => (cur === step.id ? null : step.id))}
                aria-pressed={sticky === step.id}
                className={cn(
                  "flex max-w-full items-start gap-1.5 rounded-md border px-2 py-1 text-left transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                  active === step.id
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-transparent bg-card/70 hover:border-border hover:bg-card",
                )}
              >
                <span className="font-mono text-[10px] font-bold text-primary">{i + 1}</span>
                <span className="min-w-0">
                  <b className="font-semibold text-foreground">{step.title}:</b> {step.body}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
      <button
        type="button"
        onClick={() => setState({ hidden: true })}
        aria-label="Скрыть подсказку"
        className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
