import { useMemo, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { MultiSelect, type MultiSelectOption } from "@/components/MultiSelect"
import { useStore } from "@/app/store"
import { selectProducts, selectUniversities } from "@/app/store/selectors"
import type { AdminUserRow } from "@/app/store/adminSlice"
import type { ScopeDimension } from "@/shared/api"
import { toast } from "@/shared/lib/toast-store"

const DIMENSIONS: { key: ScopeDimension; label: string; hint: string }[] = [
  { key: "UNIVERSITY", label: "Вузы", hint: "Видит заявки и сведения только этих вузов" },
  { key: "REGION", label: "Регионы", hint: "Видит вузы только этих регионов" },
  { key: "IT_DIRECTION", label: "ИТ-направления", hint: "Видит заявки только по этим направлениям" },
  { key: "SOFTWARE_PRODUCT", label: "ИТ-продукты", hint: "Видит заявки и лицензии только по этим продуктам" },
]

type Draft = Record<ScopeDimension, { limited: boolean; ids: string[] }>

/**
 * Ограничение видимости данных пользователя — требование ТЗ к роли
 * администратора. По каждому измерению: без ограничения либо список
 * разрешённых значений. Ограничения складываются: заявка видна, если
 * подходит под все заданные.
 */
export function DataScopeDialog({ user, onClose }: { user: AdminUserRow | null; onClose: () => void }) {
  const universities = useStore(selectUniversities)
  const products = useStore(selectProducts)
  const directions = useStore((s) => s.directions)
  const setUserScope = useStore((s) => s.setUserScope)
  const [busy, setBusy] = useState(false)

  const initial = useMemo<Draft>(() => {
    const draft = {} as Draft
    for (const d of DIMENSIONS) {
      const rule = user?.scopeRules?.find((r) => r.dimension === d.key)
      draft[d.key] = { limited: Boolean(rule), ids: rule?.allowedIds ?? [] }
    }
    return draft
  }, [user])
  // Диалог монтируется заново для каждого пользователя (key у родителя),
  // поэтому черновик берётся из его правил один раз.
  const [draft, setDraft] = useState<Draft>(initial)

  const options: Record<ScopeDimension, MultiSelectOption[]> = useMemo(
    () => ({
      UNIVERSITY: universities
        .map((u) => ({ value: u.id, label: u.shortName ?? u.name, hint: u.region ?? undefined }))
        .sort((a, b) => a.label.localeCompare(b.label, "ru")),
      REGION: [...new Set(universities.map((u) => u.region).filter((r): r is string => Boolean(r)))]
        .sort((a, b) => a.localeCompare(b, "ru"))
        .map((r) => ({ value: r, label: r })),
      IT_DIRECTION: directions.map((d) => ({ value: d.id, label: d.name })),
      SOFTWARE_PRODUCT: products.map((p) => ({ value: p.id, label: p.name, hint: p.vendorName })),
    }),
    [universities, directions, products],
  )

  const save = async () => {
    if (!user) return
    setBusy(true)
    for (const d of DIMENSIONS) {
      const before = initial[d.key]
      const after = draft[d.key]
      const unchanged =
        before.limited === after.limited &&
        before.ids.length === after.ids.length &&
        before.ids.every((id) => after.ids.includes(id))
      if (unchanged) continue
      const result = await setUserScope(user.id, d.key, after.limited ? after.ids : null)
      if (!result.ok) {
        setBusy(false)
        toast.error(`Ограничение «${d.label}» не сохранено`, result.error)
        return
      }
    }
    setBusy(false)
    toast.success("Доступ к данным обновлён", user.displayName)
    onClose()
  }

  return (
    <Dialog open={user !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Доступ к данным</DialogTitle>
          <DialogDescription>
            {user?.displayName}. Без ограничения — пользователь видит всё в пределах своей роли.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {DIMENSIONS.map((d) => {
            const item = draft[d.key]
            return (
              <div key={d.key} className="space-y-2 rounded-lg border p-3">
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    <span className="font-medium">{d.label}</span>
                    <span className="block text-xs text-muted-foreground">{d.hint}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={item.limited}
                    onChange={(e) => setDraft((prev) => ({ ...prev, [d.key]: { ...prev[d.key], limited: e.target.checked } }))}
                    className="size-4 accent-primary"
                    aria-label={`Ограничить: ${d.label}`}
                  />
                </label>
                {item.limited && (
                  <>
                    <MultiSelect
                      label={d.label}
                      emptyLabel="ничего"
                      options={options[d.key]}
                      value={item.ids}
                      onChange={(ids) => setDraft((prev) => ({ ...prev, [d.key]: { ...prev[d.key], ids } }))}
                    />
                    {item.ids.length === 0 && (
                      <p className="text-xs text-warning">Ничего не выбрано — по этому измерению не будет видно ничего</p>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? "Сохранение…" : "Сохранить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
