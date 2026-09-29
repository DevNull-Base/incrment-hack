import { useDroppable } from "@dnd-kit/core"
import { Plus } from "lucide-react"
import { cn } from "cn"

/** Что перетаскивается: блок из палитры (вставка) или этап (reorder). */
export type ZoneDrag = null | "tool" | "stage"

interface InsertZoneProps {
  /** Индекс после states[index]; null = в конец. */
  afterIndex: number | null
  onInsertClick: (afterIndex: number | null) => void
  /** Активный режим вставки (выбран блок в палитре) — зона подсвечивается. */
  armed: boolean
  disabled?: boolean
  disabledReason?: string
  /** gap — вертикальная щель между узлами канваса; bar — полоса в списке. */
  variant?: "gap" | "bar"
  /** Идёт drag: все зоны раскрываются, цвет плейсхолдера зависит от типа. */
  drag?: ZoneDrag
  /** Подсветка цели из баннера-инструкции. */
  spotlight?: boolean
  /** Режим «Сравнение»: только разделитель, вставка недоступна. */
  readOnly?: boolean
}

/**
 * Зона вставки между этапами. В покое — тонкая полоса (8px), при drag
 * или armed-режиме раскрывается в рамку будущей карточки: зелёную для
 * вставки из палитры, серую для reorder. Дроп из палитры (DnD) +
 * клик/клавиатура как fallback (тач, клавиатура).
 */
export function InsertZone({
  afterIndex,
  onInsertClick,
  armed,
  disabled = false,
  disabledReason,
  variant = "bar",
  drag = null,
  spotlight = false,
  readOnly = false,
}: InsertZoneProps) {
  const interactive = !readOnly && !disabled
  const { setNodeRef, isOver } = useDroppable({
    id: `insert-${afterIndex ?? "end"}`,
    disabled: !interactive,
  })
  const expanded = interactive && (armed || drag !== null || spotlight)
  const hovered = interactive && isOver

  const label = hovered
    ? drag === "stage"
      ? "Переместить сюда"
      : "Вставить здесь"
    : drag === "tool"
      ? "Новый этап"
      : drag === "stage"
        ? "Переместить"
        : "Вставить"

  return (
    <div
      ref={setNodeRef}
      role={interactive ? "button" : "presentation"}
      aria-hidden={!interactive}
      tabIndex={interactive ? 0 : -1}
      aria-label={interactive ? (hovered ? label : "Вставить этап сюда") : undefined}
      title={disabled ? disabledReason : "Вставить сюда"}
      onClick={() => interactive && onInsertClick(afterIndex)}
      onKeyDown={(e) => {
        if (!interactive) return
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onInsertClick(afterIndex)
        }
      }}
      className={cn(
        "group/zone relative flex shrink-0 items-center justify-center overflow-visible rounded-md border border-transparent transition-all duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        variant === "gap"
          ? expanded
            ? "w-16 self-stretch"
            : "w-2 self-stretch"
          : expanded
            ? "min-h-12 w-full"
            : "h-2 w-full",
        !interactive && "cursor-default bg-border/70",
        interactive && !expanded && "cursor-pointer bg-border/70 hover:bg-primary/40",
        expanded && drag === "tool" && !hovered && "border-dashed border-success/60 bg-success/10",
        expanded && drag === "stage" && !hovered && "border-dashed border-muted-foreground/50 bg-muted/70",
        expanded && drag === null && !hovered && "border-dashed border-primary/60 bg-primary/5",
        hovered && "border-primary bg-primary/10",
      )}
    >
      {expanded ? (
        <span
          className={cn(
            "px-1 text-center font-medium leading-tight",
            variant === "gap" ? "text-[9px]" : "text-[11px]",
            hovered
              ? "text-primary"
              : drag === "stage"
                ? "text-muted-foreground"
                : drag === "tool"
                  ? "text-success"
                  : "text-primary",
          )}
        >
          {label}
        </span>
      ) : interactive ? (
        <Plus className="absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity group-hover/zone:text-primary group-hover/zone:opacity-100" />
      ) : null}
    </div>
  )
}
