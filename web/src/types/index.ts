// ========================================
// Доменные типы CRM ИТ-Школы РТК
// Выровнены с openapi.json (бекенд-спецификация).
// Типы, для которых есть API-эндпоинт, — это DTO из @/shared/api.
// Типы без эндпоинта (чат, календарь и т.п.) — локальные UI-модели.
// ========================================
import type {
  AdminUserDto,
  AuditLogItemDto,
  AttachmentDto,
  AvailableTransitionDto,
  CurrentUserDto,
  EngagementDetailDto,
  EngagementListItemDto,
  ItDirectionDto,
  ItProgramDto,
  NotificationDto,
  NotificationSettingsDto,
  PersonDto,
  SoftwareProductDto,
  TransitionHistoryItemDto,
  UniversityDto,
  WorkflowTemplateDetailDto,
  WorkflowTemplateSummaryDto,
} from "@/shared/api"

export type {
  AdminUserDto,
  AttachmentDto,
  AvailableTransitionDto,
  CurrentUserDto,
  ItDirectionDto,
  PersonDto,
  TransitionHistoryItemDto,
  WorkflowTemplateDetailDto,
  WorkflowTemplateSummaryDto,
}

// --- Вуз (GET/POST/PUT /api/v1/catalog/universities) ---
export type University = UniversityDto
export type Contact = PersonDto

// --- IT-программа (GET /api/v1/catalog/programs) ---
export type Program = ItProgramDto

// --- IT-продукт (GET /api/v1/catalog/products) ---
export type ITProduct = SoftwareProductDto

// --- Взаимодействие / Engagement (GET /api/v1/engagements) ---
export type Interaction = EngagementListItemDto
export type InteractionDetail = EngagementDetailDto

// --- Сотрудник ---
// В API роли: USER | MANAGER | ADMIN (CurrentUserDto.role)
export type Employee = CurrentUserDto

// --- Уведомление (GET /api/v1/notifications) ---
export type Notification = NotificationDto
export type NotificationPreferences = NotificationSettingsDto

// --- Аудит-лог (GET /api/v1/audit) ---
export type AuditLogEntry = AuditLogItemDto

// --- Профиль пользователя (GET /api/v1/auth/me) ---
export type UserProfile = CurrentUserDto

// ========================================
// Workflow: состояния engagement'а
// Ключи и подписи соответствуют.currentStateKey / currentStateLabel
// бекенда (пример: SIGNING → «Подписание документов»).
// ========================================
export type WorkflowStage =
  | "SEARCH_CONTACTS"
  | "COMMUNICATION"
  | "MEETING"
  | "DOCUMENT_EXCHANGE"
  | "DOCUMENT_REVISION"
  | "SIGNING"
  | "MATERIALS_TRANSFER"
  | "IMPLEMENTATION_SUPPORT"
  | "TEACHER_TRAINING"
  | "PROGRAM_UPDATE"
  | "CLASSES_RUNNING"
  | "DOCUMENTATION_UPDATE"
  | "TEACHER_ADVANCED_TRAINING"
  | "STAGE_CONTROL"

export const WORKFLOW_STAGES: { key: WorkflowStage; label: string; step: number }[] = [
  { key: "SEARCH_CONTACTS", label: "Поиск контактов", step: 1 },
  { key: "COMMUNICATION", label: "Коммуникация", step: 2 },
  { key: "MEETING", label: "Организация встречи", step: 3 },
  { key: "DOCUMENT_EXCHANGE", label: "Обмен документами", step: 4 },
  { key: "DOCUMENT_REVISION", label: "Корректировка документов", step: 5 },
  { key: "SIGNING", label: "Подписание документов", step: 6 },
  { key: "MATERIALS_TRANSFER", label: "Передача материалов", step: 7 },
  { key: "IMPLEMENTATION_SUPPORT", label: "Внедрение IT-продукта", step: 8 },
  { key: "TEACHER_TRAINING", label: "Обучение преподавателей", step: 9 },
  { key: "PROGRAM_UPDATE", label: "Актуализация программы", step: 10 },
  { key: "CLASSES_RUNNING", label: "Ведение занятий", step: 11 },
  { key: "DOCUMENTATION_UPDATE", label: "Актуализация документации", step: 12 },
  { key: "TEACHER_ADVANCED_TRAINING", label: "Повышение квалификации", step: 13 },
  { key: "STAGE_CONTROL", label: "Контроль этапов", step: 14 },
]

