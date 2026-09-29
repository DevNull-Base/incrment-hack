import { AlertTriangle, Check, Plus, X } from "lucide-react"
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
import type { WorkflowPublishPreviewDto } from "@/shared/api"
import type { WorkflowDefinitionV1 } from "@/shared/api/workflow-definition"

interface PublishPreviewDialogProps {
  open: boolean
  preview: WorkflowPublishPreviewDto | null
  draft: WorkflowDefinitionV1
  mapping: Record<string, string>
  onMappingChange: (mapping: Record<string, string>) => void
  busy?: boolean
  onClose: () => void
  onNext: () => void
}

/**
 * Шаг 1 publish-flow: что изменится и куда перенести заявки
 * удаляемых этапов (stateMapping). blockingIssues блокируют переход.
 */
export function PublishPreviewDialog({
  open,
  preview,
  draft,
  mapping,
  onMappingChange,
  busy = false,
  onClose,
  onNext,
}: PublishPreviewDialogProps) {
  if (!preview) return null

  const needsTarget = preview.removedStates.filter((r) => r.engagementCount > 0)
  const unmapped = needsTarget.filter((r) => !mapping[r.key])
  const canNext = preview.blockingIssues.length === 0 && unmapped.length === 0

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Предпросмотр публикации</DialogTitle>
          <DialogDescription>
            Публикация переведёт все заявки сегмента на новую редакцию. Редакции не
            сосуществуют — изменения нельзя будет откатить без новой редакции.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {/* Blocking issues — вверху и с красным акцентом: дальше не пройти */}
          {preview.blockingIssues.length > 0 && (
            <div className="space-y-1 rounded-lg border border-destructive/50 bg-destructive/10 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
                <AlertTriangle className="size-4" /> Публикация заблокирована
              </p>
              {preview.blockingIssues.map((issue) => (
                <p key={issue} className="text-xs text-destructive">
                  • {issue}
                </p>
              ))}
            </div>
          )}

          {/* Сводка */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg border p-3">
              <div className="text-lg font-bold text-success">+{preview.addedStates.length}</div>
              <div className="text-[11px] text-muted-foreground">добавлено</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-lg font-bold text-destructive">−{preview.removedStates.length}</div>
              <div className="text-[11px] text-muted-foreground">удалено</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-lg font-bold text-info">{preview.renamedStates.length}</div>
              <div className="text-[11px] text-muted-foreground">переименовано</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-lg font-bold tabular-nums">{preview.affectedEngagements}</div>
              <div className="text-[11px] text-muted-foreground">заявок затронуто</div>
            </div>
          </div>

          {/* Удаляемые этапы → маппинг */}
          {preview.removedStates.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Куда перенести данные удаляемых этапов
              </h4>
              {preview.removedStates.map((r) => (
                <div key={r.key} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <X className="size-4 text-destructive" />
                      {r.label}
                      {r.engagementCount > 0 && (
                        <Badge variant="destructive">{r.engagementCount} заявок</Badge>
                      )}
                    </span>
                    {r.engagementCount > 0 ? (
                      <select
                        value={mapping[r.key] ?? ""}
                        onChange={(e) =>
                          onMappingChange({ ...mapping, [r.key]: e.target.value })
                        }
                        aria-label={`Куда перенести данные этапа ${r.label}`}
                        className={cn(
                          "rounded-md border bg-transparent px-2 py-1 text-xs",
                          !mapping[r.key] && "border-destructive/60",
                        )}
                      >
                        <option value="">— выберите этап —</option>
                        {draft.states.map((s) => (
                          <option key={s.key} value={s.key}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">заявок нет</span>
                    )}
                  </div>
                  {r.engagementCount > 0 && (
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      перенос при публикации: {r.noteCount ?? 0} заметок ·{" "}
                      {r.attachmentCount ?? 0} вложений
                      {r.suggestedTarget && mapping[r.key] === r.suggestedTarget && (
                        <span className="ml-1 text-success">(рекомендация)</span>
                      )}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Добавленные / переименованные */}
          {preview.addedStates.length > 0 && (
            <div className="space-y-1">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Новые этапы
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {preview.addedStates.map((s) => (
                  <span
                    key={s.key}
                    className="flex items-center gap-1 rounded-md border border-success/40 bg-success/5 px-2 py-1 text-xs"
                  >
                    <Plus className="size-3 text-success" /> {s.label}
                  </span>
                ))}
              </div>
            </div>
          )}
          {preview.renamedStates.length > 0 && (
            <div className="space-y-1">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Переименования
              </h4>
              {preview.renamedStates.map((s) => (
                <p key={s.key} className="text-xs">
                  <Check className="mr-1 inline size-3 text-info" />
                  «{s.fromLabel}» → «{s.toLabel}»
                </p>
              ))}
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            Перенос: {preview.relocatedEngagements} заявок
            {preview.transitionsChanged ? " · переходы изменены" : ""}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Назад
          </Button>
          <Button disabled={!canNext || busy} onClick={onNext}>
            {busy ? "Загрузка…" : "Далее"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
