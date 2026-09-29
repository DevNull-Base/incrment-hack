import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Plus, MapPin, Search } from "@mynaui/icons-react"
import { useStore } from "@/app/store"
import { selectInteractions, selectUniversities } from "@/app/store/selectors"
import { CreateUniversityDialog } from "@/components/CreateUniversityDialog"
import { matchesQuery } from "@/shared/lib/search"
import { ariaSort, compareNullableNumber, compareString, toggleSort, type SortState } from "@/shared/lib/sort"
import { useWorkspaceState } from "@/shared/lib/workspace"

const SELECT = "h-9 min-w-0 rounded-lg border bg-transparent px-2 text-sm"

type SortKey = "name" | "region" | "engagements"

interface UniversityListState {
  q: string
  region: string
  directionId: string
  ownerId: string
  withEngagements: boolean
  showInactive: boolean
  sort: SortState<SortKey>
}

const INITIAL: UniversityListState = {
  q: "",
  region: "",
  directionId: "",
  ownerId: "",
  withEngagements: false,
  showInactive: false,
  sort: { key: "name", dir: "asc" },
}

/**
 * Реестр вузов: поиск по названию, сокращению, ИНН и городу; отбор по
 * региону, направлению и ответственному (по взаимодействиям с вузом).
 * Отбор и сортировка — рабочий контекст пользователя.
 */
export function UniversitiesPage() {
  const universities = useStore(selectUniversities)
  const interactions = useStore(selectInteractions)
  const directions = useStore((s) => s.directions)
  const user = useStore((s) => s.user)
  const navigate = useNavigate()
  const [createOpen, setCreateOpen] = useState(false)
  const [state, setState] = useWorkspaceState<UniversityListState>("universities.list", INITIAL)
  const set = <K extends keyof UniversityListState>(key: K, value: UniversityListState[K]) =>
    setState((prev) => ({ ...prev, [key]: value }))
  const canCreate = user?.role === "MANAGER" || user?.role === "ADMIN"

  // Взаимодействия по вузам — один проход вместо фильтра на каждую строку.
  const byUniversity = useMemo(() => {
    const map = new Map<string, typeof interactions>()
    for (const i of interactions) {
      if (!i.universityId) continue
      const list = map.get(i.universityId) ?? []
      list.push(i)
      map.set(i.universityId, list)
    }
    return map
  }, [interactions])

  const regions = useMemo(
    () => [...new Set(universities.map((u) => u.region).filter((r): r is string => Boolean(r)))].sort((a, b) => a.localeCompare(b, "ru")),
    [universities],
  )
  const owners = useMemo(
    () =>
      [...new Map(interactions.filter((i) => i.universityId).map((i) => [i.ownerId, i.ownerName])).entries()].sort((a, b) =>
        a[1].localeCompare(b[1], "ru"),
      ),
    [interactions],
  )

  const rows = useMemo(() => {
    const list = universities.filter((u) => {
      const items = byUniversity.get(u.id) ?? []
      if (!state.showInactive && !u.isActive) return false
      if (state.region && u.region !== state.region) return false
      if (state.withEngagements && items.length === 0) return false
      if (state.directionId && !items.some((i) => i.directionId === state.directionId)) return false
      if (state.ownerId && !items.some((i) => i.ownerId === state.ownerId)) return false
      return matchesQuery(state.q, [u.shortName ?? u.name, u.name, u.inn, u.city, u.region])
    })
    const { key, dir } = state.sort
    return list.sort((a, b) => {
      if (key === "region") return compareString(a.region ?? "", b.region ?? "", dir) || compareString(a.name, b.name, "asc")
      if (key === "engagements")
        return compareNullableNumber(byUniversity.get(a.id)?.length ?? 0, byUniversity.get(b.id)?.length ?? 0, dir)
      return compareString(a.shortName ?? a.name, b.shortName ?? b.name, dir)
    })
  }, [universities, byUniversity, state])

  const sortHeader = (key: SortKey, label: string) => (
    <TableHead aria-sort={ariaSort(state.sort, key)}>
      <button type="button" className="font-medium hover:text-foreground" onClick={() => set("sort", toggleSort(state.sort, key))}>
        {label}
        {state.sort.key === key ? (state.sort.dir === "asc" ? " ↑" : " ↓") : ""}
      </button>
    </TableHead>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Учебные заведения</h1>
          <p className="text-sm text-muted-foreground">Реестр вузов-партнёров</p>
        </div>
        {canCreate && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            Добавить вуз
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="relative sm:col-span-2 lg:col-span-1">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60" />
              <Input
                value={state.q}
                onChange={(e) => set("q", e.target.value)}
                placeholder="Название, ИНН, город"
                aria-label="Поиск вуза"
                className="h-9 pl-8"
              />
            </div>
            <select aria-label="Регион" value={state.region} onChange={(e) => set("region", e.target.value)} className={SELECT}>
              <option value="">Все регионы</option>
              {regions.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <select aria-label="ИТ-направление" value={state.directionId} onChange={(e) => set("directionId", e.target.value)} className={SELECT}>
              <option value="">Все направления</option>
              {directions.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <select aria-label="Ответственный" value={state.ownerId} onChange={(e) => set("ownerId", e.target.value)} className={SELECT}>
              <option value="">Все ответственные</option>
              {owners.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={state.withEngagements}
                onChange={(e) => set("withEngagements", e.target.checked)}
                className="size-4 accent-primary"
              />
              Только с взаимодействиями
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={state.showInactive}
                onChange={(e) => set("showInactive", e.target.checked)}
                className="size-4 accent-primary"
              />
              Показывать неактивные
            </label>
            <Button variant="outline" size="sm" className="ml-auto" onClick={() => setState(INITIAL)}>
              Сбросить
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Вузы ({rows.length}{rows.length !== universities.length ? ` из ${universities.length}` : ""})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                {sortHeader("name", "Вуз")}
                {sortHeader("region", "Регион")}
                <TableHead>ИНН</TableHead>
                {sortHeader("engagements", "Взаимодействий")}
                <TableHead>Ответственные</TableHead>
                <TableHead>Статус</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    Ничего не найдено — измените отбор
                  </TableCell>
                </TableRow>
              )}
              {rows.map((uni) => {
                const items = byUniversity.get(uni.id) ?? []
                const ownerNames = [...new Set(items.map((i) => i.ownerName))]
                return (
                  <TableRow key={uni.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/universities/${uni.id}`)}>
                    <TableCell>
                      <div className="font-medium">{uni.shortName ?? uni.name}</div>
                      <div className="max-w-xs truncate text-xs text-muted-foreground">{uni.name}</div>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <div className="flex items-center gap-1.5 text-sm">
                        <MapPin className="size-3.5 shrink-0 text-muted-foreground" />
                        {[uni.region, uni.city && uni.city !== uni.region ? uni.city : null].filter(Boolean).join(", ") || "—"}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{uni.inn ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{items.length}</Badge>
                    </TableCell>
                    <TableCell className="min-w-40 whitespace-normal text-sm text-muted-foreground">
                      {ownerNames.join(", ") || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={uni.isActive ? "default" : "secondary"}>{uni.isActive ? "Активный" : "Неактивный"}</Badge>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CreateUniversityDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
