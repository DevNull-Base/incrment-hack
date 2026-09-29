import { describe, expect, it } from "vitest"
import { buildRegionStats } from "../region-stats"
import { levelRanges, regionLevel } from "@/shared/ui/region-map-levels"
import type { Application, Interaction, Stream, University } from "@/types"

const uni = (id: string, region: string | null): University =>
  ({ id, name: `Вуз ${id}`, shortName: id, region, city: null }) as University

describe("статистика по регионам", () => {
  it("считает вузы, взаимодействия, просрочки, обучающихся и заявки по региону вуза", () => {
    const stats = buildRegionStats({
      universities: [uni("u1", "Москва"), uni("u2", "Москва"), uni("u3", "Томская область"), uni("u4", null)],
      interactions: [
        { universityId: "u1", isOverdue: true },
        { universityId: "u2", isOverdue: false },
        { universityId: null, isOverdue: true },
      ] as Interaction[],
      streams: [
        { universityId: "u1", status: "active", studentsCount: 30 },
        { universityId: "u1", status: "completed", studentsCount: 50 },
        { universityId: "u3", status: "active", studentsCount: 20 },
        { universityId: null, status: "active", studentsCount: 99 },
      ] as Stream[],
      applications: [{ universityId: "u3" }, { universityId: undefined }] as Application[],
    })
    const moscow = stats.find((s) => s.region === "Москва")
    expect(moscow).toMatchObject({ universityCount: 2, interactionCount: 2, overdueCount: 1, studentsCount: 30, applicationCount: 0 })
    expect(stats.find((s) => s.region === "Томская область")).toMatchObject({ studentsCount: 20, applicationCount: 1 })
    expect(stats).toHaveLength(2)
  })
})

describe("ступени раскраски карты", () => {
  it("значение попадает в ступень, указанную для него в легенде", () => {
    for (const max of [1, 2, 3, 7, 10, 125]) {
      for (const range of levelRanges(max)) {
        for (let v = range.from; v <= range.to; v++) expect(regionLevel(v, max)).toBe(range.level)
      }
      const covered = levelRanges(max).reduce((n, r) => n + (r.to - r.from + 1), 0)
      expect(covered).toBe(max)
    }
  })

  it("ноль и отсутствие данных — вне ступеней", () => {
    expect(regionLevel(0, 10)).toBe(-1)
    expect(regionLevel(5, 0)).toBe(-1)
    expect(regionLevel(10, 10)).toBe(3)
  })
})
