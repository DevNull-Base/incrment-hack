import { useCallback, useMemo, useState } from "react"
import { activeStreams, liveStreams, STREAM_STATUS_LABELS, studyingNow } from "@/shared/lib/streams"
import { useNavigate } from "react-router-dom"
import { Search } from "@mynaui/icons-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useStore } from "@/app/store"
import { selectPrograms, selectStreams, selectUniversities } from "@/app/store/selectors"
import { FilterChips } from "@/shared/ui/filter-chips"
import {
  ariaSort,
  compareString,
  toggleSort,
  type SortState,
} from "@/shared/lib/sort"
import type { ProgramSource } from "@/shared/api"

type SortKey = "name" | "hours" | "students"

const SOURCE_OPTIONS: { value: ProgramSource | "all"; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "rtk-school", label: "rtk-school" },
  { value: "edu-rt", label: "edu-rt" },
  { value: "sz-rt", label: "sz-rt" },
  { value: "edupro", label: "edupro" },
]

const HOUR_RANGES: { value: string; label: string; min: number; max: number }[] = [
  { value: "all", label: "Любые часы", min: 0, max: Infinity },
  { value: "s", label: "≤ 72 ч", min: 0, max: 72 },
  { value: "m", label: "73–144 ч", min: 73, max: 144 },
  { value: "l", label: "145–360 ч", min: 145, max: 360 },
  { value: "xl", label: "361–720 ч", min: 361, max: 720 },
  { value: "xxl", label: "> 720 ч", min: 721, max: Infinity },
]

const AUDIENCE_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "Любая аудитория" },
  { value: "individuals", label: "Частные лица" },
  { value: "specialists", label: "Специалисты и компании" },
  { value: "state-project", label: "Гос. проект (ЦЗН)" },
]

/**
 * Каталог курсов: все образовательные программы проектов
 * rtk-school/edu-rt/sz-rt/edupro с фильтрами, сортировками
 * и модалкой программы (клик по строке).
 */
