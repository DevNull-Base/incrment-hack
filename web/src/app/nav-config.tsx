import * as React from "react"
import type { SystemRole } from "@/shared/api"
import {
  Home,
  Building,
  ChartBar,
  Inbox,
  ShieldCheck,
} from "lucide-react"

// ========================================
// Единый конфиг навигации с фильтром по ролям
// Используется: SidebarV2, SplitToggle
// ========================================
export interface NavItem {
  to: string
  label: string
  end?: boolean
  /** Если задано — пункт виден только перечисленным ролям. */
  roles?: SystemRole[]
}

export interface NavSectionDef {
  id: "desk" | "ops" | "reports" | "data" | "other" | "admin"
  title: string
  color: "primary" | "info" | "accent" | "success" | "danger"
  icon: React.ComponentType<{ className?: string; strokeWidth?: number | string }>
  items: NavItem[]
  /** Если задано — секция видна только перечисленным ролям. */
  roles?: SystemRole[]
}

const sections: NavSectionDef[] = [
  {
    id: "desk",
    title: "Рабочий стол",
    color: "primary",
    icon: Home,
    items: [
      { to: "/", label: "Дашборд", end: true },
      { to: "/calendar", label: "Календарь" },
      { to: "/interactions", label: "Взаимодействия" },
    ],
  },
  {
    id: "ops",
    title: "Управление",
    color: "accent",
    icon: Inbox,
    items: [
      { to: "/applications", label: "Заявки" },
      { to: "/workflow", label: "Workflow" },
    ],
  },
  {
    id: "reports",
    title: "Отчёты",
    color: "success",
    icon: ChartBar,
    items: [
      { to: "/analytics", label: "Аналитика" },
    ],
  },
  {
    id: "data",
    title: "Данные",
    color: "info",
    icon: Building,
    items: [
      { to: "/universities", label: "Вузы" },
      { to: "/region-map", label: "Карта вузов" },
      { to: "/programs", label: "Программы" },
      { to: "/courses", label: "Каталог курсов" },
      { to: "/products", label: "IT-продукты" },
      { to: "/documents", label: "Документы" },
    ],
  },
  {
    id: "other",
    title: "Прочее",
    color: "primary",
    icon: HelpCircle,
    items: [
      { to: "/notifications", label: "Уведомления" },
      { to: "/chat", label: "Чат" },
      { to: "/help", label: "Справка" },
    ],
  },
  {
    id: "admin",
    title: "Администрирование",
    color: "danger",
    icon: ShieldCheck,
    roles: ["ADMIN"],
    items: [
      { to: "/admin/users", label: "Пользователи" },
      // Процесс правит только администратор: так решено на Q&A-сессии.
      { to: "/admin/flow-editor", label: "Редактор флоу" },
      { to: "/settings/audit", label: "Аудит-лог" },
      { to: "/admin/import", label: "Импорт данных" },
      { to: "/admin/integrations", label: "Интеграции" },
      { to: "/admin/persons", label: "Персоны (152-ФЗ)" },
      { to: "/settings", label: "Настройки системы", end: true },
    ],
  },
]

/** Секции меню, видимые роли. */
export function visibleSections(role: SystemRole | null | undefined): NavSectionDef[] {
  const visibleItems = (items: NavItem[]) =>
    items.filter((i) => !i.roles || (role != null && i.roles.includes(role)))

  const visible = sections
    .filter((s) => !role ? !s.roles : !s.roles || s.roles.includes(role))
    .map((s) => ({ ...s, items: visibleItems(s.items) }))

  if (role === "ADMIN") {
    const adminOrder: Array<NavSectionDef["id"]> = ["desk", "admin", "ops", "reports", "data", "other"]
    return [...visible].sort((a, b) => {
      const ai = adminOrder.indexOf(a.id)
      const bi = adminOrder.indexOf(b.id)
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
    })
  }

  const defaultOrder: Array<NavSectionDef["id"]> = ["desk", "ops", "reports", "data", "other"]
  return [...visible].sort((a, b) => {
    const ai = defaultOrder.indexOf(a.id)
    const bi = defaultOrder.indexOf(b.id)
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
  })
}

// ========================================
// Страницы для панели split-screen
// ========================================
import { GitBranch, BookOpen, FileText, Box, GitMerge, Calendar, HelpCircle, Library } from "lucide-react"
import { Chat } from "@mynaui/icons-react"

export interface SplitPageDef {
  path: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  color: string
}

const splitPages: (SplitPageDef & { roles?: SystemRole[] })[] = [
  { path: "/", icon: Home, label: "Дашборд", color: "text-primary" },
  { path: "/calendar", icon: Calendar, label: "Календарь", color: "text-primary" },
  { path: "/chat", icon: Chat, label: "Чат", color: "text-info" },
  { path: "/universities", icon: Building, label: "Вузы", color: "text-info" },
  { path: "/programs", icon: BookOpen, label: "Программы", color: "text-info" },
  { path: "/courses", icon: Library, label: "Каталог курсов", color: "text-info" },
  { path: "/documents", icon: FileText, label: "Документы", color: "text-info" },
  { path: "/analytics", icon: ChartBar, label: "Аналитика", color: "text-success" },
  { path: "/applications", icon: Inbox, label: "Заявки", color: "text-accent" },
  { path: "/workflow", icon: GitMerge, label: "Workflow", color: "text-accent" },
  { path: "/interactions", icon: GitBranch, label: "Взаимодействия", color: "text-primary" },
  { path: "/products", icon: Box, label: "IT-продукты", color: "text-info" },
  { path: "/help", icon: HelpCircle, label: "Справка", color: "text-primary" },
  { path: "/admin/users", icon: ShieldCheck, label: "Пользователи", color: "text-destructive", roles: ["ADMIN"] },
  { path: "/admin/flow-editor", icon: GitBranch, label: "Редактор флоу", color: "text-destructive", roles: ["ADMIN"] },
]

/** Страницы split-панели, доступные роли (Chat скрыт всегда). */
export function visiblePages(role: SystemRole | null | undefined): SplitPageDef[] {
  return splitPages.filter((p) => {
    if (!p.roles) return true
    if (p.roles.length === 0) return false // явно скрытые
    return role != null && p.roles.includes(role)
  })
}
