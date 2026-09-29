// ========================================
// DTO-типы, сгенерированные из openapi.json
// (OpenAPI 3.0 — CRM «ИТ Школа РТК» v1.0)
// Источник: /openapi.json в корне проекта
// ========================================

// --- Общие ---
export interface PageMetaDto {
  page: number
  limit: number
  total: number
  totalPages: number
  hasNext: boolean
}

export interface PageDto<T> {
  items: T[]
  meta: PageMetaDto
}

export interface ProblemDetailsDto {
  type: string
  title: string
  status: number
  detail: string
  code: string
  instance: string
  traceId: string
  timestamp: string
  errors?: object[]
  meta?: object
}

// --- Auth / пользователи ---
export type SystemRole = "USER" | "MANAGER" | "ADMIN"

export interface DataScopeSummaryDto {
  restricted: boolean
  ownerCount: number | null
  universityCount: number | null
}

export interface CurrentUserDto {
  id: string
  email: string
  displayName: string
  role: SystemRole
  managerId: string | null
  managerName?: string | null
  dataScope: DataScopeSummaryDto
}

export type ScopeDimension =
  | "UNIVERSITY"
  | "IT_DIRECTION"
  | "SOFTWARE_PRODUCT"
  | "REGION"

export interface ScopeRuleDto {
  dimension: ScopeDimension
  allowedIds: string[]
}

export interface AdminUserDto {
  id: string
  email: string
  displayName: string
  role: SystemRole
  roleSource?: "KEYCLOAK" | "CRM"
  isActive: boolean
  managerId: string
  managerName: string
  lastLoginAt: string | null
  scopeRules: ScopeRuleDto[]
}

export interface ChangeRoleDto {
  role: SystemRole
  reason?: string
}

export interface ChangeStatusDto {
  isActive: boolean
  reason?: string
}

export interface ChangeManagerDto {
  /** null — подчинённость снимается. */
  managerId: string | null
}

export interface SetScopeRuleDto {
  allowedIds: string[]
}

// --- Персональные данные (152-ФЗ) ---
export type LawfulBasis =
  | "CONTRACT"
  | "CONSENT"
  | "LEGAL_OBLIGATION"
  | "UNDEFINED"

export interface PersonDto {
  id: string
  fullName: string
  email: string | null
  phone: string | null
  position: string | null
  lawfulBasis: LawfulBasis
  retentionUntil: string | null
  erasedAt: string | null
  universities: string[]
}

export interface UpdatePersonDto {
  fullName?: string
  email?: string
  phone?: string
  position?: string
  lawfulBasis?: LawfulBasis
  retentionUntil?: string
  reason?: string
}

export interface ErasePersonDto {
  reason: string
}

// --- Аудит ---
export interface AuditLogItemDto {
  id: string
  occurredAt: string
  actorEmail: string | null
  action: string
  entityType: string | null
  entityId: string | null
  ipAddress: string | null
  userAgent: string | null
  traceId: string | null
  beforeState: object | null
  afterState: object | null
}

export interface ChainVerificationDto {
  checked: number
  intact: boolean
  brokenAtId: string | null
  message: string
}

// --- Каталог: вузы ---
export interface UniversityDto {
  id: string
  name: string
  shortName: string | null
  inn: string | null
  region: string | null
  city: string | null
  website: string | null
  isActive: boolean
  engagementCount: number
  createdAt: string
}

export interface SimilarUniversityDto {
  id: string
  name: string
  similarity: number
}

export interface CreateUniversityDto {
  name: string
  shortName?: string
  inn?: string
  region?: string
  city?: string
  website?: string
}

export interface UpdateUniversityDto {
  name: string
  shortName?: string
  inn?: string
  region?: string
  city?: string
  website?: string
  isActive?: boolean
}

// --- Каталог: вендоры и продукты ---
export interface VendorDto {
  id: string
  name: string
  isActive: boolean
  productCount: number
  contactCount?: number
}

export interface CreateVendorDto {
  name: string
}

export interface UpdateVendorDto {
  name: string
  isActive?: boolean
}

export interface SoftwareProductDto {
  id: string
  name: string
  vendorId: string
  vendorName: string
  description: string | null
  isActive: boolean
}

export interface CreateSoftwareProductDto {
  name: string
  vendorId: string
  description?: string
}

