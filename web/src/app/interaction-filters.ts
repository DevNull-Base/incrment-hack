import type { Interaction } from "@/types"
import { matchesQuery } from "@/shared/lib/search"

// ========================================
// Отбор взаимодействий — сценарий ТЗ «фильтрация по вузам, ИТ-программам,
// ИТ-продуктам и статусу, за выбранный период, по ответственным».
// Период — по дате заведения заявки, как в отчётах и в API.
// ========================================

export interface InteractionFilters {
  q: string
  universityId: string
  directionId: string
  productId: string
  programId: string
  ownerId: string
  stateKey: string
  /** Заведены не раньше, YYYY-MM-DD. */
  from: string
  /** Заведены не позже, YYYY-MM-DD (день включительно). */
  to: string
  overdueOnly: boolean
}

export const EMPTY_INTERACTION_FILTERS: InteractionFilters = {
  q: "",
  universityId: "",
  directionId: "",
  productId: "",
  programId: "",
  ownerId: "",
  stateKey: "",
  from: "",
  to: "",
  overdueOnly: false,
}

/** Параметры ссылки, которыми другие экраны открывают канбан с отбором. */
export const FILTER_URL_KEYS = ["q", "universityId", "directionId", "productId", "programId", "ownerId", "stateKey"] as const

/** Сколько отборов задано — для счётчика на кнопке сброса. */
export function activeFilterCount(f: InteractionFilters): number {
  return (Object.keys(EMPTY_INTERACTION_FILTERS) as (keyof InteractionFilters)[]).filter(
    (key) => f[key] !== EMPTY_INTERACTION_FILTERS[key],
  ).length
}

/** День заведения заявки, YYYY-MM-DD, по часам пользователя. */
function createdDay(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 10)
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * Продукт в строке списка приходит идентификатором (режим API) либо только
 * названием (демо-данные) — сверяем тем, что есть.
 */
function sameProduct(i: Interaction, productId: string, productName: string | undefined): boolean {
  if (i.productId) return i.productId === productId
  return productName !== undefined && i.productName === productName
}

export function filterInteractions(
  items: readonly Interaction[],
  f: InteractionFilters,
  productNames: ReadonlyMap<string, string> = new Map(),
): Interaction[] {
  const productName = f.productId ? productNames.get(f.productId) : undefined
  return items.filter((i) => {
    if (f.universityId && i.universityId !== f.universityId) return false
    if (f.directionId && i.directionId !== f.directionId) return false
    if (f.productId && !sameProduct(i, f.productId, productName)) return false
    if (f.programId && i.programId !== f.programId) return false
    if (f.ownerId && i.ownerId !== f.ownerId) return false
    if (f.stateKey && i.currentStateKey !== f.stateKey) return false
    if (f.overdueOnly && !i.isOverdue) return false
    if (f.from || f.to) {
      const day = createdDay(i.createdAt)
      if (f.from && day < f.from) return false
      if (f.to && day > f.to) return false
    }
    return matchesQuery(f.q, [
      i.universityShortName ?? i.counterpartyName,
      i.counterpartyName,
      i.universityName,
      i.directionName,
      i.productName,
      i.programName,
      i.ownerName,
      i.currentStateLabel,
    ])
  })
}
