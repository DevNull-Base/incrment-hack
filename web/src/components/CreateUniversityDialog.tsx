import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
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
import { useStore } from "@/app/store"
import { api, type SimilarUniversityDto } from "@/shared/api"
import { dataSource } from "@/shared/config"
import { toast } from "@/shared/lib/toast-store"

const isApi = dataSource === "api"
const EMPTY = { name: "", shortName: "", inn: "", region: "", city: "", website: "" }

/**
 * Новый вуз в каталоге. Пока вводится название, система ищет похожие
 * записи: «МГТУ им. Баумана» и полное наименование — один вуз, и дубликат
 * в каталоге раздвоил бы отчёты по нему.
 */
export function CreateUniversityDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate()
  const addUniversity = useStore((s) => s.addUniversity)
  const [form, setForm] = useState(EMPTY)
  // Похожие вузы — для того названия, по которому их искали: пока ответ
  // на новое название не пришёл, прежний список не показывается.
  const [similarFor, setSimilarFor] = useState<{ name: string; items: SimilarUniversityDto[] }>({ name: "", items: [] })
  const trimmedName = form.name.trim()
  const similar = similarFor.name === trimmedName ? similarFor.items : []
  const [busy, setBusy] = useState(false)

  const set = (key: keyof typeof EMPTY, value: string) => setForm((f) => ({ ...f, [key]: value }))

  useEffect(() => {
    if (!isApi || trimmedName.length < 3) return
    const timer = window.setTimeout(() => {
      api.universities.similar(trimmedName).then(
        (items) => setSimilarFor({ name: trimmedName, items }),
        () => setSimilarFor({ name: trimmedName, items: [] }),
      )
    }, 400)
    return () => window.clearTimeout(timer)
  }, [trimmedName])

  const innValid = !form.inn || /^(\d{10}|\d{12})$/.test(form.inn)
  const canSubmit = form.name.trim().length >= 2 && innValid && !busy

  const close = (next: boolean) => {
    if (!next) {
      setForm(EMPTY)
      setSimilarFor({ name: "", items: [] })
    }
    onOpenChange(next)
  }

  const submit = async () => {
    setBusy(true)
    const created = await addUniversity({
      name: form.name.trim(),
      shortName: form.shortName.trim() || null,
      inn: form.inn.trim() || null,
      region: form.region.trim() || null,
      city: form.city.trim() || null,
      website: form.website.trim() || null,
      isActive: true,
    })
    setBusy(false)
    if (!created) {
      toast.error("Вуз не добавлен", "Проверьте поля и повторите")
      return
    }
    toast.success("Вуз добавлен", created.shortName ?? created.name)
    close(false)
    navigate(`/universities/${created.id}`)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Новый вуз</DialogTitle>
          <DialogDescription>Запись каталога вузов. Массово вузы загружаются импортом таблицы.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="uni-name">Полное наименование</Label>
            <Input id="uni-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Казанский федеральный университет" />
          </div>
          {similar.length > 0 && (
            <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs sm:col-span-2">
              <div className="mb-1 font-medium">Похоже, такой вуз уже есть:</div>
              {similar.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    close(false)
                    navigate(`/universities/${s.id}`)
                  }}
                  className="block text-left text-primary hover:underline"
                >
                  {s.name} · совпадение {Math.round(s.similarity * 100)}%
                </button>
              ))}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="uni-short">Сокращение</Label>
            <Input id="uni-short" value={form.shortName} onChange={(e) => set("shortName", e.target.value)} placeholder="КФУ" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="uni-inn">ИНН</Label>
            <Input id="uni-inn" value={form.inn} onChange={(e) => set("inn", e.target.value.replace(/\D/g, ""))} placeholder="10 или 12 цифр" />
            {!innValid && <p className="text-xs text-destructive">ИНН — 10 или 12 цифр</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="uni-region">Регион</Label>
            <Input id="uni-region" value={form.region} onChange={(e) => set("region", e.target.value)} placeholder="Республика Татарстан" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="uni-city">Город</Label>
            <Input id="uni-city" value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="Казань" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="uni-site">Сайт</Label>
            <Input id="uni-site" value={form.website} onChange={(e) => set("website", e.target.value)} placeholder="https://kpfu.ru" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={busy}>
            Отмена
          </Button>
          <Button onClick={() => void submit()} disabled={!canSubmit}>
            {busy ? "Сохранение…" : "Добавить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
