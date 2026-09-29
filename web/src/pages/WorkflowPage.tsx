import { useState } from "react"
import { Link } from "react-router-dom"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useStages } from "@/app/use-stages"
import { isClosedStage, stageProgress } from "@/app/workflow-stages"
import { useStore } from "@/app/store"
import { selectWorkingInteractions } from "@/app/store/selectors"
import { ROLE_LABELS } from "@/shared/lib/roles"
import { cn } from "@/shared/lib/utils"
import type { Segment } from "@/shared/api"
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  CircleUserRound,
  Clock,
  FileText,
  GitBranch,
  MessageSquare,
  Workflow as WorkflowIcon,
} from "lucide-react"

const SEGMENT_LABELS: Record<Segment, string> = {
  B2B: "Вузы · B2B",
  B2C: "Прямые продажи · B2C",
}

/**
 * Workflow — действующая редакция процесса сегмента.
 *
 * ТЗ требует визуализировать цикл взаимодействия и разрешает менять
 * workflow, поэтому этапы, сроки и переходы берутся из опубликованной
 * редакции, а не из текста: после правки в редакторе страница показывает
 * новый маршрут сразу. Базовый процесс из 14 пунктов ТЗ — первая редакция
 * шаблона B2B.
 */
export function WorkflowPage() {
  const [segment, setSegment] = useState<Segment>("B2B")
  const [expanded, setExpanded] = useState<string | null>(null)
  const stages = useStages(segment)
  const template = useStore((s) => s.templateForSegment(segment))
  const definition = useStore((s) => (template ? s.workflowDefinitions[template.id] : undefined))
  const interactions = useStore(selectWorkingInteractions)
  const role = useStore((s) => s.user?.role)

  const inSegment = interactions.filter((i) => i.segment === segment)
  const countByStage = new Map<string, number>()
  for (const i of inSegment) countByStage.set(i.currentStateKey, (countByStage.get(i.currentStateKey) ?? 0) + 1)
  const labelOf = (key: string) => stages.find((s) => s.key === key)?.label ?? key
  const transitionsFrom = (key: string) => (definition?.transitions ?? []).filter((t) => t.from === key)

  // Пример — первая незавершённая заявка сегмента из видимых пользователю.
  const example = inSegment.find((i) => !isClosedStage(stages, i.currentStateKey))
  const exampleProgress = example ? stageProgress(stages, example.currentStateKey) : null
  const path = stages.filter((s) => !s.isRejected)

  const published = template?.publishedAt ? new Date(template.publishedAt).toLocaleDateString("ru-RU") : null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Workflow</h1>
          <p className="text-sm text-muted-foreground">
            {template
              ? `Действующая редакция «${template.name}» · v${template.version}${published ? ` от ${published}` : ""} · этапов: ${stages.length}`
              : "Процесс сегмента не опубликован"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-lg border p-1">
            {(["B2B", "B2C"] as const).map((seg) => (
              <button
                key={seg}
                type="button"
                onClick={() => {
                  setSegment(seg)
                  setExpanded(null)
                }}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  segment === seg ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {SEGMENT_LABELS[seg]}
              </button>
            ))}
          </div>
          {role === "ADMIN" && (
            <Link to="/admin/flow-editor">
              <Button variant="outline" size="sm">Изменить в редакторе</Button>
            </Link>
          )}
        </div>
      </div>

      {/* Маршрут целиком — одной строкой, клик раскрывает этап */}
      {path.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <GitBranch className="size-4 text-violet-600 dark:text-violet-400" />
              Маршрут
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-2">
              {path.map((stage, idx) => (
                <div key={stage.key} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setExpanded(stage.key)}
                    className="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
                  >
                    {stage.step}. {stage.label}
                  </button>
                  {idx < path.length - 1 && <ArrowRight className="size-3 text-muted-foreground" />}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {example && exampleProgress && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CircleUserRound className="size-4 text-emerald-600 dark:text-emerald-400" />
              Пример: {example.universityShortName ?? example.universityName ?? example.counterpartyName}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="outline">{example.directionName}</Badge>
              {example.productName && <Badge variant="outline">{example.productName}</Badge>}
              <span className="text-muted-foreground">
                Этап {exampleProgress.completed} из {exampleProgress.total} · {example.currentStateLabel}
              </span>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${exampleProgress.pct}%` }} />
              </div>
              <span className="font-mono text-sm">{exampleProgress.pct}%</span>
            </div>
            <Link to={`/interactions/${example.id}`}>
              <Button variant="outline" size="sm" className="mt-3">Открыть взаимодействие</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {stages.map((stage) => {
          const isExpanded = expanded === stage.key
          const outgoing = transitionsFrom(stage.key)
          const count = countByStage.get(stage.key) ?? 0
          return (
            <Card key={stage.key} className={isExpanded ? "ring-2 ring-primary" : ""}>
              <CardHeader
                className="cursor-pointer select-none"
                onClick={() => setExpanded(isExpanded ? null : stage.key)}
              >
                <div className="flex items-center gap-4">
                  <div
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                      stage.isRejected ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground",
                    )}
                  >
                    {stage.step}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <WorkflowIcon className={cn(
                          "size-4",
                          stage.isRejected
                            ? "text-slate-500 dark:text-slate-400"
                            : stage.isFinal
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-blue-600 dark:text-blue-400",
                        )} />
                        {stage.label}
                      </CardTitle>
                      {stage.isRejected && <Badge variant="secondary">Отказ</Badge>}
                      {stage.isFinal && !stage.isRejected && <Badge variant="outline">Итог</Badge>}
                      {stage.requiresAttachment && (
                        <Badge variant="outline" className="gap-1">
                          <FileText className="size-3" />Нужен документ
                        </Badge>
                      )}
                    </div>
                    {stage.slaDays ? (
                      <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="size-3" />Срок этапа: {stage.slaDays} дн.
                      </div>
                    ) : null}
                  </div>
                  <Badge variant={count > 0 ? "default" : "secondary"} className="shrink-0 tabular-nums">
                    Сейчас: {count}
                  </Badge>
                  {isExpanded ? <ChevronUp className="size-4 shrink-0" /> : <ChevronDown className="size-4 shrink-0" />}
                </div>
              </CardHeader>

              {isExpanded && (
                <CardContent className="pt-0">
                  <Separator className="mb-4" />
                  {stage.description && <p className="mb-4 text-sm text-muted-foreground">{stage.description}</p>}
                  {stage.requiresAttachment && (
                    <p className="mb-4 text-sm">
                      Перейти дальше можно только с файлом, приложенным на этом этапе.
                    </p>
                  )}
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Переходы с этапа
                  </div>
                  {outgoing.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">Этап завершающий — переходов нет.</p>
                  ) : (
                    <div className="mt-2 space-y-1.5">
                      {outgoing.map((t) => (
                        <div key={`${t.from}->${t.to}`} className="flex flex-wrap items-center gap-2 text-sm">
                          <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="font-medium">{labelOf(t.to)}</span>
                          {t.label && <span className="text-muted-foreground">— {t.label}</span>}
                          {t.requiresComment && (
                            <Badge variant="outline" className="gap-1">
                              <MessageSquare className="size-3" />Комментарий обязателен
                            </Badge>
                          )}
                          {t.allowedRoles && t.allowedRoles.length > 0 && (
                            <Badge variant="secondary">
                              Только: {t.allowedRoles.map((r) => ROLE_LABELS[r]).join(", ")}
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
