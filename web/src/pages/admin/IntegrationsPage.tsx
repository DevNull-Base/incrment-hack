import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { toast } from "@/shared/lib/toast-store"
import { Refresh, CheckCircle, XCircle } from "@mynaui/icons-react"
import { api, type IntegrationSourceDto, type IntegrationSyncRunDto } from "@/shared/api"
import { dataSource } from "@/shared/config"

interface DemoSource {
  id: string
  type: "LMS" | "WEBSITE"
  name: string
  baseUrl: string
  isEnabled: boolean
  mode: "stub" | "live"
}

interface DemoRun {
  id: string
  sourceId: string
  status: "SUCCESS" | "FAILED" | "RUNNING"
  created: number
  failed: number
  startedAt: string
}

const DEMO_SOURCES: DemoSource[] = [
  { id: "src-lms", type: "LMS", name: "LMS ИТ-Школы", baseUrl: "https://lms.example.ru", isEnabled: true, mode: "stub" },
  { id: "src-web", type: "WEBSITE", name: "Сайт — заявки", baseUrl: "https://school.example.ru", isEnabled: true, mode: "stub" },
]

const DEMO_RUNS: DemoRun[] = [
  { id: "run-1", sourceId: "src-lms", status: "SUCCESS", created: 12, failed: 0, startedAt: "2025-09-23T10:00:00Z" },
  { id: "run-2", sourceId: "src-web", status: "FAILED", created: 0, failed: 3, startedAt: "2025-09-22T18:00:00Z" },
]

/** Интеграции (ADMIN): источники, прогоны, ручной sync. */
export function IntegrationsPage() {
  return dataSource === "api" ? <IntegrationsLive /> : <IntegrationsDemo />
}

const RUN_ICON: Record<IntegrationSyncRunDto["status"], React.ReactNode> = {
  SUCCESS: <CheckCircle className="size-4 text-success" />,
  PARTIAL: <CheckCircle className="size-4 text-warning" />,
  FAILED: <XCircle className="size-4 text-destructive" />,
  RUNNING: <Refresh className="size-4 animate-spin text-muted-foreground" />,
}

/**
 * Режим API: источники обмена бэкенда (LMS и сайт; на стенде — имитатор
 * внешних систем). Прогон идёт в worker — пока он RUNNING, журнал
 * перечитывается каждые 3 секунды.
 */
