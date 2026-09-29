import { useMemo } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Search } from "@mynaui/icons-react"
import { useStore } from "@/app/store"
import { selectPrograms, selectProducts, selectUniversities } from "@/app/store/selectors"
import {
  activeFilterCount,
  EMPTY_INTERACTION_FILTERS,
  type InteractionFilters,
} from "@/app/interaction-filters"
import type { StageInfo } from "@/app/workflow-stages"
import type { Segment } from "@/shared/api"
import type { Interaction } from "@/types"

const SELECT = "h-9 min-w-0 rounded-lg border bg-transparent px-2 text-sm"

/**
 * Панель отбора взаимодействий. Варианты в списках — только те, что
 * встречаются среди видимых пользователю заявок сегмента: пустой выбор
 * («вуз, по которому у вас ничего нет») только запутывал бы.
 */
export function InteractionFiltersBar({
  segment,
  interactions,
  stages,
  filters,
  onChange,
  shown,
  total,
}: {
  segment: Segment
  interactions: readonly Interaction[]
  stages: readonly StageInfo[]
  filters: InteractionFilters
  onChange: (next: InteractionFilters) => void
  shown: number
  total: number
}) {
  const universities = useStore(selectUniversities)
  const programs = useStore(selectPrograms)
  const products = useStore(selectProducts)
  const directions = useStore((s) => s.directions)

  const set = <K extends keyof InteractionFilters>(key: K, value: InteractionFilters[K]) =>
    onChange({ ...filters, [key]: value })

  const options = useMemo(() => {
    const uniIds = new Set(interactions.map((i) => i.universityId).filter(Boolean))
    const dirIds = new Set(interactions.map((i) => i.directionId))
    const owners = new Map(interactions.map((i) => [i.ownerId, i.ownerName]))
    const programIds = new Set(interactions.map((i) => i.programId).filter(Boolean))
    const productIds = new Set(interactions.map((i) => i.productId).filter(Boolean))
    const productNames = new Set(interactions.map((i) => i.productName).filter(Boolean))
    return {
      universities: universities
        .filter((u) => uniIds.has(u.id))
        .sort((a, b) => (a.shortName ?? a.name).localeCompare(b.shortName ?? b.name, "ru")),
      directions: directions.filter((d) => dirIds.has(d.id)).sort((a, b) => a.name.localeCompare(b.name, "ru")),
      programs: programs
        .filter((p) => programIds.has(p.id) && (!filters.directionId || p.directionId === filters.directionId))
        .sort((a, b) => a.name.localeCompare(b.name, "ru")),
      products: products
        .filter((p) => productIds.has(p.id) || productNames.has(p.name))
        .sort((a, b) => a.name.localeCompare(b.name, "ru")),
      owners: [...owners.entries()].sort((a, b) => a[1].localeCompare(b[1], "ru")),
    }
  }, [interactions, universities, directions, programs, products, filters.directionId])

  const count = activeFilterCount(filters)

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative sm:col-span-2">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              value={filters.q}
              onChange={(e) => set("q", e.target.value)}
              placeholder={segment === "B2B" ? "Вуз, направление, продукт, ответственный…" : "Контрагент, направление, программа…"}
              aria-label="Поиск по взаимодействиям"
              className="h-9 pl-8"
            />
          </div>
          {segment === "B2B" && (
            <select aria-label="Вуз" value={filters.universityId} onChange={(e) => set("universityId", e.target.value)} className={SELECT}>
              <option value="">Все вузы</option>
              {options.universities.map((u) => (
                <option key={u.id} value={u.id}>{u.shortName ?? u.name}</option>
              ))}
            </select>
          )}
          <select aria-label="Ответственный" value={filters.ownerId} onChange={(e) => set("ownerId", e.target.value)} className={SELECT}>
            <option value="">Все ответственные</option>
            {options.owners.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
          <select
            aria-label="ИТ-направление"
            value={filters.directionId}
            onChange={(e) => onChange({ ...filters, directionId: e.target.value, programId: "" })}
            className={SELECT}
          >
            <option value="">Все направления</option>
            {options.directions.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <select aria-label="ИТ-продукт" value={filters.productId} onChange={(e) => set("productId", e.target.value)} className={SELECT}>
            <option value="">Все продукты</option>
            {options.products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select aria-label="ИТ-программа" value={filters.programId} onChange={(e) => set("programId", e.target.value)} className={SELECT}>
            <option value="">Все программы</option>
            {options.programs.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select aria-label="Статус" value={filters.stateKey} onChange={(e) => set("stateKey", e.target.value)} className={SELECT}>
            <option value="">Все статусы</option>
            {stages.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">Заведены с</span>
            <Input type="date" value={filters.from} onChange={(e) => set("from", e.target.value)} className="h-9 w-40" aria-label="Заведены с" />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">по</span>
            <Input type="date" value={filters.to} onChange={(e) => set("to", e.target.value)} className="h-9 w-40" aria-label="Заведены по" />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={filters.overdueOnly}
              onChange={(e) => set("overdueOnly", e.target.checked)}
              className="size-4 accent-primary"
            />
            Только просроченные
          </label>
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            Показано {shown} из {total}
          </span>
          <Button variant="outline" size="sm" disabled={count === 0} onClick={() => onChange(EMPTY_INTERACTION_FILTERS)}>
            Сбросить{count > 0 ? ` (${count})` : ""}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
