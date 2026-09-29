import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Interaction } from "@/types"
import { Plus, GripVertical } from "lucide-react"
import { useStore } from "@/app/store"
import { selectInteractions } from "@/app/store/selectors"
import { toast } from "@/shared/lib/toast-store"
import { dataSource } from "@/shared/config"
import { useStages } from "@/app/use-stages"
import { kanbanGroups, stageProgress, type StageGroup, type StageInfo } from "@/app/workflow-stages"
import { TransitionDialog, type PendingTransition } from "@/components/TransitionDialog"
import { CreateEngagementDialog } from "@/components/CreateEngagementDialog"
import { InteractionFiltersBar } from "@/components/InteractionFiltersBar"
import {
  EMPTY_INTERACTION_FILTERS,
  FILTER_URL_KEYS,
  filterInteractions,
  type InteractionFilters,
} from "@/app/interaction-filters"
import { useWorkspaceState } from "@/shared/lib/workspace"

const GROUP_TONES: Record<StageGroup["tone"], { color: string; headerColor: string }> = {
  sky: {
    color: "bg-sky-50 dark:bg-sky-950/30 border-sky-200 dark:border-sky-800/30",
    headerColor: "text-sky-700 dark:text-sky-300",
  },
  amber: {
    color: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/30",
    headerColor: "text-amber-700 dark:text-amber-300",
  },
  emerald: {
    color: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/30",
    headerColor: "text-emerald-700 dark:text-emerald-300",
  },
  violet: {
    color: "bg-violet-50 dark:bg-violet-950/30 border-violet-200 dark:border-violet-800/30",
    headerColor: "text-violet-700 dark:text-violet-300",
  },
  slate: {
    color: "bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-700/40",
    headerColor: "text-slate-600 dark:text-slate-300",
  },
}

const isApi = dataSource === "api"

