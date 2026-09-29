import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable"
import type { WorkflowDefinitionV1, WorkflowStateDef } from "@/shared/api/workflow-definition"
import { StageListItem } from "./StageListItem"
import { InsertZone, type ZoneDrag } from "./InsertZone"
import type { NodeSpotlight } from "./CanvasNode"

interface StageListModeProps {
  draft: WorkflowDefinitionV1
  addedKeys: Set<string>
  engagementCounts: Record<string, number>
  selectedKey?: string
  validationByState?: Record<string, string | undefined>
  onPatch: (key: string, patch: Partial<WorkflowStateDef>) => void
  onRemove: (stateKey: string) => void
  onSelect: (stateKey: string) => void
  onInsertClick: (afterIndex: number | null) => void
  armed: boolean
  drag: ZoneDrag
  spotlight: NodeSpotlight | "insert" | null
}

/**
 * Режим «список»: вертикальный порядок через dnd-kit (arrayMove),
 * зоны вставки между строками + инлайн-правка свойств этапа.
 */
export function StageListMode({
  draft,
  addedKeys,
  engagementCounts,
  selectedKey,
  validationByState,
  onPatch,
  onRemove,
  onSelect,
  onInsertClick,
  armed,
  drag,
  spotlight,
}: StageListModeProps) {
  const keys = draft.states.map((s) => s.key)

  return (
    <div className="space-y-2">
      <SortableContext items={keys} strategy={verticalListSortingStrategy}>
        {draft.states.map((s, i) => (
          <div key={s.key}>
            <StageListItem
              state={s}
              added={addedKeys.has(s.key)}
              engagementCount={engagementCounts[s.key]}
              invalid={validationByState?.[s.key]}
              selected={selectedKey === s.key}
              outCount={draft.transitions.filter((t) => t.from === s.key).length}
              onSelect={() => onSelect(s.key)}
              onPatch={(patch) => onPatch(s.key, patch)}
              onRemove={() => onRemove(s.key)}
              spotlight={spotlight === "order" || spotlight === "props" ? spotlight : null}
            />
            <InsertZone
              afterIndex={i === draft.states.length - 1 ? null : i}
              onInsertClick={onInsertClick}
              armed={armed}
              drag={drag}
              spotlight={spotlight === "insert"}
              disabled={s.kind === "final" && i !== draft.states.length - 1}
              disabledReason="После финального этапа нельзя добавить этап"
            />
          </div>
        ))}
      </SortableContext>
    </div>
  )
}
