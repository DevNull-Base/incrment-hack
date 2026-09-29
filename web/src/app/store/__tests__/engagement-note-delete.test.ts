import { beforeEach, describe, expect, it, vi } from "vitest"
import { create } from "zustand"

const notesRemove = vi.fn()

vi.mock("@/shared/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/shared/api")>()
  return {
    ...original,
    api: {
      ...original.api,
      notes: { remove: notesRemove },
    },
  }
})

vi.mock("@/shared/config", () => ({
  authMode: "mock",
  dataSource: "mock",
  keycloak: null,
}))

const { createEngagementSlice } = await import("../engagementSlice")

type TestStore = {
  removeNote: (engagementId: string, noteId: string) => Promise<{ ok: boolean }>
  notes: Record<string, Array<{ id: string }>>
}

describe("удаление заметки по взаимодействию", () => {
  beforeEach(() => {
    notesRemove.mockReset()
  })

  it("удаляет заметку из хранилища в локальном режиме", async () => {
    const useStore = create<Record<string, unknown>>((set, getState, api) => ({
      ...createEngagementSlice(set as never, getState as never, api as never),
      refreshNotifications: vi.fn(),
    }))

    useStore.setState({
      notes: {
        i1: [
          {
            id: "n-1",
            engagementId: "i1",
            body: "Сначала",
            stateKey: "MEETING",
            stateLabel: "Встреча",
            isPinned: false,
            author: { id: "e1", name: "Иван" },
            createdAt: "2025-09-01T08:00:00",
            editedAt: null,
            canEdit: true,
            canDelete: true,
          },
          {
            id: "n-2",
            engagementId: "i1",
            body: "Потом",
            stateKey: "MEETING",
            stateLabel: "Встреча",
            isPinned: false,
            author: { id: "e2", name: "Мария" },
            createdAt: "2025-09-01T09:00:00",
            editedAt: null,
            canEdit: true,
            canDelete: true,
          },
        ],
      },
    })

    const store = useStore.getState() as TestStore
    const result = await store.removeNote("i1", "n-1")
    const updatedStore = useStore.getState() as TestStore

    expect(result.ok).toBe(true)
    expect(updatedStore.notes.i1).toHaveLength(1)
    expect(updatedStore.notes.i1?.[0].id).toBe("n-2")
    expect(notesRemove).not.toHaveBeenCalled()
  })
})