export function InteractionsPage() {
  const interactions = useStore(selectInteractions)
  const moveInteraction = useStore((s) => s.moveInteraction)
  const loadEngagement = useStore((s) => s.loadEngagement)
  const performTransition = useStore((s) => s.performTransition)
  const products = useStore((s) => s.products)
  const [activeId, setActiveId] = useState<string | null>(null)
  // Сегмент и фильтры — рабочий контекст (ТЗ, п. 13): переживают
  // перезагрузку и открываются такими же на другом устройстве.
  const [board, setBoard, boardLoaded] = useWorkspaceState<{ segment: "B2B" | "B2C"; filters: InteractionFilters }>(
    "interactions.board",
    { segment: "B2B", filters: EMPTY_INTERACTION_FILTERS },
  )
  const segment = board.segment
  const filters = { ...EMPTY_INTERACTION_FILTERS, ...board.filters }
  const setSegment = (next: "B2B" | "B2C") =>
    setBoard((prev) => ({ segment: next, filters: { ...prev.filters, universityId: "", stateKey: "" } }))
  const setFilters = (next: InteractionFilters) => setBoard((prev) => ({ ...prev, filters: next }))
  const [searchParams, setSearchParams] = useSearchParams()
  const archivedIds = useStore((s) => s.archivedIds)
  const dragStart = useRef<{ id: string; stage: string } | null>(null)
  const [pending, setPending] = useState<PendingTransition | null>(null)
  const [busy, setBusy] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const stages = useStages(segment)
  const groups = kanbanGroups(stages, segment)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  )

  // Переход с отбором по ссылке (поиск в шапке, карточки продукта и вуза):
  // параметры ссылки заменяют сохранённые фильтры и убираются из адреса.
  useEffect(() => {
    if (!boardLoaded) return
    const fromUrl = Object.fromEntries(
      FILTER_URL_KEYS.flatMap((key) => {
        const value = searchParams.get(key)
        return value ? [[key, value]] : []
      }),
    ) as Partial<InteractionFilters>
    if (Object.keys(fromUrl).length === 0) return
    const universityLinked = Boolean(fromUrl.universityId)
    setBoard((prev) => ({
      segment: universityLinked ? "B2B" : prev.segment,
      filters: { ...EMPTY_INTERACTION_FILTERS, ...fromUrl },
    }))
    setSearchParams({}, { replace: true })
  }, [boardLoaded, searchParams, setSearchParams, setBoard])

  const activeInteraction = activeId ? interactions.find((i) => i.id === activeId) : null
  const segmentAll = interactions.filter((i) => i.segment === segment && !archivedIds.includes(i.id))
  const productNames = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products])
  const segmentInteractions = filterInteractions(segmentAll, filters, productNames)

  function handleDragStart(event: DragStartEvent) {
    const id = event.active.id as string
    setActiveId(id)
    const stage = interactions.find((i) => i.id === id)?.currentStateKey
    dragStart.current = stage ? { id, stage } : null
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event
    if (!over) return

    const activeId = active.id as string
    const overId = over.id as string

    // Check if dropping over a column (stage key) or another card
    const targetStage =
      stages.find((s) => s.key === overId)?.key ||
      interactions.find((i) => i.id === overId)?.currentStateKey

    if (!targetStage) return

    moveInteraction(activeId, targetStage)
  }

  /** Отказ бэкенда — карточка возвращается на исходный этап. */
  const rollback = (id: string, stage: string, error: string) => {
    moveInteraction(id, stage)
    toast.error("Этап не изменён", error)
  }

  async function commitMove(id: string, fromStage: string, toStage: string) {
    // Карточка перечитывается: нужна свежая версия и доступные переходы.
    const detail = await loadEngagement(id)
    if (!detail) return rollback(id, fromStage, "Карточка недоступна")
    const transition = detail.availableTransitions.find((t) => t.toStateKey === toStage)
    if (!transition) {
      return rollback(id, fromStage, `Из этапа «${detail.currentStateLabel}» нельзя перейти в выбранный`)
    }
    if (!transition.allowed) {
      return rollback(id, fromStage, transition.blockedReason ?? "Переход сейчас недоступен")
    }
    // Перечитанная карточка вернула её на исходный этап — пока идёт
    // подтверждение, показываем её там, куда её перенесли.
    moveInteraction(id, toStage)
    // Подтверждение с комментарием — всегда: переход фиксируется в журнале.
    setPending({
      engagementId: id,
      toStateKey: toStage,
      label: transition.label,
      fromLabel: detail.currentStateLabel,
      toLabel: transition.toStateLabel,
      requiresComment: transition.requiresComment,
    })
  }

  function handleDragEnd(event: DragEndEvent) {
    const id = event.active.id as string
    const interaction = interactions.find((i) => i.id === id)
    const start = dragStart.current
    if (interaction && start && interaction.currentStateKey !== start.stage) {
      if (isApi) {
        void commitMove(id, start.stage, interaction.currentStateKey)
      } else {
        const stage = stages.find((s) => s.key === interaction.currentStateKey)
        toast.success("Этап обновлён", stage?.label ?? interaction.currentStateLabel)
      }
    }
    dragStart.current = null
    setActiveId(null)
  }

  const cancelPending = () => {
    if (!pending) return
    const original = interactions.find((i) => i.id === pending.engagementId)
    const detail = useStore.getState().engagementDetails[pending.engagementId]
    if (original && detail) moveInteraction(original.id, detail.currentStateKey)
    setPending(null)
  }

  const confirmPending = async (comment: string) => {
    if (!pending) return
    setBusy(true)
    const result = await performTransition(pending.engagementId, pending.toStateKey, comment)
    setBusy(false)
    if (result.ok) {
      toast.success("Этап обновлён", pending.toLabel)
      setPending(null)
    } else {
      toast.error("Этап не изменён", result.error)
      cancelPending()
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Взаимодействия</h1>
          <p className="text-sm text-muted-foreground">
            Kanban-доска: перетаскивайте карточки между этапами
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1 rounded-lg border p-1">
            {(["B2B", "B2C"] as const).map((seg) => (
              <button
                key={seg}
                type="button"
                onClick={() => setSegment(seg)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  segment === seg
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {seg}
              </button>
            ))}
          </div>
          <Button size="sm" onClick={() => isApi && setCreateOpen(true)}>
            <Plus className="size-4" />
            Новое
          </Button>
        </div>
      </div>

      <InteractionFiltersBar
        segment={segment}
        interactions={segmentAll}
        stages={stages}
        filters={filters}
        onChange={setFilters}
        shown={segmentInteractions.length}
        total={segmentAll.length}
      />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="space-y-6">
          {groups.map((group) => (
            <div key={group.title}>
              <h2 className={cn("text-sm font-semibold mb-3 pl-1", GROUP_TONES[group.tone].headerColor)}>
                {group.title}
              </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {group.stages.map((stage) => {
                  const stageInteractions = segmentInteractions.filter(
                    (i) => i.currentStateKey === stage.key,
                  )

                  return (
                    <SortableContext
                      key={stage.key}
                      id={stage.key}
                      items={stageInteractions.map((i) => i.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <KanbanColumn
                        stage={stage}
                        interactions={stageInteractions}
                        groupColor={GROUP_TONES[group.tone].color}
                        stages={stages}
                      />
                    </SortableContext>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        <DragOverlay dropAnimation={{ duration: 250, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' }}>
          {activeInteraction ? (
            <KanbanCard interaction={activeInteraction} stages={stages} isDragging />
          ) : null}
        </DragOverlay>
      </DndContext>

      <TransitionDialog
        pending={pending}
        busy={busy}
        onCancel={cancelPending}
        onConfirm={(comment) => void confirmPending(comment)}
      />
      <CreateEngagementDialog open={createOpen} onOpenChange={setCreateOpen} defaultSegment={segment} />
    </div>
  )
}

// ========================================
// Kanban Column
// ========================================

function KanbanColumn({
  stage,
  interactions: stageItems,
  groupColor,
  stages,
}: {
  stage: StageInfo
  interactions: Interaction[]
  groupColor: string
  stages: StageInfo[]
}) {
  const { setNodeRef, isOver } = useSortable({
    id: stage.key,
    data: { type: "column", stage: stage.key },
  })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col rounded-xl border p-2.5 min-h-[180px] max-h-[50vh] transition-[background-color,border-color] duration-200",
        groupColor,
        isOver && "ring-2 ring-primary/30",
      )}
    >
      {/* Column header */}
      <div className="flex items-center justify-between px-1 mb-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-mono text-muted-foreground/50 bg-background/50 rounded px-1.5 py-0.5 shrink-0">
            {stage.step}
          </span>
          <span className="text-xs font-medium text-foreground/80 truncate">{stage.label}</span>
        </div>
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5 min-w-[20px] justify-center shrink-0">
          {stageItems.length}
        </Badge>
      </div>

      {/* Cards — скроллятся внутри колонки, шапка остаётся на месте */}
      <div className="space-y-2 flex-1 min-h-0 overflow-y-auto pr-1">
        {stageItems.map((item) => (
          <KanbanCard key={item.id} interaction={item} stages={stages} />
        ))}
        {stageItems.length === 0 && (
          <div className="flex items-center justify-center h-20 rounded-lg border border-dashed border-muted-foreground/15 text-[11px] text-muted-foreground/30">
            Перетащите сюда
          </div>
        )}
      </div>
    </div>
  )
}

// ========================================
// Kanban Card
// ========================================

function KanbanCard({
  interaction,
  stages,
  isDragging = false,
}: {
  interaction: Interaction
  stages: StageInfo[]
  isDragging?: boolean
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({
    id: interaction.id,
    data: { type: "card", interaction },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? 'transform 250ms cubic-bezier(0.25, 1, 0.5, 1)',
  }

  // B2C-взаимодействие — со слушателем или компанией, вуза у него нет.
  const title = interaction.universityShortName ?? interaction.counterpartyName
  const { pct } = stageProgress(stages, interaction.currentStateKey)

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "group rounded-lg border bg-card p-3 cursor-grab active:cursor-grabbing",
        "hover:shadow-md hover:border-primary/20 transition-[shadow,border-color]",
        (isDragging || isSortableDragging) && "shadow-xl border-primary/40 scale-[1.03] z-50",
        isSortableDragging && !isDragging && "opacity-40 scale-[0.97]",
        isDragging && "rotate-[1.5deg]",
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <Link
          to={`/interactions/${interaction.id}`}
          className="text-sm font-semibold hover:text-primary transition-colors truncate"
          onClick={(e) => e.stopPropagation()}
        >
          {title}
        </Link>
        <GripVertical className="size-3.5 text-muted-foreground/30 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      {/* Tags */}
      <div className="flex flex-wrap gap-1 mb-2.5">
        <span className="inline-flex items-center rounded-md bg-primary/8 text-primary text-[10px] font-medium px-1.5 py-0.5">
          {interaction.directionName?.split(" ").slice(0, 2).join(" ")}
        </span>
        {interaction.productName && (
          <span className="inline-flex items-center rounded-md bg-muted text-muted-foreground text-[10px] font-medium px-1.5 py-0.5">
            {interaction.productName.split(" ").slice(0, 2).join(" ")}
          </span>
        )}
        {interaction.isOverdue && (
          <span className="inline-flex items-center rounded-md bg-destructive/10 text-destructive text-[10px] font-medium px-1.5 py-0.5">
            Просрочено
          </span>
        )}
      </div>

      {/* Progress */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              pct === 100 ? "bg-success" : "bg-primary",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[10px] font-mono text-muted-foreground">{pct}%</span>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
        <span className="text-[10px] text-muted-foreground truncate">
          {interaction.ownerName.split(" ").slice(0, 2).join(" ")}
        </span>
        <span className="text-[10px] text-muted-foreground/50">
          {new Date(interaction.updatedAt).toLocaleDateString("ru-RU")}
        </span>
      </div>
    </div>
  )
}