/** Подпись состояния по его ключу (для отображения в UI). */
export function workflowLabel(key: string): string {
  return WORKFLOW_STAGES.find((s) => s.key === key)?.label ?? key
}

// ========================================
// Локальные UI-типы (эндпоинтов в спецификации нет)
// ========================================
export interface StageProgress {
  stage: WorkflowStage
  status: "not_started" | "in_progress" | "completed" | "blocked"
  startedAt?: string
  completedAt?: string
  assigneeId?: string
  notes?: string
}

export interface ProgramMetrics {
  applications: number
  students: number
  parallelStreams: number
  conversionRate?: number
  avgCompletionDays?: number
}

/** Встреча с представителями вуза (режим API — GET /engagements/{id}/meetings). */
export interface Meeting {
  id: string
  interactionId: string
  date: string
  participants: string[]
  agenda?: string
  protocol?: string
  status: "scheduled" | "completed" | "cancelled"
  location?: string | null
  durationMinutes?: number | null
  /** Режим API: текущий пользователь может изменить встречу. */
  canEdit?: boolean
}

export interface Document {
  id: string
  interactionId: string
  type: "contract" | "appendix" | "act" | "license_agreement" | "other"
  name: string
  status: "draft" | "review" | "signed" | "rejected"
  version: number
  fileUrl?: string
  createdAt: string
  updatedAt: string
  /** Режим API: документ — вложение взаимодействия (реальных статусов согласования у бэкенда нет). */
  attachment?: {
    mimeType: string
    sizeBytes: number
    scanStatus: "PENDING" | "CLEAN" | "INFECTED" | "SKIPPED" | "ERROR"
    stateLabel: string | null
    uploadedByName: string
  }
}

/** Учебный поток (режим API — GET /catalog/streams). */
export interface Stream {
  id: string
  programId: string
  /** null — набор прямых продаж с сайта, без вуза. */
  universityId: string | null
  name?: string | null
  programName?: string
  universityName?: string | null
  startDate: string
  endDate?: string | null
  studentsCount: number
  status: "planned" | "active" | "completed" | "paused"
}

export interface Application {
  id: string
  /** crm — заведена в системе вручную (режим API). */
  source: "website" | "university" | "lms" | "crm"
  programId: string
  programName?: string
  universityId?: string
  applicantName: string
  applicantEmail: string
  status: "new" | "processing" | "enrolled" | "rejected"
  createdAt: string
  /** Режим API: заявка — B2C-взаимодействие маршрута прямых продаж. */
  engagementId?: string
  stateLabel?: string
  directionName?: string
}

export interface ActivityEvent {
  id: string
  type:
    | "stage_change"
    | "document"
    | "meeting"
    | "note"
    | "email"
    | "call"
    | "ENGAGEMENT_CREATED"
    | "ENGAGEMENT_UPDATED"
    | "STATE_CHANGED"
    | "INTEREST_CHANGED"
    | "OWNER_CHANGED"
    | "NOTE_ADDED"
    | "NOTE_UPDATED"
    | "NOTE_DELETED"
    | "ATTACHMENT_ADDED"
    | "ATTACHMENT_DELETED"
    | "TASK_CREATED"
    | "TASK_UPDATED"
    | "TASK_COMPLETED"
    | "TASK_REOPENED"
    | "TASK_DELETED"
    | "PAYMENT_CONFIRMED"
    | "LMS_EXPORTED"
    | "ENGAGEMENT_ARCHIVED"
    | "ENGAGEMENT_RESTORED"
  description: string
  entityId: string
  entityType: "engagement" | "university" | "document"
  userId: string
  createdAt: string
  /** Режим API: имя автора из ленты (справочник сотрудников доступен не всем ролям). */
  actorName?: string
  /** Режим API: контрагент взаимодействия, к которому относится событие. */
  entityName?: string
}

export interface ChatDialog {
  id: string
  title: string
  participantName: string
  participantRole: string
  lastMessage: string
  lastMessageAt: string
  unreadCount: number
  avatarInitials: string
}

export interface ChatMessage {
  id: string
  dialogId: string
  senderId: string
  senderName: string
  text: string
  createdAt: string
  isOwn: boolean
}

export interface CalendarEvent {
  id: string
  title: string
  description?: string
  start: string
  end: string
  color: CalendarEventColor
  labels: string[]
  type: "meeting" | "note" | "reminder"
  relatedEntityId?: string
  relatedEntityType?: "engagement" | "university" | "document"
}

export type CalendarEventColor = "purple" | "orange" | "green" | "blue" | "red" | "gray"
