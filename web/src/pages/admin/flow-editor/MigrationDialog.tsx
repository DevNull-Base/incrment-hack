import { useState } from "react"
import { AlertTriangle, ArrowRight } from "lucide-react"
import { cn } from "cn"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { WorkflowDefinitionV1 } from "@/shared/api/workflow-definition"
import type { StateCounts } from "@/shared/api/flow-editor-ops"

export interface PendingRemoval {
  key: string
  label: string
  counts: StateCounts
  suggestedTarget?: string
}

interface MigrationDialogProps {
  open: boolean
  pending: PendingRemoval | null
  draft: WorkflowDefinitionV1
  onCancel: () => void
  onConfirm: (targetKey: string) => void
}

/**
 * Диалог удаления этапа: решает судьбу заявок/заметок/вложений
 * (коррелирует с publish/preview: engagementCount + suggestedTarget
 * → stateMapping при публикации).
 */
export function MigrationDialog({ open, pending, draft, onCancel, onConfirm }: MigrationDialogProps) {
  const candidates = draft.states.filter((s) => s.key !== pending?.key)
  // Выбор хранится мапой по ключу удаляемого этапа — без эффектов-сбросов.
  const [choices, setChoices] = useState<Record<string, string>>({})
  const target =
    (pending && choices[pending.key]) ||
    pending?.suggestedTarget ||
    candidates[0]?.key ||
    ""
  const setTarget = (key: string) => {
    if (!pending) return
    setChoices((c) => ({ ...c, [pending.key]: key }))
  }

  if (!pending) return null
  const { counts } = pending
  const hasCards = counts.engagementCount > 0

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Удалить этап «{pending.label}»?
            <Badge variant="outline" className="font-mono text-[10px]">
              {pending.key}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Этап исчезнет из черновика. Куда перенести связанные данные — решите ниже.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Самое важное число для решения — крупным акцентом */}
          <div
            className={cn(
              "rounded-xl border p-4 text-center",
              hasCards ? "border-destructive/40 bg-destructive/5" : "border-border bg-muted/40",
            )}
          >
            <div
              className={cn(
                "text-4xl font-bold leading-none tabular-nums",
                hasCards ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {counts.engagementCount}
            </div>
            <div className="mt-1.5 text-xs font-semibold">
              {hasCards ? "заявок на этапе" : "заявок на этапе нет"}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {hasCards
                ? `Они будут перенесены при публикации редакции · этап «${pending.label}»`
                : `Этап «${pending.label}» просто исчезнет из черновика`}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border p-3 text-center">
              <div className="text-lg font-bold tabular-nums">{counts.noteCount}</div>
              <div className="text-[11px] text-muted-foreground">заметок</div>
            </div>
            <div className="rounded-lg border p-3 text-center">
              <div className="text-lg font-bold tabular-nums">{counts.attachmentCount}</div>
              <div className="text-[11px] text-muted-foreground">вложений</div>
            </div>
          </div>

          {hasCards ? (
            <>
              <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                <span>
                  Заявки, заметки и вложения будут перенесены при публикации редакции.
                  {pending.suggestedTarget && (
                    <>
                      {" "}
                      Рекомендация системы:{" "}
                      <b>
                        {draft.states.find((s) => s.key === pending.suggestedTarget)?.label ??
                          pending.suggestedTarget}
                      </b>
                    </>
                  )}
                </span>
              </div>

              <div className="space-y-1.5">
                <span className="text-xs font-medium">Куда перенести данные</span>
                <div className="flex flex-wrap gap-1.5">
                  {candidates.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => setTarget(s.key)}
                      className={cn(
                        "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                        target === s.key
                          ? "border-primary bg-primary/5 text-primary"
                          : "hover:bg-muted",
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                {target && (
                  <p className="flex items-center gap-1.5 pt-1 text-[11px] text-muted-foreground">
                    {pending.label} <ArrowRight className="size-3" />{" "}
                    {draft.states.find((s) => s.key === target)?.label ?? target}
                  </p>
                )}
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Переносить некуда — этап просто удаляется из черновика.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Отмена
          </Button>
          <Button
            variant="destructive"
            disabled={hasCards && !target}
            onClick={() => onConfirm(target)}
          >
            {hasCards ? "Перенести и удалить" : "Удалить этап"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
