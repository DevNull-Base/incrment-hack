const KEY = "crm_split_recent"
const MAX = 5

/** Последние страницы правой панели split-screen (для секции «Недавние»). */
export function getSplitRecent(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((p): p is string => typeof p === "string").slice(0, MAX)
  } catch {
    return []
  }
}

export function addSplitRecent(path: string) {
  try {
    const next = [path, ...getSplitRecent().filter((p) => p !== path)].slice(0, MAX)
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // localStorage недоступен — не мешаем работе приложения
  }
}
