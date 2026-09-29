import { useDraggable, useDroppable } from "@dnd-kit/core"
import { ChevronDown, GripVertical, Square, Trash2 } from "lucide-react"
import { cn } from "cn"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { WorkflowStateDef } from "@/shared/api/workflow-definition"
import { genKey, TOOL_BLOCKS } from "@/shared/api/flow-editor-ops"
import { TOOL_ICONS } from "./toolIcons"

export type NodeDiffKind = "matched" | "added" | "removed" | "renamed"
/** Какая часть интерфейса подсвечивается инструкцией. */
export type NodeSpotlight = "order" | "props" | null

/** Маска ключа, которую принимает бэкенд (та же, что у parseDefinition). */
const KEY_MASK = /^[A-Z][A-Z0-9_]*$/

interface CanvasNodeProps {
  state: WorkflowStateDef
  diff: NodeDiffKind
  /** Ряд: base (верх, read-only) или draft (низ, редактируемый). */
  row: "base" | "draft"
  selected?: boolean
  engagementCount?: number
  oldLabel?: string
  invalid?: boolean
  onSelect?: () => void
  onRemove?: () => void
  /** false в режиме «Сравнение» — узел только просматривается. */
  interactive?: boolean
  /** Правка свойств раскрытого узла (label/key/SLA/тип). */
  onPatch?: (patch: Partial<WorkflowStateDef>) => void
  /** Все ключи черновика — для генерации уникального автоключа. */
  allKeys?: string[]
  /** Исходящих переходов: блокирует смену типа на «финальный». */
  outCount?: number
  spotlight?: NodeSpotlight
}

const DIFF_CLASS: Record<NodeDiffKind, string> = {
  matched: "border-border bg-card",
  added: "border-success/60 bg-success/5",
  removed: "border-destructive/60 bg-destructive/5",
  renamed: "border-info/60 bg-info/5",
}

/** Какой блок палитры соответствует текущим свойствам этапа. */
function typeIdOf(state: WorkflowStateDef): string {
  if (state.kind === "final") return "tool-final"
  if (state.meetingRequired) return "tool-meeting"
  if (state.slaHours === 48) return "tool-docs"
  return "tool-state"
}

/**
 * Узел этапа на канвасе. base-ряд — призрачный read-only; draft в режиме
 * «Редактирование» разворачивается аккордеоном с полями свойств, reorder
 * идёт за ручку, удаление — по hover-иконке (логически отдельно от правки).
 */
