import { Link } from "react-router-dom"
import { ChevronRight } from "lucide-react"
import { Building, GitBranch, Users, ShieldCheck, Wrench } from "@mynaui/icons-react"
import { useStore } from "@/app/store"
import {
  selectWorkingInteractions,
  selectUniversities,
  selectAdminUsers,
  selectAuditLog,
} from "@/app/store/selectors"
import { KpiCard, AttentionBlock, FunnelBlock } from "./blocks"

/** Главная для ADMIN: система + операционка + быстрые ссылки администрирования. */
export function DashboardAdmin() {
  const universities = useStore(selectUniversities)
  const interactions = useStore(selectWorkingInteractions)
  const notifications = useStore((s) => s.notifications)
  const employees = useStore(selectAdminUsers)
  const auditLog = useStore(selectAuditLog)
  const activeUniversities = universities.filter((u) => u.isActive)
  const activeUsers = employees.length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Панель администратора</h1>
        <p className="text-sm text-muted-foreground">
          Состояние системы, пользователи и администрирование
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Пользователей"
          value={activeUsers}
          icon={Users}
          color="text-blue-600 dark:text-blue-400"
          bg="bg-blue-50 dark:bg-blue-950/40"
        />
        <KpiCard
          label="Взаимодействий"
          value={interactions.length}
          icon={GitBranch}
          color="text-violet-600 dark:text-violet-400"
          bg="bg-violet-50 dark:bg-violet-950/40"
        />
        <KpiCard
          label="Активных вузов"
          value={activeUniversities.length}
          icon={Building}
          color="text-green-600 dark:text-green-400"
          bg="bg-green-50 dark:bg-green-950/40"
        />
        <KpiCard
          label="Событий аудита"
          value={auditLog.length}
          icon={ShieldCheck}
          color="text-orange-600 dark:text-orange-400"
          bg="bg-orange-50 dark:bg-orange-950/40"
        />
      </div>
      <div className="pb-0 mb-6">
        <h2 className="mb-3 text-base font-semibold">Администрирование</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { to: "/admin/users", label: "Пользователи и роли", desc: "Роли, статусы, scope-правила" },
            { to: "/admin/flow-editor", label: "Редактор флоу", desc: "Процессы B2B и B2C: этапы, переходы, публикация" },
            { to: "/settings/audit", label: "Аудит-лог", desc: "Журнал действий, verify цепочки" },
            { to: "/admin/import", label: "Импорт данных", desc: "Мастер загрузки файлов" },
            { to: "/admin/integrations", label: "Интеграции", desc: "LMS, сайт, прогоны синхронизации" },
            { to: "/admin/persons", label: "Персоны 152-ФЗ", desc: "ПДн, retention, erase" },
          ].map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="group flex items-start gap-3 rounded-lg border border-border/60 bg-card p-4 transition-colors duration-150 hover:border-primary/30 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Wrench className="size-4 text-primary" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{item.label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{item.desc}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-colors duration-150 group-hover:text-primary" />
            </Link>
          ))}
        </div>
      </div>
          <h2 className="mb-3 text-base font-semibold">Работа с заявками</h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <AttentionBlock notifications={notifications} />
        <FunnelBlock interactions={interactions} />
      </div>

      
    </div>
  )
}
