import type { StateCreator } from "zustand"
import {
  api,
  ApiError,
  type AuditLogItemDto,
  type ChainVerificationDto,
  type PersonDto,
  type ScopeDimension,
  type ScopeRuleDto,
  type SystemRole,
} from "@/shared/api"
import { dataSource } from "@/shared/config"
import { auditLog as mockAudit, employees as mockEmployees } from "@/mock/data"
import { adminUserToRow, fetchAll } from "./api-data"
import type { StoreState } from "./types"

// ========================================
// Админ-домен: пользователи, аудит, персоны (152-ФЗ).
// Демо-режим — моки. Режим API: роль, статус и обезличивание — на бэкенде;
// можно ли менять роль учётной записи Keycloak, решает бэкенд и отвечает
// понятной ошибкой.
// ========================================
export interface AdminUserRow {
  id: string
  email: string
  displayName: string
  role: SystemRole
  roleSource: "KEYCLOAK" | "CRM"
  isActive: boolean
  managerId: string | null
  /** Ограничения видимости данных; нет правила по измерению — ограничения нет. */
  scopeRules?: ScopeRuleDto[]
}

function seedUsers(): AdminUserRow[] {
  return mockEmployees.map((e) => ({
    id: e.id,
    email: e.email,
    displayName: e.displayName,
    role: e.role,
    roleSource: e.role === "ADMIN" ? "KEYCLOAK" : "CRM",
    isActive: true,
    managerId: e.managerId,
  }))
}

function seedPersons(): PersonDto[] {
  return [
    {
      id: "p-1",
      fullName: "Кузнецов Андрей Иванович",
      email: "kuznetsov@msu.ru",
      phone: "+7 (495) 123-45-67",
      position: "Зав. кафедрой ИТ",
      lawfulBasis: "CONTRACT",
      retentionUntil: "2030-01-01",
      erasedAt: null,
      universities: ["u1"],
    },
    {
      id: "p-2",
      fullName: "Смирнова Ольга Дмитриевна",
      email: "smirnova@spbstu.ru",
      phone: null,
      position: "Декан ФИТ",
      lawfulBasis: "CONSENT",
      retentionUntil: "2030-01-01",
      erasedAt: null,
      universities: ["u2"],
    },
  ]
}

export interface AdminSlice {
  adminUsers: AdminUserRow[]
  auditLog: AuditLogItemDto[]
  persons: PersonDto[]
  /** Список персон прочитан (режим API читает его при открытии раздела). */
  personsLoaded: boolean
  /** Прочитать персон с бэкенда — только из раздела ПДн, не при входе. */
  loadPersons: () => Promise<void>
  changeUserRole: (id: string, role: SystemRole) => Promise<AdminResult>
  changeUserStatus: (id: string, isActive: boolean) => Promise<AdminResult>
  /** Руководитель пользователя: задаёт, чьи данные видит руководитель. */
  changeUserManager: (id: string, managerId: string | null) => Promise<AdminResult>
  /**
   * Ограничение видимости по измерению: список разрешённых значений;
   * null — снять ограничение. Пустой список — «не видно ничего».
   */
  setUserScope: (id: string, dimension: ScopeDimension, allowedIds: string[] | null) => Promise<AdminResult>
  /** 152-ФЗ erase: обезличивание + запись в аудит. */
  erasePerson: (id: string, reason: string) => Promise<AdminResult>
  /** Проверка целостности цепочки журнала (режим API). */
  verifyAudit: () => Promise<ChainVerificationDto | null>
  /** Перечитать журнал (режим API). */
  refreshAudit: () => Promise<void>
}

export type AdminResult = { ok: true } | { ok: false; error: string }

const isApi = dataSource === "api"

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : "Сервер недоступен"
}

