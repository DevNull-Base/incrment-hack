import type { StateCreator } from "zustand"
import { api, ApiError, type CreateTaskDto, type TaskDto } from "@/shared/api"
import { dataSource } from "@/shared/config"
import type { CalendarEvent, Meeting } from "@/types"
import { calendarEvents as mockEvents, meetings as mockMeetings } from "@/mock/data"
import { loadCalendarEvents, loadTasks, normalizeTask } from "./api-data"
import type { StoreState } from "./types"

// ========================================
// Календарь. Демо-режим: события производные (встречи ∪ SLA ∪ заметки).
// Режим API: задачи — /calendar/tasks, события — /calendar (задачи и сроки
// этапов); выполнение задачи — complete/reopen на бэкенде.
// ========================================
export interface CalendarSlice {
  meetings: Meeting[]
  calendarEvents: CalendarEvent[]
  calendarTasks: TaskDto[]
  addCalendarEvent: (event: Omit<CalendarEvent, "id">) => void
  addMeeting: (meeting: Omit<Meeting, "id">) => void
  /** Выполнить/вернуть задачу (режим API — complete/reopen на бэкенде). */
  toggleTask: (id: string) => Promise<void>
  /** Новая задача (режим API). */
  createTask: (dto: CreateTaskDto) => Promise<{ ok: true } | { ok: false; error: string }>
  /** Перечитать задачи и события календаря (режим API). */
  refreshCalendar: () => Promise<void>
  /** Пересобрать события из meetings + переданных SLA-дедлайнов. */
  rebuildCalendarEvents: (
    slaEvents: Omit<CalendarEvent, "id">[],
  ) => void
}

function seedTasks(): TaskDto[] {
  const day = (offset: number) => {
    const d = new Date()
    d.setDate(d.getDate() + offset)
    return d.toISOString().split("T")[0]
  }
  const now = new Date().toISOString()
  return [
    {
      id: "t1",
      title: "Подготовить пакет документов для СПбПУ",
      description: "Договор, приложение и лицензия на согласование",
      dueDate: day(1),
      dueTime: "10:00",
      dueAt: `${day(1)}T10:00:00`,
      remindAt: `${day(0)}T09:00:00`,
      isReminderSent: false,
      isCompleted: false,
      completedAt: null,
      isOverdue: false,
      owner: { id: "e1", displayName: "Иванов Алексей Петрович" },
      createdBy: { id: "e1", displayName: "Иванов Алексей Петрович" },
      engagement: { id: "i2", counterpartyName: "СПбПУ" },
      canEdit: true,
      isAssigned: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "t2",
      title: "Созвон с КФУ по условиям сотрудничества",
      description: "Обсудить пилот на потоке «Старт в IT»",
      dueDate: day(3),
      dueTime: "14:30",
      dueAt: `${day(3)}T14:30:00`,
      remindAt: null,
      isReminderSent: false,
      isCompleted: false,
      completedAt: null,
      isOverdue: false,
      owner: { id: "e2", displayName: "Петрова Мария Сергеевна" },
      createdBy: { id: "e2", displayName: "Петрова Мария Сергеевна" },
      engagement: { id: "i5", counterpartyName: "КФУ" },
      canEdit: true,
      isAssigned: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "t3",
      title: "Обновить презентацию для НГУ",
      description: "Включить кейсы внедрения IntelliJ IDEA",
      dueDate: day(-2),
      dueTime: "12:00",
      dueAt: `${day(-2)}T12:00:00`,
      remindAt: null,
      isReminderSent: true,
      isCompleted: false,
      completedAt: null,
      isOverdue: true,
      owner: { id: "e1", displayName: "Иванов Алексей Петрович" },
      createdBy: { id: "e1", displayName: "Иванов Алексей Петрович" },
      engagement: { id: "i3", counterpartyName: "НГУ" },
      canEdit: true,
      isAssigned: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "t4",
      title: "Отправить учебные материалы в УрФУ",
      description: "Архив с методичками и лицензией",
      dueDate: day(-1),
      dueTime: "18:00",
      dueAt: `${day(-1)}T18:00:00`,
      remindAt: null,
      isReminderSent: true,
      isCompleted: true,
      completedAt: `${day(-1)}T16:20:00`,
      isOverdue: false,
      owner: { id: "e2", displayName: "Петрова Мария Сергеевна" },
      createdBy: { id: "e2", displayName: "Петрова Мария Сергеевна" },
      engagement: { id: "i4", counterpartyName: "УрФУ" },
      canEdit: true,
      isAssigned: true,
      createdAt: now,
      updatedAt: now,
    },
  ]
}

const isApi = dataSource === "api"

export const createCalendarSlice: StateCreator<StoreState, [], [], CalendarSlice> = (set, get) => ({
  meetings: structuredClone(mockMeetings),
  calendarEvents: structuredClone(mockEvents),
  calendarTasks: seedTasks(),

  addCalendarEvent: (event) =>
    set((state) => ({
      calendarEvents: [
        ...state.calendarEvents,
        { ...event, id: `ce-${Date.now()}` },
      ],
    })),

  addMeeting: (meeting) =>
    set((state) => ({
      meetings: [...state.meetings, { ...meeting, id: `m-${Date.now()}` }],
    })),

  toggleTask: async (id) => {
    const before = get().calendarTasks
    const task = before.find((t) => t.id === id)
    set((state) => ({
      calendarTasks: state.calendarTasks.map((t) =>
        t.id === id
          ? {
              ...t,
              isCompleted: !t.isCompleted,
              completedAt: !t.isCompleted ? new Date().toISOString() : null,
            }
          : t,
      ),
    }))
    if (!isApi || !task) return
    try {
      const updated = normalizeTask(
        task.isCompleted ? await api.calendarTasks.reopen(id) : await api.calendarTasks.complete(id),
      )
      set((state) => ({ calendarTasks: state.calendarTasks.map((t) => (t.id === id ? updated : t)) }))
      void get().refreshCalendar()
    } catch {
      set({ calendarTasks: before })
    }
  },

  createTask: async (dto) => {
    try {
      const created = normalizeTask(await api.calendarTasks.create(dto, { silent: true }))
      set((state) => ({ calendarTasks: [created, ...state.calendarTasks] }))
      void get().refreshCalendar()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof ApiError ? error.message : "Сервер недоступен" }
    }
  },

  refreshCalendar: async () => {
    if (!isApi) return
    try {
      const [tasks, events] = await Promise.all([loadTasks(), loadCalendarEvents()])
      set({ calendarTasks: tasks, calendarEvents: events })
    } catch {
      // Фоновое обновление: ошибку показал клиент API.
    }
  },

  rebuildCalendarEvents: (slaEvents) =>
    set((state) => {
      const manual = state.calendarEvents.filter((e) => e.type !== "reminder" || !e.relatedEntityId)
      const meetingsAsEvents: CalendarEvent[] = state.meetings
        .filter((m) => m.status !== "cancelled")
        .map((m) => ({
          id: `ce-meet-${m.id}`,
          title: m.agenda ?? "Встреча",
          description: m.protocol,
          start: m.date,
          end: m.date,
          color: "purple" as const,
          labels: m.participants.slice(0, 3),
          type: "meeting" as const,
          relatedEntityId: m.interactionId,
          relatedEntityType: "engagement" as const,
        }))
      const slaWithIds: CalendarEvent[] = slaEvents.map((e, i) => ({
        ...e,
        id: `ce-sla-${i}-${Date.now()}`,
      }))
      return { calendarEvents: [...manual, ...meetingsAsEvents, ...slaWithIds] }
    }),
})
