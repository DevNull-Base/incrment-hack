import { Calendar, CheckCircle, FileText, Square } from "lucide-react"
import type { LucideIcon } from "lucide-react"

/** Иконки tool-blocks палитры: общий маппинг для палитры и узла этапа. */
export const TOOL_ICONS: Record<string, LucideIcon> = {
  "tool-state": Square,
  "tool-meeting": Calendar,
  "tool-docs": FileText,
  "tool-final": CheckCircle,
}
