import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { TrendingUp } from "@mynaui/icons-react"
import { useStore } from "@/app/store"
import {
  selectStreams,
  selectWorkingInteractions,
  selectPrograms,
} from "@/app/store/selectors"
import { dataSource } from "@/shared/config"
import { ReportsCard } from "@/components/ReportsCard"
import { FunnelBlock } from "@/pages/dashboard/blocks"
import { studyingNow } from "@/shared/lib/streams"
import { ChartExportButtons } from "@/components/ChartExportButtons"
import { RegionalAnalytics } from "@/components/RegionalAnalytics"
import type { ChartRow, ChartSpec } from "@/shared/lib/chart-export"

const isApi = dataSource === "api"

export function AnalyticsPage() {
  const programs = useStore(selectPrograms)
  const interactions = useStore(selectWorkingInteractions)
  const streams = useStore(selectStreams)
  // Востребованность программы — обучаются сейчас по её идущим потокам.
  const studentsOf = (programId: string) => studyingNow(streams.filter((s) => s.programId === programId))
  const stageCatalog = useStore((s) => s.stageCatalog)

  // Данные диаграмм для выгрузки — те же, что на экране.
  const rankingSpec = (): ChartSpec => ({
    title: "Ранжирование программ по востребованности",
    subtitle: "Обучаются сейчас — по идущим учебным потокам",
    rows: [...programs]
      .map((p) => ({ label: p.name, value: studentsOf(p.id) }))
      .sort((a, b) => b.value - a.value),
  })
  const funnelSpec = (): ChartSpec => {
    const rows: ChartRow[] = []
    const groups: { index: number; title: string }[] = []
    for (const segment of ["B2B", "B2C"] as const) {
      const items = interactions.filter((i) => i.segment === segment)
      if (items.length === 0) continue
      groups.push({ index: rows.length, title: segment === "B2B" ? "Вузы (B2B)" : "Прямые продажи (B2C)" })
      for (const stage of stageCatalog[segment]) {
        rows.push({ label: stage.label, value: items.filter((i) => i.currentStateKey === stage.key).length })
      }
    }
    return { title: "Воронка взаимодействий", subtitle: "Взаимодействий на каждом этапе процесса", rows, groups }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Аналитика</h1>
        <p className="text-sm text-muted-foreground">Отчёты, ранжирование, региональная аналитика</p>
      </div>

      {isApi && <ReportsCard />}

      {/* Program ranking */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="size-4" />
              Ранжирование программ по востребованности
            </CardTitle>
            <ChartExportButtons spec={rankingSpec} fileName="ранжирование-программ" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[...programs]
              .sort((a, b) => studentsOf(b.id) - studentsOf(a.id))
              .map((program, idx) => {
                const maxStudents = Math.max(...programs.map((p) => studentsOf(p.id)), 1)
                const pct = (studentsOf(program.id) / maxStudents) * 100
                return (
                  <div key={program.id} className="flex items-center gap-4">
                    <div className="w-6 text-right text-sm font-mono text-muted-foreground">{idx + 1}</div>
                    <div className="w-48 truncate text-sm font-medium">{program.name}</div>
                    <div className="flex-1">
                      <div className="h-6 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="flex h-full items-center justify-end rounded-full bg-primary px-2 text-[10px] font-medium text-primary-foreground"
                          style={{ width: `${pct}%` }}
                        >
                          {studentsOf(program.id).toLocaleString("ru-RU")}
                        </div>
                      </div>
                    </div>
                    <Badge variant="outline" className="w-16 justify-center font-mono">
                      {program.hoursTotal ?? "—"} ч
                    </Badge>
                  </div>
                )
              })}
          </div>
        </CardContent>
      </Card>

      <RegionalAnalytics />

      {/* Воронка — по текущим этапам взаимодействий */}
      <FunnelBlock
        interactions={interactions}
        actions={<ChartExportButtons spec={funnelSpec} fileName="воронка-взаимодействий" />}
      />
    </div>
  )
}
