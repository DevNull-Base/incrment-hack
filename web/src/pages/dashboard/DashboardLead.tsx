import { Bell, CheckCircle, Clock1, GitBranch, Users } from "@mynaui/icons-react"
import { useNavigate } from "react-router-dom"
import { useStore } from "@/app/store"
import {
  selectAdminUsers,
  selectAuditLog,
  selectWorkingInteractions,
  selectUnreadCount,
} from "@/app/store/selectors"
import {
  FunnelBlock,
  KpiCard,
  QuickActionsBlock,
  RecentActionsBlock,
  StaleTasksBlock,
  TeamLoadBlock,
} from "./blocks"
import { useStageCatalog } from "@/app/use-stages"
import { dataSource } from "@/shared/config"
import { isClosedStage, stageIndexOf, type StageCatalog } from "@/app/workflow-stages"
import type { Interaction } from "@/types"
import { useStaleNotifications } from "@/app/use-stale-notifications"

/**
 * Коммуникация состоялась: взаимодействие дошло до третьего этапа своего
 * процесса (в B2B это «Организация встречи») и не закрыто отказом.
 */
function passedCommunication(catalog: StageCatalog, i: Interaction): boolean {
  const stages = catalog[i.segment]
  const stage = stages.find((s) => s.key === i.currentStateKey)
  return !stage?.isRejected && stageIndexOf(stages, i.currentStateKey) >= 2
}

function isClosed(catalog: StageCatalog, i: Interaction): boolean {
  return isClosedStage(catalog[i.segment], i.currentStateKey)
}

/**
 * ФИО хранится в формате «Фамилия Имя [Отчество]», поэтому для обращения
 * берём второе слово. Если формат неожиданный (одно слово и т.п.) —
 * откатываемся на нейтральное приветствие.
 */
function greetingName(displayName?: string): string {
  const parts = displayName?.trim().split(/\s+/) ?? []
  return parts[1] || parts[0] || "коллега"
}

/** Дашборд руководителя КАМов: команда, эскалации, контроль сроков. */
export function DashboardLead() {
  const navigate = useNavigate()
  const interactions = useStore(selectWorkingInteractions)
  const catalog = useStageCatalog()
  const auditLog = useStore(selectAuditLog)
  const activityEvents = useStore((s) => s.activityEvents)
  const adminUsers = useStore(selectAdminUsers)
  const unreadCount = useStore(selectUnreadCount)
  const user = useStore((s) => s.user)

  const cams = adminUsers.filter((u) => u.role === "USER")
  const inWork = interactions.filter((i) => !isClosed(catalog, i)).length
  const overdueCount = interactions.filter((i) => i.isOverdue).length
  const successful = interactions.filter((i) => passedCommunication(catalog, i)).length

  const openInteraction = (id: string) => navigate(`/interactions/${id}`)

  useStaleNotifications()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">
          Добрый день, {greetingName(user?.displayName)}
        </h1>
        <p className="text-sm text-muted-foreground">Хорошего рабочего дня!</p>
      </div>

      <div className="grid grid-cols-2 gap-5 lg:grid-cols-5">
        <KpiCard
          label="КАМ в команде"
          value={cams.length}
          icon={Users}
          color="text-sky-600 dark:text-sky-400"
          bg="bg-sky-50 dark:bg-sky-950/40"
        />
        <KpiCard
          label="Взаимодействий в работе"
          value={inWork}
          icon={GitBranch}
          color="text-violet-600 dark:text-violet-400"
          bg="bg-violet-50 dark:bg-violet-950/40"
        />
        <KpiCard
          label="Непрочитанных"
          value={unreadCount}
          icon={Bell}
          color="text-orange-600 dark:text-orange-400"
          bg="bg-orange-50 dark:bg-orange-950/40"
        />
        <KpiCard
          label="Просрочены SLA"
          value={overdueCount}
          icon={Clock1}
          color="text-red-600 dark:text-red-400"
          bg="bg-red-50 dark:bg-red-950/40"
        />
        {/* На мобильных (2 колонки) 5-я карточка остаётся одна в третьей строке —
            растягиваем её на всю ширину, чтобы не было пустой ячейки. */}
        <KpiCard
          className="col-span-2 lg:col-span-1"
          label="Успешные коммуникации"
          value={successful}
          icon={CheckCircle}
          color="text-green-600 dark:text-green-400"
          bg="bg-green-50 dark:bg-green-950/40"
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <StaleTasksBlock interactions={interactions} onSelect={openInteraction} />
        </div>
        <TeamLoadBlock interactions={interactions} employees={cams} />
        <div className="lg:col-span-2">
          <FunnelBlock interactions={interactions} />
        </div>
        <QuickActionsBlock />
        <div className="lg:col-span-3">
          <RecentActionsBlock
            entries={auditLog}
            events={dataSource === "api" ? activityEvents : undefined}
          />
        </div>
      </div>
    </div>
  )
}