export interface UpdateSoftwareProductDto {
  name: string
  vendorId: string
  description?: string
  isActive?: boolean
}

// --- Каталог: направления и программы ---
export interface ItDirectionDto {
  id: string
  name: string
  code: string
  isActive: boolean
  programCount: number
}

export interface CreateItDirectionDto {
  name: string
  code?: string
}

export interface UpdateItDirectionDto {
  name: string
  code?: string
  isActive?: boolean
}

/** Источник программы — образовательный проект-сайт кейсодержателя. */
export type ProgramSource = "rtk-school" | "edu-rt" | "sz-rt" | "edupro"

/** Аудитория программы (для фильтра каталога). */
export type ProgramAudience = "individuals" | "specialists" | "state-project"

export interface ItProgramDto {
  id: string
  name: string
  directionId: string
  directionName: string
  productId: string | null
  productName: string | null
  hoursTotal: number | null
  isActive: boolean
  // Карточка каталога курсов.
  source: ProgramSource
  description: string | null
  /** Свободный текст «для кого». */
  audience: string | null
  audienceCategory: ProgramAudience
  /** «Что необходимо» — требования к слушателю. */
  requirements: string | null
  /** Потоков идёт сейчас (бэкенд; в демо-режиме считается по потокам). */
  activeStreamCount?: number
  /** Обучается сейчас — сумма по идущим потокам. */
  studentsCount?: number
}

export interface CreateItProgramDto {
  name: string
  directionId: string
  productId?: string
  hoursTotal?: number
  source?: ProgramSource
  description?: string
  audience?: string
  audienceCategory?: ProgramAudience
  requirements?: string
}

export interface UpdateItProgramDto {
  name: string
  directionId: string
  productId?: string
  hoursTotal?: number
  isActive?: boolean
  source?: ProgramSource
  description?: string
  audience?: string
  audienceCategory?: ProgramAudience
  requirements?: string
}

// --- Workflow ---
export type Segment = "B2B" | "B2C"

export interface WorkflowTemplateSummaryDto {
  id: string
  key: string
  version: number
  name: string
  description: string | null
  segment: Segment
  /** Сайт-источник процесса (sz-rt, edu-rt…); null — процесс общий. */
  siteSource?: ProgramSource | null
  isActive: boolean
  isDefault: boolean
  publishedAt: string | null
  stateCount: number
  engagementCount: number
}

export interface WorkflowTemplateDetailDto extends WorkflowTemplateSummaryDto {
  definition: object
}

export interface CreateWorkflowTemplateDto {
  key?: string
  name: string
  description?: string
  segment?: Segment
  siteSource?: ProgramSource | null
  definition: object
}

export interface UpdateWorkflowTemplateDto {
  name?: string
  description?: string
  definition?: object
}

export interface AddedStateDto {
  key: string
  label: string
}

export interface RemovedStateDto {
  key: string
  label: string
  engagementCount: number
  suggestedTarget: string
  noteCount?: number
  attachmentCount?: number
}

export interface RenamedStateDto {
  key: string
  fromLabel: string
  toLabel: string
}

export interface WorkflowPublishPreviewDto {
  currentTemplateId: string
  nextTemplateId: string
  addedStates: AddedStateDto[]
  removedStates: RemovedStateDto[]
  renamedStates: RenamedStateDto[]
  transitionsChanged: boolean
  affectedEngagements: number
  relocatedEngagements: number
  suggestedMapping: Record<string, string>
  blockingIssues: string[]
}

export interface PublishWorkflowTemplateDto {
  confirm: boolean
  stateMapping?: Record<string, string>
}

export interface WorkflowPublishResultDto {
  templateId: string
  version: number
  movedEngagements: number
  relocatedEngagements: number
}

// --- Взаимодействия (Engagements) ---
export type CounterpartyType = "UNIVERSITY" | "PERSON" | "COMPANY"

