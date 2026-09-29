import * as React from "react"
import { NavLink, useLocation, useNavigate } from "react-router-dom"
import { cn } from "cn"
import { visibleSections } from "@/app/nav-config"
import { useStore } from "@/app/store"

// ========================================
// Данные секций
// ========================================
interface NavSection {
  title: string
  color: "primary" | "info" | "accent" | "success" | "danger"
  icon: React.ComponentType<{ className?: string; strokeWidth?: number | string }>
  items: { to: string; label: string; end?: boolean }[]
}

// ========================================
// Цвета для вкладок
// ========================================
const TAB_COLORS: Record<NavSection["color"], {
  tabActive: string
  edge: string
  ring: string
  text: string
  textActive: string
  icon: string
  iconActive: string
}> = {
  primary: {
    tabActive: "bg-primary/10",
    edge: "bg-primary",
    ring: "ring-primary/20",
    text: "text-foreground/60",
    textActive: "text-primary",
    icon: "text-primary/50",
    iconActive: "text-primary",
  },
  info: {
    tabActive: "bg-info/10",
    edge: "bg-info",
    ring: "ring-info/20",
    text: "text-foreground/60",
    textActive: "text-info",
    icon: "text-info/50",
    iconActive: "text-info",
  },
  accent: {
    tabActive: "bg-accent/10",
    edge: "bg-accent",
    ring: "ring-accent/20",
    text: "text-foreground/60",
    textActive: "text-accent",
    icon: "text-accent/50",
    iconActive: "text-accent",
  },
  success: {
    tabActive: "bg-success/10",
    edge: "bg-success",
    ring: "ring-success/20",
    text: "text-foreground/60",
    textActive: "text-success",
    icon: "text-success/50",
    iconActive: "text-success",
  },
  danger: {
    tabActive: "bg-destructive/10",
    edge: "bg-destructive",
    ring: "ring-destructive/20",
    text: "text-foreground/60",
    textActive: "text-destructive",
    icon: "text-destructive/50",
    iconActive: "text-destructive",
  },
}

// ========================================
// NarrowFolderTab — узкая вкладка (split mode)
// ========================================
interface FolderTabProps {
  section: NavSection
  isActive: boolean
  isExpanded: boolean
  onToggle: (e: React.MouseEvent<HTMLButtonElement>) => void
}

function NarrowFolderTab({ section, isActive, isExpanded, onToggle }: FolderTabProps) {
  const colors = TAB_COLORS[section.color]
  const Icon = section.icon
  const active = isActive || isExpanded

  return (
    <button
      onClick={onToggle}
      aria-expanded={isExpanded}
      aria-label={section.title}
      className="group w-full rounded-r-xl outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      <div className={cn(
        "relative flex flex-col items-center justify-center w-full py-3 px-0.5 mr-1",
        "rounded-l-sm rounded-r-xl transition-all duration-150 ease-out",
        active
          ? [colors.tabActive, colors.ring, "ring-1 shadow-sm translate-x-[2px]"]
          : "hover:bg-muted/50 hover:translate-x-[1.5px] active:scale-[0.97]",
      )}>
        {/* Цветная полоска слева */}
        <div className={cn(
          "absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full transition-all duration-200 ease-out",
          colors.edge,
          active ? "opacity-100" : "opacity-25 group-hover:opacity-60",
        )} />

        {/* Иконка */}
        <div className={cn(
          "flex shrink-0 size-5 items-center justify-center rounded-lg transition-all duration-200 ease-out",
          active && "bg-card/70 shadow-xs",
          active ? colors.iconActive : colors.icon,
        )}>
          <Icon className="size-3.5 transition-transform duration-200 ease-out group-hover:scale-110" strokeWidth={active ? 2.2 : 1.8} />
        </div>

        {/* Вертикальный текст */}
        <div className={cn(
          "writing-vertical text-[10px] font-bold tracking-wider mt-1.5 transition-colors duration-200 leading-tight",
          active ? colors.textActive : colors.text,
          !active && "group-hover:text-foreground/90",
        )}>
          {section.title}
        </div>
      </div>
    </button>
  )
}

// ========================================
// DropdownPanel — выпадающее меню страниц
// ========================================
interface DropdownPanelProps {
  section: NavSection
  isOpen: boolean
  onClose: () => void
  side?: "left" | "right"
  onPageSelect?: (path: string) => void
  activePath?: string
}

