// ========================================
// Загрузка данных стора из API (режим VITE_DATA_SOURCE=api).
//
// Слой нормализации приводит ответы бэкенда к форме, которую ждут
// страницы: часть доменов интерфейса — производные от данных бэкенда
// (заявки — B2C-взаимодействия, документы — вложения), у потоков и
// встреч статусы в интерфейсе записаны строчными.
// ========================================
import {
  api,
  type ActivityItemDto,
  type AdminUserDto,
  type AttachmentDto,
  type AuditLogItemDto,
  type CalendarItemDto,
  type EngagementListItemDto,
  type ItDirectionDto,
  type LearningStreamDto,
  type MeetingDto,
  type NotificationDto,
  type PageDto,
  type SystemRole,
  type TaskDto,
  type VendorDto,
  type WorkflowTemplateSummaryDto,
} from "@/shared/api"
import {
  fromBackendDefinition,
  type WorkflowDefinitionV1,
} from "@/shared/api/workflow-definition"
import {
  stagesFromDefinition,
  type StageCatalog,
  EMPTY_STAGE_CATALOG,
} from "@/app/workflow-stages"
import type {
  ActivityEvent,
  Application,
  CalendarEvent,
  Document,
  ITProduct,
  Interaction,
  Meeting,
  Program,
  Stream,
  University,
} from "@/types"
import type { AdminUserRow } from "./adminSlice"

const PAGE_LIMIT = 200

/** Весь список постранично: бэкенд отдаёт не больше 200 записей за раз. */
export async function fetchAll<T>(
  load: (query: { page: number; limit: number }) => Promise<PageDto<T>>,
  maxItems = 10_000,
): Promise<T[]> {
  const items: T[] = []
  for (let page = 1; items.length < maxItems; page++) {
    const result = await load({ page, limit: PAGE_LIMIT })
    items.push(...result.items)
    if (!result.meta?.hasNext) break
  }
  return items
}

/**
 * Все заявки, включая архивные, и идентификаторы архивных — одним списком.
 *
 * Прежде список запрашивался дважды: активные и все вместе с архивом, чтобы
 * вычесть одно из другого. Теперь признак архива приходит в строке, и вход
 * в интерфейс вдвое короче (docs/load-testing.md). Если бэкенд признака
 * не отдал, архивные по-прежнему вычисляются вторым списком.
 */
export async function loadEngagements(): Promise<{ items: EngagementListItemDto[]; archivedIds: string[] }> {
  const items = await fetchAll((q) => api.engagements.list({ ...q, includeArchived: true }))
  if (items.every((i) => typeof i.isArchived === "boolean")) {
    return { items, archivedIds: items.filter((i) => i.isArchived).map((i) => i.id) }
  }
  const active = new Set((await fetchAll((q) => api.engagements.list(q))).map((i) => i.id))
  return { items, archivedIds: items.filter((i) => !active.has(i.id)).map((i) => i.id) }
}

/** Параллельно, но не больше `limit` запросов одновременно. */
export async function mapLimited<T, R>(
  inputs: T[],
  limit: number,
  fn: (input: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(inputs.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, inputs.length) }, async () => {
    while (next < inputs.length) {
      const index = next++
      results[index] = await fn(inputs[index])
    }
  })
  await Promise.all(workers)
  return results
}

// ---------------------------------------- нормализация DTO

export function normalizeUniversity(dto: Partial<University> & Pick<University, "id" | "name">): University {
  return {
    shortName: null,
    inn: null,
    region: null,
    city: null,
    website: null,
    isActive: true,
    engagementCount: 0,
    createdAt: new Date(0).toISOString(),
    ...dto,
  }
}

export function normalizeProgram(dto: Partial<Program> & Pick<Program, "id" | "name">): Program {
  return {
    directionId: "",
    directionName: "",
    productId: null,
    productName: null,
    hoursTotal: null,
    isActive: true,
    // Бэкенд без карточки каталога курсов — программа ИТ Школы РТК.
    source: "rtk-school",
    description: null,
    audience: null,
    audienceCategory: "specialists",
    requirements: null,
    ...dto,
  }
}

/** entityType бэкенда — имя сущности («Engagement»); интерфейс сравнивает в нижнем регистре. */
export function normalizeNotification(dto: NotificationDto): NotificationDto {
  return { ...dto, entityType: dto.entityType ? dto.entityType.toLowerCase() : null }
}

type RawPerson = { id: string; name?: string; displayName?: string; email?: string } | null | undefined

function person(raw: RawPerson) {
  return raw ? { id: raw.id, displayName: raw.displayName ?? raw.name, email: raw.email } : null
}

/** В задачах бэкенд отдаёт имя как `name`, клиентский тип — `displayName`. */
export function normalizeTask(dto: TaskDto): TaskDto {
  const raw = dto as TaskDto & { owner: RawPerson; createdBy?: RawPerson }
  return { ...dto, owner: person(raw.owner), createdBy: person(raw.createdBy) }
}