export interface EngagementListItemDto {
  id: string
  segment: Segment
  counterpartyType: CounterpartyType
  counterpartyName: string
  universityName: string | null
  universityShortName: string | null
  universityId: string | null
  directionName: string
  directionId: string
  productId?: string | null
  productName: string | null
  programId?: string | null
  programName?: string | null
  /** Внешняя система, из которой пришла заявка; null — заведена в CRM. */
  externalSource?: string | null
  ownerName: string
  ownerId: string
  currentStateKey: string
  currentStateLabel: string
  slaDueAt: string | null
  isOverdue: boolean
  interestLevel?: "LOW" | "MEDIUM" | "HIGH" | null
  /** Признак архива в строке списка; прежний бэкенд его не отдавал. */
  isArchived?: boolean
  createdAt: string
  updatedAt: string
}

export interface AvailableTransitionDto {
  toStateKey: string
  toStateLabel: string
  label: string
  requiresComment: boolean
  requiresAttachment: boolean
  allowed: boolean
  blockedReason: string | null
}

export interface TransitionHistoryItemDto {
  id: string
  fromStateLabel: string | null
  toStateLabel: string
  actorName: string
  comment: string | null
  createdAt: string
}

export interface EngagementDetailDto extends EngagementListItemDto {
  programName: string | null
  title: string | null
  version: number
  isArchived: boolean
  availableTransitions: AvailableTransitionDto[]
  history: TransitionHistoryItemDto[]
  attachmentCount: number
  noteCount?: number
  stages?: StageSummaryDto[]
  interestComment?: string | null
  interestUpdatedAt?: string | null
  interestUpdatedByName?: string | null
  paymentConfirmedAt?: string | null
  paymentReference?: string | null
  studyStream?: string | null
  lmsExportedAt?: string | null
  archivedAt?: string | null
  archivedByName?: string | null
  archiveReason?: string | null
}

export interface CreateEngagementDto {
  directionId: string
  segment?: Segment
  universityId?: string
  counterpartyType?: CounterpartyType
  counterpartyName?: string
  counterpartyContactId?: string
  productId?: string
  programId?: string
  ownerId?: string
  title?: string
}

export interface PerformTransitionDto {
  toStateKey: string
  comment?: string
}

export interface ReassignEngagementDto {
  ownerId: string
  reason?: string
}

export type ScanStatus = "PENDING" | "CLEAN" | "INFECTED" | "SKIPPED" | "ERROR"

export interface AttachmentDto {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  sha256: string
  scanStatus: ScanStatus
  uploadedByName: string
  createdAt: string
  stateKey?: string | null
  stateLabel?: string | null
}

// --- Импорт ---
export interface ImportFieldDto {
  key: string
  label: string
  required: boolean
  synonyms: string[]
}

export interface ImportJobCreatedDto {
  jobId: string
  status: string
  message: string
}

export interface UpdateMappingDto {
  mapping?: Record<string, string>
}

export interface SetResolutionsDto {
  resolutions: Record<string, string>
}

// --- Отчёты ---
export type ReportColumnType = "text" | "date" | "datetime" | "number" | "boolean"

export interface ReportColumnDto {
  key: string
  label: string
  type: ReportColumnType
  description: string | null
  isDefault: boolean
}

export interface ReportFiltersDto {
  periodFrom?: string
  periodTo?: string
  segments?: string[]
  universityIds?: string[]
  directionIds?: string[]
  productIds?: string[]
  programIds?: string[]
  ownerIds?: string[]
  stateKeys?: string[]
  regions?: string[]
  onlyOverdue?: boolean
  includeArchived?: boolean
  interestLevels?: string[]
}

export type ReportFormat = "XLSX" | "XLS" | "PDF" | "CSV" | "JSON"

export interface CreateReportDto {
  title?: string
  columns: string[]
  format: ReportFormat
  filters?: ReportFiltersDto
}

export type ReportJobStatus =
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"

export interface ReportJobDto {
  id: string
  status: ReportJobStatus
  progress: number
  rowCount: number | null
  sizeBytes: number | null
  errorCode: string | null
}

// --- Рабочий контекст (activity) ---
export interface WorkspaceStateDto {
  scopeKey: string
  state: object
  updatedAt: string | null
}

export interface SaveStateDto {
  state: object
}

export interface SaveDraftDto {
  payload: object
}

export interface DraftDto {
  entityType: string
  entityId: string | null
  payload: Record<string, unknown>
  updatedAt: string
}

export interface RecentItemDto {
  entityType: string
  entityId: string
  title: string
  visitedAt: string
}

export interface TrackVisitDto {
  title: string
}

