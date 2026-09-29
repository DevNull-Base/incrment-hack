import { useStore } from "@/app/store"
import { DashboardManager } from "./dashboard/DashboardManager"
import { DashboardAdmin } from "./dashboard/DashboardAdmin"
import { DashboardLead } from "./dashboard/DashboardLead"

/**
 * Дашборд: одна точка входа, контент по роли.
 * USER (КАМ) → операционный, MANAGER (руководитель) → Lead, ADMIN → Admin.
 * Блоки общие: src/pages/dashboard/blocks.tsx.
 */
export function DashboardPage() {
  const role = useStore((s) => s.user?.role)

  if (role === "ADMIN") return <DashboardAdmin />
  if (role === "MANAGER") return <DashboardLead />
  return <DashboardManager />
}
