import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Search } from "@mynaui/icons-react"
import { Building2, BookOpen, Box, Clock, GitBranch } from "lucide-react"
import { useStore } from "@/app/store"
import { selectInteractions, selectPrograms, selectProducts, selectUniversities } from "@/app/store/selectors"
import { searchItems } from "@/shared/lib/search"
import { loadRecent, recentPath } from "@/shared/lib/workspace"
import type { RecentItemDto } from "@/shared/api"
import { cn } from "@/lib/utils"

const PER_GROUP = 5

interface ResultItem {
  key: string
  group: string
  icon: React.ComponentType<{ className?: string }>
  title: string
  subtitle?: string
  to: string
}

/**
 * Поиск в шапке: вузы (название, сокращение, ИНН, город), программы,
 * взаимодействия (вуз или контрагент, направление, продукт, программа,
 * ответственный) и продукты. Ctrl+K или «/» — перейти к поиску; стрелки
 * и Enter — выбрать; без запроса — недавно открытое.
 */
export function GlobalSearch({
  autoFocus = false,
  onNavigate,
}: {
  /** Сразу поставить курсор в поле (поиск под шапкой на узком экране). */
  autoFocus?: boolean
  /** Вызывается после перехода к найденному — например, чтобы закрыть панель. */
  onNavigate?: () => void
} = {}) {
  const navigate = useNavigate()
  const universities = useStore(selectUniversities)
  const programs = useStore(selectPrograms)
  const interactions = useStore(selectInteractions)
  const products = useStore(selectProducts)
  const archivedIds = useStore((s) => s.archivedIds)

  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [recent, setRecent] = useState<RecentItemDto[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  // Ctrl+K / Cmd+K и «/» вне полей ввода — к поиску. Скрытое поле
  // (узкий экран) горячие клавиши не забирает: там поиск открывает шапка.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!inputRef.current || inputRef.current.offsetParent === null) return
      const target = event.target as HTMLElement | null
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      if ((event.key === "k" || event.key === "л") && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        inputRef.current?.focus()
      } else if (event.key === "/" && !typing) {
        event.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // Клик мимо — закрыть.
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  useEffect(() => {
    if (open && !query.trim()) void loadRecent().then(setRecent)
  }, [open, query])

  const results = useMemo<ResultItem[]>(() => {
    const q = query.trim()
    if (!q) {
      return recent.flatMap((item) => {
        const to = recentPath(item)
        return to
          ? [{ key: `r-${item.entityType}-${item.entityId}`, group: "Недавно открытые", icon: Clock, title: item.title, to }]
          : []
      })
    }

    const uniItems = searchItems(universities, q, (u) => [u.shortName ?? u.name, u.name, u.inn, u.city, u.region], PER_GROUP).map(
      (u): ResultItem => ({
        key: `u-${u.id}`,
        group: "Вузы",
        icon: Building2,
        title: u.shortName ?? u.name,
        subtitle: [u.shortName ? u.name : null, u.city].filter(Boolean).join(" · "),
        to: `/universities/${u.id}`,
      }),
    )

    const programItems = searchItems(programs, q, (p) => [p.name, p.directionName, p.productName, p.description], PER_GROUP).map(
      (p): ResultItem => ({
        key: `p-${p.id}`,
        group: "Программы",
        icon: BookOpen,
        title: p.name,
        subtitle: [p.directionName, p.source].filter(Boolean).join(" · "),
        to: `/programs/${p.id}`,
      }),
    )

    const engagementItems = searchItems(
      interactions,
      q,
      (i) => [
        i.universityShortName ?? i.counterpartyName,
        i.counterpartyName,
        i.directionName,
        i.productName,
        i.programName,
        i.ownerName,
        i.currentStateLabel,
      ],
      PER_GROUP,
    ).map(
      (i): ResultItem => ({
        key: `e-${i.id}`,
        group: "Взаимодействия",
        icon: GitBranch,
        title: i.universityShortName ?? i.counterpartyName,
        subtitle: [
          i.directionName,
          i.productName,
          i.currentStateLabel,
          i.ownerName,
          archivedIds.includes(i.id) ? "в архиве" : null,
        ]
          .filter(Boolean)
          .join(" · "),
        to: `/interactions/${i.id}`,
      }),
    )

    const productItems = searchItems(products, q, (p) => [p.name, p.vendorName, p.description], PER_GROUP).map(
      (p): ResultItem => ({
        key: `pr-${p.id}`,
        group: "Продукты — взаимодействия по продукту",
        icon: Box,
        title: p.name,
        subtitle: p.vendorName,
        to: `/interactions?productId=${p.id}`,
      }),
    )

    const all: ResultItem[] = [...uniItems, ...programItems, ...engagementItems, ...productItems]
    all.push({
      key: "all-engagements",
      group: "",
      icon: Search,
      title: `Все взаимодействия по запросу «${q}»`,
      to: `/interactions?q=${encodeURIComponent(q)}`,
    })
    return all
  }, [query, recent, universities, programs, interactions, products, archivedIds])

  const go = (item: ResultItem | undefined) => {
    if (!item) return
    navigate(item.to)
    setOpen(false)
    setQuery("")
    inputRef.current?.blur()
    onNavigate?.()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setOpen(true)
      setActive((i) => Math.min(i + 1, results.length - 1))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (event.key === "Enter") {
      event.preventDefault()
      go(results[active])
    } else if (event.key === "Escape") {
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  const showEmpty = open && query.trim().length > 0 && results.length <= 1

  return (
    <div ref={boxRef} className="relative">
      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/50" />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls="global-search-results"
        aria-label="Поиск по вузам, программам и взаимодействиям"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        autoFocus={autoFocus}
        onKeyDown={onKeyDown}
        placeholder="Поиск по вузам, программам..."
        className="h-10 w-full rounded-xl border border-border/70 bg-muted/40 pl-9 pr-14 text-sm placeholder:text-muted-foreground/50 transition-all duration-300 ease-[cubic-bezier(0.645,0.045,0.355,1)] focus:border-primary/40 focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary/15"
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground lg:block">
        Ctrl K
      </kbd>

      {open && (results.length > 0 || showEmpty) && (
        <div
          id="global-search-results"
          role="listbox"
          className="absolute left-0 right-0 top-12 z-50 max-h-[70vh] overflow-y-auto rounded-xl border bg-card p-1.5 shadow-lg"
        >
          {showEmpty && (
            <p className="px-3 py-2 text-sm text-muted-foreground">Ничего не найдено по вузам, программам и продуктам</p>
          )}
          {results.map((item, index) => {
            const header = item.group && item.group !== results[index - 1]?.group ? item.group : null
            const Icon = item.icon
            return (
              <div key={item.key}>
                {header && (
                  <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {header}
                  </div>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  onMouseEnter={() => setActive(index)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => go(item)}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left",
                    index === active ? "bg-muted" : "hover:bg-muted/60",
                    !item.group && "mt-1 border-t pt-2.5",
                  )}
                >
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{item.title}</span>
                    {item.subtitle && <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span>}
                  </span>
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
