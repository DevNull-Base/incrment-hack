// ========================================
// Типизированный API-клиент по openapi.json
// Базовый путь: /api/v1
// ========================================
import type {
  AdminUserDto,
  AttachmentDto,
  AuditLogItemDto,
  ChainVerificationDto,
  ChangeManagerDto,
  ChangeRoleDto,
  ChangeStatusDto,
  ChannelSettingsDto,
  ContractDescriptionDto,
  CreateEngagementDto,
  CreateItDirectionDto,
  CreateItProgramDto,
  CreateReportDto,
  CreateSoftwareProductDto,
  CreateUniversityDto,
  CreateVendorDto,
  CreateWorkflowTemplateDto,
  CurrentUserDto,
  EngagementDetailDto,
  EngagementListItemDto,
  ErasePersonDto,
  GuideDto,
  GuideSummaryDto,
  ImportFieldDto,
  ImportJobCreatedDto,
  IntegrationSourceDto,
  IntegrationSyncRunDto,
  InboundEventResultDto,
  ItDirectionDto,
  ItProgramDto,
  NotificationDto,
  NotificationSettingsDto,
  PageDto,
  PerformTransitionDto,
  PersonDto,
  PublishWorkflowTemplateDto,
  RecentItemDto,
  ReassignEngagementDto,
  ReportColumnDto,
  ReportJobDto,
  SaveDraftDto,
  SaveStateDto,
  ScopeDimension,
  ScopeRuleDto,
  SetResolutionsDto,
  SetScopeRuleDto,
  SimilarUniversityDto,
  SoftwareProductDto,
  TrackVisitDto,
  UnreadCountDto,
  UpdateChannelDto,
  UpdateItDirectionDto,
  UpdateItProgramDto,
  UpdateMappingDto,
  UpdatePersonDto,
  UpdatePolicyDto,
  UpdateSoftwareProductDto,
  UpdateUniversityDto,
  UpdateEngagementDto,
  UpdateVendorDto,
  UpdateWorkflowTemplateDto,
  UniversityDto,
  VendorDto,
  WorkflowPublishPreviewDto,
  WorkflowPublishResultDto,
  WorkflowTemplateDetailDto,
  WorkflowTemplateSummaryDto,
  WorkspaceStateDto,
  ActivityItemDto,
  ArchiveEngagementDto,
  CalendarDto,
  CreateNoteDto,
  CreateTaskDto,
  EngagementContactDto,
  NoteDto,
  TaskDto,
  UniversityContactDto,
  UniversityContractDto,
  LearningStreamDto,
  CreateLearningStreamDto,
  UniversityNoteDto,
  CreateUniversityNoteDto,
  MeetingDto,
  CreateMeetingDto,
  UpdateMeetingDto,
  ProgramSource,
  ProgramAudience,
  StreamStatusDto,
  DraftDto,
} from "./types"
import { toast } from "@/shared/lib/toast-store"

// ========================================
// Конфигурация
// ========================================
export interface ApiClientConfig {
  baseUrl?: string
  getToken?: () => string | null
  /**
   * Вызывается на 401 с токеном, с которым ушёл запрос. true — токен
   * обновлён, запрос повторяется один раз.
   */
  onUnauthorized?: (usedToken: string | null) => Promise<boolean>
  /** 401 не удалось исправить: сессия истекла или отозвана. */
  onSessionExpired?: () => void
}

const defaultConfig: ApiClientConfig = {
  baseUrl: "/api/v1",
  getToken: () => localStorage.getItem("crm_access_token"),
}

let config: ApiClientConfig = { ...defaultConfig }

export function configureApi(cfg: Partial<ApiClientConfig>): void {
  config = { ...config, ...cfg }
}

// ========================================
// Транспорт
// ========================================
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly traceId?: string

  constructor(
    status: number,
    code: string,
    message: string,
    traceId?: string,
  ) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
    this.traceId = traceId
  }
}

type Query = Record<string, string | number | boolean | undefined | null>

