import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Calendar, GripVertical, Trash2 } from "lucide-react"
import { cn } from "cn"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { WorkflowStateDef } from "@/shared/api/workflow-definition"
import type { NodeSpotlight } from "./CanvasNode"

interface StageListItemProps {
  state: WorkflowStateDef
  added: boolean
  /** Сколько заявок на этапе — бейдж на кнопке удаления. */
  engagementCount?: number
  invalid?: string
  selected: boolean
  outCount: number
  onSelect: () => void
  onPatch: (patch: Partial<WorkflowStateDef>) => void
  onRemove: () => void
  spotlight?: NodeSpotlight
}

/** Строка списка этапов: drag-порядок + инлайн-правка свойств. */
export function StageListItem({
  state,
  added,
  engagementCount,
  invalid,
  selected,
  outCount,
  onSelect,
  onPatch,
  onRemove,
  spotlight = null,
}: StageListItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: state.key,
    data: { type: "stage" },
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group/row relative flex items-start gap-2 rounded-lg border bg-card p-3",
        selected && "ring-2 ring-primary/50",
        invalid && "border-destructive/60",
        isDragging && "z-10 shadow-xl opacity-90",
        spotlight === "props" && "spotlight-ring",
      )}
      onClick={onSelect}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Переместить этап ${state.label}`}
        title="Перетащите, чтобы изменить порядок"
        className={cn(
          "mt-1 flex size-7 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground transition-all hover:bg-muted hover:text-foreground hover:ring-2 hover:ring-primary/30 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
          spotlight === "order" && "spotlight-ring",
        )}
      >
        <GripVertical className="size-4" />
      </button>

      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="w-8 justify-center tabular-nums">
            {state.order}
          </Badge>
          <Input
            value={state.label}
            onChange={(e) => onPatch({ label: e.target.value })}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Название этапа ${state.label}`}
            className="h-8 w-56 rounded-md border bg-transparent px-2 text-sm font-medium"
          />
          <Input
            value={state.key}
            onChange={(e) => onPatch({ key: e.target.value })}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Ключ этапа ${state.key}`}
            className="h-8 w-44 rounded-md border bg-transparent px-2 font-mono text-xs"
          />
          <Badge
            variant={state.kind === "initial" ? "default" : state.kind === "final" ? "secondary" : "outline"}
          >
            {state.kind === "initial" ? "старт" : state.kind === "final" ? "финал" : "обычный"}
          </Badge>
          {added && (
            <Badge className="border-success/40 bg-success/10 text-success" variant="outline">
              новый
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          <label className="flex items-center gap-1.5">
            SLA, ч
            <Input
              type="number"
              min={0}
              value={state.slaHours ?? ""}
              onChange={(e) =>
                onPatch({ slaHours: e.target.value === "" ? undefined : Number(e.target.value) })
              }
              onClick={(e) => e.stopPropagation()}
              aria-label={`SLA этапа ${state.label} в часах`}
              className="h-7 w-16 rounded-md border bg-transparent px-1.5 text-xs tabular-nums"
            />
          </label>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={state.meetingRequired ?? false}
              onChange={(e) => onPatch({ meetingRequired: e.target.checked })}
              onClick={(e) => e.stopPropagation()}
              className="size-3.5 accent-primary"
            />
            <Calendar className="size-3.5" />
            встреча обязательна
          </label>
          <span className="flex items-center gap-1.5">
            исходящих переходов: <b className="tabular-nums">{outCount}</b>
          </span>
        </div>

        {invalid && <p className="text-[11px] text-destructive">{invalid}</p>}
      </div>

      <span
        className="mt-0.5 flex"
        title={state.kind === "initial" ? "Стартовый этап нельзя удалить" : "Удалить этап"}
      >
        <Button
          variant="ghost"
          size="sm"
          disabled={state.kind === "initial"}
          aria-label={`Удалить этап ${state.label}`}
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className={cn(
            "rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100",
            state.kind !== "initial" && "hover:text-destructive",
          )}
        >
          <Trash2 className="size-4" />
          {state.kind !== "initial" && engagementCount !== undefined && engagementCount > 0 && (
            <span className="ml-0.5 rounded-full bg-destructive px-1 text-[10px] font-bold tabular-nums text-destructive-foreground">
              {engagementCount}
            </span>
          )}
        </Button>
      </span>
    </div>
  )
}
