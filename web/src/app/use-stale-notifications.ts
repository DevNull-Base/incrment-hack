import { useEffect } from "react"
import { useStore } from "@/app/store"
import { APP_NOW } from "@/shared/lib/app-now"
import { dataSource } from "@/shared/config"

/** ТЗ: зависание заявки >1–2 недель → уведомление руководителю (дефолт 14 дней). */
const DEFAULT_STALE_DAYS = 14
const ALLOWED_THRESHOLDS = [7, 14, 30]

/**
 * Демо-режим. Авто-уведомления о зависших заявках: при загрузке (и при смене порога
 * в localStorage.crm_stale_days) добавляет уведомление на каждую заявку,
 * простоявшую на этапе дольше порога. Дедуп — по entityId в ленте.
 */
export function useStaleNotifications() {
  const interactions = useStore((s) => s.interactions)
  const notifications = useStore((s) => s.notifications)
  const pushNotification = useStore((s) => s.pushNotification)

  useEffect(() => {
    // Режим API: зависшие заявки эскалирует бэкенд (ESCALATION_CRON) —
    // его уведомления приходят в ленту сами, локальные были бы дублями.
    if (dataSource === "api") return
    const saved = Number(localStorage.getItem("crm_stale_days"))
    const days = ALLOWED_THRESHOLDS.includes(saved) ? saved : DEFAULT_STALE_DAYS
    const existing = new Set(
      notifications
        .filter((n) => n.entityType === "engagement" && n.entityId)
        .map((n) => n.entityId),
    )

    for (const i of interactions) {
      const staleDays = Math.floor(
        (APP_NOW - new Date(i.updatedAt).getTime()) / 86_400_000,
      )
      if (staleDays < days || existing.has(i.id)) continue
      const title = i.universityName || i.counterpartyName
      pushNotification({
        subject: `Заявка зависла: ${title}`,
        body: `«${title}» без изменений ${staleDays} дн. — этап «${i.currentStateLabel}». Требуется вмешательство.`,
        entityType: "engagement",
        entityId: i.id,
      })
    }
  }, [interactions, notifications, pushNotification])
}
