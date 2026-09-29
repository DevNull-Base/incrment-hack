import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"

export interface PendingTransition {
  engagementId: string
  toStateKey: string
  /** Подпись кнопки перехода из процесса («Встреча проведена»). */
  label: string
  fromLabel: string
  toLabel: string
  requiresComment: boolean
}

/**
 * Подтверждение перехода по процессу. Комментарий обязателен, если этого
 * требует переход в шаблоне (бэкенд иначе ответит ошибкой валидации).
 */
export function TransitionDialog({
  pending,
  busy,
  onCancel,
  onConfirm,
}: {
  pending: PendingTransition | null
  busy?: boolean
  onCancel: () => void
  onConfirm: (comment: string) => void
}) {
  const [comment, setComment] = useState("")
  const needComment = pending?.requiresComment ?? false
  const close = () => {
    setComment("")
    onCancel()
  }

  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{pending?.label ?? "Переход"}</DialogTitle>
          <DialogDescription>
            {pending ? `«${pending.fromLabel}» → «${pending.toLabel}»` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="transition-comment">
            Комментарий{needComment ? " (обязательно)" : ""}
          </Label>
          <textarea
            id="transition-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder={needComment ? "Что произошло на этапе" : "Необязательно"}
            className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={busy}>
            Отмена
          </Button>
          <Button
            onClick={() => {
              const text = comment
              setComment("")
              onConfirm(text)
            }}
            disabled={busy || (needComment && !comment.trim())}
          >
            {busy ? "Сохранение…" : "Перевести"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
