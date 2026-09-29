import type { StoreState } from "./types"
import type { Employee } from "@/types"

/**
 * Кэш производного селектора по входу.
 * zustand сравнивает результат снапшота через Object.is: если селектор
 * возвращает новый массив/объект при каждом вызове, React уходит в
 * бесконечный ре-рендер ("getSnapshot should be cached") и падает.
 */
function cached<TInput, TResult>(
  pick: (s: StoreState) => TInput,
  derive: (input: TInput) => TResult,
) {
  let prevInput: TInput | undefined
  let prevResult: TResult | undefined
  return (s: StoreState): TResult => {
    const input = pick(s)
    if (input !== prevInput || prevResult === undefined) {
      prevInput = input
      prevResult = derive(input)
    }
    return prevResult as TResult
  }
}

// ========================================
// Общие чистые селекторы (мемо-дружелюбные: принимают state)
// ========================================
export const selectUnreadNotifications = cached(
  (s) => s.notifications,
  (notifications) => notifications.filter((n) => !n.readAt),
)

export const selectUnreadCount = (s: StoreState) =>
  s.notifications.reduce((count, n) => (n.readAt ? count : count + 1), 0)

export const selectReadNotifications = cached(
  (s) => s.notifications,
  (notifications) => notifications.filter((n) => n.readAt),
)

export const selectInteractions = (s: StoreState) => s.interactions

/**
 * Рабочие взаимодействия — без архивных. Стор держит архивные вместе
 * с рабочими (карточка из архива открывается по ссылке), но в метриках
 * и рабочих списках им не место.
 */
let workingSource: StoreState["interactions"] | undefined
let workingArchived: StoreState["archivedIds"] | undefined
let workingSnapshot: StoreState["interactions"] = []

export const selectWorkingInteractions = (s: StoreState) => {
  if (s.interactions === workingSource && s.archivedIds === workingArchived) return workingSnapshot
  workingSource = s.interactions
  workingArchived = s.archivedIds
  const archived = new Set(s.archivedIds)
  workingSnapshot = archived.size === 0 ? s.interactions : s.interactions.filter((i) => !archived.has(i.id))
  return workingSnapshot
}

/** Воронка: { STATE_KEY: count }. */
export const selectFunnel = cached(
  (s) => s.interactions,
  (interactions) =>
    interactions.reduce<Record<string, number>>((acc, i) => {
      acc[i.currentStateKey] = (acc[i.currentStateKey] ?? 0) + 1
      return acc
    }, {}),
)

/** Активные (не на финальном контроле). */
export const selectActiveInteractions = cached(
  (s) => s.interactions,
  (interactions) => interactions.filter((i) => i.currentStateKey !== "STAGE_CONTROL"),
)

export const selectOverdueInteractions = cached(
  (s) => s.interactions,
  (interactions) => interactions.filter((i) => i.isOverdue),
)

export const selectUniversities = (s: StoreState) => s.universities
export const selectPrograms = (s: StoreState) => s.programs
export const selectProducts = (s: StoreState) => s.products
export const selectDocuments = (s: StoreState) => s.documents
export const selectApplications = (s: StoreState) => s.applications
export const selectCalendarEvents = (s: StoreState) => s.calendarEvents
export const selectStreams = (s: StoreState) => s.streams
export const selectMeetings = (s: StoreState) => s.meetings
export const selectActivityEvents = (s: StoreState) => s.activityEvents
export const selectChatDialogs = (s: StoreState) => s.chatDialogs
export const selectChatMessages = (s: StoreState) => s.chatMessages

export const selectAdminUsers = (s: StoreState) => s.adminUsers
export const selectAuditLog = (s: StoreState) => s.auditLog
export const selectPersons = (s: StoreState) => s.persons

/** Совместимый вид сотрудников (Employee) поверх adminUsers. */
let employeesSource: StoreState["adminUsers"] | undefined
let employeesSnapshot: Employee[] = []

export const selectEmployees = (s: StoreState): Employee[] => {
  if (s.adminUsers === employeesSource) return employeesSnapshot

  employeesSource = s.adminUsers
  employeesSnapshot = s.adminUsers.map((u) => ({
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    managerId: u.managerId,
    dataScope: { restricted: false, ownerCount: null, universityCount: null },
  }))
  return employeesSnapshot
}