function buildUrl(path: string, query?: Query): string {
  const base = (config.baseUrl ?? "").replace(/\/$/, "")
  const url = `${base}${path}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue
    params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

async function request<T>(
  method: string,
  path: string,
  options: {
    query?: Query
    body?: unknown
    headers?: Record<string, string>
    raw?: boolean
    /** Ошибку покажет вызывающий код — с контекстом действия, без общего тоста. */
    silent?: boolean
  } = {},
  retried = false,
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...options.headers,
  }
  const token = config.getToken?.() ?? null
  if (token) headers.Authorization = `Bearer ${token}`
  if (options.body !== undefined && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json"
  }

  const response = await fetch(buildUrl(path, options.query), {
    method,
    headers,
    body:
      options.body === undefined
        ? undefined
        : options.body instanceof FormData
          ? options.body
          : JSON.stringify(options.body),
  }).catch((cause: unknown) => {
    // Неуспешное действие: сеть недоступна. ApiError ниже — для HTTP-ошибок.
    if (!options.silent) toast.error("Ошибка сети", "Не удалось связаться с сервером")
    throw cause
  })

  if (response.status === 401 && config.onUnauthorized) {
    // Токен просрочен или обновлён соседней вкладкой — одна попытка восстановиться.
    if (!retried && (await config.onUnauthorized(token))) {
      return request<T>(method, path, options, true)
    }
    // Сессию не вернуть: вместо череды одинаковых тостов — выход на экран входа.
    config.onSessionExpired?.()
    throw new ApiError(401, "UNAUTHORIZED", "Сессия истекла")
  }

  if (!response.ok) {
    let code = "HTTP_ERROR"
    let message = response.statusText || `HTTP ${response.status}`
    let traceId: string | undefined
    try {
      const problem = await response.json()
      if (problem?.code) code = problem.code
      if (problem?.detail || problem?.title) message = problem.detail || problem.title
      if (problem?.traceId) traceId = problem.traceId
    } catch {
      // ответ не JSON — оставляем статус-текст
    }
    if (!options.silent) toast.error("Запрос не выполнен", message)
    throw new ApiError(response.status, code, message, traceId)
  }

  if (options.raw) return response as unknown as T
  if (response.status === 204) return undefined as T
  const text = await response.text()
  return (text ? JSON.parse(text) : undefined) as T
}

/** Параметры вызова: silent — ошибку показывает вызывающий код. */
export interface CallOptions {
  silent?: boolean
}

const get = <T>(path: string, query?: Query, opts?: CallOptions) =>
  request<T>("GET", path, { query, silent: opts?.silent })
const post = <T>(path: string, body?: unknown, headers?: Record<string, string>, opts?: CallOptions) =>
  request<T>("POST", path, { body, headers, silent: opts?.silent })
const put = <T>(path: string, body?: unknown, opts?: CallOptions) =>
  request<T>("PUT", path, { body, silent: opts?.silent })
const patch = <T>(path: string, body?: unknown, opts?: CallOptions) =>
  request<T>("PATCH", path, { body, silent: opts?.silent })
const del = <T>(path: string, opts?: CallOptions) =>
  request<T>("DELETE", path, { silent: opts?.silent })

// Общие query-параметры списков
export interface ListQuery {
  page?: number
  limit?: number
  search?: string
  sortOrder?: string
}

// ========================================
// Auth
// ========================================
export const auth = {
  me: () => get<CurrentUserDto>("/auth/me"),
}

// ========================================
// Здоровье сервиса
// ========================================
export const health = {
  live: () => get<unknown>("/health/live", undefined),
  ready: () => get<unknown>("/health/ready", undefined),
  check: () => get<unknown>("/health", undefined),
}

// ========================================
// Каталог: вузы
// ========================================
export interface UniversityListQuery extends ListQuery {
  region?: string
  activeOnly?: boolean
  sortBy?: "name" | "createdAt" | "engagementCount"
}

export const universities = {
  list: (query?: UniversityListQuery) =>
    get<PageDto<UniversityDto>>("/catalog/universities", query as Query),
  similar: (name: string) =>
    get<SimilarUniversityDto[]>("/catalog/universities/similar", { name }),
  get: (id: string) => get<UniversityDto>(`/catalog/universities/${id}`),
  create: (body: CreateUniversityDto, opts?: CallOptions) =>
    post<UniversityDto>("/catalog/universities", body, undefined, opts),
  update: (id: string, body: UpdateUniversityDto, opts?: CallOptions) =>
    put<UniversityDto>(`/catalog/universities/${id}`, body, opts),
  remove: (id: string) => del<void>(`/catalog/universities/${id}`),
  contacts: (id: string) =>
    get<UniversityContactDto[]>(`/catalog/universities/${id}/contacts`),
  contracts: (id: string) =>
    get<UniversityContractDto[]>(`/catalog/universities/${id}/contracts`),
}

/** Заметки по вузу целиком — то, что не относится ни к одной заявке. */
export const universityNotes = {
  list: (universityId: string) =>
    get<UniversityNoteDto[]>(`/catalog/universities/${universityId}/notes`),
  create: (universityId: string, body: CreateUniversityNoteDto, opts?: CallOptions) =>
    post<UniversityNoteDto>(`/catalog/universities/${universityId}/notes`, body, undefined, opts),
  update: (universityId: string, noteId: string, body: Partial<CreateUniversityNoteDto>) =>
    patch<UniversityNoteDto>(`/catalog/universities/${universityId}/notes/${noteId}`, body),
  remove: (universityId: string, noteId: string) =>
    del<void>(`/catalog/universities/${universityId}/notes/${noteId}`),
}

// ========================================
// Каталог: вендоры и продукты
// ========================================
export const vendors = {
  list: (query?: ListQuery) => get<PageDto<VendorDto>>("/catalog/vendors", query as Query),
  create: (body: CreateVendorDto) => post<VendorDto>("/catalog/vendors", body),
  update: (id: string, body: UpdateVendorDto) =>
    put<VendorDto>(`/catalog/vendors/${id}`, body),
}

export interface ProductListQuery extends ListQuery {
  vendorId?: string
  activeOnly?: boolean
}

export const products = {
  list: (query?: ProductListQuery) =>
    get<PageDto<SoftwareProductDto>>("/catalog/products", query as Query),
  create: (body: CreateSoftwareProductDto, opts?: CallOptions) =>
    post<SoftwareProductDto>("/catalog/products", body, undefined, opts),
  update: (id: string, body: UpdateSoftwareProductDto) =>
    put<SoftwareProductDto>(`/catalog/products/${id}`, body),
}

// ========================================
// Каталог: направления и программы
// ========================================
export const directions = {
  list: (query?: ListQuery) => get<PageDto<ItDirectionDto>>("/catalog/directions", query as Query),
  create: (body: CreateItDirectionDto) => post<ItDirectionDto>("/catalog/directions", body),
  update: (id: string, body: UpdateItDirectionDto) =>
    put<ItDirectionDto>(`/catalog/directions/${id}`, body),
}

export interface ProgramListQuery extends ListQuery {
  directionId?: string
  activeOnly?: boolean
  source?: ProgramSource
  audienceCategory?: ProgramAudience
  universityId?: string
  hoursMin?: number
  hoursMax?: number
  hasStreams?: boolean
  sortBy?: "name" | "hoursTotal" | "students"
}

export const programs = {
  list: (query?: ProgramListQuery) =>
    get<PageDto<ItProgramDto>>("/catalog/programs", query as Query),
  create: (body: CreateItProgramDto) => post<ItProgramDto>("/catalog/programs", body),
  update: (id: string, body: UpdateItProgramDto) =>
    put<ItProgramDto>(`/catalog/programs/${id}`, body),
}

// ========================================
// Учебные потоки
// ========================================
export interface StreamListQuery extends ListQuery {
  programId?: string
  universityId?: string
  status?: StreamStatusDto
}

export const streams = {
  list: (query?: StreamListQuery) =>
    get<PageDto<LearningStreamDto>>("/catalog/streams", query as Query),
  create: (body: CreateLearningStreamDto, opts?: CallOptions) =>
    post<LearningStreamDto>("/catalog/streams", body, undefined, opts),
  update: (id: string, body: CreateLearningStreamDto, opts?: CallOptions) =>
    put<LearningStreamDto>(`/catalog/streams/${id}`, body, opts),
  remove: (id: string) => del<void>(`/catalog/streams/${id}`),
}

// ========================================
// Workflow-шаблоны
// ========================================
export interface WorkflowListQuery {
  segment?: string
  includeInactive?: boolean
}

export const workflowTemplates = {
  list: (query?: WorkflowListQuery) =>
    get<WorkflowTemplateSummaryDto[]>("/workflow/templates", query as Query),
  get: (id: string) => get<WorkflowTemplateDetailDto>(`/workflow/templates/${id}`),
  create: (body: CreateWorkflowTemplateDto, opts?: CallOptions) =>
    post<WorkflowTemplateDetailDto>("/workflow/templates", body, undefined, opts),
  update: (id: string, body: UpdateWorkflowTemplateDto, opts?: CallOptions) =>
    put<WorkflowTemplateDetailDto>(`/workflow/templates/${id}`, body, opts),
  publishPreview: (id: string, opts?: CallOptions) =>
    get<WorkflowPublishPreviewDto>(`/workflow/templates/${id}/publish/preview`, undefined, opts),
  publish: (id: string, body: PublishWorkflowTemplateDto, opts?: CallOptions) =>
    post<WorkflowPublishResultDto>(`/workflow/templates/${id}/publish`, body, undefined, opts),
}

// ========================================
// Взаимодействия (Engagements)
// ========================================
export interface EngagementListQuery extends ListQuery {
  segment?: string
  universityId?: string
  directionId?: string
  productId?: string
  ownerId?: string
  stateKey?: string
  periodFrom?: string
  periodTo?: string
  includeArchived?: boolean
  sortBy?: string
}

export const engagements = {
  list: (query?: EngagementListQuery) =>
    get<PageDto<EngagementListItemDto>>("/engagements", query as Query),
  get: (id: string) => get<EngagementDetailDto>(`/engagements/${id}`),
  create: (body: CreateEngagementDto, opts?: CallOptions) =>
    post<EngagementDetailDto>("/engagements", body, undefined, opts),
  transition: (id: string, body: PerformTransitionDto, version?: number, opts?: CallOptions) =>
    post<EngagementDetailDto>(`/engagements/${id}/transition`, body,
      version !== undefined ? { "If-Match": String(version) } : undefined, opts),
  reassign: (id: string, body: ReassignEngagementDto, opts?: CallOptions) =>
    post<EngagementDetailDto>(`/engagements/${id}/reassign`, body, undefined, opts),
  update: (id: string, body: UpdateEngagementDto) =>
    patch<EngagementDetailDto>(`/engagements/${id}`, body),
  timeline: (id: string, query?: ListQuery) =>
    get<PageDto<ActivityItemDto>>(`/engagements/${id}/timeline`, query as Query),
  archive: (id: string, body: ArchiveEngagementDto, opts?: CallOptions) =>
    post<void>(`/engagements/${id}/archive`, body, undefined, opts),
  restore: (id: string, opts?: CallOptions) =>
    post<void>(`/engagements/${id}/restore`, undefined, undefined, opts),
  getContact: (id: string) => get<EngagementContactDto>(`/engagements/${id}/contact`),
  updateContact: (id: string, body: EngagementContactDto) =>
    patch<EngagementContactDto>(`/engagements/${id}/contact`, body),
}

export const attachments = {
  list: (engagementId: string) =>
    get<AttachmentDto[]>(`/engagements/${engagementId}/attachments`),
  upload: (engagementId: string, file: File, stateKey?: string, opts?: CallOptions) => {
    const form = new FormData()
    form.append("file", file)
    const qs = stateKey ? `?stateKey=${encodeURIComponent(stateKey)}` : ""
    return post<AttachmentDto>(`/engagements/${engagementId}/attachments${qs}`, form, undefined, opts)
  },
  download: (engagementId: string, attachmentId: string) =>
    request<Response>("GET", `/engagements/${engagementId}/attachments/${attachmentId}`, {
      raw: true,
    }),
  remove: (engagementId: string, attachmentId: string, opts?: CallOptions) =>
    del<void>(`/engagements/${engagementId}/attachments/${attachmentId}`, opts),
}

// ========================================
// Импорт
// ========================================
export const importApi = {
  fields: () => get<ImportFieldDto[]>("/import/fields"),
  start: (body: FormData) => post<ImportJobCreatedDto>("/import", body),
  get: (id: string) => get<unknown>(`/import/${id}`),
  updateMapping: (id: string, body: UpdateMappingDto) =>
    put<unknown>(`/import/${id}/mapping`, body),
  setResolutions: (id: string, body: SetResolutionsDto) =>
    put<unknown>(`/import/${id}/resolutions`, body),
  apply: (id: string) => post<unknown>(`/import/${id}/apply`),
}

// ========================================
// Отчёты
// ========================================
/**
 * Небольшой отчёт бэкенд отдаёт сразу файлом (200), объёмный ставит
 * в очередь (202 с jobId) — готовый файл забирается через download.
 */
export type ReportRequestResult =
  | { kind: "file"; blob: Blob; fileName: string | null; rowCount: number | null }
  | { kind: "job"; jobId: string; status: string; fromCache: boolean }

export const reports = {
  columns: () => get<ReportColumnDto[]>("/reports/columns"),
  create: async (body: CreateReportDto): Promise<ReportRequestResult> => {
    const response = await request<Response>("POST", "/reports", { body, raw: true })
    if (response.status === 202) {
      const job = (await response.json()) as { jobId: string; status: string; fromCache?: boolean }
      return { kind: "job", jobId: job.jobId, status: job.status, fromCache: Boolean(job.fromCache) }
    }
    const disposition = response.headers.get("Content-Disposition") ?? ""
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1]
    const rows = response.headers.get("X-Report-Rows")
    return {
      kind: "file",
      blob: await response.blob(),
      fileName: encoded ? decodeURIComponent(encoded) : null,
      rowCount: rows ? Number(rows) : null,
    }
  },
  get: (id: string) => get<ReportJobDto>(`/reports/${id}`),
  download: (id: string) =>
    request<Response>("GET", `/reports/${id}/download`, { raw: true }),
}

// ========================================
// Рабочий контекст (activity)
// ========================================
export const activity = {
  snapshot: () => get<unknown>("/activity/snapshot"),
  getState: (scopeKey: string, opts?: CallOptions) =>
    get<WorkspaceStateDto>(`/activity/workspace/${encodeURIComponent(scopeKey)}`, undefined, opts),
  saveState: (scopeKey: string, body: SaveStateDto, opts?: CallOptions) =>
    put<WorkspaceStateDto>(`/activity/workspace/${encodeURIComponent(scopeKey)}`, body, opts),
  clearState: (scopeKey: string) =>
    del<void>(`/activity/workspace/${encodeURIComponent(scopeKey)}`),
  getDraft: (entityType: string, entityId?: string, opts?: CallOptions) =>
    get<DraftDto | null>(`/activity/drafts/${entityType}`, entityId ? { entityId } : undefined, opts),
  saveDraft: (entityType: string, entityId: string | undefined, body: SaveDraftDto, opts?: CallOptions) =>
    put<unknown>(
      entityId
        ? `/activity/drafts/${entityType}?entityId=${encodeURIComponent(entityId)}`
        : `/activity/drafts/${entityType}`,
      body,
      opts,
    ),
  deleteDraft: (entityType: string, entityId?: string, opts?: CallOptions) =>
    del<unknown>(
      entityId
        ? `/activity/drafts/${entityType}?entityId=${encodeURIComponent(entityId)}`
        : `/activity/drafts/${entityType}`,
      opts,
    ),
  recent: (opts?: CallOptions) => get<RecentItemDto[]>("/activity/recent", undefined, opts),
  feed: (query?: ListQuery) => get<PageDto<ActivityItemDto>>("/activity/feed", query as Query),
  trackVisit: (entityType: string, entityId: string, body: TrackVisitDto, opts?: CallOptions) =>
    put<void>(`/activity/recent/${entityType}/${entityId}`, body, opts),
}

// ========================================
// Администрирование
// ========================================
export interface AdminUserListQuery extends ListQuery {
  role?: string
  activeOnly?: boolean
}

export const adminUsers = {
  list: (query?: AdminUserListQuery) =>
    get<PageDto<AdminUserDto>>("/admin/users", query as Query),
  get: (id: string) => get<AdminUserDto>(`/admin/users/${id}`),
  changeRole: (id: string, body: ChangeRoleDto, opts?: CallOptions) =>
    patch<AdminUserDto>(`/admin/users/${id}/role`, body, opts),
  changeStatus: (id: string, body: ChangeStatusDto, opts?: CallOptions) =>
    patch<AdminUserDto>(`/admin/users/${id}/status`, body, opts),
  changeManager: (id: string, body: ChangeManagerDto, opts?: CallOptions) =>
    patch<AdminUserDto>(`/admin/users/${id}/manager`, body, opts),
  setScope: (id: string, dimension: ScopeDimension, body: SetScopeRuleDto, opts?: CallOptions) =>
    put<ScopeRuleDto>(`/admin/users/${id}/scope/${dimension}`, body, opts),
  removeScope: (id: string, dimension: ScopeDimension, opts?: CallOptions) =>
    del<void>(`/admin/users/${id}/scope/${dimension}`, opts),
}

// ========================================
// Персоны (персональные данные)
// ========================================
export interface PersonListQuery extends ListQuery {
  includeErased?: boolean
}

export const persons = {
  list: (query?: PersonListQuery) =>
    get<PageDto<PersonDto>>("/persons", query as Query),
  get: (id: string) => get<PersonDto>(`/persons/${id}`),
  update: (id: string, body: UpdatePersonDto) =>
    patch<PersonDto>(`/persons/${id}`, body),
  erase: (id: string, body: ErasePersonDto, opts?: CallOptions) =>
    post<void>(`/persons/${id}/erase`, body, undefined, opts),
}

// ========================================
// Интеграции
// ========================================
export const integrations = {
  sources: () => get<IntegrationSourceDto[]>("/integration/sources"),
  runs: (sourceId?: string) =>
    get<IntegrationSyncRunDto[]>("/integration/runs", sourceId ? { sourceId } : undefined),
  sync: (id: string) => post<IntegrationSyncRunDto>(`/integration/sources/${id}/sync`),
  resetCursor: (id: string) => del<void>(`/integration/sources/${id}/cursor`),
  lmsEvent: (body: unknown, signature?: string) =>
    post<InboundEventResultDto>("/integration/lms/events", body,
      signature ? { "X-Signature": signature } : undefined),
  websiteEvent: (body: unknown, signature?: string) =>
    post<InboundEventResultDto>("/integration/website/events", body,
      signature ? { "X-Signature": signature } : undefined),
  contract: (name: string) =>
    get<ContractDescriptionDto>(`/integration/contracts/${name}`),
}

// ========================================
// Уведомления
// ========================================
export interface NotificationListQuery extends ListQuery {
  channel?: string
  onlyUnread?: boolean
}

export const notifications = {
  list: (query?: NotificationListQuery) =>
    get<PageDto<NotificationDto>>("/notifications", query as Query),
  unreadCount: () => get<UnreadCountDto>("/notifications/unread-count"),
  markRead: (id: string) => post<void>(`/notifications/${id}/read`),
  markAllRead: () => post<void>("/notifications/read-all"),
  settings: () => get<NotificationSettingsDto>("/notifications/settings"),
  updatePolicy: (body: UpdatePolicyDto) =>
    put<NotificationSettingsDto>("/notifications/settings", body),
  updateChannel: (channel: string, body: UpdateChannelDto) =>
    put<ChannelSettingsDto>(`/notifications/settings/channels/${channel}`, body),
  testChannel: (channel: string) =>
    post<ChannelSettingsDto>(`/notifications/settings/channels/${channel}/test`),
  runEscalation: () => post<unknown>("/notifications/escalation/run"),
}

// ========================================
// Справочники (guides)
// ========================================
export const guides = {
  list: () => get<GuideSummaryDto[]>("/guides"),
  get: (slug: string) => get<GuideDto>(`/guides/${slug}`),
}

// ========================================
// Аудит
// ========================================
export interface AuditListQuery extends ListQuery {
  action?: string
  entityType?: string
  actorId?: string
  from?: string
  to?: string
  depth?: number
}

export const audit = {
  list: (query?: AuditListQuery) =>
    get<PageDto<AuditLogItemDto>>("/audit", query as Query),
  verify: (query?: AuditListQuery) =>
    get<ChainVerificationDto>("/audit/verify", query as Query),
}

// ========================================
// Календарь задач и заметки (новый контракт)
// ========================================
export const calendar = {
  get: (query?: { from?: string; to?: string; kinds?: string; team?: boolean; includeCompleted?: boolean }) =>
    get<CalendarDto>("/calendar", query as Query),
}

export interface TaskListQuery {
  page?: number
  limit?: number
  status?: string
  from?: string
  to?: string
  engagementId?: string
  assignedByMe?: boolean
}

export const calendarTasks = {
  list: (query?: TaskListQuery) =>
    get<PageDto<TaskDto>>("/calendar/tasks", query as Query),
  get: (id: string) => get<TaskDto>(`/calendar/tasks/${id}`),
  create: (body: CreateTaskDto, opts?: CallOptions) =>
    post<TaskDto>("/calendar/tasks", body, undefined, opts),
  update: (id: string, body: Partial<Omit<CreateTaskDto, "ownerId">>) =>
    patch<TaskDto>(`/calendar/tasks/${id}`, body),
  remove: (id: string) => del<void>(`/calendar/tasks/${id}`),
  complete: (id: string) => post<TaskDto>(`/calendar/tasks/${id}/complete`),
  reopen: (id: string) => post<TaskDto>(`/calendar/tasks/${id}/reopen`),
}

export const notes = {
  list: (engagementId: string) =>
    get<NoteDto[]>(`/engagements/${engagementId}/notes`),
  create: (engagementId: string, body: CreateNoteDto, opts?: CallOptions) =>
    post<NoteDto>(`/engagements/${engagementId}/notes`, body, undefined, opts),
  update: (engagementId: string, noteId: string, body: Partial<CreateNoteDto>) =>
    patch<NoteDto>(`/engagements/${engagementId}/notes/${noteId}`, body),
  remove: (engagementId: string, noteId: string) =>
    del<void>(`/engagements/${engagementId}/notes/${noteId}`),
}

/** Встречи с представителями вуза по заявке. Удаления нет — встреча отменяется. */
export const meetings = {
  list: (engagementId: string) =>
    get<MeetingDto[]>(`/engagements/${engagementId}/meetings`),
  create: (engagementId: string, body: CreateMeetingDto, opts?: CallOptions) =>
    post<MeetingDto>(`/engagements/${engagementId}/meetings`, body, undefined, opts),
  update: (engagementId: string, meetingId: string, body: UpdateMeetingDto, opts?: CallOptions) =>
    patch<MeetingDto>(`/engagements/${engagementId}/meetings/${meetingId}`, body, opts),
}

// ========================================
// Агрегат клиента
// ========================================
export const api = {
  auth,
  health,
  universities,
  universityNotes,
  vendors,
  products,
  directions,
  programs,
  streams,
  workflowTemplates,
  engagements,
  attachments,
  import: importApi,
  reports,
  activity,
  calendar,
  calendarTasks,
  notes,
  meetings,
  adminUsers,
  persons,
  integrations,
  notifications,
  guides,
  audit,
}

export type Api = typeof api
