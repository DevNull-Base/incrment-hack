// Ступени раскраски карты регионов: четыре уровня от меньших значений к большим.

/**
 * Уровень региона: доля от наибольшего значения, разбитая на четыре
 * равные ступени. -1 — нет значения (регион в легенде «нет данных»).
 */
export function regionLevel(value: number, max: number): number {
  if (value <= 0 || max <= 0) return -1
  return Math.min(3, Math.ceil((value / max) * 4) - 1)
}

/** Диапазоны ступеней для легенды; пустые (при малом максимуме) пропускаются. */
export function levelRanges(max: number): { level: number; from: number; to: number }[] {
  const ranges: { level: number; from: number; to: number }[] = []
  let previous = 0
  for (let level = 0; level < 4; level++) {
    const to = Math.floor((max * (level + 1)) / 4)
    if (to > previous) ranges.push({ level, from: previous + 1, to })
    previous = Math.max(previous, to)
  }
  return ranges
}
