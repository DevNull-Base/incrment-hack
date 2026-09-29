import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FileText } from "@mynaui/icons-react"
import { api, type ReportColumnDto, type ReportFiltersDto, type ReportFormat, type ReportJobDto } from "@/shared/api"
import { useStore } from "@/app/store"
import { selectInteractions, selectPrograms, selectProducts, selectUniversities } from "@/app/store/selectors"
import { MultiSelect } from "@/components/MultiSelect"
import { toast } from "@/shared/lib/toast-store"
import { useWorkspaceState } from "@/shared/lib/workspace"

/** Форматы по ТЗ — xls, xlsx, pdf; CSV — для загрузки в другие системы. */
const FORMATS: ReportFormat[] = ["XLSX", "XLS", "PDF", "CSV"]
const EXTENSIONS: Record<string, string> = { XLSX: "xlsx", XLS: "xls", CSV: "csv", PDF: "pdf", JSON: "json" }

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface ReportFilterState {
  periodFrom: string
  periodTo: string
  segments: string[]
  universityIds: string[]
  directionIds: string[]
  productIds: string[]
  programIds: string[]
  ownerIds: string[]
  stateKeys: string[]
  onlyOverdue: boolean
  includeArchived: boolean
}

const EMPTY_FILTERS: ReportFilterState = {
  periodFrom: "",
  periodTo: "",
  segments: [],
  universityIds: [],
  directionIds: [],
  productIds: [],
  programIds: [],
  ownerIds: [],
  stateKeys: [],
  onlyOverdue: false,
  includeArchived: false,
}

interface ReportBuilderState {
  columns: string[] | null
  format: ReportFormat
  filters: ReportFilterState
}

/** Отбор в том виде, в каком его ждёт POST /reports: пустое не передаётся. */
function toRequestFilters(f: ReportFilterState): ReportFiltersDto {
  const out: ReportFiltersDto = {}
  if (f.periodFrom) out.periodFrom = f.periodFrom
  if (f.periodTo) out.periodTo = f.periodTo
  for (const key of ["segments", "universityIds", "directionIds", "productIds", "programIds", "ownerIds", "stateKeys"] as const) {
    if (f[key].length > 0) out[key] = f[key]
  }
  if (f.onlyOverdue) out.onlyOverdue = true
  if (f.includeArchived) out.includeArchived = true
  return out
}

/**
 * Отчёт по взаимодействиям (POST /reports) — требование ТЗ: за выбранный
 * период, по выбранным вузам, направлениям, продуктам, программам,
 * ответственным и статусам; колонки на выбор; xls, xlsx, pdf. Объёмный
 * отчёт формирует worker — интерфейс ждёт задачу и скачивает файл.
 * Видимость строк — та же, что у пользователя.
 */
