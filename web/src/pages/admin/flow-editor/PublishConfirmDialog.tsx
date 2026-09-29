import { useState } from "react"
import { AlertTriangle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

interface PublishConfirmDialogProps {
  open: boolean
  busy?: boolean
  affectedCount: number
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Шаг 2 publish-flow: явное подтверждение (API требует confirm:true,
 * без него — 428 Precondition Required).
 */
export function PublishConfirmDialog({
  open,
  busy = false,
  affectedCount,
  onCancel,
  onConfirm,
}: PublishConfirmDialogProps) {
  const [checked, setChecked] = useState(false)

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setChecked(false)
          onCancel()
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Опубликовать новую редакцию?</DialogTitle>
          <DialogDescription>
            Действие переводит все текущие заявки сегмента на новую редакцию.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="space-y-1">
            <p className="font-medium">
              Будет затронуто заявок: <span className="tabular-nums">{affectedCount}</span>
            </p>
            <p className="text-muted-foreground">
              Текущая редакция станет неактивной. Редакции не сосуществуют: откатить публикацию
              можно только создав новую редакцию.
            </p>
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="checkbox"
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 size-4 accent-primary"
          />
          <span>
            Я понимаю, что <b className="tabular-nums">{affectedCount}</b> активных заявок будет
            переведено на новую редакцию
          </span>
        </label>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setChecked(false)
              onCancel()
            }}
          >
            Отмена
          </Button>
          <Button disabled={!checked || busy} onClick={onConfirm}>
            {busy ? "Публикация…" : "Опубликовать"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
