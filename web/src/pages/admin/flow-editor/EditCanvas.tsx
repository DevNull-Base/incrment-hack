import { Fragment } from "react"
import type { WorkflowDefinitionV1, WorkflowStateDef } from "@/shared/api/workflow-definition"
import { CanvasNode, type NodeSpotlight } from "./CanvasNode"
import { InsertZone, type ZoneDrag } from "./InsertZone"

interface EditCanvasProps {
  draft: WorkflowDefinitionV1
  /** Счётчик заявок на этапах (бейдж на кнопке удаления). */
  engagementCounts: Record<string, number>
  /** Что идёт drag: блок палитры или существующий этап. */
  drag: ZoneDrag
  /** Выбран блок в палитре — зоны вставки раскрыты пунктиром. */
  armed: boolean
  selectedKey?: string
  onToggle: (stateKey: string) => void
  onPatch: (stateKey: string, patch: Partial<WorkflowStateDef>) => void
  onRemove: (stateKey: string) => void
  onInsertClick: (afterIndex: number | null) => void
  spotlight: NodeSpotlight | "insert" | null
  versionLabel?: string
}

/**
 * Канвас режима «Редактирование»: одна колонка на всю ширину, только
 * черновик — без read-only «призрака» действующей редакции. Между узлами
 * тонкие зоны вставки, которые раскрываются при drag/выборе блока.
 */
export function EditCanvas({
  draft,
  engagementCounts,
  drag,
  armed,
  selectedKey,
  onToggle,
  onPatch,
  onRemove,
  onInsertClick,
  spotlight,
  versionLabel,
}: EditCanvasProps) {
  const allKeys = draft.states.map((s) => s.key)

  return (
    <div className="overflow-x-auto rounded-xl border bg-muted/20">
      <div className="min-w-max px-5 py-5">
        <div className="sticky left-0 z-10 mb-2 flex w-fit items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
            Черновик{versionLabel ? ` · ${versionLabel}` : ""}
          </span>
          <span className="text-[11px] text-muted-foreground">·</span>
          <span className="text-[11px] text-muted-foreground">
            {draft.states.length} этапов · только правки
          </span>
        </div>

        <div className="flex items-stretch gap-2">
          {draft.states.map((s, i) => (
            <Fragment key={s.key}>
              {i > 0 && (
                <InsertZone
                  variant="gap"
                  afterIndex={i - 1}
                  onInsertClick={onInsertClick}
                  armed={armed}
                  drag={drag}
                  spotlight={spotlight === "insert"}
                />
              )}
              <CanvasNode
                state={s}
                row="draft"
                diff="matched"
                engagementCount={engagementCounts[s.key]}
                selected={selectedKey === s.key}
                interactive
                onSelect={() => onToggle(s.key)}
                onRemove={() => onRemove(s.key)}
                onPatch={(patch) => onPatch(s.key, patch)}
                allKeys={allKeys}
                outCount={draft.transitions.filter((t) => t.from === s.key).length}
                spotlight={spotlight === "order" || spotlight === "props" ? spotlight : null}
              />
            </Fragment>
          ))}
          <InsertZone
            variant="gap"
            afterIndex={null}
            onInsertClick={onInsertClick}
            armed={armed}
            drag={drag}
            spotlight={spotlight === "insert"}
          />
        </div>

        <p className="mt-3 text-[11px] text-muted-foreground">
          Ручка на карточке — порядок · зона между карточками — новый этап · клик по карточке —
          свойства.
        </p>
      </div>
    </div>
  )
}
