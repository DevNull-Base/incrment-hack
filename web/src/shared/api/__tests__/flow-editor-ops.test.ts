import { describe, it, expect } from "vitest"
import {
  genKey,
  renumberOrders,
  reorderStates,
  matchStates,
  insertStateAfter,
  removeStateWithRemap,
  mockPublishPreview,
  type ToolBlock,
} from "@/shared/api/flow-editor-ops"
import { parseDefinition, type WorkflowDefinitionV1 } from "@/shared/api/workflow-definition"

function linearDef(labels: string[]): WorkflowDefinitionV1 {
  const states = labels.map((label, i) => ({
    key: label.toUpperCase(),
    label,
    kind: (i === 0 ? "initial" : i === labels.length - 1 ? "final" : "normal") as
      | "initial"
      | "normal"
      | "final",
    order: i + 1,
  }))
  const transitions = states.slice(1).map((s, i) => ({
    key: `t${i + 1}`,
    from: states[i].key,
    to: s.key,
    label: `→ ${s.label}`,
  }))
  return { schemaVersion: 1, states, transitions }
}

const block: ToolBlock = {
  id: "tool-1",
  label: "Новый этап",
  description: "",
  payload: {},
}

describe("genKey", () => {
  it("генерирует уникальный ключ по label", () => {
    // Бэкенд принимает ключи только ^[A-Z][A-Z0-9_]*$ — кириллица транслитерируется.
    const k = genKey("Новый этап", [])
    expect(k).toBe("NOVYY_ETAP_1")
    expect(genKey("1-й созвон", [])).toMatch(/^[A-Z][A-Z0-9_]*$/)
    const k2 = genKey("New stage", ["NEW_STAGE_1"])
    expect(k2).toBe("NEW_STAGE_2")
  })

  it("заменяет недопустимые символы и не даёт дубликат", () => {
    const k1 = genKey("A/B:C", [])
    expect(k1).toBe("A_B_C_1")
    expect(genKey("A/B:C", [k1])).toBe("A_B_C_2")
  })
})

describe("renumberOrders / reorderStates", () => {
  it("order = индекс + 1 после reorder", () => {
    const def = linearDef(["Alpha", "Beta", "Gamma"])
    const moved = reorderStates(def.states, 2, 0)
    expect(moved.map((s) => s.key)).toEqual(["GAMMA", "ALPHA", "BETA"])
    expect(moved.map((s) => s.order)).toEqual([1, 2, 3])
  })

  it("renumberOrders не меняет порядок", () => {
    const states = linearDef(["A", "B"]).states.map((s) => ({ ...s, order: 99 }))
    expect(renumberOrders(states).map((s) => s.order)).toEqual([1, 2])
  })
})

describe("matchStates", () => {
  it("находит matched/added/removed/renamed", () => {
    const base = linearDef(["Alpha", "Beta", "Gamma"])
    const draft: WorkflowDefinitionV1 = {
      ...base,
      states: [
        { ...base.states[0], label: "Alpha v2" }, // renamed
        { key: "DELTA", label: "Delta", kind: "normal", order: 2 }, // added
        base.states[2], // matched (Gamma); Beta удалён
      ],
    }
    const m = matchStates(base, draft)
    expect(m.renamed).toEqual(["ALPHA"])
    expect(m.added).toEqual(["DELTA"])
    expect(m.removed).toEqual(["BETA"])
    expect(m.matched).toContain("GAMMA")
    expect(m.matched).not.toContain("BETA")
  })
})