export function activityToEvent(item: ActivityItemDto): ActivityEvent {
  const actor = item.actor as { id?: string; name?: string } | null | undefined
  const engagement = item.engagement as { id?: string; counterpartyName?: string } | null | undefined
  return {
    id: item.id,
    type: item.type as ActivityEvent["type"],
    description: item.summary ? `${item.title}: ${item.summary}` : item.title,
    entityId: engagement?.id ?? "",
    entityType: "engagement",
    userId: actor?.id ?? "",
    actorName: actor?.name,
    entityName: engagement?.counterpartyName,
    createdAt: item.occurredAt,
  }
}

const CALENDAR_COLORS: Record<CalendarItemDto["kind"], CalendarEvent["color"]> = {
  TASK: "blue",
  STAGE_DEADLINE: "orange",
  MEETING: "purple",
}

const CALENDAR_LABELS: Record<CalendarItemDto["kind"], string> = {
  TASK: "Задача",
  STAGE_DEADLINE: "Срок этапа",
  MEETING: "Встреча",
}

const CALENDAR_TYPES: Record<CalendarItemDto["kind"], CalendarEvent["type"]> = {
  TASK: "reminder",
  STAGE_DEADLINE: "reminder",
  MEETING: "meeting",
}

/** Событие календаря бэкенда (задача, срок этапа, встреча) → событие виджета календаря. */
export function calendarItemToEvent(item: CalendarItemDto): CalendarEvent {
  const start = item.at ?? `${item.date}T${item.time ?? "09:00"}:00`
  const duration = item.meeting?.durationMinutes
  const end = duration ? new Date(new Date(start).getTime() + duration * 60_000).toISOString() : start
  const engagement = item.engagement as { id?: string } | null | undefined
  return {
    id: `${item.kind}-${item.id}`,
    title: item.title,
    description: item.meeting?.agenda ?? undefined,
    start,
    end,
    color: item.isOverdue && !item.isDone ? "red" : item.isDone ? "gray" : CALENDAR_COLORS[item.kind],
    labels: [CALENDAR_LABELS[item.kind]],
    type: CALENDAR_TYPES[item.kind],
    relatedEntityId: engagement?.id,
    relatedEntityType: engagement?.id ? "engagement" : undefined,
  }
}

const STREAM_STATUS: Record<LearningStreamDto["status"], Stream["status"]> = {
  PLANNED: "planned",
  ACTIVE: "active",
  COMPLETED: "completed",
  PAUSED: "paused",
}

/** Учебный поток бэкенда → поток интерфейса. */
export function streamFromDto(dto: LearningStreamDto): Stream {
  return {
    id: dto.id,
    programId: dto.programId,
    universityId: dto.universityId,
    name: dto.name,
    programName: dto.programName,
    universityName: dto.universityName,
    startDate: dto.startDate,
    endDate: dto.endDate,
    studentsCount: dto.studentsCount,
    status: STREAM_STATUS[dto.status],
  }
}

const MEETING_STATUS: Record<MeetingDto["status"], Meeting["status"]> = {
  SCHEDULED: "scheduled",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
}

/** Встреча бэкенда → встреча интерфейса. */
export function meetingFromDto(dto: MeetingDto): Meeting {
  return {
    id: dto.id,
    interactionId: dto.engagementId,
    date: dto.scheduledAt,
    participants: dto.participants.map((p) => p.name),
    agenda: dto.agenda ?? undefined,
    protocol: dto.protocol ?? undefined,
    status: MEETING_STATUS[dto.status],
    location: dto.location,
    durationMinutes: dto.durationMinutes,
    canEdit: dto.canEdit,
  }
}

export function adminUserToRow(dto: AdminUserDto): AdminUserRow {
  return {
    id: dto.id,
    email: dto.email,
    displayName: dto.displayName,
    role: dto.role,
    roleSource: dto.roleSource ?? "KEYCLOAK",
    isActive: dto.isActive,
    managerId: dto.managerId ?? null,
    scopeRules: dto.scopeRules ?? [],
  }
}

/**
 * Справочник сотрудников без доступа к /admin/users (руководитель, КАМ):
 * ответственные по видимым взаимодействиям плюс сам пользователь.
 */
export function employeesFromEngagements(
  interactions: Interaction[],
  me: { id: string; email: string; displayName: string; role: SystemRole; managerId: string | null },
): AdminUserRow[] {
  const rows = new Map<string, AdminUserRow>()
  rows.set(me.id, { ...me, roleSource: "KEYCLOAK", isActive: true })
  for (const i of interactions) {
    if (rows.has(i.ownerId)) continue
    rows.set(i.ownerId, {
      id: i.ownerId,
      email: "",
      displayName: i.ownerName,
      role: "USER",
      roleSource: "KEYCLOAK",
      isActive: true,
      managerId: me.role === "MANAGER" ? me.id : null,
    })
  }
  return [...rows.values()]
}

