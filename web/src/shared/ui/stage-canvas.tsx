import * as React from "react"
import { cn } from "cn"
import { Check } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./dialog"
import { Button } from "./button"
import { Input } from "./input"

export type NodeStatus = "completed" | "in_progress" | "not_started" | "blocked"

export interface GraphNode {
  id: string
  label: string
  step: number
  status: NodeStatus
  description?: string
  date?: string
  assignee?: string
  notes?: string
}

// ========================================
// StageCanvas — вставляемый холст этапов взаимодействия:
// колесо = горизонтальная прокрутка, перетаскивание = панорама,
// клик по этапу = модалка с описанием
// ========================================
export interface StageCanvasProps {
  nodes: GraphNode[]
  onNodeClick?: (node: GraphNode) => void
  /** Если задан — в модалке этапа появляется поле заметки и кнопка «Добавить». */
  onAddNote?: (node: GraphNode, body: string) => void
  className?: string
}

const NODE_STATUS: Record<NodeStatus, string> = {
  completed: "border-success/40 bg-success/5",
  in_progress: "border-primary/50 bg-primary/5 ring-2 ring-primary/20",
  not_started: "border-border bg-muted/40 text-muted-foreground",
  blocked: "border-destructive/40 bg-destructive/5",
}

const STATUS_LABEL: Record<NodeStatus, string> = {
  completed: "Завершён",
  in_progress: "Текущий этап",
  not_started: "Не начат",
  blocked: "Просрочен",
}

export function StageCanvas({ nodes, onNodeClick, onAddNote, className }: StageCanvasProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const dragRef = React.useRef<{ startX: number; startScroll: number } | null>(null)
  const [dragging, setDragging] = React.useState(false)
  const [selected, setSelected] = React.useState<GraphNode | null>(null)
  const [noteDraft, setNoteDraft] = React.useState("")

  // Колесо мыши → горизонтальная прокрутка холста
  React.useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      el.scrollLeft += e.deltaY + e.deltaX
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [])

  // Панорама перетаскиванием (только по фону, клики по этапам не гасим)
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest("[data-node]")) return
    e.preventDefault()
    dragRef.current = {
      startX: e.clientX,
      startScroll: scrollRef.current?.scrollLeft ?? 0,
    }
    setDragging(true)
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    const d = dragRef.current
    if (!d || !scrollRef.current) return
    scrollRef.current.scrollLeft = d.startScroll - (e.clientX - d.startX)
  }

  const handleDragEnd = () => {
    dragRef.current = null
    setDragging(false)
  }

  if (nodes.length === 0) {
    return (
      <div
        className={cn(
          "flex h-40 items-center justify-center rounded-xl border bg-muted/20 text-sm text-muted-foreground",
          className,
        )}
      >
        Нет этапов для отображения
      </div>
    )
  }

  return (
    <div className={cn("relative", className)}>
      <div
        ref={scrollRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleDragEnd}
        onMouseLeave={handleDragEnd}
        className={cn(
          "relative h-72 overflow-x-auto overflow-y-hidden rounded-xl border bg-muted/20 select-none",
          dragging ? "cursor-grabbing" : "cursor-grab",
        )}
      >
        <div className="flex h-full min-w-max items-center px-4 py-5">
            {nodes.map((node, i) => (
              <React.Fragment key={node.id}>
                {i > 0 && (
                  <div
                    className={cn(
                      "h-0 w-10 shrink-0 border-t-2 border-dashed",
                      nodes[i - 1].status === "completed"
                        ? "border-primary/50"
                        : "border-border",
                    )}
                  />
                )}
                <button
                  type="button"
                  data-node
                  onClick={() => {
                    setNoteDraft("")
                    setSelected(node)
                    if (onNodeClick) onNodeClick(node)
                  }}
                  className={cn(
                    "group flex w-40 shrink-0 flex-col gap-1.5 rounded-lg border p-3 text-left",
                    "chart-fade transition-all duration-150 ease-out hover:-translate-y-0.5 hover:shadow-md",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                    NODE_STATUS[node.status],
                    i === 0 && "ml-2",
                    i === nodes.length - 1 && "mr-2",
                  )}
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold tracking-[0.14em] uppercase opacity-70">
                      Этап {node.step}
                    </span>
                    {node.status === "completed" && (
                      <Check className="size-3.5 text-success" />
                    )}
                    {node.status === "in_progress" && (
                      <span className="size-2 rounded-full bg-primary motion-safe:animate-pulse" />
                    )}
                    {node.status === "blocked" && (
                      <span className="text-[10px] font-medium text-destructive">
                        просрочен
                      </span>
                    )}
                  </span>
                  <span className="text-sm leading-snug font-medium">
                    {node.label}
                  </span>
                </button>
              </React.Fragment>
            ))}
        </div>
      </div>

      {/* Модалка этапа */}
      <Dialog
        open={selected != null}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null)
            setNoteDraft("")
          }
        }}
      >
        <DialogContent className="rounded-xl sm:max-w-md">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>{selected.label}</DialogTitle>
                <DialogDescription>
                  Этап {selected.step} · {STATUS_LABEL[selected.status]}
                </DialogDescription>
              </DialogHeader>
              <p className="text-sm leading-relaxed text-foreground">
                {selected.description ?? "Описание этапа не заполнено"}
              </p>
              {selected.date && (
                <p className="text-xs text-muted-foreground">
                  Дата: {selected.date}
                </p>
              )}
              {selected.assignee && (
                <p className="text-xs text-muted-foreground">
                  Ответственный: {selected.assignee}
                </p>
              )}
              {selected.notes && (
                <p className="text-xs text-muted-foreground">Заметки: {selected.notes}</p>
              )}
              {onAddNote && (
                <div className="space-y-2 border-t pt-3">
                  <Input
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    placeholder="Заметка к этапу…"
                    className="h-9"
                  />
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={!noteDraft.trim()}
                    onClick={() => {
                      if (!selected) return
                      onAddNote(selected, noteDraft.trim())
                      setNoteDraft("")
                    }}
                  >
                    Добавить
                  </Button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
