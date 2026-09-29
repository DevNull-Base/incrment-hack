import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Bell, Search, Sun, Moon } from "@mynaui/icons-react"
import { useTheme } from "@/hooks/useTheme"
import { useStore } from "@/app/store"
import { selectUnreadCount } from "@/app/store/selectors"
import { ROLE_LABELS } from "@/shared/lib/roles"
import { toast } from "@/shared/lib/toast-store"
import { SplitToggle } from "@/components/SplitToggle"
import { GlobalSearch } from "@/components/GlobalSearch"
import { notificationTarget } from "@/shared/lib/notifications"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { SidebarV2 } from "./SidebarV2"
import { Menu } from "lucide-react"

export function Header() {
  const navigate = useNavigate()
  const { theme, toggleTheme } = useTheme()
  const notifications = useStore((s) => s.notifications)
  const unreadCount = useStore(selectUnreadCount)
  const markNotificationRead = useStore((s) => s.markNotificationRead)
  const user = useStore((s) => s.user)
  const logout = useStore((s) => s.logout)
  // Узкий экран: поиск открывается панелью под шапкой.
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.key === "k" || event.key === "л") && (event.ctrlKey || event.metaKey) && window.innerWidth < 1280) {
        event.preventDefault()
        setSearchOpen(true)
      } else if (event.key === "Escape") {
        setSearchOpen(false)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    // z-30: выпадающий список поиска живёт внутри шапки и должен лежать поверх
    // страницы. Центрирование поля через transform создаёт свой контекст
    // наложения, и без z-index у шапки карточки и таблицы страницы (они идут
    // в разметке позже) рисовались поверх результатов поиска. Диалоги и меню
    // открываются в портале с z-50 и остаются выше шапки.
    <header className="relative z-30 flex h-[68px] items-center justify-between border-b border-border bg-card px-6">
      {/* Бренд */}
      <button
        onClick={() => navigate("/")}
        aria-label="На главную"
        className="group flex shrink-0 flex-col items-start gap-1 no-select"
      >
        <span className="text-lg font-semibold leading-none tracking-tight transition-opacity duration-300 group-hover:opacity-75">
          incrment<span className="text-primary">.</span>
        </span>
      </button>

      {/* Мобильная навигация */}
      <Sheet>
        <SheetTrigger
          aria-label="Открыть меню"
          className="rounded-xl p-2.5 text-muted-foreground transition-all duration-300 ease-[cubic-bezier(0.645,0.045,0.355,1)] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 lg:hidden"
        >
          <Menu className="size-5" />
        </SheetTrigger>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">Навигация</SheetTitle>
          <SidebarV2 />
        </SheetContent>
      </Sheet>

      {/* Поиск — строго по центру хедера; на узком экране — панелью под ним */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 hidden w-full max-w-96 -translate-x-1/2 -translate-y-1/2 px-4 xl:block">
        <div className="pointer-events-auto">
          <GlobalSearch />
        </div>
      </div>
      {searchOpen && (
        <div className="absolute left-0 right-0 top-full z-40 border-b bg-card p-3 shadow-sm xl:hidden">
          <GlobalSearch autoFocus onNavigate={() => setSearchOpen(false)} />
        </div>
      )}

      {/* Right side */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setSearchOpen((open) => !open)}
          aria-label="Поиск"
          aria-expanded={searchOpen}
          className="rounded-xl p-2.5 text-muted-foreground transition-all duration-300 ease-[cubic-bezier(0.645,0.045,0.355,1)] hover:bg-muted hover:text-foreground xl:hidden"
        >
          <Search className="size-4.5" />
        </button>
        <SplitToggle />
        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          aria-label={theme === "light" ? "Тёмная тема" : "Светлая тема"}
          className="rounded-xl p-2.5 text-muted-foreground transition-all duration-300 ease-[cubic-bezier(0.645,0.045,0.355,1)] hover:bg-muted hover:text-foreground"
          title={theme === "light" ? "Тёмная тема" : "Светлая тема"}
        >
          {theme === "light" ? <Moon className="size-4.5" /> : <Sun className="size-4.5" />}
        </button>

        {/* Notifications */}
        <DropdownMenu>
          <DropdownMenuTrigger aria-label="Уведомления" className="relative rounded-xl p-2.5 transition-all duration-300 ease-[cubic-bezier(0.645,0.045,0.355,1)] hover:bg-muted">
            <Bell className="size-4.5 text-muted-foreground" />
            {unreadCount > 0 && (
              <span className="absolute right-1.5 top-1.5 flex size-3.5 items-center justify-center rounded-full bg-rt-orange text-[8px] font-bold text-white">
                {unreadCount}
              </span>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80 rounded-xl shadow-lg">
            <div className="px-4 py-2.5 text-sm font-semibold border-b">Уведомления</div>
            <DropdownMenuSeparator />
            {notifications.slice(0, 5).map((n) => (
              <DropdownMenuItem
                key={n.id}
                className="flex flex-col items-start gap-1 py-2.5 px-4 cursor-pointer"
                onClick={() => {
                  markNotificationRead(n.id)
                  navigate(notificationTarget(n))
                }}
              >
                <span className="text-sm font-medium">{n.subject}</span>
                <span className="text-xs text-muted-foreground line-clamp-1">{n.body}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-center text-sm text-primary font-medium cursor-pointer py-2.5" onClick={() => navigate("/notifications")}>
              Все уведомления →
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Divider */}
        <div className="h-7 w-px bg-border/50 mx-1.5" />

        {/* User */}
        <DropdownMenu>
          <DropdownMenuTrigger aria-label="Меню пользователя" className="cursor-pointer flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 transition-all duration-300 ease-[cubic-bezier(0.645,0.045,0.355,1)] hover:bg-muted">
            <Avatar className="size-8">
              <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
                {user?.displayName ? user.displayName.split(" ").map((n: string) => n[0]).join("").slice(0, 2) : "??"}
              </AvatarFallback>
            </Avatar>
            <div className="text-left hidden md:block">
              <div className="text-sm font-medium leading-tight">{user?.displayName?.split(" ").slice(0, 2).join(" ") || "Пользователь"}</div>
              <div className="text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{user ? ROLE_LABELS[user.role] : ""}</div>
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 rounded-xl shadow-lg">
            <DropdownMenuItem onClick={() => navigate("/profile")} className="rounded-lg">Профиль</DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/settings")} className="rounded-lg">Настройки</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                logout()
                toast.success("Вы вышли из системы")
                navigate("/login")
              }}
              className="rounded-lg text-destructive"
            >
              Выйти
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
