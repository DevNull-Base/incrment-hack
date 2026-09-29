// ========================================
// Поиск по данным интерфейса: вузы, программы, взаимодействия, продукты.
// Данные уже в сторе (режим API загружает их целиком при входе), поэтому
// поиск идёт на месте и отвечает мгновенно — без запроса на каждый символ.
// ========================================

/**
 * Приведение текста к виду для сравнения: регистр, «ё» и знаки препинания
 * не влияют на совпадение. «МГТУ им. Баумана» и «мгту им баумана»,
 * «ООО «Базис»» и «ооо базис» — одно и то же.
 */
export function normalizeSearch(text: string | null | undefined): string {
  return (text ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

/** Слова запроса: каждое должно встретиться в тексте записи. */
export function searchTokens(query: string): string[] {
  return normalizeSearch(query).split(" ").filter(Boolean)
}

/**
 * Насколько запись подходит под запрос: null — не подходит, меньше — лучше.
 *
 * Каждое слово запроса должно быть началом какого-то слова записи: «каз»
 * находит «Казанский» и «Казань», но не «Кавказский» и не «Отказ» — поиск
 * внутри слов давал больше шума, чем пользы. Первое поле — главное
 * (название): совпадение с его началом выше совпадения в других полях.
 */
export function matchRank(tokens: string[], fields: (string | null | undefined)[]): number | null {
  if (tokens.length === 0) return null
  const normalized = fields.map(normalizeSearch)
  const words = normalized.join(" ").split(" ")
  if (!tokens.every((token) => words.some((word) => word.startsWith(token)))) return null

  const title = normalized[0] ?? ""
  const titleWords = title.split(" ")
  if (title.startsWith(tokens.join(" "))) return 0
  if (tokens.every((token) => titleWords.some((word) => word.startsWith(token)))) return 1
  if (titleWords.some((word) => word.startsWith(tokens[0]))) return 2
  return 3
}

export interface SearchHit<T> {
  item: T
  rank: number
}

/** Подходящие записи по возрастанию ранга; при равенстве — по названию. */
export function searchItems<T>(
  items: readonly T[],
  query: string,
  fields: (item: T) => (string | null | undefined)[],
  limit = Number.POSITIVE_INFINITY,
): T[] {
  const tokens = searchTokens(query)
  if (tokens.length === 0) return []
  const hits: SearchHit<T>[] = []
  for (const item of items) {
    const rank = matchRank(tokens, fields(item))
    if (rank !== null) hits.push({ item, rank })
  }
  return hits
    .sort((a, b) => a.rank - b.rank || normalizeSearch(fields(a.item)[0]).localeCompare(normalizeSearch(fields(b.item)[0]), "ru"))
    .slice(0, limit)
    .map((hit) => hit.item)
}

/** Подходит ли запись под запрос — для фильтров списков. Пустой запрос подходит всем. */
export function matchesQuery(query: string, fields: (string | null | undefined)[]): boolean {
  const tokens = searchTokens(query)
  return tokens.length === 0 || matchRank(tokens, fields) !== null
}