export function ReportsCard() {
  const [columns, setColumns] = useState<ReportColumnDto[]>([])
  const [builder, setBuilder] = useWorkspaceState<ReportBuilderState>("reports.builder", {
    columns: null,
    format: "XLSX",
    filters: EMPTY_FILTERS,
  })
  const [job, setJob] = useState<ReportJobDto | null>(null)
  const [busy, setBusy] = useState(false)

  const universities = useStore(selectUniversities)
  const programs = useStore(selectPrograms)
  const products = useStore(selectProducts)
  const interactions = useStore(selectInteractions)
  const archivedIds = useStore((s) => s.archivedIds)
  const directions = useStore((s) => s.directions)
  const employees = useStore((s) => s.adminUsers)
  const stageCatalog = useStore((s) => s.stageCatalog)

  useEffect(() => {
    api.reports.columns().then(setColumns, () => {})
  }, [])

  const filters = useMemo(() => ({ ...EMPTY_FILTERS, ...builder.filters }), [builder.filters])
  const selected = builder.columns ?? columns.filter((c) => c.isDefault).map((c) => c.key)
  const format = builder.format
  const setFilter = <K extends keyof ReportFilterState>(key: K, value: ReportFilterState[K]) =>
    setBuilder((prev) => ({ ...prev, filters: { ...EMPTY_FILTERS, ...prev.filters, [key]: value } }))
  const toggleColumn = (key: string) =>
    setBuilder((prev) => {
      const current = prev.columns ?? selected
      return { ...prev, columns: current.includes(key) ? current.filter((k) => k !== key) : [...current, key] }
    })

  const options = useMemo(
    () => ({
      universities: universities
        .filter((u) => u.isActive)
        .map((u) => ({ value: u.id, label: u.shortName ?? u.name, hint: u.region ?? undefined }))
        .sort((a, b) => a.label.localeCompare(b.label, "ru")),
      directions: directions.map((d) => ({ value: d.id, label: d.name })),
      products: products.map((p) => ({ value: p.id, label: p.name, hint: p.vendorName })),
      programs: programs.map((p) => ({ value: p.id, label: p.name, hint: p.directionName })),
      owners: employees
        .filter((e) => e.isActive)
        .map((e) => ({ value: e.id, label: e.displayName }))
        .sort((a, b) => a.label.localeCompare(b.label, "ru")),
      states: (["B2B", "B2C"] as const).flatMap((segment) =>
        stageCatalog[segment].map((s) => ({ value: s.key, label: s.label, hint: segment })),
      ).filter((o, i, all) => all.findIndex((x) => x.value === o.value) === i),
    }),
    [universities, directions, products, programs, employees, stageCatalog],
  )

  // Оценка объёма по данным, уже загруженным в интерфейс: отклик на смену
  // отбора мгновенный, без запроса. Точное число строк — в готовом файле.
  const estimate = useMemo(() => {
    const inSet = (list: string[], v: string | null | undefined) => list.length === 0 || (v != null && list.includes(v))
    return interactions.filter((i) => {
      if (!filters.includeArchived && archivedIds.includes(i.id)) return false
      if (filters.onlyOverdue && !i.isOverdue) return false
      const day = i.createdAt.slice(0, 10)
      if (filters.periodFrom && day < filters.periodFrom) return false
      if (filters.periodTo && day > filters.periodTo) return false
      return (
        inSet(filters.segments, i.segment) &&
        inSet(filters.universityIds, i.universityId) &&
        inSet(filters.directionIds, i.directionId) &&
        inSet(filters.productIds, i.productId) &&
        inSet(filters.programIds, i.programId) &&
        inSet(filters.ownerIds, i.ownerId) &&
        inSet(filters.stateKeys, i.currentStateKey)
      )
    }).length
  }, [interactions, archivedIds, filters])

  const periodInvalid = Boolean(filters.periodFrom && filters.periodTo && filters.periodFrom > filters.periodTo)

  const save = (blob: Blob, fileName: string | null) => {
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = fileName ?? `отчёт-по-взаимодействиям.${EXTENSIONS[format] ?? "bin"}`
    link.click()
    URL.revokeObjectURL(url)
  }

  const build = async () => {
    if (selected.length === 0 || periodInvalid) return
    setBusy(true)
    setJob(null)
    try {
      const result = await api.reports.create({
        title: "Отчёт по взаимодействиям",
        columns: selected,
        format,
        filters: toRequestFilters(filters),
      })
      // Небольшой отчёт приходит сразу файлом.
      if (result.kind === "file") {
        save(result.blob, result.fileName)
        setJob({ id: "", status: "COMPLETED", progress: 100, rowCount: result.rowCount, sizeBytes: result.blob.size, errorCode: null })
        toast.success("Отчёт сформирован", `Строк: ${result.rowCount ?? "—"}`)
        return
      }
      // Объёмный — фоновая задача в worker: ждём готовности и скачиваем.
      let current = await api.reports.get(result.jobId)
      setJob(current)
      for (let attempt = 0; attempt < 180 && ["QUEUED", "RUNNING"].includes(current.status); attempt++) {
        await sleep(1000)
        current = await api.reports.get(result.jobId)
        setJob(current)
      }
      if (current.status === "COMPLETED") {
        const response = await api.reports.download(result.jobId)
        save(await response.blob(), null)
        toast.success("Отчёт сформирован", `Строк: ${current.rowCount ?? 0}`)
      } else {
        toast.error("Отчёт не сформирован", current.errorCode ?? current.status)
      }
    } catch {
      // ошибку показал клиент API
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="size-4" />
          Отчёт по взаимодействиям
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Отбор</h3>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Период: заведены с</span>
            <Input type="date" value={filters.periodFrom} onChange={(e) => setFilter("periodFrom", e.target.value)} className="h-9 w-40" aria-label="Период с" />
            <span className="text-muted-foreground">по</span>
            <Input type="date" value={filters.periodTo} onChange={(e) => setFilter("periodTo", e.target.value)} className="h-9 w-40" aria-label="Период по" />
            {periodInvalid && <span className="text-xs text-destructive">Начало периода позже конца</span>}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <MultiSelect
              label="Сегмент"
              options={[
                { value: "B2B", label: "Вузы (B2B)" },
                { value: "B2C", label: "Прямые продажи (B2C)" },
              ]}
              value={filters.segments}
              onChange={(v) => setFilter("segments", v)}
            />
            <MultiSelect label="Вузы" options={options.universities} value={filters.universityIds} onChange={(v) => setFilter("universityIds", v)} />
            <MultiSelect label="Направления" options={options.directions} value={filters.directionIds} onChange={(v) => setFilter("directionIds", v)} />
            <MultiSelect label="Продукты" options={options.products} value={filters.productIds} onChange={(v) => setFilter("productIds", v)} />
            <MultiSelect label="Программы" options={options.programs} value={filters.programIds} onChange={(v) => setFilter("programIds", v)} />
            <MultiSelect label="Ответственные" options={options.owners} value={filters.ownerIds} onChange={(v) => setFilter("ownerIds", v)} />
            <MultiSelect label="Статусы" options={options.states} value={filters.stateKeys} onChange={(v) => setFilter("stateKeys", v)} />
            <div className="flex flex-col justify-center gap-1 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={filters.onlyOverdue} onChange={(e) => setFilter("onlyOverdue", e.target.checked)} className="size-4 accent-primary" />
                Только просроченные
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={filters.includeArchived} onChange={(e) => setFilter("includeArchived", e.target.checked)} className="size-4 accent-primary" />
                Включая архив
              </label>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>
              Взаимодействий под отбором: ≈ <span className="font-medium tabular-nums text-foreground">{estimate}</span>
            </span>
            <button type="button" className="underline-offset-2 hover:underline" onClick={() => setBuilder((prev) => ({ ...prev, filters: EMPTY_FILTERS }))}>
              Сбросить отбор
            </button>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Колонки</h3>
          {columns.length === 0 && <p className="text-sm text-muted-foreground">Загрузка колонок…</p>}
          <div className="flex flex-wrap gap-1.5">
            {columns.map((c) => (
              <button
                key={c.key}
                type="button"
                title={c.description ?? undefined}
                onClick={() => toggleColumn(c.key)}
                className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                  selected.includes(c.key) ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Выбрано колонок: {selected.length} из {columns.length}</p>
        </section>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg border p-1" role="group" aria-label="Формат файла">
            {FORMATS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setBuilder((prev) => ({ ...prev, format: f }))}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${format === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
              >
                {f}
              </button>
            ))}
          </div>
          <Button size="sm" disabled={busy || selected.length === 0 || periodInvalid} onClick={() => void build()}>
            {busy ? "Формируется…" : "Сформировать и скачать"}
          </Button>
          {job && (
            <Badge variant={job.status === "COMPLETED" ? "default" : job.status === "FAILED" ? "destructive" : "outline"}>
              {job.status === "COMPLETED" ? `готово · ${job.rowCount ?? 0} строк` : `${job.status} · ${job.progress}%`}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
