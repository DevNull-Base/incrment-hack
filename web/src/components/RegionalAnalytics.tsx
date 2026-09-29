import { useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { MapPin } from "@mynaui/icons-react"
import { RegionMap } from "@/components/ui/region-map"
import { useStore } from "@/app/store"
import {
  selectApplications,
  selectStreams,
  selectUniversities,
  selectWorkingInteractions,
} from "@/app/store/selectors"
import { buildRegionStats, REGION_METRICS, type RegionMetric } from "@/app/region-stats"
import { FilterChips } from "@/shared/ui/filter-chips"
import { ChartExportButtons } from "@/components/ChartExportButtons"
import type { ChartSpec } from "@/shared/lib/chart-export"
import { useWorkspaceState } from "@/shared/lib/workspace"
import { cn } from "@/lib/utils"

/**
 * Региональная аналитика: карта России, раскрашенная по выбранному
 * показателю, и таблица регионов по тому же показателю. Показатель
 * запоминается — и на аналитике, и на странице карты он один.
 */
export function RegionalAnalytics({ withTable = true }: { withTable?: boolean }) {
  const universities = useStore(selectUniversities)
  const interactions = useStore(selectWorkingInteractions)
  const streams = useStore(selectStreams)
  const applications = useStore(selectApplications)
  const [view, setView] = useWorkspaceState<{ metric: RegionMetric }>("regions.map", { metric: "interactionCount" })

  const metric = REGION_METRICS.some((m) => m.value === view.metric) ? view.metric : "interactionCount"
  const metricInfo = REGION_METRICS.find((m) => m.value === metric) ?? REGION_METRICS[1]

  const stats = useMemo(
    () => buildRegionStats({ universities, interactions, streams, applications }),
    [universities, interactions, streams, applications],
  )
  const sorted = useMemo(
    () => [...stats].sort((a, b) => b[metric] - a[metric] || a.region.localeCompare(b.region, "ru")),
    [stats, metric],
  )

  const spec = (): ChartSpec => ({
    title: `Регионы: ${metricInfo.label.toLowerCase()}`,
    subtitle: "Региональная аналитика; в подписи — вузов и взаимодействий региона",
    rows: sorted
      .filter((s) => s[metric] > 0)
      .map((s) => ({
        label: s.region,
        value: s[metric],
        caption: `${s[metric].toLocaleString("ru-RU")} · ${s.universityCount} вуз. · ${s.interactionCount} вз.`,
      })),
  })

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="size-4" />
            Региональная аналитика
          </CardTitle>
          <ChartExportButtons spec={spec} fileName="региональная-аналитика" />
        </div>
        <FilterChips
          ariaLabel="Показатель на карте"
          options={REGION_METRICS.map((m) => ({ value: m.value, label: m.label }))}
          value={metric}
          onChange={(value) => setView({ metric: value })}
        />
      </CardHeader>
      <CardContent className="space-y-4">
        <RegionMap stats={stats} metric={metric} metricLabel={metricInfo.label} title="Карта регионов" />

        {withTable && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Регион</TableHead>
                  {REGION_METRICS.map((m) => (
                    <TableHead key={m.value} className={cn("text-right", m.value === metric && "text-foreground")}>
                      {m.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((s, index) => (
                  <TableRow key={s.region}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{index + 1}</TableCell>
                    <TableCell className="font-medium">{s.region}</TableCell>
                    {REGION_METRICS.map((m) => (
                      <TableCell
                        key={m.value}
                        className={cn(
                          "text-right tabular-nums",
                          m.value === metric ? "font-semibold" : "text-muted-foreground",
                          m.value === "overdueCount" && s.overdueCount > 0 && "text-destructive",
                        )}
                      >
                        {s[m.value].toLocaleString("ru-RU")}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
