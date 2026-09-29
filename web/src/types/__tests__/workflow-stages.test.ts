import { describe, it, expect } from "vitest"
import { WORKFLOW_STAGES } from "@/types"

describe("WORKFLOW_STAGES", () => {
  it("should have exactly 14 stages", () => {
    expect(WORKFLOW_STAGES).toHaveLength(14)
  })

  it("should have sequential step numbers 1-14", () => {
    const steps = WORKFLOW_STAGES.map((s) => s.step)
    expect(steps).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
  })

  it("should have unique keys", () => {
    const keys = WORKFLOW_STAGES.map((s) => s.key)
    const uniqueKeys = new Set(keys)
    expect(uniqueKeys.size).toBe(14)
  })

  it("should start with SEARCH_CONTACTS and end with STAGE_CONTROL", () => {
    expect(WORKFLOW_STAGES[0].key).toBe("SEARCH_CONTACTS")
    expect(WORKFLOW_STAGES[13].key).toBe("STAGE_CONTROL")
  })

  it("each stage should have key, label, and step", () => {
    WORKFLOW_STAGES.forEach((stage) => {
      expect(stage).toHaveProperty("key")
      expect(stage).toHaveProperty("label")
      expect(stage).toHaveProperty("step")
      expect(typeof stage.key).toBe("string")
      expect(typeof stage.label).toBe("string")
      expect(typeof stage.step).toBe("number")
    })
  })
})
