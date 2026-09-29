import { useEffect, useState } from "react"
import { ArrowRight, CheckCircle, Upload } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { api, type ImportFieldDto } from "@/shared/api"
import { useStore } from "@/app/store"
import { toast } from "@/shared/lib/toast-store"

// ========================================
// Мастер импорта (режим API): файл разбирается фоновой задачей до
// статуса DRY_RUN_READY; дальше — сопоставление колонок, решения по
// похожим вузам и применение. Ничего не пишется в каталог до «Применить».
// ========================================

/** Ответ GET /import/{id} (src/modules/import/import.service.ts, ImportPreview). */
interface ImportPreview {
  jobId: string
  status: string
  fileName: string
  totalRows: number
  validRows: number
  invalidRows: number
  detectedMapping: Record<string, string>
  unmappedHeaders: string[]
  missingRequired: { key: string; label: string }[]
  pendingDecisions: number
  willCreate: Record<string, number>
  willUpdate: Record<string, number>
  duplicateCandidates: {
    rowNumber: number
    incomingName: string
    matchedName: string
    matchedId?: string
    similarity: number
    decision?: string | null
  }[]
  warnings: { rowNumber?: number; message?: string }[]
  errors: { rowNumber: number; columnName: string | null; message: string }[]
}

interface ApplyResult {
  created: number
  updated: number
  engagementsCreated: number
}

type Step = "fields" | "file" | "mapping" | "resolutions" | "apply"

const STEPS: { id: Step; label: string }[] = [
  { id: "fields", label: "Поля" },
  { id: "file", label: "Файл" },
  { id: "mapping", label: "Маппинг" },
  { id: "resolutions", label: "Совпадения" },
  { id: "apply", label: "Применить" },
]

const COUNT_LABELS: Record<string, string> = {
  universities: "вузов",
  vendors: "вендоров",
  products: "продуктов",
  contracts: "договоров",
  licenses: "лицензий",
  engagements: "взаимодействий",
  contacts: "контактов",
}

const CREATE_NEW = "CREATE_NEW"

