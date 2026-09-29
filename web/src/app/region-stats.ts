import type { RegionMapMetric, RegionMapStat } from "@/shared/ui/region-map"
import type { Application, Interaction, Stream, University } from "@/types"

// ========================================
// Статистика по регионам — для карты и таблицы региональной аналитики.
// Регион берётся у вуза; прямые продажи и наборы сайта (без вуза)
// к региону не относятся.
// ========================================

export type RegionMetric = RegionMapMetric

/**
 * Показатели карты. Заявок здесь нет: заявки на обучение — прямые продажи,
 * у них нет вуза, а значит и региона, и карта показывала бы везде ноль.
 */
export const REGION_METRICS: { value: RegionMetric; label: string; short: string }[] = [
  { value: "universityCount", label: "Вузов", short: "вузов" },
  { value: "interactionCount", label: "Взаимодействий", short: "взаимодействий" },
  { value: "studentsCount", label: "Обучается сейчас", short: "обучается" },
  { value: "overdueCount", label: "Просрочено", short: "просрочено" },
]

export function buildRegionStats(input: {
  universities: readonly University[]
  interactions: readonly Interaction[]
  streams: readonly Stream[]
  applications: readonly Application[]
}): RegionMapStat[] {
  const byRegion = new Map<string, RegionMapStat>()
  const regionOf = new Map<string, string>()

  for (const u of input.universities) {
    if (!u.region) continue
    regionOf.set(u.id, u.region)
    let stat = byRegion.get(u.region)
    if (!stat) {
      stat = {
        region: u.region,
        universityCount: 0,
        interactionCount: 0,
        overdueCount: 0,
        studentsCount: 0,
        applicationCount: 0,
        universities: [],
      }
      byRegion.set(u.region, stat)
    }
    stat.universityCount += 1
    stat.universities.push({ name: u.shortName ?? u.name, city: u.city ?? undefined })
  }

  const statOf = (universityId: string | null | undefined) => {
    const region = universityId ? regionOf.get(universityId) : undefined
    return region ? byRegion.get(region) : undefined
  }

  for (const i of input.interactions) {
    const stat = statOf(i.universityId)
    if (!stat) continue
    stat.interactionCount += 1
    if (i.isOverdue) stat.overdueCount += 1
  }

  // Обучаются сейчас — только идущие потоки: завершённые — выпуск.
  for (const s of input.streams) {
    if (s.status !== "active") continue
    const stat = statOf(s.universityId)
    if (stat) stat.studentsCount += s.studentsCount
  }

  for (const a of input.applications) {
    const stat = statOf(a.universityId)
    if (stat) stat.applicationCount += 1
  }

  return [...byRegion.values()]
}
