import type * as React from "react"
import { useState } from "react"
import { APP_NOW } from "@/shared/lib/app-now"
import { Link } from "react-router-dom"
import {
  Building,
  BookOpen,
  CalendarDays,
  CheckCircle,
  Download,
  FileText,
  Inbox,
  LogIn,
  Map,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AnimatedNumber } from "@/components/ui/animated-number"
import { Chat, Clock1, DangerTriangle, LayersOne, TrendingUp, Users } from "@mynaui/icons-react"
import {
  workflowLabel,
  type ActivityEvent,
  type AuditLogEntry,
  type Interaction,
  type Notification,
} from "@/types"
import { useStageCatalog } from "@/app/use-stages"
import { auditAction, type AuditVariant } from "@/shared/lib/audit"
import type { StageInfo } from "@/app/workflow-stages"

function formatRelativeTime(value: string): string {
  const elapsed = Math.max(0, APP_NOW - new Date(value).getTime())
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return "только что"
  if (minutes < 60) return `${minutes} мин. назад`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ч. назад`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} дн. назад`
  return new Date(value).toLocaleDateString("ru-RU")
}

/** KPI-карточка. */
export function KpiCard({
  label,
  value,
  icon: Icon,
  color,
  bg,
  className,
}: {
  label: string
  value: string | number
  icon: React.ComponentType<{ className?: string }>
  color: string
  bg: string
  /** Раскладка в сетке — например, растянуть последнюю плитку на мобильных. */
  className?: string
}) {
  return (
    <Card className={className}>
      <CardContent className="flex items-center gap-3 p-3 @sm:gap-4 @sm:p-4">
        <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg @sm:size-10 ${bg}`}>
          <Icon className={`size-4.5 @sm:size-5 ${color}`} />
        </div>
        <div className="min-w-0">
          <div className="text-[2rem] font-light leading-none tabular-nums">
            <AnimatedNumber value={value} />
          </div>
          <div className="mt-1.5 text-[11px] leading-tight font-medium tracking-[0.08em] break-words uppercase text-muted-foreground">
            {label}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/** Баннер ограниченной области видимости dataScope. */
export function ScopeBanner({
  restricted,
  ownerCount,
  universityCount,
}: {
  restricted: boolean
  ownerCount: number | null
  universityCount: number | null
}) {
  if (!restricted && ownerCount == null && universityCount == null) return null
  const parts: string[] = []
  if (ownerCount != null) parts.push(`ответственных: ${ownerCount}`)
  if (universityCount != null) parts.push(`вузов: ${universityCount}`)
  return (
    <div className="rounded-xl border border-warning/40 bg-warning/5 px-4 py-3 text-sm">
      <span className="font-medium">Ограниченный режим доступа</span>
      <span className="text-muted-foreground">
        {parts.length ? ` — видны записи ${parts.join(", ")}` : " — выборка отфильтрована сервером"}
      </span>
    </div>
  )
}

/** «Требует внимания»: непрочитанные уведомления. */
export function AttentionBlock({
  notifications,
  onSelect,
}: {
  notifications: Notification[]
  onSelect?: (n: Notification) => void
}) {
  const unread = notifications.filter((n) => !n.readAt)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <DangerTriangle className="size-4 text-warning" />
          Требует внимания
          {unread.length > 0 && (
            <Badge variant="secondary" className="ml-auto">
              {unread.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="max-h-[320px] space-y-2 overflow-y-auto pr-3">
        {unread.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <CheckCircle className="size-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">Всё под контролем</p>
          </div>
        )}
        {unread.map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => onSelect?.(n)}
            className="w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-medium">{n.subject}</div>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {formatRelativeTime(n.createdAt)}
              </span>
            </div>
            <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {n.body}
            </div>
          </button>
        ))}
      </CardContent>
    </Card>
  )
}

/**
 * Воронка по этапам процесса. В режиме API сегменты идут разными
 * маршрутами — у каждого свои этапы; в демо-режиме этапы общие.
 */
export function FunnelBlock({
  interactions,
  actions,
}: {
  interactions: Interaction[]
  actions?: React.ReactNode
}) {
  const catalog = useStageCatalog()
  const shared = catalog.B2C.every((s) => catalog.B2B.some((b) => b.key === s.key))

  const rows: { segment: string | null; stages: StageInfo[]; items: Interaction[] }[] = shared
    ? [{ segment: null, stages: catalog.B2B, items: interactions }]
    : (["B2B", "B2C"] as const)
        .map((segment) => ({
          segment,
          stages: catalog[segment],
          items: interactions.filter((i) => i.segment === segment),
        }))
        .filter((row) => row.items.length > 0)

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="size-4 text-primary" />
            Воронка взаимодействий
          </CardTitle>
          {actions}
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Нет данных для отображения
          </p>
        ) : (
          <div className="space-y-5">
            {rows.map(({ segment, stages, items }) => {
              // считаем максимум внутри сегмента, а не глобально
              const segmentMax = items.length || 1
              return (
                <div key={segment ?? "all"} className="space-y-2">
                  {segment && (
                    <div className="border-b pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {segment}
                    </div>
                  )}
                  {stages.map((stage, stageIndex) => {
                    const count = items.filter((i) => i.currentStateKey === stage.key).length
                    const pct = (count / segmentMax) * 100
                    return (
                      <div key={stage.key} className="flex items-center gap-3">
                        <div className="w-6 shrink-0 text-right text-xs font-mono text-muted-foreground">
                          {stage.step}
                        </div>
                        <div
                          className="w-32 shrink-0 truncate text-sm sm:w-40"
                          title={stage.label}
                        >
                          {stage.label}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div
                            className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
                            role="progressbar"
                            aria-valuenow={count}
                            aria-valuemin={0}
                            aria-valuemax={segmentMax}
                            aria-label={stage.label}
                          >
                            <div
                              className="h-full rounded-full bg-primary transition-[width] duration-300 ease-[cubic-bezier(0.645,0.045,0.355,1)] chart-grow-x"
                              style={{
                                width: `${Math.max(pct, count > 0 ? 8 : 0)}%`,
                                animationDelay: `${stageIndex * 50}ms`,
                              }}
                            />
                          </div>
                        </div>
                        <div className="w-9 shrink-0 text-right text-xs font-medium tabular-nums text-muted-foreground">
                          <AnimatedNumber value={count} delay={stageIndex * 50} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ========================================
// Мои недавние взаимодействия
// ========================================
export function RecentInteractionsBlock({
  interactions,
  onSelect,
}: {
  interactions: Interaction[]
  onSelect: (id: string) => void
}) {
  const recent = [...interactions]
    .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
    .slice(0, 20)

  return (
    <Card className="flex-1">
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Chat className="size-4 text-sky-500" />
          Мои недавние взаимодействия
        </CardTitle>
      </CardHeader>
      <CardContent className="max-h-[320px] overflow-y-auto pr-1">
        {recent.length === 0 && (
          <p className="text-sm text-muted-foreground">Пока нет взаимодействий</p>
        )}
        <div className="space-y-2 rounded-lg bg-background p-3">
          {recent.map((i) => (
            <Button
              variant="ghost"
              key={i.id}
              type="button"
              onClick={() => onSelect(i.id)}
              className="flex h-auto w-full flex-row-reverse items-center gap-6 rounded-md border border-border/60 bg-card/60 p-2.5 text-left transition-colors duration-150 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none"
            >
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {new Date(i.updatedAt).toLocaleDateString("ru-RU")}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {i.universityName || i.counterpartyName}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {i.currentStateLabel || workflowLabel(i.currentStateKey)}
                </span>
              </span>
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// ========================================
// Мои последние действия (аудит-лента)
// ========================================
const actionLabels: Record<
  string,
  { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
> = {
  create: { label: "Создание", variant: "default" },
  update: { label: "Изменение", variant: "outline" },
  delete: { label: "Удаление", variant: "destructive" },
  login: { label: "Вход", variant: "secondary" },
  export: { label: "Экспорт", variant: "secondary" },
}

const ENTITY_LABELS: Record<string, string> = {
  user: "Пользователь",
  engagement: "Взаимодействие",
  meeting: "Встреча",
  person: "Персона",
  analytics: "Аналитика",
  auth: "Авторизация",
  university: "Вуз",
  document: "Документ",
  license: "Лицензия",
}

function actionDetail(entry: AuditLogEntry): string {
  const state = entry.afterState as { from?: string; to?: string } | null | undefined
  if (state && typeof state === "object" && state.from && state.to) {
    return `Смена статуса: ${workflowLabel(state.from)} → ${workflowLabel(state.to)}`
  }
  if (!entry.entityType) return metaFallback(entry.action)
  return ENTITY_LABELS[entry.entityType] ?? entry.entityType
}

function metaFallback(action: string): string {
  return actionLabels[action]?.label ?? action
}

const ACTION_CHIP: Record<string, string> = {
  create: "bg-success/20 text-success",
  update: "bg-info/20 text-info",
  delete: "bg-destructive/20 text-destructive",
  login: "bg-muted text-muted-foreground",
  export: "bg-muted text-muted-foreground",
}

/** Иконка и цвет — чтобы тип действия читался с одного взгляда. */
const ACTION_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  create: Plus,
  update: Pencil,
  delete: Trash2,
  login: LogIn,
  export: Download,
}

/** Оттенок подписи аудита → чип (коды бэкенда: WORKFLOW_TRANSITION и т.п.). */
const VARIANT_ACTION: Record<AuditVariant, string> = {
  default: "create",
  outline: "update",
  destructive: "delete",
  secondary: "login",
}

/** Тип события ленты → действие для чипа (создание, изменение, удаление). */
function feedAction(type: string): string {
  if (type.endsWith("_CREATED") || type.endsWith("_ADDED")) return "create"
  if (type.endsWith("_DELETED") || type === "ENGAGEMENT_ARCHIVED") return "delete"
  return "update"
}

interface ActionRow {
  id: string
  action: string
  detail: string
  at: string
}

/**
 * Мои последние действия: журнал аудита (администратор) либо лента
 * действий пользователя (режим API — у КАМ и руководителя нет доступа к аудиту).
 */
export function RecentActionsBlock({ entries, events }: { entries: AuditLogEntry[]; events?: ActivityEvent[] }) {
  const rows: ActionRow[] = events
    ? events.map((e) => ({
        id: e.id,
        action: feedAction(e.type),
        detail: e.entityName ? `${e.description} · ${e.entityName}` : e.description,
        at: e.createdAt,
      }))
    : entries.map((entry) => ({ id: entry.id, action: entry.action, detail: actionDetail(entry), at: entry.occurredAt }))
  const recent = rows.sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, 20)

  return (
    <Card className="flex-1">
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock1 className="size-4 text-info" />
          Мои последние действия
        </CardTitle>
      </CardHeader>
      <CardContent className="max-h-[320px] overflow-y-auto pr-1">
        {recent.length === 0 && (
          <p className="text-sm text-muted-foreground">Действий пока нет</p>
        )}
        <div className="space-y-2 rounded-lg bg-background p-3">
          {recent.map((entry) => {
            const known = auditAction(entry.action)
            const label = known.label
            const chip = ACTION_CHIP[entry.action] ?? ACTION_CHIP[VARIANT_ACTION[known.variant]]
            const Icon = ACTION_ICON[entry.action] ?? ACTION_ICON.update
            return (
              <div
                key={entry.id}
                className="flex items-center flex-row-reverse gap-6 rounded-md border border-border/60 bg-card/60 p-2.5"
              >
                <span
                  className={`flex shrink-0 items-start gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${chip}`}
                >
                  <Icon className="size-3" />
                  {label}
                </span>
                <span className="min-w-0 flex-1 items-center">
                  <span className="block truncate text-sm text-foreground">
                    {entry.detail}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground tabular-nums">
                    {new Date(entry.at).toLocaleString("ru-RU", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </span>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

// ========================================
// Зависшие задачи — статус без изменений N+ дней (порог настраивается)
// ========================================
const STALE_DAYS_KEY = "crm_stale_days"
const STALE_THRESHOLDS = [7, 14, 30]

export function StaleTasksBlock({
  interactions,
  onSelect,
}: {
  interactions: Interaction[]
  onSelect: (id: string) => void
}) {
  const [threshold, setThreshold] = useState<number>(() => {
    const saved = Number(localStorage.getItem(STALE_DAYS_KEY))
    return STALE_THRESHOLDS.includes(saved) ? saved : 30
  })

  const changeThreshold = (value: number) => {
    setThreshold(value)
    try {
      localStorage.setItem(STALE_DAYS_KEY, String(value))
    } catch {
      // localStorage недоступен — порог живёт до перезагрузки
    }
  }

  const catalog = useStageCatalog()
  const stale = interactions
    .filter((i) => !catalog[i.segment]?.find((s) => s.key === i.currentStateKey)?.isFinal)
    .map((i) => ({
      interaction: i,
      days: Math.floor((APP_NOW - new Date(i.updatedAt).getTime()) / 86_400_000),
    }))
    .filter((x) => x.days >= threshold)
    .sort((a, b) => b.days - a.days)

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <DangerTriangle className="size-4 text-warning" />
            Зависшие задачи
            {stale.length > 0 && (
              <Badge variant="secondary">{stale.length}</Badge>
            )}
          </CardTitle>
          <select
            value={threshold}
            onChange={(e) => changeThreshold(Number(e.target.value))}
            aria-label="Порог зависания заявки"
            className="rounded-md border bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            {STALE_THRESHOLDS.map((d) => (
              <option key={d} value={d}>
                {d}+ дней
              </option>
            ))}
          </select>
        </div>
      </CardHeader>
      <CardContent className="max-h-[320px] space-y-2 overflow-y-auto pr-3">
        {stale.length === 0 && (
          <p className="text-sm text-muted-foreground">Зависших задач нет</p>
        )}
        {stale.map(({ interaction: i, days }) => (
          <button
            key={i.id}
            type="button"
            onClick={() => onSelect(i.id)}
            className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card/60 p-3 text-left transition-colors duration-150 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {i.universityName || i.counterpartyName}
              </span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {i.currentStateLabel || workflowLabel(i.currentStateKey)}
              </span>
            </span>
            {i.isOverdue && (
              <Badge variant="destructive" className="shrink-0">
                Просрочен
              </Badge>
            )}
            <Badge variant="outline" className="shrink-0 tabular-nums">
              {days} дн.
            </Badge>
          </button>
        ))}
      </CardContent>
    </Card>
  )
}

// ========================================
// Загрузка по ответственным
// ========================================
export function TeamLoadBlock({
  interactions,
  employees,
}: {
  interactions: Interaction[]
  employees: { id: string; displayName: string }[]
}) {
  const rows = employees
    .map((e) => {
      const mine = interactions.filter((i) => i.ownerId === e.id)
      return {
        id: e.id,
        name: e.displayName,
        count: mine.length,
        overdue: mine.filter((i) => i.isOverdue).length,
      }
    })
    .sort((a, b) => b.count - a.count)
  const max = Math.max(...rows.map((r) => r.count), 1)

  return (
    <Card className="flex-1">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="size-4 text-violet-500" />
          Загрузка по ответственным
        </CardTitle>
      </CardHeader>
      <CardContent className="max-h-[320px] overflow-y-auto">
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground">Сотрудников нет</p>
        )}
        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={r.id} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
                  {r.overdue > 0 && (
                    <Badge variant="destructive" className="text-[10px]">
                      {r.overdue}
                    </Badge>
                  )}
                  <span className="text-muted-foreground">{r.count}</span>
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary chart-grow-x"
                  style={{
                    width: `${Math.max((r.count / max) * 100, r.count > 0 ? 8 : 0)}%`,
                    animationDelay: `${i * 60}ms`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// ========================================
// Быстрые действия
// ========================================
const QUICK_ACTIONS: {
  to: string
  label: string
  desc: string
  icon: React.ComponentType<{ className?: string }>
  color: string
  bg: string
}[] = [
  {
    to: "/universities",
    label: "К списку вузов",
    desc: "Реестр вузов-партнёров",
    icon: Building,
    color: "text-sky-600 dark:text-sky-400",
    bg: "bg-sky-50 group-hover:bg-sky-100 dark:bg-sky-950/40 dark:group-hover:bg-sky-950/70",
  },
  {
    to: "/programs",
    label: "Программы обучения",
    desc: "Каталог программ",
    icon: BookOpen,
    color: "text-violet-600 dark:text-violet-400",
    bg: "bg-violet-50 group-hover:bg-violet-100 dark:bg-violet-950/40 dark:group-hover:bg-violet-950/70",
  },
  {
    to: "/applications",
    label: "Заявки",
    desc: "Новые и в работе",
    icon: Inbox,
    color: "text-green-600 dark:text-green-400",
    bg: "bg-green-50 group-hover:bg-green-100 dark:bg-green-950/40 dark:group-hover:bg-green-950/70",
  },
  {
    to: "/calendar",
    label: "Календарь",
    desc: "Встречи, задачи и сроки",
    icon: CalendarDays,
    color: "text-orange-600 dark:text-orange-400",
    bg: "bg-orange-50 group-hover:bg-orange-100 dark:bg-orange-950/40 dark:group-hover:bg-orange-950/70",
  },
  {
    to: "/documents",
    label: "Документы",
    desc: "Файлы этапов взаимодействий",
    icon: FileText,
    color: "text-indigo-600 dark:text-indigo-400",
    bg: "bg-indigo-50 group-hover:bg-indigo-100 dark:bg-indigo-950/40 dark:group-hover:bg-indigo-950/70",
  },
  {
    to: "/region-map",
    label: "Карта вузов",
    desc: "География присутствия",
    icon: Map,
    color: "text-teal-600 dark:text-teal-400",
    bg: "bg-teal-50 group-hover:bg-teal-100 dark:bg-teal-950/40 dark:group-hover:bg-teal-950/70",
  },
]

export function QuickActionsBlock() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <LayersOne className="size-4 text-success" />
          Быстрые действия
        </CardTitle>
      </CardHeader>
      {/* Колонки — по ширине карточки: без @container классы @md/@2xl не срабатывают. */}
      <CardContent className="@container">
        <div className="grid grid-cols-1 gap-3 @md:grid-cols-2 @2xl:grid-cols-3">
          {QUICK_ACTIONS.map((action) => (
            <Link
              key={action.to}
              to={action.to}
              className="group flex items-start gap-3 rounded-lg border border-border/60 bg-card p-4 transition-all duration-150 ease-out hover:-translate-y-0.5 hover:border-primary/30 hover:bg-muted/50 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none"
            >
              <span
                className={`flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors duration-150 ${action.bg}`}
              >
                <action.icon className={`size-4.5 ${action.color}`} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{action.label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{action.desc}</span>
              </span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
