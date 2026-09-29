import type { StateCreator } from "zustand"
import type { Document } from "@/types"
import { documents as mockDocuments } from "@/mock/data"

/** Документы — local-first, внутренний документооборот. */
export interface DocumentSlice {
  documents: Document[]
  patchDocument: (id: string, patch: Partial<Document>) => void
}

export const createDocumentSlice: StateCreator<DocumentSlice, [], [], DocumentSlice> = (set) => ({
  documents: structuredClone(mockDocuments),
  patchDocument: (id, patch) =>
    set((state) => ({
      documents: state.documents.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    })),
})
