import type { StateCreator } from "zustand"
import {
  api,
  ApiError,
  type AttachmentDto,
  type CreateEngagementDto,
  type CreateMeetingDto,
  type EngagementDetailDto,
  type NoteDto,
  type UpdateMeetingDto,
} from "@/shared/api"
import { dataSource } from "@/shared/config"
import type { ActivityEvent, Interaction, Meeting, WorkflowStage } from "@/types"
import {
  activityEvents as mockActivityEvents,
  interactions as mockInteractions,
  meetings as mockMeetings,
} from "@/mock/data"
import {
  activityToEvent,
  applicationsFromEngagements,
  attachmentToDocument,
  fetchAll,
  loadEngagements,
  mapLimited,
  meetingFromDto,
} from "./api-data"
import type { StoreState } from "./types"

// ========================================
// Слайс взаимодействий (engagements).
// Демо-режим: мутации локальные. Режим API: каждое действие — вызов
// бэкенда, а список обновляется из его ответа; переход идёт с версией
// карточки (If-Match), конфликт версий — перечитывание и повтор вручную.
// Общие данные для обеих split-панелей и Dashboard.
// ========================================

export type ActionResult = { ok: true } | { ok: false; error: string }

export interface EngagementSlice {
  interactions: Interaction[]
  meetings: Meeting[]
  activityEvents: ActivityEvent[]
  /** Заметки по взаимодействиям (engagementId → список). */
  notes: Record<string, NoteDto[]>
  /** Архивные взаимодействия (режим API — из бэкенда). */
  archivedIds: string[]
  /** Карточки с бэкенда: версия, доступные переходы, история, этапы. */
  engagementDetails: Record<string, EngagementDetailDto>
  attachments: Record<string, AttachmentDto[]>
  /** История взаимодействия (GET /engagements/{id}/timeline). */
  timelines: Record<string, ActivityEvent[]>
  /** Точечное добавление созданного взаимодействия (после api.engagements.create). */
  addInteraction: (item: Interaction) => void
  /** Заливка списка заметок с бека (api.notes.list). */
  setNotes: (engagementId: string, list: NoteDto[]) => void
  /** Drag-and-drop: перенос карточки на другой этап (визуально, до подтверждения). */
  moveInteraction: (id: string, targetStage: WorkflowStage | string) => void
  /** Обновление полей (например, переassign в будущем). */
  patchInteraction: (id: string, patch: Partial<Interaction>) => void
  addNote: (
    engagementId: string,
    body: string,
    author: { id: string; name: string },
    stage?: { key: string; label: string },
  ) => Promise<ActionResult>
  archiveInteraction: (id: string, reason?: string) => Promise<ActionResult>
  restoreInteraction: (id: string) => Promise<ActionResult>

  // --- режим API ---
  loadEngagement: (id: string) => Promise<EngagementDetailDto | null>
  loadNotes: (id: string) => Promise<void>
  loadAttachments: (id: string) => Promise<void>
  loadTimeline: (id: string) => Promise<void>
  /** Переход по процессу: с версией карточки, комментарием, если требуется. */
  performTransition: (id: string, toStateKey: string, comment?: string) => Promise<ActionResult>
  createEngagement: (dto: CreateEngagementDto) => Promise<{ ok: true; item: Interaction } | { ok: false; error: string }>
  reassignEngagement: (id: string, ownerId: string, reason?: string) => Promise<ActionResult>
  uploadAttachment: (id: string, file: File, stateKey?: string) => Promise<ActionResult>
  removeAttachment: (id: string, attachmentId: string) => Promise<ActionResult>
  /** Перечитать список взаимодействий (после публикации процесса, архивации). */
  reloadInteractions: () => Promise<void>
  /** Все вложения видимых взаимодействий загружены (реестр файлов). */
  allAttachmentsLoaded: boolean
  /** Реестр файлов: общего списка вложений в контракте нет — собираем по взаимодействиям. */
  loadAllAttachments: () => Promise<void>
  /** Встречи с представителями вуза по взаимодействию (режим API). */
  loadMeetings: (id: string) => Promise<void>
  /** Назначить встречу: время в ISO, участники — сотрудники и контакты вуза. */
  scheduleMeeting: (id: string, input: CreateMeetingDto) => Promise<ActionResult>
  /** Перенос, итоги, статус «проведена» или «отменена». */
  updateMeeting: (id: string, meetingId: string, patch: UpdateMeetingDto) => Promise<ActionResult>
}

const MEETING_STATUS_TO_UI = { SCHEDULED: "scheduled", COMPLETED: "completed", CANCELLED: "cancelled" } as const

