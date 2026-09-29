import { create } from "zustand"
import { ApiError, api, configureApi, type CurrentUserDto, type SystemRole } from "@/shared/api"
import { authMode, dataSource } from "@/shared/config"
import {
  beginLogin,
  clearSession,
  getAccessToken,
  handleRedirectCallback,
  hasSession,
  logoutRedirect,
  recoverFromUnauthorized,
  startSessionKeeper,
} from "@/shared/auth/keycloak"
import { currentUser as mockCurrentUser, employees } from "@/mock/data"
import { createNotificationSlice } from "./notificationSlice"
import { createEngagementSlice } from "./engagementSlice"
import { createCatalogSlice } from "./catalogSlice"
import { createWorkflowSlice } from "./workflowSlice"
import { createDocumentSlice } from "./documentSlice"
import { createApplicationSlice } from "./applicationSlice"
import { createCalendarSlice } from "./calendarSlice"
import { createAdminSlice } from "./adminSlice"
import { createChatSlice } from "./chatSlice"
import { createStreamSlice } from "./streamSlice"
import { loadAppData, type AppData } from "./api-data"
import type { StoreState } from "./types"
import { EMPTY_STAGE_CATALOG } from "@/app/workflow-stages"

// ========================================
// Глобальный стор приложения (zustand)
// Навигация split-панелей живёт в SplitContext — сюда не дублируется.
// ========================================

export type SessionStatus = "loading" | "authenticated" | "anonymous"

export interface SessionUser extends CurrentUserDto {}

export type DataStatus = "idle" | "loading" | "ready" | "error"

/** Загрузка данных с бэкенда (VITE_DATA_SOURCE=api). */
export interface DataSlice {
  /** idle — демо-режим либо ещё не вошли; ready — данные на месте. */
  dataStatus: DataStatus
  dataError: string | null
  /** Загрузить всё, что нужно интерфейсу; повторный вызов — «обновить». */
  loadData: () => Promise<void>
}

/**
 * Начальные данные режима API: моков нет, всё приходит с бэкенда.
 * Встречи и заметки по вузу догружаются страницами по мере открытия.
 * Исключение — чат: бэкенда у него нет, виджет пока работает на моках.
 */
const EMPTY_API_STATE: Partial<StoreState> = {
  universities: [],
  programs: [],
  products: [],
  directions: [],
  vendors: [],
  universityContacts: {},
  universityContracts: {},
  universityNotes: {},
  interactions: [],
  meetings: [],
  activityEvents: [],
  notes: {},
  notifications: [],
  workflowTemplates: [],
  workflowDefinitions: {},
  stageCatalog: EMPTY_STAGE_CATALOG,
  documents: [],
  applications: [],
  streams: [],
  calendarEvents: [],
  calendarTasks: [],
  adminUsers: [],
  auditLog: [],
  persons: [],
  personsLoaded: false,
}

/** Уведомления рождаются на бэкенде (переходы, эскалации) — опрашиваем. */
const NOTIFICATION_POLL_MS = 60_000
let notificationTimer: number | undefined

export interface SessionSlice {
  // --- session ---
  sessionStatus: SessionStatus
  user: SessionUser | null
  /** Почему вход не состоялся — показывается на экране входа. */
  sessionError: string | null
  /** Демо-вход по TEST_ACCOUNTS (authMode = mock). */
  login: (email: string, password: string) => boolean
  /** Вход через Keycloak (authMode = keycloak): уход на страницу провайдера. */
  loginWithKeycloak: (returnTo?: string) => Promise<void>
  logout: () => void
  bootstrap: () => Promise<void>
}

/** Тестовые аккаунты — только роли SystemRole (USER|MANAGER|ADMIN). */
export const TEST_ACCOUNTS: { email: string; password: string; user: SessionUser }[] = [
  {
    email: "ivanov@rtk.ru",
    password: "manager123",
    user: mockCurrentUser, // role: MANAGER
  },
  {
    email: "user@rtk.ru",
    password: "user123",
    user: {
      id: "e4",
      email: "user@rtk.ru",
      displayName: "Козлова Елена Викторовна",
      role: "USER" as SystemRole,
      managerId: "e3",
      dataScope: { restricted: false, ownerCount: null, universityCount: null },
    },
  },
  {
    email: "admin@rtk.ru",
    password: "admin123",
    user: {
      id: "e5",
      email: "admin@rtk.ru",
      displayName: "Админ Системы",
      role: "ADMIN" as SystemRole,
      managerId: null,
      dataScope: { restricted: false, ownerCount: null, universityCount: null },
    },
  },
]

