import type { Segment } from "@/shared/api"
import { useStore } from "@/app/store"
import type { StageInfo } from "@/app/workflow-stages"

/** Этапы действующего процесса сегмента (режим API — из шаблона бэкенда). */
export function useStages(segment: Segment = "B2B"): StageInfo[] {
  return useStore((s) => s.stageCatalog[segment])
}

/** Этапы обоих сегментов — для страниц со смешанными списками. */
export function useStageCatalog() {
  return useStore((s) => s.stageCatalog)
}