function seedNotes(): Record<string, NoteDto[]> {
  return {
    i1: [
      {
        id: "n-i1-1",
        engagementId: "i1",
        body: "Преподаватели просят расписание на два потока, уточнить аудитории",
        stateKey: "TEACHER_TRAINING",
        stateLabel: "Обучение преподавателей",
        isPinned: false,
        author: { id: "e1", name: "Иванов А.П." },
        createdAt: "2025-09-01T10:15:00",
        editedAt: null,
        canEdit: true,
        canDelete: true,
      },
      {
        id: "n-i1-2",
        engagementId: "i1",
        body: "Согласованы даты вводного модуля, ждём подтверждения от вуза",
        stateKey: "TEACHER_TRAINING",
        stateLabel: "Обучение преподавателей",
        isPinned: true,
        author: { id: "e2", name: "Петрова М.С." },
        createdAt: "2025-09-02T09:30:00",
        editedAt: null,
        canEdit: true,
        canDelete: true,
      },
    ],
    i2: [
      {
        id: "n-i2-1",
        engagementId: "i2",
        body: "Юристы просят второй экземпляр приложения к договору",
        stateKey: "SIGNING",
        stateLabel: "Подписание документов",
        isPinned: false,
        author: { id: "e2", name: "Петрова М.С." },
        createdAt: "2025-08-30T14:00:00",
        editedAt: null,
        canEdit: true,
        canDelete: true,
      },
    ],
  }
}

/** Поля карточки, которые показывает список. */
export function listItemFromDetail(d: EngagementDetailDto): Interaction {
  return {
    id: d.id,
    segment: d.segment,
    counterpartyType: d.counterpartyType,
    counterpartyName: d.counterpartyName,
    universityId: d.universityId,
    universityName: d.universityName,
    universityShortName: d.universityShortName,
    directionId: d.directionId,
    directionName: d.directionName,
    productName: d.productName,
    ownerId: d.ownerId,
    ownerName: d.ownerName,
    currentStateKey: d.currentStateKey,
    currentStateLabel: d.currentStateLabel,
    slaDueAt: d.slaDueAt,
    interestLevel: d.interestLevel,
    isOverdue: d.isOverdue,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  } as Interaction
}

function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.message
  return "Сервер недоступен"
}

const isApi = dataSource === "api"

