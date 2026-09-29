import { useSyncExternalStore } from "react"
import { cn } from "cn"
import { CheckCircle, XCircle, DangerTriangle, Info, X } from "@mynaui/icons-react"
import {
  toast,
  toastStore,
  type ToastItem,
  type ToastVariant,
} from "@/shared/lib/toast-store"

const VARIANT_STYLE: Record<
  ToastVariant,
  { icon: typeof CheckCircle; iconClass: string; accentClass: string }
> = {
  success: { icon: CheckCircle, iconClass: "text-success", accentClass: "border-l-success" },
  error: { icon: XCircle, iconClass: "text-destructive", accentClass: "border-l-destructive" },
  warning: { icon: DangerTriangle, iconClass: "text-warning", accentClass: "border-l-warning" },
  info: { icon: Info, iconClass: "text-info", accentClass: "border-l-info" },
}

function ToastCard({ item, index, count }: { item: ToastItem; index: number; count: number }) {
  const { icon: Icon, iconClass, accentClass } = VARIANT_STYLE[item.variant]
  return (
    <div
      role={item.variant === "error" ? "alert" : "status"}
      style={{ zIndex: count - index }}
      className={cn(
        "pointer-events-auto relative flex w-full items-start gap-2 rounded-md border border-border border-l-4 bg-card px-3 py-2 shadow-md",
        accentClass,
        // Старый тост подтягивается вверх — новый накрывает его на 8px
        // (перекрывается только внутренний отступ, текст старого читается).
        index > 0 && "-mt-6 opacity-40 duration-75 scale-90",
        item.closing ? "toast-out" : "toast-in",
      )}
    >
      <Icon className={cn("mt-px size-4 shrink-0", iconClass)} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium leading-snug">{item.title}</p>
        {item.description && (
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{item.description}</p>
        )}
      </div>
      <button
        type="button"
        aria-label="Закрыть уведомление"
        onClick={() => toast.dismiss(item.id)}
        className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <X className="size-3" />
      </button>
    </div>
  )
}

/**
 * Глобальная очередь тостов. Монтировать один раз (main.tsx),
 * позиция — под хедером справа, поверх контента.
 */
export function Toaster() {
  const items = useSyncExternalStore(toastStore.subscribe, toastStore.getSnapshot, toastStore.getSnapshot)
  if (items.length === 0) return null
  return (
    <div
      aria-label="Уведомления"
      className="pointer-events-none fixed right-3 top-[76px] z-[70] flex w-[min(320px,calc(100vw-1.5rem))] flex-col"
    >
      {items.map((item, index) => (
        <ToastCard key={item.id} item={item} index={index} count={items.length} />
      ))}
    </div>
  )
}
