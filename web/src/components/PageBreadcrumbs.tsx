import * as React from "react"
import { Link } from "react-router-dom"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { visibleSections } from "@/app/nav-config"
import { useStore } from "@/app/store"
import {
  selectDocuments,
  selectInteractions,
  selectPrograms,
  selectUniversities,
} from "@/app/store/selectors"

interface Crumb {
  to: string
  label: string
}

/** Маршруты, которых нет в дереве меню некоторых ролей. */
const EXTRA_LABELS: Record<string, string> = {
  "/help": "Справка",
  "/chat": "Чат",
  "/region-map": "Карта вузов",
  "/settings": "Настройки",
  "/settings/audit": "Аудит-лог",
  "/profile": "Профиль",
}

const DETAIL_COLLECTIONS = new Set(["universities", "programs", "documents", "interactions"])

/** Сегменты-группы без собственной страницы: крошка «Admin» вела бы в «не найдено». */
const GROUP_SEGMENTS = new Set(["/admin"])

function prettify(segment: string): string {
  const text = decodeURIComponent(segment).replace(/[-_]+/g, " ").trim()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * Хлебные крошки по строке пути. Path передаётся пропом,
 * поэтому один компонент работает и в обычном режиме, и внутри
 * split-панели, где реальный URL не совпадает с содержимым панели.
 */
export function PageBreadcrumbs({ path, className }: { path: string; className?: string }) {
  const role = useStore((s) => s.user?.role)
  const universities = useStore(selectUniversities)
  const interactions = useStore(selectInteractions)
  const programs = useStore(selectPrograms)
  const documents = useStore(selectDocuments)

  const parts = path.split("?")[0].split("#")[0].split("/").filter(Boolean)
  if (parts.length === 0) return null

  // Метки из навигации + запасные для маршрутов вне меню роли
  const labels: Record<string, string> = { ...EXTRA_LABELS }
  for (const section of visibleSections(role)) {
    for (const item of section.items) labels[item.to] = item.label
  }

  const entityTitle = (collection: string, id: string): string | null => {
    if (collection === "universities") return universities.find((u) => u.id === id)?.name ?? null
    if (collection === "programs") return programs.find((p) => p.id === id)?.name ?? null
    if (collection === "documents") return documents.find((d) => d.id === id)?.name ?? null
    if (collection === "interactions") {
      const it = interactions.find((i) => i.id === id)
      if (!it) return null
      return it.universityName || it.counterpartyName || it.directionName || null
    }
    return null
  }

  const items: Crumb[] = [{ to: "/", label: "Дашборд" }]
  let cumulative = ""
  parts.forEach((segment, index) => {
    cumulative += "/" + segment
    if (GROUP_SEGMENTS.has(cumulative)) return
    let label = labels[cumulative]
    if (!label && index === 1 && DETAIL_COLLECTIONS.has(parts[0])) {
      label = entityTitle(parts[0], segment) ?? ""
    }
    if (!label) label = prettify(segment)
    items.push({ to: cumulative, label })
  })

  return (
    <Breadcrumb className={className}>
      <BreadcrumbList className="gap-1.5 text-xs">
        {items.map((item, index) => (
          <React.Fragment key={item.to}>
            {index > 0 && (
              <BreadcrumbSeparator className="text-muted-foreground/50" />
            )}
            <BreadcrumbItem>
              {index === items.length - 1 ? (
                <BreadcrumbPage className="font-medium">{item.label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink
                  render={<Link to={item.to} />}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {item.label}
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </React.Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