function counts(record: Record<string, number> | undefined): string {
  const parts = Object.entries(record ?? {})
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${COUNT_LABELS[k] ?? k}`)
  return parts.length > 0 ? parts.join(", ") : "ничего"
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Разбор идёт в worker: опрашиваем, пока статус не станет итоговым. */
async function waitForPreview(jobId: string): Promise<ImportPreview> {
  for (let attempt = 0; attempt < 120; attempt++) {
    const preview = (await api.import.get(jobId)) as ImportPreview
    if (!["PENDING", "PARSING"].includes(preview.status)) return preview
    await sleep(1000)
  }
  throw new Error("Разбор файла не завершился за 2 минуты")
}

export function ImportLive() {
  const reloadInteractions = useStore((s) => s.reloadInteractions)
  const loadData = useStore((s) => s.loadData)
  const [step, setStep] = useState<Step>("fields")
  const [fields, setFields] = useState<ImportFieldDto[]>([])
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [decisions, setDecisions] = useState<Record<string, string>>({})
  const [result, setResult] = useState<ApplyResult | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const stepIndex = STEPS.findIndex((s) => s.id === step)

  useEffect(() => {
    api.import.fields().then(setFields, () => {})
  }, [])

  const acceptPreview = (next: ImportPreview) => {
    setPreview(next)
    setMapping(next.detectedMapping ?? {})
    setDecisions(
      Object.fromEntries(
        next.duplicateCandidates.map((d) => [d.incomingName, d.decision ?? ""]),
      ),
    )
    if (next.status === "FAILED") toast.error("Файл не разобран", next.errors[0]?.message)
  }

  const upload = async (file: File) => {
    setBusy("upload")
    setResult(null)
    try {
      const form = new FormData()
      form.append("file", file)
      const created = await api.import.start(form)
      acceptPreview(await waitForPreview(created.jobId))
      setStep("mapping")
    } catch (error) {
      if (error instanceof Error && !("status" in error)) toast.error("Импорт не начат", error.message)
    } finally {
      setBusy(null)
    }
  }

  const saveMapping = async () => {
    if (!preview) return
    setBusy("mapping")
    try {
      await api.import.updateMapping(preview.jobId, { mapping })
      acceptPreview(await waitForPreview(preview.jobId))
      setStep("resolutions")
    } catch {
      // ошибку показал клиент API
    } finally {
      setBusy(null)
    }
  }

  const saveDecisions = async () => {
    if (!preview) return
    setBusy("resolutions")
    try {
      const resolutions = Object.fromEntries(Object.entries(decisions).filter(([, v]) => v))
      await api.import.setResolutions(preview.jobId, { resolutions })
      acceptPreview((await api.import.get(preview.jobId)) as ImportPreview)
      setStep("apply")
    } catch {
      // ошибку показал клиент API
    } finally {
      setBusy(null)
    }
  }

  const apply = async () => {
    if (!preview) return
    setBusy("apply")
    try {
      const applied = (await api.import.apply(preview.jobId)) as ApplyResult
      setResult(applied)
      toast.success(
        "Импорт применён",
        `Создано ${applied.created}, обновлено ${applied.updated}, взаимодействий ${applied.engagementsCreated}`,
      )
      // Каталоги и взаимодействия изменились — перечитываем данные интерфейса.
      await Promise.all([reloadInteractions(), loadData()])
    } catch {
      // ошибку показал клиент API
    } finally {
      setBusy(null)
    }
  }

  const reset = () => {
    setPreview(null)
    setResult(null)
    setMapping({})
    setDecisions({})
    setStep("file")
  }

  const headers = preview ? [...new Set([...Object.keys(preview.detectedMapping ?? {}), ...(preview.unmappedHeaders ?? [])])] : []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Импорт данных</h1>
        <p className="text-sm text-muted-foreground">
          Мастер загрузки: поля → файл → маппинг → совпадения → применение
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2">
            <Badge variant={i <= stepIndex ? "default" : "outline"}>
              {i + 1}. {s.label}
            </Badge>
            {i < STEPS.length - 1 && <ArrowRight className="size-3 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {step === "fields" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Поля импорта ({fields.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Колонки файла сопоставляются с полями по заголовкам; синонимы подхватываются автоматически.
            </p>
            {fields.map((f) => (
              <div key={f.key} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                <span>
                  <span className="font-medium">{f.label}</span>
                  {f.required && <Badge className="ml-2" variant="default">обязательное</Badge>}
                </span>
                <span className="text-xs text-muted-foreground">{f.synonyms.slice(0, 4).join(", ")}</span>
              </div>
            ))}
            <Button onClick={() => setStep("file")}>Далее</Button>
          </CardContent>
        </Card>
      )}

      {step === "file" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Файл</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-sm text-muted-foreground hover:bg-muted/40">
              <Upload className="size-6" />
              {busy === "upload" ? "Файл разбирается…" : "Выберите файл XLSX или XLS"}
              <Input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                disabled={busy !== null}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void upload(file)
                  e.target.value = ""
                }}
              />
            </label>
          </CardContent>
        </Card>
      )}

      {preview && step === "mapping" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {preview.fileName}: строк {preview.totalRows}, корректных {preview.validRows}, с ошибками {preview.invalidRows}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {preview.missingRequired.length > 0 && (
              <p className="text-sm text-destructive">
                Не сопоставлено обязательное: {preview.missingRequired.map((m) => m.label).join(", ")}
              </p>
            )}
            {headers.map((header) => (
              <div key={header} className="grid grid-cols-2 items-center gap-3 rounded-lg border p-2 text-sm">
                <span className="truncate font-medium">{header}</span>
                <select
                  value={mapping[header] ?? ""}
                  onChange={(e) =>
                    setMapping((m) => {
                      const next = { ...m }
                      if (e.target.value) next[header] = e.target.value
                      else delete next[header]
                      return next
                    })
                  }
                  className="rounded-md border bg-transparent px-2 py-1"
                >
                  <option value="">— не загружать</option>
                  {fields.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            {preview.errors.length > 0 && (
              <div className="rounded-lg border border-destructive/30 p-3 text-xs">
                {preview.errors.slice(0, 10).map((e, i) => (
                  <div key={i}>
                    строка {e.rowNumber}
                    {e.columnName ? `, «${e.columnName}»` : ""}: {e.message}
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={reset} disabled={busy !== null}>
                Другой файл
              </Button>
              <Button onClick={() => void saveMapping()} disabled={busy !== null}>
                {busy === "mapping" ? "Пересчёт…" : "Далее"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {preview && step === "resolutions" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Похожие вузы ({preview.duplicateCandidates.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Совпадение применяется только по вашему решению: похожие по написанию, но разные вузы не сливаются.
            </p>
            {preview.duplicateCandidates.length === 0 && <p className="text-sm">Совпадений нет.</p>}
            {preview.duplicateCandidates.map((d) => (
              <div key={d.incomingName} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg border p-3 text-sm">
                <div>
                  <div className="font-medium">«{d.incomingName}»</div>
                  <div className="text-xs text-muted-foreground">
                    похож на «{d.matchedName}» · сходство {Math.round(d.similarity * 100)}%
                  </div>
                </div>
                <select
                  value={decisions[d.incomingName] ?? ""}
                  onChange={(e) => setDecisions((m) => ({ ...m, [d.incomingName]: e.target.value }))}
                  className="rounded-md border bg-transparent px-2 py-1"
                >
                  <option value="">решение не принято</option>
                  {d.matchedId && <option value={d.matchedId}>это «{d.matchedName}»</option>}
                  <option value={CREATE_NEW}>новый вуз</option>
                </select>
              </div>
            ))}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep("mapping")} disabled={busy !== null}>
                Назад
              </Button>
              <Button onClick={() => void saveDecisions()} disabled={busy !== null}>
                {busy === "resolutions" ? "Сохранение…" : "Далее"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {preview && step === "apply" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Применение</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-lg border p-3">Будет создано: {counts(preview.willCreate)}</div>
            <div className="rounded-lg border p-3">Будет обновлено: {counts(preview.willUpdate)}</div>
            {preview.warnings.length > 0 && (
              <div className="rounded-lg border border-warning/30 p-3 text-xs">
                {preview.warnings.slice(0, 10).map((w, i) => (
                  <div key={i}>
                    {w.rowNumber ? `строка ${w.rowNumber}: ` : ""}
                    {w.message ?? JSON.stringify(w)}
                  </div>
                ))}
              </div>
            )}
            {result ? (
              <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/5 p-3">
                <CheckCircle className="size-4 text-success" />
                Создано {result.created}, обновлено {result.updated}, взаимодействий {result.engagementsCreated}
              </div>
            ) : null}
            <div className="flex gap-2">
              <Button variant="outline" onClick={result ? reset : () => setStep("resolutions")} disabled={busy !== null}>
                {result ? "Загрузить ещё" : "Назад"}
              </Button>
              {!result && (
                <Button onClick={() => void apply()} disabled={busy !== null || preview.validRows === 0}>
                  {busy === "apply" ? "Применение…" : "Применить"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