export const createEngagementSlice: StateCreator<StoreState, [], [], EngagementSlice> = (set, get) => {
  /** Карточка изменилась на бэкенде — обновляем её и строку списка. */
  const applyDetail = (detail: EngagementDetailDto) =>
    set((state) => {
      const item = listItemFromDetail(detail)
      const exists = state.interactions.some((i) => i.id === detail.id)
      const interactions = exists
        ? state.interactions.map((i) => (i.id === detail.id ? { ...i, ...item } : i))
        : [item, ...state.interactions]
      const archivedIds = detail.isArchived
        ? state.archivedIds.includes(detail.id)
          ? state.archivedIds
          : [...state.archivedIds, detail.id]
        : state.archivedIds.filter((x) => x !== detail.id)
      return {
        interactions,
        archivedIds,
        applications: applicationsFromEngagements(interactions),
        engagementDetails: { ...state.engagementDetails, [detail.id]: detail },
      }
    })

  /** После изменения — свежая история и сводка этапов (без блокировки интерфейса). */
  const refreshAfterChange = (id: string) => {
    void get().loadTimeline(id)
    void get().refreshNotifications?.()
  }

  return {
    interactions: structuredClone(mockInteractions),
    meetings: structuredClone(mockMeetings),
    activityEvents: structuredClone(mockActivityEvents),
    notes: seedNotes(),
    archivedIds: [],
    engagementDetails: {},
    attachments: {},
    timelines: {},
    allAttachmentsLoaded: false,

    addInteraction: (item) =>
      set((state) => ({ interactions: [item, ...state.interactions] })),

    setNotes: (engagementId, list) =>
      set((state) => ({ notes: { ...state.notes, [engagementId]: list } })),

    moveInteraction: (id, targetStage) =>
      set((state) => ({
        interactions: state.interactions.map((i) =>
          i.id === id && i.currentStateKey !== targetStage
            ? {
                ...i,
                currentStateKey: targetStage,
                currentStateLabel: stateLabelFor(state, i.segment, targetStage) ?? i.currentStateLabel,
                // В режиме API дату изменения ставит бэкенд.
                updatedAt: isApi ? i.updatedAt : new Date().toISOString().split("T")[0],
              }
            : i,
        ),
      })),

    patchInteraction: (id, patch) =>
      set((state) => ({
        interactions: state.interactions.map((i) =>
          i.id === id ? { ...i, ...patch } : i,
        ),
      })),

    addNote: async (engagementId, body, author, stage) => {
      if (isApi) {
        try {
          const note = await api.notes.create(engagementId, { body, stateKey: stage?.key ?? null }, { silent: true })
          set((state) => ({
            notes: { ...state.notes, [engagementId]: [note, ...(state.notes[engagementId] ?? [])] },
          }))
          refreshAfterChange(engagementId)
          return { ok: true }
        } catch (error) {
          return { ok: false, error: errorText(error) }
        }
      }
      set((state) => ({
        notes: {
          ...state.notes,
          [engagementId]: [
            {
              id: `n-${Date.now()}`,
              engagementId,
              body,
              stateKey: stage?.key ?? "",
              stateLabel: stage?.label ?? "",
              isPinned: false,
              author,
              createdAt: new Date().toISOString(),
              editedAt: null,
              canEdit: true,
              canDelete: true,
            },
            ...(state.notes[engagementId] ?? []),
          ],
        },
      }))
      return { ok: true }
    },

    archiveInteraction: async (id, reason) => {
      if (isApi) {
        try {
          await api.engagements.archive(id, reason ? { reason } : {}, { silent: true })
          await get().loadEngagement(id)
          refreshAfterChange(id)
          return { ok: true }
        } catch (error) {
          return { ok: false, error: errorText(error) }
        }
      }
      set((state) => ({
        archivedIds: state.archivedIds.includes(id) ? state.archivedIds : [...state.archivedIds, id],
      }))
      return { ok: true }
    },

    restoreInteraction: async (id) => {
      if (isApi) {
        try {
          await api.engagements.restore(id, { silent: true })
          await get().loadEngagement(id)
          refreshAfterChange(id)
          return { ok: true }
        } catch (error) {
          return { ok: false, error: errorText(error) }
        }
      }
      set((state) => ({ archivedIds: state.archivedIds.filter((x) => x !== id) }))
      return { ok: true }
    },

    // --------------------------------------------------- режим API

    loadEngagement: async (id) => {
      try {
        const detail = await api.engagements.get(id)
        applyDetail(detail)
        return detail
      } catch {
        return null
      }
    },

    loadNotes: async (id) => {
      try {
        const list = await api.notes.list(id)
        set((state) => ({ notes: { ...state.notes, [id]: list } }))
      } catch {
        // ошибку показал клиент API
      }
    },

    loadAttachments: async (id) => {
      try {
        const list = await api.attachments.list(id)
        set((state) => ({
          attachments: { ...state.attachments, [id]: list },
          documents: [
            ...state.documents.filter((d) => d.interactionId !== id),
            ...list.map((a) => attachmentToDocument(id, a)),
          ],
        }))
      } catch {
        // ошибку показал клиент API
      }
    },

    loadMeetings: async (id) => {
      if (!isApi) return
      try {
        const list = await api.meetings.list(id)
        set((state) => ({
          meetings: [...state.meetings.filter((m) => m.interactionId !== id), ...list.map(meetingFromDto)],
        }))
      } catch {
        // ошибку показал клиент API
      }
    },

    scheduleMeeting: async (id, input) => {
      if (isApi) {
        try {
          const created = await api.meetings.create(id, input, { silent: true })
          set((state) => ({ meetings: [...state.meetings, meetingFromDto(created)] }))
          refreshAfterChange(id)
          return { ok: true }
        } catch (error) {
          return { ok: false, error: errorText(error) }
        }
      }
      const user = get().user
      set((state) => ({
        meetings: [
          ...state.meetings,
          {
            id: `m-${Date.now()}`,
            interactionId: id,
            date: input.scheduledAt,
            participants: user ? [user.displayName] : [],
            agenda: input.agenda,
            status: "scheduled",
            location: input.location ?? null,
            durationMinutes: input.durationMinutes ?? null,
            canEdit: true,
          },
        ],
      }))
      return { ok: true }
    },

    updateMeeting: async (id, meetingId, patch) => {
      if (isApi) {
        try {
          const updated = await api.meetings.update(id, meetingId, patch, { silent: true })
          set((state) => ({
            meetings: state.meetings.map((m) => (m.id === meetingId ? meetingFromDto(updated) : m)),
          }))
          refreshAfterChange(id)
          return { ok: true }
        } catch (error) {
          return { ok: false, error: errorText(error) }
        }
      }
      set((state) => ({
        meetings: state.meetings.map((m) =>
          m.id === meetingId
            ? {
                ...m,
                ...(patch.scheduledAt ? { date: patch.scheduledAt } : {}),
                ...(patch.protocol !== undefined ? { protocol: patch.protocol ?? undefined } : {}),
                ...(patch.status ? { status: MEETING_STATUS_TO_UI[patch.status] } : {}),
              }
            : m,
        ),
      }))
      return { ok: true }
    },

    loadTimeline: async (id) => {
      try {
        const items = await fetchAll((q) => api.engagements.timeline(id, q), 500)
        set((state) => ({ timelines: { ...state.timelines, [id]: items.map(activityToEvent) } }))
      } catch {
        // ошибку показал клиент API
      }
    },

    performTransition: async (id, toStateKey, comment) => {
      const body = { toStateKey, ...(comment?.trim() ? { comment: comment.trim() } : {}) }

      /** Переход доступен из карточки — или текст, почему нет. */
      const check = (detail: EngagementDetailDto): string | null => {
        const transition = detail.availableTransitions.find((t) => t.toStateKey === toStateKey)
        if (!transition) return `Из этапа «${detail.currentStateLabel}» нет перехода в выбранный этап`
        if (!transition.allowed) return transition.blockedReason ?? "Переход сейчас недоступен"
        if (transition.requiresComment && !comment?.trim()) return "Для этого перехода нужен комментарий"
        return null
      }

      // Открытая карточка уже в сторе: её версии достаточно, отдельно
      // перечитывать карточку перед каждым переходом незачем — это вдвое
      // удлиняло действие (docs/load-testing.md). Устаревшую версию бэкенд
      // отклонит (If-Match, CRM-WFL-0005), и тогда карточка перечитывается.
      // С канбана, где открытой карточки нет, она загружается как прежде.
      const cached = get().engagementDetails[id]
      const detail = cached ?? (await get().loadEngagement(id))
      if (!detail) return { ok: false, error: "Карточка недоступна" }
      const blocked = check(detail)
      if (blocked) return { ok: false, error: blocked }

      const send = (version: number) => api.engagements.transition(id, body, version, { silent: true })

      try {
        applyDetail(await send(detail.version))
        refreshAfterChange(id)
        return { ok: true }
      } catch (error) {
        // Карточка могла измениться — перечитываем, чтобы показать правду.
        const fresh = await get().loadEngagement(id)
        // Кэш устарел, но заявка стоит на том же этапе и переход по-прежнему
        // разрешён: пользователь хотел ровно этого, повторяем один раз со
        // свежей версией. Если этап сменился, решать заново — пользователю.
        const staleCache =
          cached && error instanceof ApiError && error.status === 409 && fresh &&
          fresh.currentStateKey === detail.currentStateKey && check(fresh) === null
        if (staleCache) {
          try {
            applyDetail(await send(fresh.version))
            refreshAfterChange(id)
            return { ok: true }
          } catch (retryError) {
            await get().loadEngagement(id)
            return { ok: false, error: errorText(retryError) }
          }
        }
        return { ok: false, error: errorText(error) }
      }
    },

    createEngagement: async (dto) => {
      try {
        const detail = await api.engagements.create(dto, { silent: true })
        applyDetail(detail)
        void get().refreshNotifications?.()
        return { ok: true, item: listItemFromDetail(detail) }
      } catch (error) {
        return { ok: false, error: errorText(error) }
      }
    },

    reassignEngagement: async (id, ownerId, reason) => {
      try {
        const detail = await api.engagements.reassign(id, { ownerId, ...(reason ? { reason } : {}) }, { silent: true })
        applyDetail(detail)
        refreshAfterChange(id)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: errorText(error) }
      }
    },

    uploadAttachment: async (id, file, stateKey) => {
      try {
        await api.attachments.upload(id, file, stateKey, { silent: true })
        await Promise.all([get().loadAttachments(id), get().loadEngagement(id)])
        refreshAfterChange(id)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: errorText(error) }
      }
    },

    removeAttachment: async (id, attachmentId) => {
      try {
        await api.attachments.remove(id, attachmentId, { silent: true })
        await Promise.all([get().loadAttachments(id), get().loadEngagement(id)])
        refreshAfterChange(id)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: errorText(error) }
      }
    },

    loadAllAttachments: async () => {
      if (!isApi) return
      const ids = get().interactions.map((i) => i.id)
      const lists = await mapLimited(ids, 6, async (id) => ({
        id,
        list: await api.attachments.list(id).catch(() => [] as AttachmentDto[]),
      }))
      set({
        allAttachmentsLoaded: true,
        attachments: Object.fromEntries(lists.map((l) => [l.id, l.list])),
        documents: lists.flatMap((l) => l.list.map((a) => attachmentToDocument(l.id, a))),
      })
    },

    reloadInteractions: async () => {
      const { items, archivedIds } = await loadEngagements()
      set({
        interactions: items,
        archivedIds,
        applications: applicationsFromEngagements(items),
      })
    },
  }
}

/** Подпись этапа по ключу из справочника этапов сегмента. */
function stateLabelFor(state: StoreState, segment: Interaction["segment"], key: string): string | undefined {
  return state.stageCatalog[segment]?.find((s) => s.key === key)?.label
}