// --- Интеграции ---
export type IntegrationType = "LMS" | "WEBSITE"

export interface IntegrationSourceDto {
  id: string
  type: IntegrationType
  name: string
  baseUrl: string
  isEnabled: boolean
  syncCursor: string | null
  cronSchedule: string | null
  mode: "stub" | "live"
}

export type IntegrationRunStatus = "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED"

export interface IntegrationSyncRunDto {
  id: string
  sourceId: string
  status: IntegrationRunStatus
  fetched: number
  created: number
  updated: number
  skipped: number
  failed: number
  errorDetail: string | null
  startedAt: string
  finishedAt: string | null
}

export interface InboundEventResultDto {
  accepted: boolean
  outcome: "created" | "updated" | "skipped" | "failed"
}

export interface ContractDescriptionDto {
  contract: string
  description: string
  schema: object
  example: object
}

// --- Уведомления ---
export type NotificationChannel = "IN_APP" | "EMAIL" | "TELEGRAM" | "MAX"

export interface NotificationDto {
  id: string
  channel: NotificationChannel
  subject: string
  body: string
  entityType: string | null
  entityId: string | null
  readAt: string | null
  sentAt: string | null
  deliveryError: string | null
  createdAt: string
}

export interface UnreadCountDto {
  unread: number
}

export interface ChannelSettingsDto {
  channel: NotificationChannel
  isEnabled: boolean
  ready: boolean
  readinessDetail: string | null
  settings: object
  lastTestDelivered: boolean
  lastTestDetail: string | null
}

export interface NotificationSettingsDto {
  escalationDays: number
  notifyOwnerOnTransition: boolean
  notifyManagerOnEscalation: boolean
  channels: ChannelSettingsDto[]
}

export interface UpdatePolicyDto {
  escalationDays?: number
  notifyOwnerOnTransition?: boolean
  notifyManagerOnEscalation?: boolean
}

export interface UpdateChannelDto {
  isEnabled?: boolean
  settings?: object
}

// --- Справочники / guides ---
export interface GuideSummaryDto {
  slug: string
  title: string
  description: string
  order: number
  updatedAt: string
}

export interface GuideDto extends GuideSummaryDto {
  content: string
}

// ========================================
// Новые схемы openapi (контракт 122 операции)
// ========================================

/** Этап в предпросмотре публикации workflow. */
export interface StageSummaryDto {
  key: string
  label: string
  isCurrent: boolean
  isInitial: boolean
  isFinal: boolean
  isRemoved: boolean
  requiresAttachment: boolean
  slaDays: number
  noteCount: number
  attachmentCount: number
}

// --- Задачи календаря (calendar/tasks) ---
export interface PlannerPersonDto {
  id: string
  displayName?: string
  email?: string
}

export interface PlannerEngagementDto {
  id: string
  counterpartyName?: string
  universityName?: string | null
}

export interface TaskDto {
  id: string
  title: string
  description: string
  dueDate: string
  dueTime: string
  dueAt: string
  remindAt: string | null
  isReminderSent: boolean
  isCompleted: boolean
  completedAt: string | null
  isOverdue: boolean
  owner: PlannerPersonDto | null
  createdBy?: PlannerPersonDto | null
  engagement: PlannerEngagementDto | null
  canEdit: boolean
  isAssigned: boolean
  createdAt: string
  updatedAt: string
}

export interface UpdateEngagementDto {
  title?: string | null
  programId?: string | null
  interestLevel?: "LOW" | "MEDIUM" | "HIGH"
  interestComment?: string | null
}

export interface CreateTaskDto {
  title: string
  description?: string
  dueDate?: string
  dueTime?: string
  remindAt?: string
  engagementId?: string
  ownerId?: string
}

export interface CalendarItemDto {
  kind: "TASK" | "STAGE_DEADLINE" | "MEETING"
  id: string
  date: string
  time?: string | null
  at?: string | null
  title: string
  isDone: boolean
  isOverdue: boolean
  engagement?: PlannerEngagementDto | null
  task?: TaskDto | null
  deadline?: { stateKey: string; stateLabel: string } | null
  meeting?: MeetingDto | null
}

// --- Заметки (engagements/notes) ---
export interface NoteAuthorDto {
  id: string
  name: string
}

