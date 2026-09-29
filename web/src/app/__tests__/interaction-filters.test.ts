import { describe, expect, it } from "vitest"
import type { Interaction } from "@/types"
import { activeFilterCount, EMPTY_INTERACTION_FILTERS, filterInteractions } from "../interaction-filters"

const item = (patch: Partial<Interaction>): Interaction =>
  ({
    id: "e-1",
    segment: "B2B",
    counterpartyType: "UNIVERSITY",
    counterpartyName: "Казанский федеральный университет",
    universityName: "Казанский федеральный университет",
    universityShortName: "КФУ",
    universityId: "u-1",
    directionName: "DevOps",
    directionId: "d-1",
    productId: "p-1",
    productName: "Базис Dynamix",
    programId: "pr-1",
    programName: "Основы DevOps-практик",
    ownerName: "Иванова Анна",
    ownerId: "o-1",
    currentStateKey: "SIGNING",
    currentStateLabel: "Подписание документов",
    slaDueAt: null,
    isOverdue: false,
    createdAt: "2026-09-10T10:00:00.000Z",
    updatedAt: "2026-09-10T10:00:00.000Z",
    ...patch,
  }) as Interaction

const items = [
  item({}),
  item({
    id: "e-2",
    universityId: "u-2",
    universityShortName: "МАИ",
    ownerId: "o-2",
    ownerName: "Орлов Дмитрий",
    isOverdue: true,
    createdAt: "2026-06-01T10:00:00.000Z",
  }),
  item({ id: "e-3", productId: null, productName: "Базис Dynamix", programId: null, directionId: "d-2", directionName: "QA" }),
]

const ids = (list: Interaction[]) => list.map((i) => i.id)

describe("отбор взаимодействий", () => {
  it("без отбора — все", () => {
    expect(ids(filterInteractions(items, EMPTY_INTERACTION_FILTERS))).toEqual(["e-1", "e-2", "e-3"])
  })

  it("по вузу, ответственному, программе и статусу", () => {
    expect(ids(filterInteractions(items, { ...EMPTY_INTERACTION_FILTERS, universityId: "u-2" }))).toEqual(["e-2"])
    expect(ids(filterInteractions(items, { ...EMPTY_INTERACTION_FILTERS, ownerId: "o-1" }))).toEqual(["e-1", "e-3"])
    expect(ids(filterInteractions(items, { ...EMPTY_INTERACTION_FILTERS, programId: "pr-1" }))).toEqual(["e-1", "e-2"])
    expect(ids(filterInteractions(items, { ...EMPTY_INTERACTION_FILTERS, stateKey: "SIGNING", overdueOnly: true }))).toEqual(["e-2"])
  })

  it("продукт узнаётся и по названию, если идентификатора в строке нет", () => {
    const names = new Map([["p-1", "Базис Dynamix"]])
    expect(ids(filterInteractions(items, { ...EMPTY_INTERACTION_FILTERS, productId: "p-1" }, names))).toEqual([
      "e-1",
      "e-2",
      "e-3",
    ])
  })

  it("период — по дню заведения, границы включительно", () => {
    const f = { ...EMPTY_INTERACTION_FILTERS, from: "2026-09-10", to: "2026-09-10" }
    expect(ids(filterInteractions(items, f))).toEqual(["e-1", "e-3"])
    expect(ids(filterInteractions(items, { ...EMPTY_INTERACTION_FILTERS, to: "2026-08-31" }))).toEqual(["e-2"])
  })

  it("поиск — по вузу, направлению, продукту и ответственному", () => {
    expect(ids(filterInteractions(items, { ...EMPTY_INTERACTION_FILTERS, q: "орлов" }))).toEqual(["e-2"])
    expect(ids(filterInteractions(items, { ...EMPTY_INTERACTION_FILTERS, q: "кфу qa" }))).toEqual(["e-3"])
  })

  it("считает заданные отборы", () => {
    expect(activeFilterCount(EMPTY_INTERACTION_FILTERS)).toBe(0)
    expect(activeFilterCount({ ...EMPTY_INTERACTION_FILTERS, q: "кфу", overdueOnly: true })).toBe(2)
  })
})
