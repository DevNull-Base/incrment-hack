import type { StateCreator } from "zustand"
import type { Application } from "@/types"
import { applications as mockApplications } from "@/mock/data"

/** Заявки — local-first (назначение страницы уточняется). */
export interface ApplicationSlice {
  applications: Application[]
  patchApplication: (id: string, patch: Partial<Application>) => void
}

export const createApplicationSlice: StateCreator<
  ApplicationSlice,
  [],
  [],
  ApplicationSlice
> = (set) => ({
  applications: structuredClone(mockApplications),
  patchApplication: (id, patch) =>
    set((state) => ({
      applications: state.applications.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    })),
})
