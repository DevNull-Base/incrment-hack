import { useDraggable } from "@dnd-kit/core"
import { Square } from "lucide-react"
import { cn } from "cn"
import { TOOL_BLOCKS, type ToolBlock } from "@/shared/api/flow-editor-ops"
import { TOOL_ICONS } from "./toolIcons"

interface ToolButtonProps {
  block: ToolBlock
  armed: boolean
  onArm: (block: ToolBlock | null) => void
}

function ToolButton({ block, armed, onArm }: ToolButtonProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: block.id,
    data: { type: "tool", block },
  })
  const Icon = TOOL_ICONS[block.id] ?? Square

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      {...attributes}
      onClick={() => onArm(armed ? null : block)}
      title={`${block.label} — перетащите в разрыв или выберите и кликните место`}
      aria-pressed={armed}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg border p-2.5 text-left transition-all duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm",
        armed ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border bg-card",
        isDragging && "opacity-40",
      )}
    >
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold leading-tight">{block.label}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
          {block.description}
        </span>
      </span>
    </button>
  )
}

interface ToolPaletteProps {
  armed: ToolBlock | null
  onArm: (block: ToolBlock | null) => void
  /** Подсветка палитры из баннера-инструкции. */
  spotlight?: boolean
}

/** Палитра tool-blocks: drag на канвас/в список или выбор кликом. */
export function ToolPalette({ armed, onArm, spotlight = false }: ToolPaletteProps) {
  return (
    <div className={cn("space-y-2", spotlight && "spotlight-ring")}>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Готовые блоки
        </h3>
        {armed && (
          <button
            type="button"
            onClick={() => onArm(null)}
            className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Отменить выбор
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        {TOOL_BLOCKS.map((b) => (
          <ToolButton key={b.id} block={b} armed={armed?.id === b.id} onArm={onArm} />
        ))}
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        Перетащите блок в разрыв между этапами — или выберите блок и кликните разрыв.
      </p>
    </div>
  )
}

/** Превью перетаскиваемого блока в DragOverlay. */
export function ToolDragPreview({ block }: { block: ToolBlock }) {
  const Icon = TOOL_ICONS[block.id] ?? Square
  return (
    <div className="flex items-center gap-2 rounded-lg border border-primary bg-card px-3 py-2 shadow-lg">
      <Icon className="size-4 text-primary" />
      <span className="text-xs font-semibold">{block.label}</span>
    </div>
  )
}
