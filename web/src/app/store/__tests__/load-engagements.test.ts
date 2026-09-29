import { beforeEach, describe, expect, it, vi } from "vitest"

const list = vi.fn()
vi.mock("@/shared/api", () => ({ api: { engagements: { list } } }))

const { loadEngagements } = await import("../api-data")

const page = (items: object[]) => ({ items, meta: { hasNext: false } })

// Вход в интерфейс: список заявок запрашивается один раз, архивные
// определяются по признаку в строке. Прежде запросов было два —
// активные и все, — и вход длился вдвое дольше (docs/load-testing.md).
describe("загрузка заявок при входе", () => {
  // Фигурные скобки обязательны: mockReset() возвращает сам mock,
  // и vitest вызвал бы его как функцию очистки после теста.
  beforeEach(() => {
    list.mockReset()
  })

  it("один список с архивом, архивные — по признаку", async () => {
    list.mockResolvedValue(page([{ id: "a", isArchived: false }, { id: "b", isArchived: true }]))

    const result = await loadEngagements()

    expect(list).toHaveBeenCalledTimes(1)
    expect(list.mock.calls[0][0]).toMatchObject({ includeArchived: true })
    expect(result.items.map((i) => i.id)).toEqual(["a", "b"])
    expect(result.archivedIds).toEqual(["b"])
  })

  it("без признака архива — прежний способ, вторым списком активных", async () => {
    list.mockImplementation(async (query: { includeArchived?: boolean }) =>
      query.includeArchived ? page([{ id: "a" }, { id: "b" }]) : page([{ id: "a" }]),
    )

    const result = await loadEngagements()

    expect(list).toHaveBeenCalledTimes(2)
    expect(result.archivedIds).toEqual(["b"])
  })
})
