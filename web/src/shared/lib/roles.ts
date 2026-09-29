import type { SystemRole } from "@/shared/api"

/** Порядок ролей: больше число = больше прав в UI. */
export const ROLE_RANK: Record<SystemRole, number> = {
  USER: 1,
  MANAGER: 2,
  ADMIN: 3,
}

/** Роль min или выше (UX-guard; сервер — источник истины по scope). */
export function can(role: SystemRole, min: SystemRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min]
}

export function isAdmin(role: SystemRole | null | undefined): boolean {
  return role === "ADMIN"
}

export function isManagerOrAdmin(role: SystemRole | null | undefined): boolean {
  return role === "MANAGER" || role === "ADMIN"
}

export const ROLE_LABELS: Record<SystemRole, string> = {
  USER: "Менеджер",
  MANAGER: "Руководитель",
  ADMIN: "Администратор",
}
