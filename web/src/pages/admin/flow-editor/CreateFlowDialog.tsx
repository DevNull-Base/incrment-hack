import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { ProgramSource, Segment, WorkflowTemplateSummaryDto } from "@/shared/api"

interface CreateFlowDialogProps {
  open: boolean
  templates: WorkflowTemplateSummaryDto[]
  onOpenChange: (open: boolean) => void
  onCreate: (input: {
    name: string
    key: string
    segment: Segment
    siteSource: ProgramSource | null
    baseTemplateId: string | null
  }) => Promise<{ ok: true; id: string } | { ok: false; error: string }>
  onCreated: (id: string) => void
}

const KEY_RE = /^[a-z][a-z0-9-]{0,63}$/

/** Сайт-источник процесса: отличает, например, процесс sz-rt от edu-rt внутри сегмента. */
const SITE_OPTIONS: { value: ProgramSource | ""; label: string }[] = [
  { value: "", label: "Общий процесс" },
  { value: "sz-rt", label: "sz-rt — федеральный проект" },
  { value: "edu-rt", label: "edu-rt — коммерческие программы" },
  { value: "edupro", label: "edupro — корпоративное обучение" },
  { value: "rtk-school", label: "rtk-school — ИТ Школа РТК" },
]

const CYR_TO_LAT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
}

/** Авто-ключ из названия: транслит кириллицы → latin a-z0-9, иначе fallback. */
function slugifyKey(name: string, fallbackIndex: number): string {
  const latin = name
    .toLowerCase()
    .split("")
    .map((ch) => CYR_TO_LAT[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
  if (latin && /^[a-z]/.test(latin)) return latin
  return `flow-${fallbackIndex}`
}

/** Диалог создания нового флоу: с нуля или копированием существующего. */
export function CreateFlowDialog({
  open,
  templates,
  onOpenChange,
  onCreate,
  onCreated,
}: CreateFlowDialogProps) {
  const [name, setName] = useState("")
  const [key, setKey] = useState("")
  const [keyTouched, setKeyTouched] = useState(false)
  const [segment, setSegment] = useState<Segment>("B2B")
  const [siteSource, setSiteSource] = useState<ProgramSource | "">("")
  const [baseId, setBaseId] = useState<string>("")
  const [error, setError] = useState<string | null>(null)

  // Сброс при закрытии, чтобы следующее открытие начиналось с чистого состояния.
  const reset = () => {
    setName("")
    setKey("")
    setKeyTouched(false)
    setSegment("B2B")
    setSiteSource("")
    setBaseId("")
    setError(null)
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const effectiveKey = keyTouched ? key : slugifyKey(name, templates.length + 1)
  const keyValid = KEY_RE.test(effectiveKey)
  const canSubmit = name.trim().length >= 3 && keyValid

  const submit = async () => {
    const res = await onCreate({
      name: name.trim(),
      key: effectiveKey,
      segment,
      siteSource: siteSource || null,
      baseTemplateId: baseId || null,
    })
    if (!res.ok) {
      setError(res.error)
      return
    }
    handleOpenChange(false)
    onCreated(res.id)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новый флоу</DialogTitle>
          <DialogDescription>
            Создайте путь с нуля или скопируйте существующий — затем отредактируйте этапы в
            редакторе.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="flow-name">Название</Label>
            <Input
              id="flow-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: Пилот LMS для вузов"
              className="h-9 rounded-lg"
            />
            {name.trim().length > 0 && name.trim().length < 3 && (
              <p className="text-xs text-destructive">Минимум 3 символа</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="flow-key">Ключ (latin, a-z, 0-9, дефис)</Label>
            <Input
              id="flow-key"
              value={effectiveKey}
              onChange={(e) => {
                setKeyTouched(true)
                setKey(e.target.value)
              }}
              placeholder="lms-pilot"
              className="h-9 rounded-lg font-mono text-xs"
            />
            {!keyValid && (
              <p className="text-xs text-destructive">
                Ключ должен начинаться с буквы и содержать только a-z, 0-9 и дефис
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="flow-segment">Аудитория</Label>
            <select
              id="flow-segment"
              value={segment}
              onChange={(e) => setSegment(e.target.value as Segment)}
              className="h-9 w-full rounded-lg border bg-transparent px-2 text-sm"
            >
              <option value="B2B">B2B — организации и вузы</option>
              <option value="B2C">B2C — частные лица</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="flow-site">Сайт-источник</Label>
            <select
              id="flow-site"
              value={siteSource}
              onChange={(e) => setSiteSource(e.target.value as ProgramSource | "")}
              className="h-9 w-full rounded-lg border bg-transparent px-2 text-sm"
            >
              {SITE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="flow-base">Основа</Label>
            <select
              id="flow-base"
              value={baseId}
              onChange={(e) => setBaseId(e.target.value)}
              className="h-9 w-full rounded-lg border bg-transparent px-2 text-sm"
            >
              <option value="">Создать с нуля (Старт → Завершение)</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  Скопировать: {t.name}
                </option>
              ))}
            </select>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Отмена
          </Button>
          <Button disabled={!canSubmit} onClick={submit}>
            Создать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
