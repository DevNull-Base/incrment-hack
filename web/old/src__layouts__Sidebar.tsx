import { NavLink, useNavigate } from "react-router-dom"
import { cn } from "@/lib/utils"
import {
  Home,
  Building,
  GitBranch,
  BookOpen,
  FileText,
  ChartBar,
  Cog,
  Bell,
  Box,
  Inbox,
  Clock1,
  User,
  GitMerge,
  Calendar,
  Chat,
} from "@mynaui/icons-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"

const navSections = [
  {
    title: "Рабочий стол",
    items: [
      { to: "/", icon: Home, label: "Дашборд" },
      { to: "/interactions", icon: GitBranch, label: "Взаимодействия" },
      { to: "/calendar", icon: Calendar, label: "Календарь" },
      { to: "/chat", icon: Chat, label: "Чат" },
      { to: "/demo2", icon: ChartBar, label: "Demo 2" },
      { to: "/notifications", icon: Bell, label: "Уведомления" },
    ],
  },
  {
    title: "Данные",
    items: [
      { to: "/universities", icon: Building, label: "Вузы" },
      { to: "/programs", icon: BookOpen, label: "Программы" },
      { to: "/products", icon: Box, label: "IT-продукты" },
      { to: "/documents", icon: FileText, label: "Документы" },
    ],
  },
  {
    title: "Управление",
    items: [
      { to: "/applications", icon: Inbox, label: "Заявки" },
      { to: "/licenses", icon: Clock1, label: "Лицензии" },
      { to: "/workflow", icon: GitMerge, label: "Workflow" },
    ],
  },
  {
    title: "Отчёты",
    items: [
      { to: "/analytics", icon: ChartBar, label: "Аналитика" },
    ],
  },
]

export function Sidebar() {
  const navigate = useNavigate()
  const userRaw = localStorage.getItem("crm_user")
  const user = userRaw ? JSON.parse(userRaw) : null

  const handleLogout = () => {
    localStorage.removeItem("crm_user")
    navigate("/login")
  }

  return (
    <aside className="flex h-screen w-[250px] flex-col bg-card border-r border-border">
      {/* Logo */}
      <div className="flex h-[68px] items-center gap-3 px-5 border-b border-border">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-xs no-select">
          РТ
        </div>
        <div>
          <div className="text-sm font-semibold tracking-tight">ИТ-Школа РТК</div>
          <div className="text-[10px] text-muted-foreground font-medium">CRM · v0.2</div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-4 px-3 py-4 overflow-y-auto">
        {navSections.map((section, sIdx) => (
          <div key={section.title}>
            {sIdx > 0 && <div className="mx-3 mb-3 h-px bg-border" />}
            <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50">
              {section.title}
            </div>
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) =>
                    cn(
                      "group flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-150 no-select",
                      isActive
                        ? "bg-primary/10 text-primary dark:bg-primary/15 dark:text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <div className={cn(
                        "flex size-7 items-center justify-center rounded-md transition-all",
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground group-hover:bg-muted/80 group-hover:text-foreground"
                      )}>
                        <item.icon className="size-3.5" />
                      </div>
                      {item.label}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-border p-3 space-y-0.5">
        {user && (
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-muted/50 mb-2">
            <Avatar className="size-8">
              <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
                {user.name ? user.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2) : "??"}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium truncate">{user.name || user.email}</div>
              <div className="text-[10px] text-muted-foreground">{user.role}</div>
            </div>
          </div>
        )}
        <NavLink
          to="/profile"
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all no-select",
              isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )
          }
        >
          <User className="size-4" />
          Профиль
        </NavLink>
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all no-select",
              isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )
          }
        >
          <Cog className="size-4" />
          Настройки
        </NavLink>
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-all no-select"
        >
          Выйти
        </button>
      </div>
    </aside>
  )
}