/** Этап B2C-маршрута → статус заявки на обучение. */
const APPLICATION_STATUS: Record<string, Application["status"]> = {
  REQUEST: "new",
  QUALIFICATION: "processing",
  OFFER: "processing",
  CONTRACT: "processing",
  ACCESS_GRANTED: "enrolled",
  LEARNING: "enrolled",
  COMPLETED: "enrolled",
  REJECTED: "rejected",
}

/**
 * Откуда пришла заявка. Бэкенд отдаёт имя источника интеграции («LMS ИТ
 * Школы РТК», «Сайт ИТ Школы РТК»); тип источника в строке списка не
 * передаётся, поэтому LMS узнаётся по имени, остальные внешние — сайт.
 */
function applicationSource(externalSource: string | null | undefined): Application["source"] {
  if (!externalSource) return "crm"
  return /lms/i.test(externalSource) ? "lms" : "website"
}

/** Заявки на обучение — B2C-взаимодействия (обращения с сайта, из LMS, заведённые в CRM). */
export function applicationsFromEngagements(interactions: Interaction[]): Application[] {
  return interactions
    .filter((i) => i.segment === "B2C")
    .map((i) => ({
      id: i.id,
      engagementId: i.id,
      source: applicationSource(i.externalSource),
      programId: i.programId ?? "",
      programName: i.programName ?? undefined,
      universityId: i.universityId ?? undefined,
      applicantName: i.counterpartyName,
      applicantEmail: "",
      status: APPLICATION_STATUS[i.currentStateKey] ?? "processing",
      stateLabel: i.currentStateLabel,
      directionName: i.directionName,
      createdAt: i.createdAt.slice(0, 10),
    }))
}

/** Документы — вложения взаимодействия. */
export function attachmentToDocument(engagementId: string, a: AttachmentDto): Document {
  const stateLabel = typeof a.stateLabel === "string" ? a.stateLabel : null
  return {
    id: a.id,
    interactionId: engagementId,
    type: "other",
    name: a.fileName,
    // Согласования документов у бэкенда нет; статус файла — результат проверки.
    status: a.scanStatus === "INFECTED" || a.scanStatus === "ERROR" ? "rejected" : "signed",
    version: 1,
    createdAt: a.createdAt,
    updatedAt: a.createdAt,
    attachment: {
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      scanStatus: a.scanStatus,
      stateLabel,
      uploadedByName: a.uploadedByName,
    },
  }
}

// ---------------------------------------- календарь

/**
 * Задачи: все невыполненные и выполненные со сроком за последние 30 дней.
 * По умолчанию бэкенд отдаёт только невыполненные — отмеченная задача
 * исчезала бы после обновления, и вернуть её в работу было бы нельзя.
 */
export async function loadTasks(): Promise<TaskDto[]> {
  const since = new Date()
  since.setDate(since.getDate() - 30)
  const [open, done] = await Promise.all([
    fetchAll((q) => api.calendarTasks.list({ ...q, status: "open" }), 2000),
    fetchAll((q) => api.calendarTasks.list({ ...q, status: "done", from: since.toISOString().slice(0, 10) }), 2000),
  ])
  return [...open, ...done].map(normalizeTask)
}

/** Бэкенд отдаёт календарь не больше чем за 92 дня — берём окнами по 90. */
const CALENDAR_WINDOW_DAYS = 90