export const createAdminSlice: StateCreator<StoreState, [], [], AdminSlice> = (set, get) => ({
  adminUsers: seedUsers(),
  auditLog: structuredClone(mockAudit),
  persons: seedPersons(),
  personsLoaded: !isApi,

  loadPersons: async () => {
    if (!isApi) return
    try {
      const persons = await fetchAll((q) => api.persons.list(q))
      set({ persons, personsLoaded: true })
    } catch {
      set({ personsLoaded: true })
    }
  },

  changeUserRole: async (id, role) => {
    if (isApi) {
      try {
        const updated = adminUserToRow(await api.adminUsers.changeRole(id, { role }, { silent: true }))
        set((state) => ({ adminUsers: state.adminUsers.map((u) => (u.id === id ? updated : u)) }))
        void get().refreshAudit()
        return { ok: true }
      } catch (error) {
        return { ok: false, error: errorText(error) }
      }
    }
    set((state) => ({
      adminUsers: state.adminUsers.map((u) => (u.id === id ? { ...u, role } : u)),
      auditLog: [
        {
          id: `al-${Date.now()}`,
          occurredAt: new Date().toISOString(),
          actorEmail: "admin@rtk.ru",
          action: "update",
          entityType: "user",
          entityId: id,
          ipAddress: null,
          userAgent: null,
          traceId: null,
          beforeState: null,
          afterState: { role },
        },
        ...state.auditLog,
      ],
    }))
    return { ok: true }
  },

  changeUserStatus: async (id, isActive) => {
    if (isApi) {
      try {
        const updated = adminUserToRow(await api.adminUsers.changeStatus(id, { isActive }, { silent: true }))
        set((state) => ({ adminUsers: state.adminUsers.map((u) => (u.id === id ? updated : u)) }))
        void get().refreshAudit()
        return { ok: true }
      } catch (error) {
        return { ok: false, error: errorText(error) }
      }
    }
    set((state) => ({
      adminUsers: state.adminUsers.map((u) => (u.id === id ? { ...u, isActive } : u)),
    }))
    return { ok: true }
  },

  changeUserManager: async (id, managerId) => {
    if (isApi) {
      try {
        const updated = adminUserToRow(await api.adminUsers.changeManager(id, { managerId }, { silent: true }))
        set((state) => ({ adminUsers: state.adminUsers.map((u) => (u.id === id ? updated : u)) }))
        void get().refreshAudit()
        return { ok: true }
      } catch (error) {
        return { ok: false, error: errorText(error) }
      }
    }
    set((state) => ({ adminUsers: state.adminUsers.map((u) => (u.id === id ? { ...u, managerId } : u)) }))
    return { ok: true }
  },

  setUserScope: async (id, dimension, allowedIds) => {
    const apply = (rules: ScopeRuleDto[] | undefined): ScopeRuleDto[] => [
      ...(rules ?? []).filter((r) => r.dimension !== dimension),
      ...(allowedIds === null ? [] : [{ dimension, allowedIds }]),
    ]
    if (isApi) {
      try {
        if (allowedIds === null) await api.adminUsers.removeScope(id, dimension, { silent: true })
        else await api.adminUsers.setScope(id, dimension, { allowedIds }, { silent: true })
        void get().refreshAudit()
      } catch (error) {
        return { ok: false, error: errorText(error) }
      }
    }
    set((state) => ({
      adminUsers: state.adminUsers.map((u) => (u.id === id ? { ...u, scopeRules: apply(u.scopeRules) } : u)),
    }))
    return { ok: true }
  },

  erasePerson: async (id, reason) => {
    if (isApi) {
      try {
        await api.persons.erase(id, { reason }, { silent: true })
        const updated = await api.persons.get(id)
        set((state) => ({ persons: state.persons.map((p) => (p.id === id ? updated : p)) }))
        void get().refreshAudit()
        return { ok: true }
      } catch (error) {
        return { ok: false, error: errorText(error) }
      }
    }
    set((state) => ({
      persons: state.persons.map((p) =>
        p.id === id
          ? {
              ...p,
              email: null,
              phone: null,
              fullName: "Удалено (152-ФЗ)",
              erasedAt: new Date().toISOString(),
            }
          : p,
      ),
      auditLog: [
        {
          id: `al-${Date.now()}`,
          occurredAt: new Date().toISOString(),
          actorEmail: "admin@rtk.ru",
          action: "delete",
          entityType: "person",
          entityId: id,
          ipAddress: null,
          userAgent: null,
          traceId: null,
          beforeState: { id },
          afterState: { reason },
        },
        ...state.auditLog,
      ],
    }))
    return { ok: true }
  },

  verifyAudit: async () => {
    if (!isApi) return null
    try {
      return await api.audit.verify()
    } catch {
      return null
    }
  },

  refreshAudit: async () => {
    if (!isApi || get().user?.role !== "ADMIN") return
    try {
      const page = await api.audit.list({ page: 1, limit: 200 })
      set({ auditLog: page.items })
    } catch {
      // Фоновое обновление: ошибку показал клиент API.
    }
  },
})
