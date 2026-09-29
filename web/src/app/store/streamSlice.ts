import type { StateCreator } from "zustand"
import type { Stream } from "@/types"
import { streams as mockStreams } from "@/mock/data"

// ========================================
// Потоки обучения (streams) — учебные потоки программ.
// ========================================
export interface StreamSlice {
  streams: Stream[]
}

export const createStreamSlice: StateCreator<StreamSlice, [], [], StreamSlice> = () => ({
  streams: structuredClone(mockStreams),
})
