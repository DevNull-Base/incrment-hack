// ========================================
// Тосты: мини-стор без зависимостей.
// toast.success(...) / toast.error(...) вызываются из обработчиков,
// <Toaster /> рендерит очередь (см. shared/ui/toast.tsx).
// При интеграции с бекендом — вызывать из catch-веток api-клиента.
// ========================================

export type ToastVariant = "success" | "error" | "warning" | "info"

export interface ToastItem {
  id: string
  variant: ToastVariant
  title: string
  description?: string
  /** мс до автозакрытия; 0 — держать до ручного закрытия */
  duration?: number
  closing?: boolean
}

export interface ToastOptions {
  /** мс; по умолчанию зависит от variant */
  duration?: number
}

const DEFAULT_DURATION: Record<ToastVariant, number> = {
  success: 2500,
  info: 2500,
  warning: 4000,
  error: 5000,
}

const MAX_TOASTS = 4
const EXIT_MS = 200

let items: ToastItem[] = []
let seq = 0
const listeners = new Set<() => void>()
const timers = new Map<string, { auto?: ReturnType<typeof setTimeout>; exit?: ReturnType<typeof setTimeout> }>()

function notify() {
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot() {
  return items
}

function clearTimers(id: string) {
  const entry = timers.get(id)
  if (entry?.auto) clearTimeout(entry.auto)
  if (entry?.exit) clearTimeout(entry.exit)
  timers.delete(id)
}

function removeNow(id: string) {
  clearTimers(id)
  items = items.filter((item) => item.id !== id)
  notify()
}

function startExit(id: string) {
  const target = items.find((item) => item.id === id)
  if (!target || target.closing) return
  const entry = timers.get(id) ?? {}
  if (entry.auto) {
    clearTimeout(entry.auto)
    entry.auto = undefined
  }
  if (entry.exit) return
  entry.exit = setTimeout(() => removeNow(id), EXIT_MS)
  timers.set(id, entry)
  items = items.map((item) => (item.id === id ? { ...item, closing: true } : item))
  notify()
}

function dismissToast(id: string) {
  startExit(id)
}

function pushToast(
  variant: ToastVariant,
  title: string,
  description?: string,
  options?: ToastOptions,
): string {
  const duration = options?.duration ?? DEFAULT_DURATION[variant]
  // Дедупликация: повторное identical-действие продлевает жизнь тоста,
  // а не плодит одинаковые карточки.
  const existing = items.find(
    (item) =>
      !item.closing &&
      item.variant === variant &&
      item.title === title &&
      item.description === description,
  )
  if (existing) {
    const entry = timers.get(existing.id) ?? {}
    if (entry.auto) clearTimeout(entry.auto)
    if (entry.exit) {
      clearTimeout(entry.exit)
      entry.exit = undefined
    }
    if (duration > 0) {
      entry.auto = setTimeout(() => startExit(existing.id), duration)
    }
    timers.set(existing.id, entry)
    // Повторное identical-действие поднимает тост наверх и продлевает жизнь.
    items = [
      { ...existing, closing: false },
      ...items.filter((item) => item.id !== existing.id),
    ]
    notify()
    return existing.id
  }

  const id = `toast-${++seq}`
  // Новый тост идёт первым (сверху стека), старые уходят в хвост и срезаются.
  const next = [{ id, variant, title, description, duration }, ...items]
  const dropped = next.slice(MAX_TOASTS)
  dropped.forEach((item) => clearTimers(item.id))
  items = next.slice(0, MAX_TOASTS)
  if (duration > 0) {
    timers.set(id, { auto: setTimeout(() => startExit(id), duration) })
  }
  notify()
  return id
}

/** Тосты для успешных/неуспешных действий. Вызывать из обработчиков, не из рендера. */
export const toast = {
  success: (title: string, description?: string, options?: ToastOptions) =>
    pushToast("success", title, description, options),
  error: (title: string, description?: string, options?: ToastOptions) =>
    pushToast("error", title, description, options),
  warning: (title: string, description?: string, options?: ToastOptions) =>
    pushToast("warning", title, description, options),
  info: (title: string, description?: string, options?: ToastOptions) =>
    pushToast("info", title, description, options),
  dismiss: dismissToast,
  /** Сразу очищает очередь (без анимации выхода) — logout, смена маршрута. */
  dismissAll: () => {
    items.forEach((item) => clearTimers(item.id))
    items = []
    notify()
  },
}

/** Для useSyncExternalStore в <Toaster />. */
export const toastStore = { subscribe, getSnapshot }
