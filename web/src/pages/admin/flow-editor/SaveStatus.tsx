import { AlertTriangle, Check, LoaderCircle } from "lucide-react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"

export type SaveStatusKind =
  | "idle"
  | "pending"
  | "saving"
  | "saved"
  | "error"
  | "conflict"

interface SaveStatusProps {
  status: SaveStatusKind
  onRetry: () => void
  /** Показать редакцию другого админа рядом со своей. */
  onShowOtherChanges: () => void
  /** Перечитать черновик с сервера (существующее поведение конфликта). */
  onRereadDraft: () => void
}

const CHIP =
  "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-4xl border px-2.5 text-[11px] font-medium"

/**
 * Индикатор состояния сохранения рядом со шапкой редактора. Конфликт версий
 * показывается здесь же — с явными CTA, а не только тостом.
 */
export function SaveStatus({
  status,
  onRetry,
  onShowOtherChanges,
  onRereadDraft,
}: SaveStatusProps) {
  if (status === "idle") return null

  if (status === "conflict") {
    return (
      <div
        role="alert"
        className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2"
      >
        <span className="flex items-center gap-1.5 text-xs font-medium text-destructive">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          Редакция изменена другим администратором
        </span>
        <span className="ml-auto flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" onClick={onShowOtherChanges}>
            Показать изменения другого админа
          </Button>
          <Button variant="outline" size="sm" onClick={onRereadDraft}>
            Перечитать черновик
          </Button>
        </span>
      </div>
    )
  }

  return (
    <span aria-live="polite" className="flex shrink-0 items-center gap-1.5">
      <span
        className={cn(
          CHIP,
          status === "saving" && "border-border bg-muted text-muted-foreground",
          status === "saved" && "border-success/40 bg-success/10 text-success",
          status === "pending" && "border-border bg-muted/60 text-muted-foreground",
          status === "error" && "border-destructive/40 bg-destructive/10 text-destructive",
        )}
      >
        {status === "saving" && <LoaderCircle className="size-3 animate-spin" aria-hidden />}
        {status === "saved" && <Check className="size-3" aria-hidden />}
        {status === "error" && <AlertTriangle className="size-3" aria-hidden />}
        {status === "saving" && "Сохранение…"}
        {status === "saved" && "Сохранено"}
        {status === "pending" && "Есть несохранённые изменения"}
        {status === "error" && "Ошибка сохранения"}
      </span>
      {status === "error" && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Повторить
        </Button>
      )}
    </span>
  )
}