function readStoredUser(): SessionUser | null {
  try {
    const raw = localStorage.getItem("crm_user")
    if (!raw) return null
    const parsed = JSON.parse(raw) as SessionUser
    if (parsed && typeof parsed === "object" && "role" in parsed && "email" in parsed) {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

export const useStore = create<StoreState>()((set, get, ...rest) => {
  const expireSession = () => {
    clearSession()
    if (notificationTimer) window.clearInterval(notificationTimer)
    set({ user: null, sessionStatus: "anonymous", sessionError: "Сессия истекла — войдите снова." })
  }

  const bootstrapKeycloak = async () => {
    configureApi({
      getToken: getAccessToken,
      onUnauthorized: recoverFromUnauthorized,
      onSessionExpired: expireSession,
    })

    // Вызов до первого await: адрес возврата с Keycloak восстанавливается
    // синхронно, ещё до того, как роутер прочитает location.
    const callback = await handleRedirectCallback()
    if (callback?.error) {
      set({ user: null, sessionStatus: "anonymous", sessionError: callback.error })
      return
    }
    if (!hasSession()) {
      set({ user: null, sessionStatus: "anonymous" })
      return
    }

    startSessionKeeper(expireSession)
    try {
      const user = await api.auth.me()
      set({ user, sessionStatus: "authenticated", sessionError: null })
      if (dataSource === "api") void get().loadData()
    } catch (error) {
      // 401 уже обработан клиентом (expireSession). Прочие ошибки — бэкенд
      // недоступен: токены сохраняем, после восстановления хватит перезагрузки.
      if (error instanceof ApiError && error.status === 401) return
      const reason = error instanceof ApiError ? error.message : "сервер недоступен"
      set({
        user: null,
        sessionStatus: "anonymous",
        sessionError: `Не удалось получить профиль пользователя: ${reason}`,
      })
    }
  }

  return {
    ...createNotificationSlice(set, get, ...rest),
    ...createEngagementSlice(set, get, ...rest),
    ...createCatalogSlice(set, get, ...rest),
    ...createWorkflowSlice(set, get, ...rest),
    ...createDocumentSlice(set, get, ...rest),
    ...createApplicationSlice(set, get, ...rest),
    ...createCalendarSlice(set, get, ...rest),
    ...createAdminSlice(set, get, ...rest),
    ...createChatSlice(set, get, ...rest),
    ...createStreamSlice(set, get, ...rest),
    ...(dataSource === "api" ? EMPTY_API_STATE : {}),

    dataStatus: "idle",
    dataError: null,

    loadData: async () => {
      const user = get().user
      if (dataSource !== "api" || !user) return
      set({ dataStatus: get().dataStatus === "ready" ? "ready" : "loading", dataError: null })
      try {
        const data: AppData = await loadAppData(user)
        set({ ...data, dataStatus: "ready", dataError: null })
        if (notificationTimer) window.clearInterval(notificationTimer)
        notificationTimer = window.setInterval(() => void get().refreshNotifications(), NOTIFICATION_POLL_MS)
      } catch (error) {
        set({
          dataStatus: "error",
          dataError: error instanceof ApiError ? error.message : "Сервер недоступен",
        })
      }
    },

    sessionStatus: "loading",
    user: null,
    sessionError: null,

    bootstrap: async () => {
      if (authMode === "keycloak") return bootstrapKeycloak()
      const user = readStoredUser()
      set({ user, sessionStatus: user ? "authenticated" : "anonymous" })
    },

    login: (email, password) => {
      if (authMode !== "mock") return false
      const account = TEST_ACCOUNTS.find(
        (a) => a.email === email && a.password === password,
      )
      if (!account) return false
      localStorage.setItem("crm_user", JSON.stringify(account.user))
      set({ user: account.user, sessionStatus: "authenticated", sessionError: null })
      return true
    },

    loginWithKeycloak: (returnTo) => {
      set({ sessionError: null })
      return beginLogin(returnTo)
    },

    logout: () => {
      if (notificationTimer) window.clearInterval(notificationTimer)
      set({ user: null, sessionStatus: "anonymous", sessionError: null, dataStatus: "idle" })
      if (authMode === "keycloak") {
        logoutRedirect()
        return
      }
      localStorage.removeItem("crm_user")
    },
  }
})

/** Хук селектора: useStore(s => s.user) — подписка только на выбранный слайс. */
export { useStore as useAppStore }

// справочно: employees доступны для админ-списка (этап 7)
export { employees }