export function CanvasNode({
  state,
  diff,
  row,
  selected = false,
  engagementCount,
  oldLabel,
  invalid = false,
  onSelect,
  onRemove,
  interactive = false,
  onPatch,
  allKeys,
  outCount = 0,
  spotlight = null,
}: CanvasNodeProps) {
  const isBase = row === "base"
  const editable = !isBase && interactive
  const expanded = editable && selected
  const removable = editable && state.kind !== "initial"

  // id строк отличаются в рядах: base и draft содержат одни и те же ключи.
  const nodeData = { type: "stage", key: state.key }
  const { setNodeRef: setDragRef, listeners, attributes, isDragging } = useDraggable({
    id: `node:${row}:${state.key}`,
    data: nodeData,
    disabled: !editable,
  })
  const { setNodeRef: setDropRef } = useDroppable({
    id: `drop:${row}:${state.key}`,
    data: nodeData,
    disabled: !editable,
  })
  const setRefs = (el: HTMLDivElement | null) => {
    setDragRef(el)
    setDropRef(el)
  }

  const keyValid = KEY_MASK.test(state.key)
  const duplicate = (allKeys ?? []).filter((k) => k === state.key).length > 1
  const activeToolId = typeIdOf(state)
  const finalBlocked = outCount > 0

  return (
    <div
      ref={setRefs}
      data-center-key={`${row}:${state.key}`}
      className={cn(
        "group/node relative flex w-44 shrink-0 flex-col gap-1.5 rounded-lg border p-3 transition-all duration-150",
        DIFF_CLASS[diff],
        isBase && "opacity-65",
        selected && editable && "ring-2 ring-primary/50",
        invalid && "ring-2 ring-destructive/60",
        expanded && "w-72",
        spotlight === "props" && "spotlight-ring",
        isDragging && "opacity-40",
        editable && !expanded && "cursor-pointer hover:-translate-y-0.5 hover:shadow-md",
        "focus-visible:outline-none",
      )}
      onClick={(e) => {
        if (!editable) return
        const target = e.target as HTMLElement
        if (target !== e.currentTarget && target.closest("button, input, select, textarea, label, a")) return
        onSelect?.()
      }}
      onKeyDown={(e) => {
        if (!editable || e.target !== e.currentTarget) return
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onSelect?.()
        }
      }}
      tabIndex={editable ? 0 : -1}
      role={isBase ? "img" : editable ? (expanded ? "group" : "button") : "img"}
      aria-label={`Этап: ${state.label}`}
      aria-expanded={editable ? expanded : undefined}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {state.order}
        </span>
        <span className="flex flex-wrap items-center justify-end gap-1">
          {state.kind === "initial" && <Badge variant="outline">старт</Badge>}
          {state.kind === "final" && <Badge variant="secondary">финал</Badge>}
          {diff === "added" && (
            <Badge className="border-success/40 bg-success/10 text-success" variant="outline">
              новый
            </Badge>
          )}
          {diff === "renamed" && (
            <Badge className="border-info/40 bg-info/10 text-info" variant="outline">
              переименован
            </Badge>
          )}
          {diff === "removed" && engagementCount !== undefined && engagementCount > 0 && (
            <Badge variant="destructive">{engagementCount} заявок</Badge>
          )}
        </span>
      </span>

      <span className="text-sm font-medium leading-snug">{state.label}</span>

      {oldLabel && (
        <span className="truncate text-[11px] text-muted-foreground">было: «{oldLabel}»</span>
      )}

      <span className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
        {state.slaHours !== undefined && <span>SLA {state.slaHours}ч</span>}
        {state.meetingRequired && <span>встреча</span>}
        {state.kind === "final" && <span>завершает процесс</span>}
        {diff === "removed" && isBase && <span className="text-destructive">будет удалён</span>}
        {diff === "added" && !isBase && <span className="text-success">добавлен в черновик</span>}
      </span>

      {/* Аккордеон свойств — только draft в режиме «Редактирование» */}
      {expanded && onPatch && (
        <div
          className="mt-1 space-y-2 border-t border-border/70 pt-2"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <span className="flex items-center justify-between">
            <span className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
              <ChevronDown className="size-3" aria-hidden /> Свойства
            </span>
            <button
              type="button"
              onClick={() => onSelect?.()}
              className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Свернуть
            </button>
          </span>

          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">Название</span>
            <Input
              value={state.label}
              onChange={(e) => onPatch({ label: e.target.value })}
              className="h-7 w-full rounded-md border bg-transparent px-2 text-sm"
            />
          </label>

          <div className="space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">Ключ</span>
            <span className="flex gap-1">
              <Input
                value={state.key}
                aria-invalid={state.key !== "" && (!keyValid || duplicate)}
                onChange={(e) => onPatch({ key: e.target.value })}
                className="h-7 min-w-0 flex-1 rounded-md border bg-transparent px-2 font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="xs"
                title="Сгенерировать ключ транслитом из названия"
                onClick={() =>
                  onPatch({ key: genKey(state.label, (allKeys ?? []).filter((k) => k !== state.key)) })
                }
              >
                Автоключ
              </Button>
            </span>
            {!keyValid && state.key !== "" && (
              <p className="text-[10px] text-destructive">
                Формат: заглавная A–Z, далее A–Z, 0–9 и «_»
              </p>
            )}
            {duplicate && <p className="text-[10px] text-destructive">Такой ключ уже занят</p>}
            <p className="text-[10px] leading-snug text-muted-foreground">
              Ключ создаётся транслитом от названия — можно править вручную.
            </p>
          </div>

          {state.kind === "normal" && (
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">SLA, ч</span>
              <Input
                type="number"
                min={0}
                value={state.slaHours ?? ""}
                onChange={(e) =>
                  onPatch({ slaHours: e.target.value === "" ? undefined : Number(e.target.value) })
                }
                className="h-7 w-24 rounded-md border bg-transparent px-2 text-xs tabular-nums"
              />
            </label>
          )}

          {state.kind !== "initial" && (
            <div className="space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">Тип этапа</span>
              <span className="flex flex-wrap gap-1">
                {TOOL_BLOCKS.map((block) => {
                  const Icon = TOOL_ICONS[block.id] ?? Square
                  const active = activeToolId === block.id
                  const blocked = block.payload.kind === "final" && finalBlocked
                  return (
                    <button
                      key={block.id}
                      type="button"
                      disabled={blocked}
                      title={
                        blocked
                          ? "Сначала уберите исходящие переходы этого этапа"
                          : `${block.label} — ${block.description}`
                      }
                      aria-pressed={active}
                      onClick={() =>
                        onPatch({
                          kind: block.payload.kind,
                          meetingRequired: block.payload.meetingRequired ?? false,
                          slaHours: block.payload.slaHours,
                        })
                      }
                      className={cn(
                        "flex items-center gap-1 rounded-md border px-1.5 py-1 text-[11px] font-medium transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                        active
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                        blocked && "cursor-not-allowed opacity-50 hover:bg-transparent",
                      )}
                    >
                      <Icon className="size-3.5" />
                      {block.label.replace(/^Этап /, "")}
                    </button>
                  )
                })}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Иконки действий: reorder — за ручку, удаление — отдельно, по hover */}
      {editable && (
        <span
          className={cn(
            "absolute -right-2 -top-2 flex gap-1 opacity-0 transition-opacity group-hover/node:opacity-100 focus-within/node:opacity-100",
            spotlight === "order" && "opacity-100",
          )}
          title={state.kind === "initial" ? "Стартовый этап нельзя удалить" : undefined}
        >
          <button
            type="button"
            {...listeners}
            {...attributes}
            aria-label={`Переместить этап ${state.label}`}
            title="Перетащите, чтобы изменить порядок"
            className={cn(
              "flex size-6 cursor-grab touch-none items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:text-foreground active:cursor-grabbing",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
            )}
          >
            <GripVertical className="size-3" />
          </button>
          <button
            type="button"
            disabled={!removable}
            aria-disabled={!removable}
            aria-label={`Удалить этап ${state.label}`}
            title={removable ? "Удалить этап" : "Стартовый этап нельзя удалить"}
            onClick={(e) => {
              e.stopPropagation()
              if (removable) onRemove?.()
            }}
            className={cn(
              "flex h-6 items-center gap-0.5 rounded-full border border-destructive/40 bg-card px-1.5 text-destructive shadow-sm transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
              removable
                ? "hover:bg-destructive hover:text-destructive-foreground"
                : "cursor-not-allowed border-border text-muted-foreground opacity-60",
            )}
          >
            <Trash2 className="size-3" />
            {!isBase && engagementCount !== undefined && engagementCount > 0 && (
              <span className="text-[10px] font-bold tabular-nums">{engagementCount}</span>
            )}
          </button>
        </span>
      )}
      {selected && editable && (
        <span className="absolute -left-1 -top-1 size-2 rounded-full bg-primary" aria-hidden />
      )}
    </div>
  )
}