function IntegrationsLive() {
  const [sources, setSources] = useState<IntegrationSourceDto[] | null>(null)
  const [runs, setRuns] = useState<IntegrationSyncRunDto[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const loadRuns = () =>
    api.integrations.runs().then(
      (list) => setRuns(list),
      () => {},
    )

  useEffect(() => {
    api.integrations.sources().then(
      (list) => setSources(list),
      () => setSources([]),
    )
    void loadRuns()
  }, [])

  const running = runs.some((r) => r.status === "RUNNING")
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => void loadRuns(), 3000)
    return () => window.clearInterval(timer)
  }, [running])

  const sync = async (source: IntegrationSourceDto) => {
    setBusy(source.id)
    try {
      const run = await api.integrations.sync(source.id)
      setRuns((prev) => [run, ...prev.filter((r) => r.id !== run.id)])
      if (run.status === "FAILED") toast.error("Синхронизация не удалась", run.errorDetail ?? source.name)
      else if (run.status === "RUNNING") toast.info("Синхронизация запущена", source.name)
      else toast.success("Синхронизация завершена", `Создано: ${run.created}, обновлено: ${run.updated}`)
    } catch {
      // ошибку показал клиент API
    } finally {
      setBusy(null)
      void loadRuns()
    }
  }

  const resetCursor = async (source: IntegrationSourceDto) => {
    if (!window.confirm(`Сбросить курсор «${source.name}»? Следующая синхронизация перечитает всё с начала.`)) return
    setBusy(source.id)
    try {
      await api.integrations.resetCursor(source.id)
      setSources((prev) => prev?.map((s) => (s.id === source.id ? { ...s, syncCursor: null } : s)) ?? prev)
      toast.success("Курсор сброшен", source.name)
    } catch {
      // ошибку показал клиент API
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Интеграции</h1>
        <p className="text-sm text-muted-foreground">Источники данных LMS и сайт, прогоны синхронизации</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {!sources && <p className="text-sm text-muted-foreground">Загрузка…</p>}
        {sources?.map((s) => (
          <Card key={s.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span>{s.name}</span>
                <Badge variant={s.mode === "live" ? "default" : "outline"}>
                  {s.mode === "live" ? "обмен по сети" : "встроенные примеры"}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="font-mono text-xs text-muted-foreground">{s.baseUrl}</div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{s.type}</Badge>
                <Badge variant={s.isEnabled ? "default" : "secondary"}>{s.isEnabled ? "включён" : "выключен"}</Badge>
                {s.cronSchedule && <Badge variant="outline">расписание {s.cronSchedule}</Badge>}
              </div>
              <div className="text-xs text-muted-foreground">Курсор: {s.syncCursor ?? "с начала"}</div>
              <div className="flex gap-2">
                <Button size="sm" disabled={busy !== null || !s.isEnabled} onClick={() => void sync(s)}>
                  <Refresh className={busy === s.id ? "size-4 animate-spin" : "size-4"} />
                  {busy === s.id ? "Синхронизация…" : "Синхронизировать"}
                </Button>
                <Button size="sm" variant="outline" disabled={busy !== null || !s.syncCursor} onClick={() => void resetCursor(s)}>
                  Сбросить курсор
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Последние прогоны ({runs.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {runs.length === 0 && <p className="text-sm text-muted-foreground">Прогонов пока не было</p>}
          {runs.map((r) => {
            const source = sources?.find((s) => s.id === r.sourceId)
            return (
              <div key={r.id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {RUN_ICON[r.status]}
                    <span>{source?.name ?? r.sourceId}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    получено {r.fetched} · создано {r.created} · обновлено {r.updated} · пропущено {r.skipped} · ошибок {r.failed}
                    {" · "}
                    {new Date(r.startedAt).toLocaleString("ru-RU")}
                  </div>
                </div>
                {r.errorDetail && <p className="mt-1 text-xs text-destructive">{r.errorDetail}</p>}
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}

/** Демо-режим: источники и прогоны на моках. */
function IntegrationsDemo() {
  const [runs, setRuns] = useState<DemoRun[]>(DEMO_RUNS)
  const [syncing, setSyncing] = useState<string | null>(null)

  useEffect(() => {
    if (!syncing) return
    const t = window.setTimeout(() => {
      const created = 3
      const failed = 0
      setRuns((prev) => [
        {
          id: `run-${Date.now()}`,
          sourceId: syncing,
          status: "SUCCESS",
          created,
          failed,
          startedAt: new Date().toISOString(),
        },
        ...prev,
      ])
      setSyncing(null)
      if (failed > 0) {
        toast.error("Синхронизация завершена", `Ошибок: ${failed}`)
      } else {
        toast.success("Синхронизация завершена", `Создано записей: ${created}`)
      }
    }, 1200)
    return () => window.clearTimeout(t)
  }, [syncing])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Интеграции</h1>
        <p className="text-sm text-muted-foreground">
          Источники данных LMS и сайт, прогоны синхронизации
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {DEMO_SOURCES.map((s) => (
          <Card key={s.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span>{s.name}</span>
                <Badge variant={s.mode === "live" ? "default" : "outline"}>{s.mode}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-xs text-muted-foreground font-mono">{s.baseUrl}</div>
              <div className="flex gap-2">
                <Badge variant="outline">{s.type}</Badge>
                <Badge variant={s.isEnabled ? "default" : "secondary"}>
                  {s.isEnabled ? "включён" : "выключен"}
                </Badge>
              </div>
              <Button
                size="sm"
                disabled={syncing !== null}
                onClick={() => setSyncing(s.id)}
              >
                <Refresh className={syncing === s.id ? "size-4 animate-spin" : "size-4"} />
                {syncing === s.id ? "Синхронизация…" : "Синхронизировать"}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Последние прогоны</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {runs.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-lg border p-3 text-sm">
              <div className="flex items-center gap-2">
                {r.status === "SUCCESS" ? (
                  <CheckCircle className="size-4 text-success" />
                ) : (
                  <XCircle className="size-4 text-destructive" />
                )}
                <span className="font-mono text-xs">{r.sourceId}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                +{r.created} / ошибок: {r.failed} · {new Date(r.startedAt).toLocaleString("ru-RU")}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
