import { CheckCircle, Clipboard, Clock1, FileText, Inbox } from "@mynaui/icons-react"
import { useNavigate } from "react-router-dom"
import { useStore } from "@/app/store"
import { APP_NOW } from "@/shared/lib/app-now"
import {
  selectApplications,
  selectAuditLog,
  selectDocuments,
  selectWorkingInteractions,
} from "@/app/store/selectors"
import {
  KpiCard,
  QuickActionsBlock,
  RecentActionsBlock,
  RecentInteractionsBlock,
  ScopeBanner,
  StaleTasksBlock,
} from "./blocks"
import { useStageCatalog } from "@/app/use-stages"
import { stageIndexOf, type StageCatalog } from "@/app/workflow-stages"
import type { Interaction } from "@/types"
import { useStaleNotifications } from "@/app/use-stale-notifications"
import { dataSource } from "@/shared/config"

const isApi = dataSource === "api"

/**
 * Коммуникация состоялась: взаимодействие дошло до третьего этапа своего
 * процесса (в B2B это «Организация встречи») и не закрыто отказом.
 */
function passedCommunication(catalog: StageCatalog, i: Interaction): boolean {
  const stages = catalog[i.segment]
  const stage = stages.find((s) => s.key === i.currentStateKey)
  return !stage?.isRejected && stageIndexOf(stages, i.currentStateKey) >= 2
}

/** Главная для менеджера: заявки, вузы, программы — цифры и рабочие очереди. */
export function DashboardManager() {
  const navigate = useNavigate()
  const user = useStore((s) => s.user)
  const interactions = useStore(selectWorkingInteractions)
  const catalog = useStageCatalog()
  const applications = useStore(selectApplications)
  const documents = useStore(selectDocuments)
  const calendarEvents = useStore((s) => s.calendarEvents)
  const auditLog = useStore(selectAuditLog)
  const activityEvents = useStore((s) => s.activityEvents)
  const tasks = useStore((s) => s.calendarTasks)
  const scope = user?.dataScope

  const inProgressApplications = applications.filter(
    (a) => a.status === "new" || a.status === "processing",
  ).length
  const successfulComms = interactions.filter(
    (i) => passedCommunication(catalog, i),
  ).length
  const overdueCount = interactions.filter((i) => i.isOverdue).length
  const docsInReview = documents.filter((d) => d.status === "review").length
  // Режим API: согласования документов у бэкенда нет — показываем задачи.
  const openTasks = tasks.filter((t) => !t.isCompleted).length
  // Встречи на ближайшие семь дней — из календаря (режим API — встречи с вузами).
  const upcomingMeetings = calendarEvents.filter((e) => {
    if (e.type !== "meeting" || e.color === "gray") return false
    const diff = new Date(e.start).getTime() - APP_NOW
    return diff >= 0 && diff < 7 * 24 * 60 * 60 * 1000
  }).length

  const openInteraction = (id: string) => navigate(`/interactions/${id}`)

  useStaleNotifications()

  // @container вместо viewport-брееков: в split-панели ширина контента
  // около половины экрана, поэтому lg: считался бы неверно.
  return (
    <div className="@container space-y-5">
      <div>
        <h1 className="text-2xl font-bold">
          Добрый день, {user?.displayName?.trim().split(" ")[1] || "коллега"}
        </h1>
        <p className="text-sm text-muted-foreground">
          Хорошего рабочего дня!
        </p>
      </div>

      {scope && (
        <ScopeBanner
          restricted={scope.restricted}
          ownerCount={scope.ownerCount}
          universityCount={scope.universityCount}
        />
      )}

      {/* Цифры сверху */}
      <div className="grid grid-cols-2 gap-4 @min-[36rem]:grid-cols-3 @min-[60rem]:grid-cols-5">
        <KpiCard
          label="Заявки в работе"
          value={inProgressApplications}
          icon={Inbox}
          color="text-sky-600 dark:text-sky-400"
          bg="bg-sky-50 dark:bg-sky-950/40"
        />
        <KpiCard
          label="Успешные коммуникации"
          value={successfulComms}
          icon={CheckCircle}
          color="text-green-600 dark:text-green-400"
          bg="bg-green-50 dark:bg-green-950/40"
        />
        <KpiCard
          label="Просрочены SLA"
          value={overdueCount}
          icon={Clock1}
          color="text-red-600 dark:text-red-400"
          bg="bg-red-50 dark:bg-red-950/40"
        />
        <KpiCard
          label={isApi ? "Открытые задачи" : "Документы на согласовании"}
          value={isApi ? openTasks : docsInReview}
          icon={FileText}
          color="text-violet-600 dark:text-violet-400"
          bg="bg-violet-50 dark:bg-violet-950/40"
        />
        <KpiCard
          label="Встречи на неделе"
          value={upcomingMeetings}
          icon={Clipboard}
          color="text-orange-600 dark:text-orange-400"
          bg="bg-orange-50 dark:bg-orange-950/40"
        />
      </div>

      {/* Основная сетка: слева — ленты, справа — широкий блок и быстрые действия */}
      <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-3">
        <div className="flex flex-col gap-4">
          <RecentInteractionsBlock interactions={interactions} onSelect={openInteraction} />
          <RecentActionsBlock entries={auditLog} events={isApi ? activityEvents : undefined} />
        </div>
        <div className="flex flex-col gap-4 @3xl:col-span-2">
          <QuickActionsBlock />
          <StaleTasksBlock interactions={interactions} onSelect={openInteraction} />
        </div>
      </div>
    </div>
  )
}
