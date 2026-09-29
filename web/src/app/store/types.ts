import type { DataSlice, SessionSlice } from "./index"
import type { NotificationSlice } from "./notificationSlice"
import type { EngagementSlice } from "./engagementSlice"
import type { CatalogSlice } from "./catalogSlice"
import type { WorkflowSlice } from "./workflowSlice"
import type { DocumentSlice } from "./documentSlice"
import type { ApplicationSlice } from "./applicationSlice"
import type { CalendarSlice } from "./calendarSlice"
import type { AdminSlice } from "./adminSlice"
import type { ChatSlice } from "./chatSlice"
import type { StreamSlice } from "./streamSlice"

/** Агрегат всех срезов — расширяется по мере подключения (этапы 3–6). */
export interface StoreState
  extends SessionSlice,
    DataSlice,
    NotificationSlice,
    EngagementSlice,
    CatalogSlice,
    WorkflowSlice,
    DocumentSlice,
    ApplicationSlice,
    CalendarSlice,
    AdminSlice,
    ChatSlice,
    StreamSlice {}
