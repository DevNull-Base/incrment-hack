// ========================================
// Сортировка таблиц: общий хелпер для
// таблиц: реестр вузов, «Каталог курсов».
// ========================================

export type SortDir = "asc" | "desc"

export interface SortState<K extends string> {
  key: K
  dir: SortDir
}

/** Клик по колонке: тоггл направления, либо новая колонка по возрастанию. */
export function toggleSort<K extends string>(
  current: SortState<K> | null,
  key: K,
): SortState<K> {
  if (!current || current.key !== key) return { key, dir: "asc" }
  return { key, dir: current.dir === "asc" ? "desc" : "asc" }
}

/** Числа null идут всегда в конец независимо от направления. */
export function compareNullableNumber(
  a: number | null,
  b: number | null,
  dir: SortDir,
): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  return dir === "asc" ? a - b : b - a
}

/** Строки сравнение с учётом направления (locale, ru). */
export function compareString(a: string, b: string, dir: SortDir): number {
  const res = a.localeCompare(b, "ru")
  return dir === "asc" ? res : -res
}

/** aria-sort для TableHead. */
export function ariaSort(current: SortState<string> | null, key: string): "ascending" | "descending" | "none" {
  if (!current || current.key !== key) return "none"
  return current.dir === "asc" ? "ascending" : "descending"
}
