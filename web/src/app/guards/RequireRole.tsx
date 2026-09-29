import { Navigate } from "react-router-dom"
import type { SystemRole } from "@/shared/api"
import { can } from "@/shared/lib/roles"
import { useStore } from "@/app/store"

/**
 * Ролевой guard (UX-уровень): роль ниже min → редирект на /.
 * Источник истины по доступу — сервер (scope/Keycloak), guard только скрывает UI.
 */
export function RequireRole({
  roles,
  children,
}: {
  roles: SystemRole[]
  children: React.ReactNode
}) {
  const role = useStore((s) => s.user?.role)

  if (!role) return <Navigate to="/login" replace />
  const allowed = roles.some((min) => can(role, min))
  if (!allowed) return <Navigate to="/" replace />
  return <>{children}</>
}
