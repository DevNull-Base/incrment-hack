import { beforeEach, describe, expect, it, vi } from "vitest"
import { create } from "zustand"

const get = vi.fn()
const transition = vi.fn()
const timeline = vi.fn()

vi.mock("@/shared/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/shared/api")>()
  return { ...original, api: { engagements: { get, transition, timeline } } }
})

const { ApiError } = await import("@/shared/api")
const { createEngagementSlice } = await import("../engagementSlice")

type Detail = {
  id: string
  version: number
  currentStateKey: string
  currentStateLabel: string
  isArchived: boolean
  availableTransitions: Array<{ toStateKey: string; allowed: boolean; requiresComment: boolean; blockedReason: string | null }>
}

const detail = (patch: Partial<Detail> = {}): Detail => ({
  id: "e1",
  version: 3,
  currentStateKey: "MEETING",
  currentStateLabel: "Организация встречи",
  isArchived: false,
  availableTransitions: [{ toStateKey: "DOCUMENTS_EXCHANGE", allowed: true, requiresComment: false, blockedReason: null }],
  ...patch,
})

function store(cached?: Detail) {
  const useStore = create<Record<string, unknown>>()((set, getState, api) => ({
    ...createEngagementSlice(set as never, getState as never, api as never),
    refreshNotifications: vi.fn(),
  }))
  if (cached) useStore.setState({ engagementDetails: { [cached.id]: cached } })
  return useStore.getState() as unknown as {
    performTransition: (id: string, to: string, comment?: string) => Promise<{ ok: boolean; error?: string }>
  }
}

const conflict = () => new ApiError(409, "CRM-WFL-0005", "Карточка изменена другим пользователем")

// Переход по этапу из открытой карточки: версия берётся из уже загруженной
// карточки, без отдельного чтения перед каждым переходом.
describe("переход по этапу", () => {
  beforeEach(() => {
    get.mockReset()
    transition.mockReset()
    timeline.mockReset()
    timeline.mockResolvedValue({ items: [], meta: { hasNext: false } })
  })

  it("открытая карточка — переход сразу, без повторного чтения", async () => {
    transition.mockResolvedValue(detail({ version: 4, currentStateKey: "DOCUMENTS_EXCHANGE" }))

    const result = await store(detail()).performTransition("e1", "DOCUMENTS_EXCHANGE")

    expect(result.ok).toBe(true)
    expect(get).not.toHaveBeenCalled()
    expect(transition).toHaveBeenCalledTimes(1)
    expect(transition.mock.calls[0][2]).toBe(3)
  })

  it("карточки нет в сторе (канбан) — загружается перед переходом", async () => {
    get.mockResolvedValue(detail())
    transition.mockResolvedValue(detail({ version: 4 }))

    const result = await store().performTransition("e1", "DOCUMENTS_EXCHANGE")

    expect(result.ok).toBe(true)
    expect(get).toHaveBeenCalledTimes(1)
  })

  it("устаревшая версия, этап прежний — один повтор со свежей версией", async () => {
    transition.mockRejectedValueOnce(conflict()).mockResolvedValueOnce(detail({ version: 6 }))
    get.mockResolvedValue(detail({ version: 5 }))

    const result = await store(detail()).performTransition("e1", "DOCUMENTS_EXCHANGE")

    expect(result.ok).toBe(true)
    expect(transition).toHaveBeenCalledTimes(2)
    expect(transition.mock.calls[1][2]).toBe(5)
  })

  it("этап уже сменил другой пользователь — без повтора, с ошибкой", async () => {
    transition.mockRejectedValue(conflict())
    get.mockResolvedValue(detail({ version: 5, currentStateKey: "DOCUMENTS_EXCHANGE", availableTransitions: [] }))

    const result = await store(detail()).performTransition("e1", "DOCUMENTS_EXCHANGE")

    expect(result.ok).toBe(false)
    expect(transition).toHaveBeenCalledTimes(1)
  })
})