export interface NoteDto {
  id: string
  engagementId: string
  body: string
  stateKey: string
  stateLabel: string
  isPinned: boolean
  author: NoteAuthorDto
  createdAt: string
  editedAt: string | null
  canEdit: boolean
  canDelete: boolean
}

export interface CreateNoteDto {
  body: string
  stateKey?: string | null
  isPinned?: boolean
}

// --- Activity feed / timeline (activity/feed, engagements/timeline) ---
export interface ActivityItemDto {
  id: string
  occurredAt: string
  type: string
  source?: string
  title: string
  summary: string
  comment?: string | null
  actor?: Record<string, unknown> | null
  engagement?: Record<string, unknown> | null
  stage?: Record<string, unknown> | null
  note?: Record<string, unknown> | null
  attachment?: Record<string, unknown> | null
  task?: Record<string, unknown> | null
  details?: Record<string, unknown> | null
}

// --- Архивирование взаимодействия ---
export interface ArchiveEngagementDto {
  reason?: string
}

// --- Контакты и контракты вуза (catalog/universities/...) ---
export interface UniversityContactDto {
  id: string
  personId: string
  fullName: string
  phone: string | null
  email: string | null
  position: string | null
  role: string | null
  isPrimary: boolean
  createdAt: string
}

export interface UniversityLicenseDto {
  id: string
  productId: string
  productName: string
  vendorName: string
  signedAt: string
  validYears: number
  validUntil: string
  validity: "ACTIVE" | "EXPIRED" | "UNKNOWN"
  transferStatus: "NOT_STARTED" | "IN_PROGRESS" | "TRANSFERRED" | "REJECTED"
  comment: string | null
}

export interface UniversityContractDto {
  id: string
  number: string
  signedAt: string | null
  comment: string | null
  licenses: UniversityLicenseDto[]
}

export interface EngagementContactDto {
  personId: string
  fullName: string
  email: string
  phone: string
}

export interface CalendarDto {
  from: string
  to: string
  timezone: string
  items: CalendarItemDto[]
}

// --- Учебные потоки (catalog/streams) ---
export type StreamStatusDto = "PLANNED" | "ACTIVE" | "COMPLETED" | "PAUSED"

export interface LearningStreamDto {
  id: string
  programId: string
  programName: string
  /** null — набор прямых продаж с сайта, без вуза. */
  universityId: string | null
  universityName: string | null
  name: string | null
  startDate: string
  endDate: string | null
  studentsCount: number
  status: StreamStatusDto
  externalSource: string | null
}

export interface CreateLearningStreamDto {
  programId: string
  universityId?: string | null
  name?: string | null
  startDate: string
  endDate?: string | null
  studentsCount: number
  status?: StreamStatusDto
}

// --- Заметки по вузу (catalog/universities/{id}/notes) ---
export interface UniversityNoteDto {
  id: string
  universityId: string
  body: string
  isPinned: boolean
  author: NoteAuthorDto
  createdAt: string
  editedAt: string | null
  canEdit: boolean
  canDelete: boolean
}

export interface CreateUniversityNoteDto {
  body: string
  isPinned?: boolean
}

// --- Встречи (engagements/{id}/meetings) ---
export type MeetingStatusDto = "SCHEDULED" | "COMPLETED" | "CANCELLED"

export interface MeetingParticipantDto {
  kind: "EMPLOYEE" | "CONTACT"
  id: string
  name: string
  position: string | null
}

export interface MeetingDto {
  id: string
  engagementId: string
  scheduledAt: string
  /** День и время по часовому поясу организации. */
  date: string
  time: string
  durationMinutes: number | null
  location: string | null
  agenda: string | null
  protocol: string | null
  status: MeetingStatusDto
  participants: MeetingParticipantDto[]
  createdBy: NoteAuthorDto
  createdAt: string
  canEdit: boolean
}

export interface CreateMeetingDto {
  scheduledAt: string
  durationMinutes?: number
  location?: string
  agenda?: string
  attendeeIds?: string[]
  contactIds?: string[]
}

export interface UpdateMeetingDto {
  scheduledAt?: string
  durationMinutes?: number | null
  location?: string | null
  agenda?: string | null
  protocol?: string | null
  status?: MeetingStatusDto
  attendeeIds?: string[]
  contactIds?: string[]
}
