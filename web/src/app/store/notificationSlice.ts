import type { StateCreator } from "zustand"
import { api } from "@/shared/api"
import { dataSource } from "@/shared/config"
import type { Notification } from "@/types"
import { notifications as mockNotifications } from "@/mock/data"
import { fetchAll, normalizeNotification } from "./api-data"
import type { StoreState } from "./types"

// ========================================
// Слайс уведомлений: общий для Header, Dashboard,
// NotificationsPage и обеих split-панелей.
// Демо-режим — локально; режим API — прочтение на бэкенде
// (оптимистично, с откатом при отказе) и периодическое обновление:
// уведомления рождаются на бэкенде при переходах и эскалациях.
// ========================================
export interface NotificationSlice {
  notifications: Notification[]
  /** Добавить уведомление (например, об эскалации). */
  pushNotification: (n: {
    subject: string
    body: string
    entityType: Notification["entityType"]
    entityId: string
  }) => void
  /** Пометить одно прочитанным (optimistic). */
  markNotificationRead: (id: string) => void
  /** Пометить все прочитанными (optimistic). */
  markAllNotificationsRead: () => void
  /** Перечитать уведомления с бэкенда (режим API). */
  refreshNotifications: () => Promise<void>
}

const isApi = dataSource === "api"

export const createNotificationSlice: StateCreator<StoreState, [], [], NotificationSlice> = (set, get) => ({
  notifications: structuredClone(mockNotifications),

  pushNotification: (n) =>
    set((state) => ({
      notifications: [
        {
          id: `n-${Date.now()}`,
          channel: "IN_APP",
          subject: n.subject,
          body: n.body,
          entityType: n.entityType,
          entityId: n.entityId,
          readAt: null,
          sentAt: new Date().toISOString(),
          deliveryError: null,
          createdAt: new Date().toISOString(),
        },
        ...state.notifications,
      ],
    })),

  markNotificationRead: (id) => {
    const before = get().notifications
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id && !n.readAt
          ? { ...n, readAt: new Date().toISOString(), sentAt: n.sentAt ?? new Date().toISOString() }
          : n,
      ),
    }))
    if (isApi && before.some((n) => n.id === id && !n.readAt)) {
      api.notifications.markRead(id).catch(() => set({ notifications: before }))
    }
  },

  markAllNotificationsRead: () => {
    const before = get().notifications
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.readAt
          ? n
          : { ...n, readAt: new Date().toISOString(), sentAt: n.sentAt ?? new Date().toISOString() },
      ),
    }))
    if (isApi) api.notifications.markAllRead().catch(() => set({ notifications: before }))
  },

  refreshNotifications: async () => {
    if (!isApi) return
    try {
      const list = await fetchAll((q) => api.notifications.list(q), 1000)
      set({ notifications: list.map(normalizeNotification) })
    } catch {
      // Фоновое обновление: ошибку показал клиент API, список остаётся прежним.
    }
  },
})
