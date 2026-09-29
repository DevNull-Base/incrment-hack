import type { Stream } from "@/types"

// ========================================
// Показатели востребованности по учебным потокам.
// ТЗ ранжирует программы по заявкам, числу обучающихся и числу
// параллельных потоков. Обучаются и идут параллельно — только потоки
// со статусом «идёт»: завершённые — уже выпуск, запланированные — набор.
// ========================================

export const STREAM_STATUS_LABELS: Record<
  Stream["status"],
  { label: string; variant: "default" | "secondary" | "outline" }
> = {
  active: { label: "Идёт", variant: "default" },
  planned: { label: "Планируется", variant: "outline" },
  completed: { label: "Завершён", variant: "secondary" },
  paused: { label: "Приостановлен", variant: "secondary" },
}

/** Идущие потоки. */
export function activeStreams(streams: readonly Stream[]): Stream[] {
  return streams.filter((s) => s.status === "active")
}

/** Обучаются сейчас — сумма по идущим потокам. */
export function studyingNow(streams: readonly Stream[]): number {
  return activeStreams(streams).reduce((sum, s) => sum + s.studentsCount, 0)
}

/** Потоки, по которым идёт или готовится обучение: идущие и запланированные. */
export function liveStreams(streams: readonly Stream[]): Stream[] {
  return streams.filter((s) => s.status === "active" || s.status === "planned")
}