function addDays(base: Date, days: number): string {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

/** События календаря за период [сегодня+fromDays; сегодня+toDays]. */
export async function loadCalendarEvents(fromDays = -60, toDays = 180): Promise<CalendarEvent[]> {
  const today = new Date()
  const windows: { from: string; to: string }[] = []
  for (let start = fromDays; start <= toDays; start += CALENDAR_WINDOW_DAYS + 1) {
    windows.push({ from: addDays(today, start), to: addDays(today, Math.min(start + CALENDAR_WINDOW_DAYS, toDays)) })
  }
  const pages = await mapLimited(windows, 3, (w) => api.calendar.get(w))
  const seen = new Set<string>()
  const events: CalendarEvent[] = []
  for (const item of pages.flatMap((p) => p.items)) {
    const event = calendarItemToEvent(item)
    if (seen.has(event.id)) continue
    seen.add(event.id)
    events.push(event)
  }
  return events
}

// ---------------------------------------- шаблоны процессов

export interface WorkflowData {
  workflowTemplates: WorkflowTemplateSummaryDto[]
  workflowDefinitions: Record<string, WorkflowDefinitionV1>
  stageCatalog: StageCatalog
}

/**
 * Все редакции процессов с определениями. Этапы сегмента — из действующей
 * основной редакции: по ней ведутся все заявки сегмента.
 */
export async function loadWorkflow(): Promise<WorkflowData> {
  const workflowTemplates = await api.workflowTemplates.list({ includeInactive: true })
  const details = await mapLimited(workflowTemplates, 4, (t) => api.workflowTemplates.get(t.id))
  const workflowDefinitions = Object.fromEntries(
    details.map((d) => [d.id, fromBackendDefinition(d.definition)]),
  )
  return { workflowTemplates, workflowDefinitions, stageCatalog: stageCatalogFrom(workflowTemplates, workflowDefinitions) }
}

export function stageCatalogFrom(
  templates: WorkflowTemplateSummaryDto[],
  definitions: Record<string, WorkflowDefinitionV1>,
): StageCatalog {
  const catalog: StageCatalog = { ...EMPTY_STAGE_CATALOG }
  for (const segment of ["B2B", "B2C"] as const) {
    const active = templates.find((t) => t.segment === segment && t.isActive && t.isDefault)
    const definition = active ? definitions[active.id] : undefined
    catalog[segment] = definition ? stagesFromDefinition(definition) : []
  }
  return catalog
}

// ---------------------------------------- начальная загрузка

export interface SessionInfo {
  id: string
  email: string
  displayName: string
  role: SystemRole
  managerId: string | null
}

export interface AppData extends WorkflowData {
  universities: University[]
  programs: Program[]
  products: ITProduct[]
  directions: ItDirectionDto[]
  vendors: VendorDto[]
  streams: Stream[]
  interactions: Interaction[]
  archivedIds: string[]
  applications: Application[]
  notifications: NotificationDto[]
  calendarTasks: TaskDto[]
  calendarEvents: CalendarEvent[]
  activityEvents: ActivityEvent[]
  adminUsers: AdminUserRow[]
  auditLog: AuditLogItemDto[]
}

/** Необязательная часть: её отказ не должен ронять весь интерфейс. */
async function optional<T>(label: string, load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load()
  } catch (error) {
    console.warn(`[api] не загружено: ${label}`, error)
    return fallback
  }
}

/**
 * Данные, которые нужны интерфейсу сразу после входа. Запросы идут
 * параллельно; разделы администрирования запрашиваются только у ролей,
 * которым бэкенд их отдаёт, — иначе каждый вход сопровождался бы 403.
 */
export async function loadAppData(me: SessionInfo): Promise<AppData> {
  const isAdmin = me.role === "ADMIN"

  const [
    universities,
    programs,
    products,
    directions,
    vendors,
    streams,
    engagements,
    workflow,
    notifications,
    calendarTasks,
    calendar,
    feed,
    users,
    auditLog,
  ] = await Promise.all([
    fetchAll((q) => api.universities.list(q)),
    fetchAll((q) => api.programs.list(q)),
    fetchAll((q) => api.products.list(q)),
    fetchAll((q) => api.directions.list(q)),
    fetchAll((q) => api.vendors.list(q)),
    optional("учебные потоки", () => fetchAll((q) => api.streams.list(q)), [] as LearningStreamDto[]),
    loadEngagements(),
    loadWorkflow(),
    optional("уведомления", () => fetchAll((q) => api.notifications.list(q), 1000), []),
    optional("задачи", loadTasks, []),
    optional("календарь", () => loadCalendarEvents(), [] as CalendarEvent[]),
    optional("лента действий", () => api.activity.feed({ page: 1, limit: PAGE_LIMIT }), null),
    isAdmin ? optional("пользователи", () => fetchAll((q) => api.adminUsers.list(q)), []) : Promise.resolve([]),
    isAdmin ? optional("журнал аудита", () => api.audit.list({ page: 1, limit: PAGE_LIMIT }), null) : Promise.resolve(null),
    // Персоны (ПДн) здесь не загружаются: каждое чтение списка — запись
    // «просмотр ПДн» в журнале, и выдавать их при каждом входе, когда
    // раздел никто не открывал, противоречит минимизации (152-ФЗ).
    // Список читает сама страница — loadPersons.
  ])

  const interactions = engagements.items

  return {
    ...workflow,
    universities: universities.map(normalizeUniversity),
    programs: programs.map(normalizeProgram),
    products,
    directions,
    vendors,
    streams: streams.map(streamFromDto),
    interactions,
    archivedIds: engagements.archivedIds,
    applications: applicationsFromEngagements(interactions),
    notifications: notifications.map(normalizeNotification),
    calendarTasks,
    calendarEvents: calendar,
    activityEvents: (feed?.items ?? []).map(activityToEvent),
    adminUsers: isAdmin ? users.map(adminUserToRow) : employeesFromEngagements(interactions, me),
    auditLog: auditLog?.items ?? [],
  }
}