function DropdownPanel({ section, isOpen, onClose, side, onPageSelect, activePath }: DropdownPanelProps) {
  const colors = TAB_COLORS[section.color]
  const panelRef = React.useRef<HTMLDivElement>(null)
  const location = useLocation()
  const navigate = useNavigate()
  const currentPath = activePath || location.pathname

  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (!panelRef.current) return
      // «Снаружи» = за пределами всей ячейки (вкладка + мостик + окно),
      // чтобы клик по самой категории панель не закрывал.
      const wrapper = panelRef.current.closest("[data-folder]")
      const insideWrapper = wrapper
        ? wrapper.contains(e.target as Node)
        : panelRef.current.contains(e.target as Node)
      if (!insideWrapper) {
        onClose()
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside)
      return () => document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [isOpen, onClose])

  const handleItemClick = (path: string) => {
    if (onPageSelect) {
      onPageSelect(path)
    } else {
      navigate(path)
    }
    onClose()
  }

  return (
    <div
      ref={panelRef}
      aria-hidden={!isOpen}
      data-open={isOpen ? "true" : "false"}
      className={cn(
        "group absolute left-full top-0 ml-2 z-[100] origin-left overflow-hidden",
        "w-56 rounded-r-xl border border-border/60 bg-card shadow-xl shadow-black/10",
        isOpen
          ? "visible opacity-100 translate-x-0 scale-100 transition-[opacity,transform,visibility] duration-75 ease-out"
          : "invisible pointer-events-none opacity-0 -translate-x-1 scale-95 transition-[opacity_700ms_ease-in-out,transform_700ms_linear,visibility_700ms]",
      )}
    >
      <div className={cn(
        "flex items-center gap-2.5 px-3.5 py-2.5 border-b border-border/40",
        "transition-opacity duration-150 group-data-[open=true]:duration-0 group-data-[open=false]:opacity-0",
        colors.tabActive,
      )}>
        <div className={cn("w-1 h-4 rounded-full transition-all duration-200", colors.edge)} />
        <span className="text-xs font-semibold tracking-tight text-foreground/80">
          {section.title}
        </span>
        {side && (
          <span className="ml-auto text-[9px] text-muted-foreground/50 font-medium bg-muted/50 px-1.5 py-0.5 rounded-md">
            {side === "left" ? "левая" : "правая"}
          </span>
        )}
      </div>

      <div className="p-1.5 transition-opacity duration-150 group-data-[open=true]:duration-0 group-data-[open=false]:opacity-0">
        {section.items.map((item) => {
          const isActivePage = isNavItemActive(currentPath, item.to, item.end)
          return (
            <button
              key={item.to}
              onClick={() => handleItemClick(item.to)}
              className={cn(
                "group flex items-center gap-2.5 w-full rounded-lg px-3 py-2 text-[15px] font-medium text-left",
                "transition-all duration-150 ease-out",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                isActivePage
                  ? [colors.tabActive, colors.ring, colors.textActive, "font-semibold ring-1 shadow-xs"]
                  : "text-foreground/60 hover:bg-muted/60 hover:text-foreground hover:translate-x-0.5",
              )}
            >
              <div className={cn(
                "w-1 h-1 rounded-full shrink-0 transition-all duration-200 ease-out",
                isActivePage
                  ? [colors.edge, "scale-125"]
                  : "bg-foreground/25 group-hover:scale-125",
              )} />
              {item.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ========================================
// SidebarV2 — основной компонент
// ========================================
interface SidebarV2Props {
  side?: "left" | "right"
  onPageSelect?: (path: string) => void
  hidden?: boolean
  activePath?: string
  narrow?: boolean
}

function isNavItemActive(currentPath: string, itemTo: string, end = false): boolean {
  if (itemTo === "/") return currentPath === "/"
  if (end) return currentPath === itemTo
  return currentPath === itemTo || currentPath.startsWith(`${itemTo}/`)
}

export function SidebarV2({ side, onPageSelect, hidden, activePath, narrow }: SidebarV2Props) {
  const [expandedSection, setExpandedSection] = React.useState<string | null>(null)
  const location = useLocation()
  const navigate = useNavigate()
  const role = useStore((s) => s.user?.role)
  const currentPath = activePath || location.pathname
  const sections = visibleSections(role)

  // Подпункты открывает только наведение (150ms) — клик по категории
  // мышью не работает; Enter/Space (detail === 0) — доступность с клавиатуры.
  const hoverOpenTimer = React.useRef<number | null>(null)
  const hoverCloseTimer = React.useRef<number | null>(null)

  const clearHoverTimers = () => {
    if (hoverOpenTimer.current != null) {
      window.clearTimeout(hoverOpenTimer.current)
      hoverOpenTimer.current = null
    }
    if (hoverCloseTimer.current != null) {
      window.clearTimeout(hoverCloseTimer.current)
      hoverCloseTimer.current = null
    }
  }

  React.useEffect(() => clearHoverTimers, [])

  const closePanel = () => {
    setExpandedSection(null)
  }

  // Наслоение: каждое открытие получает растущий z-index, поэтому новое
  // окно всегда выше медленно гаснущих старых — независимо от порядка в DOM.
  const zCounter = React.useRef(0)
  const [panelZ, setPanelZ] = React.useState<Record<string, number>>({})
  const applyOpen = (title: string) => {
    zCounter.current += 1
    const z = zCounter.current
    setPanelZ((prev) => ({ ...prev, [title]: z }))
    setExpandedSection(title)
  }

  const scheduleOpen = (title: string) => {
    if (hoverCloseTimer.current != null) {
      window.clearTimeout(hoverCloseTimer.current)
      hoverCloseTimer.current = null
    }
    if (expandedSection === title || hoverOpenTimer.current != null) return
    // Уже открыто другое окно — новое ставится сразу поверх,
    // старое уходит собственным fade'ом, не дожидаясь задержки.
    if (expandedSection) {
      applyOpen(title)
      return
    }
    hoverOpenTimer.current = window.setTimeout(() => {
      hoverOpenTimer.current = null
      applyOpen(title)
    }, 50)
  }

  const scheduleClose = () => {
    if (hoverOpenTimer.current != null) {
      window.clearTimeout(hoverOpenTimer.current)
      hoverOpenTimer.current = null
    }
    if (hoverCloseTimer.current != null) window.clearTimeout(hoverCloseTimer.current)
    hoverCloseTimer.current = window.setTimeout(() => {
      hoverCloseTimer.current = null
      setExpandedSection(null)
    }, 200)
  }

  const handleTabActivate = (title: string, e: React.MouseEvent<HTMLButtonElement>) => {
    const pointerType = (e.nativeEvent as PointerEvent).pointerType
    if (e.detail !== 0 && pointerType !== "touch") return
    clearHoverTimers()
    if (expandedSection === title) {
      setExpandedSection(null)
      return
    }
    applyOpen(title)
  }

  if (hidden) return null

  // === Узкий режим (split mode) — вертикальный текст, выдвижное меню ===
  if (narrow) {
    return (
      <aside className="relative z-20 flex h-full w-[52px] flex-col bg-card/50 border-r border-border/60 shrink-0">
        <nav className="flex-1 flex flex-col gap-1 p-1 pt-2">
          {sections.map((section, sectionIndex) => {
            const hasActiveItem = section.items.some((item) => isNavItemActive(currentPath, item.to, item.end))
            return (
            <div
              key={section.title}
              data-folder={section.title}
              className="relative sidebar-enter"
              style={{
                animationDelay: `${sectionIndex * 45}ms`,
                zIndex: panelZ[section.title] ?? 0,
              }}
              onMouseEnter={() => scheduleOpen(section.title)}
              onMouseLeave={scheduleClose}
            >
              <NarrowFolderTab
                section={section}
                isActive={hasActiveItem}
                isExpanded={expandedSection === section.title}
                onToggle={(e) => handleTabActivate(section.title, e)}
              />
              {/* Невидимый мостик: закрывает зазор 8px между вкладкой и панелью */}
              <span aria-hidden className="absolute left-full top-0 h-full w-2" />
                <DropdownPanel
                  section={section}
                  isOpen={expandedSection === section.title}
                  onClose={closePanel}
                  side={side}
                  onPageSelect={onPageSelect}
                  activePath={activePath}
                />
              </div>
            )
          })}
        </nav>
      </aside>
    )
  }

  // === Широкий режим (single mode) — все пункты видны сразу ===
  const handleItemClick = (path: string) => {
    if (onPageSelect) {
      onPageSelect(path)
    } else {
      navigate(path)
    }
  }

  return (
    <aside className="flex h-full w-60 flex-col bg-card/50 border-r border-border/60 shrink-0">
      <nav className="flex-1 flex flex-col p-2 pt-3 overflow-y-auto">
        {sections.map((section, sectionIndex) => {
          const colors = TAB_COLORS[section.color]
          return (
            <div
              key={section.title}
              className={cn(
                "sidebar-enter",
                sectionIndex > 0 && "mt-1 border-t border-border/50 pt-3",
                sectionIndex === sections.length - 1 && "pb-2",
              )}
              style={{ animationDelay: `${sectionIndex * 45}ms` }}
            >
              {/* Заголовок секции */}
              <div className="flex items-center gap-2 px-3 mb-1.5">
                <div className={cn("w-1 h-3 rounded-full", colors.edge)} />
                <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/70">
                  {section.title}
                </span>
                <div className="flex-1 h-px bg-border/60" />
              </div>

              {/* Пункты меню */}
              <div className="flex flex-col gap-0.5">
                {section.items.map((item) => {
                  const isActiveItem = isNavItemActive(currentPath, item.to, item.end)
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end || item.to === "/"}
                      onClick={(e) => {
                        if (onPageSelect) {
                          e.preventDefault()
                          handleItemClick(item.to)
                        }
                      }}
                      className={cn(
                        "group flex items-center gap-2.5 rounded-lg pl-3 pr-2.5 py-[7px] text-sm",
                        "transition-all duration-150 ease-out",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                        isActiveItem
                          ? [colors.tabActive, colors.ring, colors.textActive, "font-semibold ring-1 shadow-xs"]
                          : "text-foreground/60 hover:bg-muted/60 hover:text-foreground hover:translate-x-0.5",
                      )}
                    >
                      <div className={cn(
                        "w-1 h-1 rounded-full shrink-0 transition-all duration-200 ease-out",
                        isActiveItem
                          ? [colors.edge, "scale-125"]
                          : "bg-foreground/25 group-hover:bg-foreground/50 group-hover:scale-125",
                      )} />
                      {item.label}
                    </NavLink>
                  )
                })}
              </div>
            </div>
          )
        })}
      </nav>
    </aside>
  )
}
