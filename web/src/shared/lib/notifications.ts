import type { Notification } from "@/types"

/**
 * Куда ведёт уведомление: о заявке — в её карточку, о задаче — в календарь,
 * где задачи и живут. Остальное — в общий список уведомлений.
 */
export function notificationTarget(n: Pick<Notification, "entityType" | "entityId">): string {
  if ((n.entityType === "engagement" || n.entityType === "interaction") && n.entityId) {
    return `/interactions/${n.entityId}`
  }
  if (n.entityType === "task") return "/calendar"
  return "/notifications"
}

/** «28.09.2026, 12:00» — момент уведомления по часам пользователя. */
export function formatNotificationTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}