export function CoursesPage() {
  const navigate = useNavigate()
  const programs = useStore(selectPrograms)
  const streams = useStore(selectStreams)
  const universities = useStore(selectUniversities)

  const [search, setSearch] = useState("")
  const [source, setSource] = useState<ProgramSource | "all">("all")
  const [directionId, setDirectionId] = useState("all")
  const [universityId, setUniversityId] = useState("all")
  const [hours, setHours] = useState("all")
  const [audience, setAudience] = useState("all")
  const [onlyWithStreams, setOnlyWithStreams] = useState(false)
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "students", dir: "desc" })
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const directions = useMemo(() => {
    const map = new Map<string, string>()
    programs.forEach((p) => map.set(p.directionId, p.directionName))
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "ru"))
  }, [programs])

  const streamsByProgram = useMemo(() => {
    const map = new Map<string, typeof streams>()
    streams.forEach((s) => {
      const list = map.get(s.programId) ?? []
      list.push(s)
      map.set(s.programId, list)
    })
    return map
  }, [streams])

  // Обучаются сейчас — по идущим потокам: завершённые — выпуск, запланированные — набор.
  const studentsOf = useCallback(
    (programId: string) => studyingNow(streamsByProgram.get(programId) ?? []),
    [streamsByProgram],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const range = HOUR_RANGES.find((r) => r.value === hours) ?? HOUR_RANGES[0]
    const rows = programs.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false
      if (source !== "all" && p.source !== source) return false
      if (directionId !== "all" && p.directionId !== directionId) return false
      if (audience !== "all" && p.audienceCategory !== audience) return false
      const h = p.hoursTotal ?? 0
      if (h < range.min || h > range.max) return false
      const pStreams = streamsByProgram.get(p.id) ?? []
      if (onlyWithStreams && liveStreams(pStreams).length === 0) return false
      if (universityId !== "all" && !pStreams.some((s) => s.universityId === universityId)) {
        return false
      }
      return true
    })
    rows.sort((a, b) => {
      if (sort.key === "name") return compareString(a.name, b.name, sort.dir)
      if (sort.key === "hours") {
        const diff = (a.hoursTotal ?? 0) - (b.hoursTotal ?? 0)
        return sort.dir === "asc" ? diff : -diff
      }
      const diff = studentsOf(a.id) - studentsOf(b.id)
      return sort.dir === "asc" ? diff : -diff
    })
    return rows
  }, [programs, streamsByProgram, search, source, directionId, universityId, hours, audience, onlyWithStreams, sort, studentsOf])

  const metrics = useMemo(() => {
    const uniIds = new Set(
      filtered.flatMap((p) => (streamsByProgram.get(p.id) ?? []).flatMap((s) => (s.universityId ? [s.universityId] : []))),
    )
    const students = filtered.reduce((sum, p) => sum + studentsOf(p.id), 0)
    const flowCount = filtered.reduce((sum, p) => sum + activeStreams(streamsByProgram.get(p.id) ?? []).length, 0)
    return { programs: filtered.length, directions: new Set(filtered.map((p) => p.directionId)).size, flows: flowCount, students, universities: uniIds.size }
  }, [filtered, streamsByProgram, studentsOf])

  const reset = () => {
    setSearch("")
    setSource("all")
    setDirectionId("all")
    setUniversityId("all")
    setHours("all")
    setAudience("all")
    setOnlyWithStreams(false)
    setSort({ key: "students", dir: "desc" })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Каталог курсов</h1>
        <p className="text-sm text-muted-foreground">
          Образовательные программы проектов rtk-school · edu-rt · sz-rt · edupro
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "Программ", value: metrics.programs },
          { label: "Направлений", value: metrics.directions },
          { label: "Потоков идёт", value: metrics.flows },
          { label: "Обучающихся", value: metrics.students },
        ].map((m) => (
          <Card key={m.label}>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold tabular-nums">{m.value}</div>
              <div className="text-xs text-muted-foreground">{m.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center gap-3 justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Search className="size-4" />
            Фильтры
          </CardTitle>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию"
            className="h-auto w-64 rounded-lg border bg-transparent px-3 py-1.5 text-sm"
          />
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <FilterChips
              ariaLabel="Источник программы"
              options={SOURCE_OPTIONS}
              value={source}
              onChange={setSource}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={directionId}
              onChange={(e) => setDirectionId(e.target.value)}
              aria-label="Направление"
              className="h-9 rounded-lg border bg-transparent px-2 text-sm"
            >
              <option value="all">Все направления</option>
              {directions.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
            <select
              value={universityId}
              onChange={(e) => setUniversityId(e.target.value)}
              aria-label="Вуз"
              title={universities.find((u) => u.id === universityId)?.name ?? "Все вузы"}
              className="h-9 w-[220px] max-w-[260px] rounded-lg border bg-transparent px-2 text-sm"
              style={{ maxWidth: 260 }}
            >
              <option value="all">Все вузы</option>
              {universities.map((u) => (
                <option key={u.id} value={u.id} title={u.name}>
                  {u.shortName ?? u.name}
                </option>
              ))}
            </select>
            <select
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              aria-label="Часы"
              className="h-9 rounded-lg border bg-transparent px-2 text-sm"
            >
              {HOUR_RANGES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              aria-label="Аудитория"
              className="h-9 rounded-lg border bg-transparent px-2 text-sm"
            >
              {AUDIENCE_OPTIONS.map((a) => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={onlyWithStreams}
                onChange={(e) => setOnlyWithStreams(e.target.checked)}
                className="size-4 accent-primary"
              />
              Только с потоками
            </label>
            <Button variant="ghost" size="sm" onClick={reset} className="text-muted-foreground">
              Сбросить
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Программы ({filtered.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              По текущим фильтрам ничего не найдено. Сбросьте фильтры или измените запрос.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead
                    className="cursor-pointer select-none hover:text-foreground"
                    aria-sort={ariaSort(sort, "name")}
                    onClick={() => setSort((s) => toggleSort(s, "name"))}
                  >
                    Программа
                  </TableHead>
                  <TableHead>Источник</TableHead>
                  <TableHead>Направление</TableHead>
                  <TableHead
                    className="cursor-pointer select-none hover:text-foreground"
                    aria-sort={ariaSort(sort, "hours")}
                    onClick={() => setSort((s) => toggleSort(s, "hours"))}
                  >
                    Часы
                  </TableHead>
                  <TableHead>Вузы</TableHead>
                  <TableHead>Потоки</TableHead>
                  <TableHead
                    className="cursor-pointer text-right select-none hover:text-foreground"
                    aria-sort={ariaSort(sort, "students")}
                    onClick={() => setSort((s) => toggleSort(s, "students"))}
                  >
                    Обучающиеся
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((p) => {
                  const pStreams = streamsByProgram.get(p.id) ?? []
                  // Вуз с несколькими потоками программы показывается один раз.
                  const uniIds = [...new Set(pStreams.flatMap((s) => (s.universityId ? [s.universityId] : [])))]
                  return (
                    <TableRow
                      key={p.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedId(p.id)}
                    >
                      <TableCell className="min-w-48 whitespace-normal font-medium">{p.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {p.source}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-normal text-sm text-muted-foreground">{p.directionName}</TableCell>
                      <TableCell className="tabular-nums">{p.hoursTotal ?? "—"}</TableCell>
                      <TableCell className="whitespace-normal">
                        {uniIds.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className="flex flex-wrap gap-1">
                            {uniIds.map((id) => {
                              const u = universities.find((x) => x.id === id)
                              return (
                                <button
                                  key={id}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    navigate(`/universities/${id}`)
                                  }}
                                  className="rounded-md px-1.5 py-0.5 text-xs text-primary underline-offset-2 hover:underline"
                                >
                                  {u?.shortName ?? u?.name ?? id}
                                </button>
                              )
                            })}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums">{pStreams.length}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {studentsOf(p.id)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Модалка программы */}
      <Dialog open={selectedId !== null} onOpenChange={(o) => !o && setSelectedId(null)}>
        {(() => {
          const program = programs.find((p) => p.id === selectedId)
          if (!program) return null
          const pStreams = streamsByProgram.get(program.id) ?? []
          const meta = [program.directionName, program.productName, `${program.hoursTotal ?? "—"} ч`]
            .filter(Boolean)
            .join(" · ")
          return (
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
              <Badge variant="outline" className="absolute right-12 top-6 z-10 font-mono">
                {program.source}
              </Badge>
              <DialogHeader>
                <DialogTitle>{program.name}</DialogTitle>
                <DialogDescription>{meta}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 text-sm">
                <section className="space-y-1">
                  <h4 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Описание
                  </h4>
                  <p>{program.description ?? "Описание не заполнено."}</p>
                </section>
                <section className="space-y-1">
                  <h4 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Для кого
                  </h4>
                  <p>{program.audience ?? "—"}</p>
                </section>
                <section className="space-y-1">
                  <h4 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Что необходимо
                  </h4>
                  <p>{program.requirements ?? "—"}</p>
                </section>
                <section className="space-y-2">
                  <h4 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Потоки ({pStreams.length})
                  </h4>
                  {pStreams.length === 0 ? (
                    <p className="text-muted-foreground">Потоков пока нет.</p>
                  ) : (
                    pStreams.map((s) => {
                      const u = s.universityId ? universities.find((x) => x.id === s.universityId) : undefined
                      const status = STREAM_STATUS_LABELS[s.status]
                      return (
                        <div
                          key={s.id}
                          className="flex items-center justify-between gap-3 rounded-lg border p-3"
                        >
                          <div className="min-w-0">
                            {s.universityId ? (
                              <button
                                type="button"
                                onClick={() => {
                                  navigate(`/universities/${s.universityId}`)
                                  setSelectedId(null)
                                }}
                                className="truncate text-sm font-medium text-primary underline-offset-2 hover:underline"
                              >
                                {u?.shortName ?? u?.name ?? s.universityName ?? "Вуз"}
                              </button>
                            ) : (
                              <div className="truncate text-sm font-medium">Набор на сайте</div>
                            )}
                            <div className="text-xs text-muted-foreground">
                              {[s.name, new Date(s.startDate).toLocaleDateString("ru-RU"), `${s.studentsCount} обучающихся`]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                          </div>
                          <Badge variant={status.variant}>{status.label}</Badge>
                        </div>
                      )
                    })
                  )}
                </section>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    navigate(`/programs/${program.id}`)
                    setSelectedId(null)
                  }}
                >
                  Открыть карточку программы
                </Button>
                <Button onClick={() => setSelectedId(null)}>Закрыть</Button>
              </DialogFooter>
            </DialogContent>
          )
        })()}
      </Dialog>
    </div>
  )
}
