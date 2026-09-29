import { describe, expect, it } from "vitest"
import type { CalendarItemDto, EngagementListItemDto, LearningStreamDto, MeetingDto } from "@/shared/api"
import {
  applicationsFromEngagements,
  calendarItemToEvent,
  meetingFromDto,
  streamFromDto,
} from "../api-data"
import { activeStreams, liveStreams, studyingNow } from "@/shared/lib/streams"
import type { Stream } from "@/types"

// Нормализация ответов бэкенда: потоки, встречи, заявки и календарь
// приходят в форме контракта, а страницы работают с формой интерфейса.

const stream = (patch: Partial<LearningStreamDto>): LearningStreamDto => ({
  id: "s-1",
  programId: "p-1",
  programName: "Основы DevOps-практик",
  universityId: "u-1",
  universityName: "МГТУ им. Баумана",
  name: "Осень-2026",
  startDate: "2026-09-01",
  endDate: null,
  studentsCount: 30,
  status: "ACTIVE",
  externalSource: null,
  ...patch,
})

describe("учебные потоки", () => {
  it("статус переводится в строчный, набор сайта остаётся без вуза", () => {
    const ui = streamFromDto(stream({ status: "PLANNED", universityId: null, universityName: null }))
    expect(ui.status).toBe("planned")
    expect(ui.universityId).toBeNull()
  })

  it("обучаются сейчас только в идущих потоках", () => {
    // Завершённый поток — уже выпуск, запланированный — ещё набор:
    // их слушатели не должны попадать в «обучаются сейчас».
    const streams: Stream[] = [
      streamFromDto(stream({ id: "a", status: "ACTIVE", studentsCount: 30 })),
      streamFromDto(stream({ id: "b", status: "ACTIVE", studentsCount: 20 })),
      streamFromDto(stream({ id: "c", status: "COMPLETED", studentsCount: 45 })),
      streamFromDto(stream({ id: "d", status: "PLANNED", studentsCount: 25 })),
    ]
    expect(studyingNow(streams)).toBe(50)
    expect(activeStreams(streams)).toHaveLength(2)
    expect(liveStreams(streams).map((s) => s.id)).toEqual(["a", "b", "d"])
  })
})

describe("встречи", () => {
  it("участники — имена, статус — строчный", () => {
    const dto: MeetingDto = {
      id: "m-1",
      engagementId: "e-1",
      scheduledAt: "2026-10-05T07:00:00.000Z",
      date: "2026-10-05",
      time: "10:00",
      durationMinutes: 60,
      location: "Видеовстреча",
      agenda: "Пилот",
      protocol: null,
      status: "SCHEDULED",
      participants: [
        { kind: "EMPLOYEE", id: "u-1", name: "Иванова Анна", position: null },
        { kind: "CONTACT", id: "c-1", name: "Кузнецов Андрей", position: "Проректор" },
      ],
      createdBy: { id: "u-1", name: "Иванова Анна" },
      createdAt: "2026-09-28T10:00:00.000Z",
      canEdit: true,
    }
    const ui = meetingFromDto(dto)
    expect(ui).toMatchObject({
      interactionId: "e-1",
      status: "scheduled",
      participants: ["Иванова Анна", "Кузнецов Андрей"],
      protocol: undefined,
    })
  })
})

const b2c = (patch: Partial<EngagementListItemDto>): EngagementListItemDto => ({
  id: "e-1",
  segment: "B2C",
  counterpartyType: "PERSON",
  counterpartyName: "Белова Ксения",
  universityName: null,
  universityShortName: null,
  universityId: null,
  directionName: "Тестирование ПО (QA)",
  directionId: "d-1",
  productName: null,
  ownerName: "Иванова Анна",
  ownerId: "u-1",
  currentStateKey: "CONTRACT",
  currentStateLabel: "Договор и оплата",
  slaDueAt: null,
  isOverdue: false,
  createdAt: "2026-09-10T10:00:00.000Z",
  updatedAt: "2026-09-10T10:00:00.000Z",
  ...patch,
})

describe("заявки на обучение", () => {
  it("берут программу из заявки и различают источник", () => {
    const apps = applicationsFromEngagements([
      b2c({ id: "site", programId: "p-1", programName: "Инженер-тестировщик", externalSource: "Сайт ИТ Школы РТК" }),
      b2c({ id: "lms", externalSource: "LMS ИТ Школы РТК" }),
      b2c({ id: "crm", externalSource: null }),
      b2c({ id: "b2b", segment: "B2B" }),
    ])
    expect(apps.map((a) => [a.id, a.source, a.programId])).toEqual([
      ["site", "website", "p-1"],
      ["lms", "lms", ""],
      ["crm", "crm", ""],
    ])
  })
})

describe("календарь", () => {
  it("встреча — событие типа meeting с длительностью", () => {
    const item: CalendarItemDto = {
      kind: "MEETING",
      id: "m-1",
      date: "2026-10-05",
      time: "10:00",
      at: "2026-10-05T07:00:00.000Z",
      title: "Встреча: МАИ",
      isDone: false,
      isOverdue: false,
      engagement: { id: "e-1" },
      meeting: {
        id: "m-1",
        engagementId: "e-1",
        scheduledAt: "2026-10-05T07:00:00.000Z",
        date: "2026-10-05",
        time: "10:00",
        durationMinutes: 90,
        location: null,
        agenda: "Пилот",
        protocol: null,
        status: "SCHEDULED",
        participants: [],
        createdBy: { id: "u-1", name: "Иванова Анна" },
        createdAt: "2026-09-28T10:00:00.000Z",
        canEdit: true,
      },
    }
    const event = calendarItemToEvent(item)
    expect(event).toMatchObject({ type: "meeting", color: "purple", labels: ["Встреча"], relatedEntityId: "e-1" })
    expect(new Date(event.end).getTime() - new Date(event.start).getTime()).toBe(90 * 60_000)
  })
})