describe("insertStateAfter", () => {
  it("вставка в середину перешивает A→B в A→N→B и проходит parseDefinition", () => {
    const def = linearDef(["Alpha", "Beta", "Gamma"])
    const res = insertStateAfter(def, 0, { ...block, label: "Middle" })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.def.states.map((s) => s.key)).toEqual(["ALPHA", "MIDDLE_1", "BETA", "GAMMA"])
    expect(res.def.transitions.find((t) => t.from === "ALPHA")?.to).toBe("MIDDLE_1")
    expect(res.def.transitions.find((t) => t.from === "MIDDLE_1")?.to).toBe("BETA")
    expect(() => parseDefinition(res.def)).not.toThrow()
  })

  it("вставка в конец при final в хвосте вставляет перед ним", () => {
    const def = linearDef(["Alpha", "Beta", "Finish"])
    const res = insertStateAfter(def, null, { ...block, label: "Tail" })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.def.states.map((s) => s.key)).toEqual(["ALPHA", "BETA", "TAIL_1", "FINISH"])
    expect(res.def.transitions.find((t) => t.from === "BETA")?.to).toBe("TAIL_1")
    expect(res.def.transitions.find((t) => t.from === "TAIL_1")?.to).toBe("FINISH")
    expect(() => parseDefinition(res.def)).not.toThrow()
  })

  it("вставка в конец, когда хвост не final — new становится хвостом", () => {
    const def = linearDef(["Alpha", "Beta"])
    def.states[1] = { ...def.states[1], kind: "normal" }
    const res = insertStateAfter(def, null, { ...block, label: "Tail" })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.def.states.at(-1)?.key).toBe("TAIL_1")
    expect(res.def.transitions.find((t) => t.from === "BETA")?.to).toBe("TAIL_1")
    expect(() => parseDefinition(res.def)).not.toThrow()
  })

  it("вставка после final в середине запрещена", () => {
    // Finish в середине: линейный def с final не в хвосте эмулируем вручную
    const def = linearDef(["Alpha", "Finish", "Beta"])
    def.states[1] = { ...def.states[1], kind: "final" }
    def.states[2] = { ...def.states[2], kind: "normal" }
    const res = insertStateAfter(def, 1, block)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toMatch(/финальн/)
  })
})

describe("removeStateWithRemap", () => {
  it("удаление среднего узла композирует in×out (A→B→C ⇒ A→C)", () => {
    const def = linearDef(["Alpha", "Beta", "Gamma"])
    const res = removeStateWithRemap(def, "BETA", "GAMMA")
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.def.states.map((s) => s.key)).toEqual(["ALPHA", "GAMMA"])
    expect(res.def.transitions).toHaveLength(1)
    expect(res.def.transitions[0]).toMatchObject({ from: "ALPHA", to: "GAMMA" })
    expect(() => parseDefinition(res.def)).not.toThrow()
  })

  it("жертва без out-перехода: ин-переходы перенаправляются на targetKey", () => {
    const def = linearDef(["Alpha", "Beta", "Gamma", "Finish"])
    const res = removeStateWithRemap(def, "FINISH", "ALPHA")
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.def.states.some((s) => s.key === "FINISH")).toBe(false)
    expect(res.def.transitions.find((t) => t.from === "GAMMA")?.to).toBe("ALPHA")
    expect(() => parseDefinition(res.def)).not.toThrow()
  })

  it("удаление initial запрещено", () => {
    const def = linearDef(["Alpha", "Beta"])
    const res = removeStateWithRemap(def, "ALPHA")
    expect(res).toEqual({ ok: false, error: "Нельзя удалить начальный этап" })
  })

  it("target, совпадающий с жертвой — ошибка", () => {
    const def = linearDef(["Alpha", "Beta"])
    const res = removeStateWithRemap(def, "BETA", "BETA")
    expect(res.ok).toBe(false)
  })

  it("удаление хвоста final убирает ин-переходы без моста", () => {
    const def = linearDef(["Alpha", "Finish"])
    const res = removeStateWithRemap(def, "FINISH", "ALPHA")
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.def.states.map((s) => s.key)).toEqual(["ALPHA"])
    expect(res.def.transitions).toHaveLength(0)
    expect(() => parseDefinition(res.def)).not.toThrow()
  })
})

describe("mockPublishPreview", () => {
  it("считает added/removed/renamed и suggestedMapping", () => {
    const base = linearDef(["Alpha", "Beta", "Gamma"])
    const draft = linearDef(["Alpha", "Delta", "Gamma"])
    const prev = mockPublishPreview(base, draft, { BETA: { engagementCount: 5, noteCount: 2 } })
    expect(prev.addedStates.map((s) => s.key)).toEqual(["DELTA"])
    expect(prev.removedStates).toHaveLength(1)
    expect(prev.removedStates[0]).toMatchObject({
      key: "BETA",
      engagementCount: 5,
      noteCount: 2,
    })
    expect(prev.suggestedMapping["BETA"]).toBeTruthy()
    expect(prev.affectedEngagements).toBe(5)
    expect(prev.blockingIssues).toEqual([])
  })

  it("блокирует публикацию, если для удаляемого с заявками нет цели", () => {
    const base = linearDef(["Alpha"])
    const draft: WorkflowDefinitionV1 = {
      ...base,
      states: [{ key: "BETA", label: "Beta", kind: "initial", order: 1 }],
      transitions: [],
    }
    const prev = mockPublishPreview(base, draft, { ALPHA: { engagementCount: 3 } })
    expect(prev.blockingIssues.length).toBeGreaterThan(0)
  })
})
