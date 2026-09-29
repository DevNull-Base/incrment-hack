// ========================================
// Подписи действий журнала аудита.
// Демо-моки пишут create/update/delete; бэкенд — коды вида
// WORKFLOW_TRANSITION (src/modules/audit). Неизвестный код не должен
// ронять страницу: подпись — сам код, оттенок — по смыслу окончания.
// ========================================

export type AuditVariant = "default" | "secondary" | "outline" | "destructive"

const LABELS: Record<string, { label: string; variant: AuditVariant }> = {
  create: { label: "Создание", variant: "default" },
  update: { label: "Изменение", variant: "outline" },
  delete: { label: "Удаление", variant: "destructive" },
  login: { label: "Вход", variant: "secondary" },
  export: { label: "Экспорт", variant: "secondary" },

  LOGIN: { label: "Вход", variant: "secondary" },
  LOGIN_DENIED: { label: "Отказ во входе", variant: "destructive" },
  VIEW_PERSONAL_DATA: { label: "Просмотр ПДн", variant: "secondary" },
  EXPORT_REPORT: { label: "Выгрузка отчёта", variant: "secondary" },
  DOWNLOAD_ATTACHMENT: { label: "Скачивание файла", variant: "secondary" },
  UPLOAD_ATTACHMENT: { label: "Загрузка файла", variant: "default" },
  DELETE_ATTACHMENT: { label: "Удаление файла", variant: "destructive" },
  ATTACHMENT_REJECTED: { label: "Файл отклонён", variant: "destructive" },
  WORKFLOW_TRANSITION: { label: "Смена этапа", variant: "outline" },
  WORKFLOW_TEMPLATE_CREATE: { label: "Черновик процесса", variant: "default" },
  WORKFLOW_TEMPLATE_UPDATE: { label: "Правка процесса", variant: "outline" },
  WORKFLOW_TEMPLATE_PUBLISH: { label: "Публикация процесса", variant: "default" },
  ENGAGEMENT_CREATE: { label: "Новое взаимодействие", variant: "default" },
  ENGAGEMENT_UPDATE: { label: "Правка взаимодействия", variant: "outline" },
  ENGAGEMENT_REASSIGN: { label: "Переназначение", variant: "outline" },
  CATALOG_CREATE: { label: "Запись каталога", variant: "default" },
  CATALOG_UPDATE: { label: "Правка каталога", variant: "outline" },
  CATALOG_DEACTIVATE: { label: "Отключение в каталоге", variant: "destructive" },
  IMPORT_APPLY: { label: "Импорт", variant: "default" },
  USER_ROLE_CHANGE: { label: "Смена роли", variant: "outline" },
  USER_STATUS_CHANGE: { label: "Смена статуса", variant: "outline" },
  USER_MANAGER_CHANGE: { label: "Смена руководителя", variant: "outline" },
  DATA_SCOPE_CHANGE: { label: "Область видимости", variant: "outline" },
  NOTIFICATION_SETTINGS_CHANGE: { label: "Настройки уведомлений", variant: "outline" },
  PERSONAL_DATA_RECTIFY: { label: "Уточнение ПДн", variant: "outline" },
  PERSONAL_DATA_ERASE: { label: "Обезличивание ПДн", variant: "destructive" },
  PERSONAL_DATA_RETENTION_SET: { label: "Срок хранения ПДн", variant: "outline" },
  RETENTION_PURGE: { label: "Очистка по сроку", variant: "destructive" },
}

export function auditAction(action: string): { label: string; variant: AuditVariant } {
  const known = LABELS[action]
  if (known) return known
  const variant: AuditVariant = /DELETE|ERASE|PURGE|REJECT|DENIED|ARCHIVE/.test(action)
    ? "destructive"
    : /CREATE|UPLOAD/.test(action)
      ? "default"
      : "outline"
  return { label: action, variant }
}

/** Сущности журнала — по-русски: бэкенд пишет имена моделей («Engagement»). */
const ENTITY_LABELS: Record<string, string> = {
  Engagement: "Взаимодействие",
  ENGAGEMENT: "Взаимодействие",
  AppUser: "Пользователь",
  Person: "Контакт",
  University: "Вуз",
  UniversityContact: "Контакт вуза",
  Vendor: "Вендор",
  VendorContact: "Контакт вендора",
  SoftwareProduct: "IT-продукт",
  ItProgram: "Программа",
  ItDirection: "Направление",
  LearningStream: "Поток",
  WorkflowTemplate: "Процесс",
  Attachment: "Файл",
  Report: "Отчёт",
  Payment: "Оплата",
  Task: "Задача",
  ImportJob: "Импорт",
  LmsExport: "Выгрузка в LMS",
  NotificationPolicy: "Правила уведомлений",
  NotificationChannelConfig: "Канал уведомлений",
  System: "Система",
}

export function auditEntity(entityType: string | null | undefined): string {
  if (!entityType) return "—"
  return ENTITY_LABELS[entityType] ?? entityType
}

/** Подписи полей из снимка изменения; прочие поля показываются как есть. */
const FIELD_LABELS: Record<string, string> = {
  fileName: "файл",
  sizeBytes: "размер, байт",
  scanStatus: "проверка",
  fullName: "ФИО",
  email: "почта",
  phone: "телефон",
  position: "должность",
  segment: "сегмент",
  role: "роль",
  reason: "причина",
  title: "название",
  name: "название",
  version: "версия",
  toStateLabel: "этап",
  rowCount: "строк",
  rows: "строк",
  recordCount: "записей",
  engagementCount: "взаимодействий",
  engagementsCreated: "создано взаимодействий",
  skipped: "пропущено",
  updated: "обновлено",
  lawfulBasis: "основание",
  retentionUntil: "хранить до",
  interestLevel: "заинтересованность",
  detail: "подробности",
  signature: "угроза",
  deduplicated: "уже был загружен",
}

/** Служебные поля: идентификаторы и вложенные структуры читателю журнала ничего не скажут. */
const HIDDEN_FIELD = /(^id$|Id$|Ids$|^tx$|^definition$|^stateMapping$|^meta$|^query$|^method$|Key$|^sha256$|^mimeType$)/

/**
 * Снимок изменения одной строкой: «файл: Акт.pdf · проверка: CLEAN»
 * вместо JSON. Полный снимок остаётся во всплывающей подсказке.
 */
export function auditDetails(afterState: Record<string, unknown> | null | undefined): string {
  if (!afterState) return "—"
  const parts: string[] = []
  for (const [key, value] of Object.entries(afterState)) {
    if (HIDDEN_FIELD.test(key) || value === null || value === undefined) continue
    let text: string
    if (typeof value === "boolean") text = value ? "да" : "нет"
    else if (typeof value === "number" || typeof value === "string") text = String(value)
    else if (Array.isArray(value)) text = `${value.length} шт.`
    else continue
    parts.push(`${FIELD_LABELS[key] ?? key}: ${text.length > 60 ? `${text.slice(0, 57)}…` : text}`)
  }
  const search = (afterState.query as Record<string, unknown> | null | undefined)?.search
  if (typeof search === "string" && search) parts.push(`поиск: «${search}»`)
  return parts.length ? parts.join(" · ") : "—"
}
