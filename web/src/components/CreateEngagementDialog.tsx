import { useMemo, useState } from "react"
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
import type { Segment } from "@/shared/api"
import { toast } from "@/shared/lib/toast-store"

const selectClass = "w-full rounded-lg border bg-transparent px-3 py-2 text-sm"

/**
 * Новое взаимодействие (POST /engagements). B2B — с вузом из каталога,
 * B2C — с физлицом или компанией по имени. Ответственного выбирают
 * руководитель и администратор; КАМ создаёт взаимодействие на себя.
 */
export function CreateEngagementDialog({
  open,
  onOpenChange,
  defaultSegment = "B2B",
  universityId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultSegment?: Segment
  /** Вуз зафиксирован (создание со страницы вуза). */
  universityId?: string
}) {
  const navigate = useNavigate()
  const universities = useStore((s) => s.universities)
  const directions = useStore((s) => s.directions)
  const products = useStore((s) => s.products)
  const programs = useStore((s) => s.programs)
  const employees = useStore((s) => s.adminUsers)
  const user = useStore((s) => s.user)
  const createEngagement = useStore((s) => s.createEngagement)

  const [segment, setSegment] = useState<Segment>(universityId ? "B2B" : defaultSegment)
  const [uniId, setUniId] = useState(universityId ?? "")
  const [counterpartyType, setCounterpartyType] = useState<"PERSON" | "COMPANY">("PERSON")
  const [counterpartyName, setCounterpartyName] = useState("")
  const [directionId, setDirectionId] = useState("")
  const [productId, setProductId] = useState("")
  const [programId, setProgramId] = useState("")
  const [ownerId, setOwnerId] = useState("")
  const [title, setTitle] = useState("")
  const [busy, setBusy] = useState(false)

  const canAssign = user?.role === "MANAGER" || user?.role === "ADMIN"
  const activeDirections = directions.filter((d) => d.isActive)
  const directionPrograms = useMemo(
    () => programs.filter((p) => p.isActive && (!directionId || p.directionId === directionId)),
    [programs, directionId],
  )
  const assignable = employees.filter((e) => e.isActive)

  const valid =
    Boolean(directionId) &&
    (segment === "B2B" ? Boolean(uniId) : counterpartyName.trim().length > 1)

  const reset = () => {
    setSegment(universityId ? "B2B" : defaultSegment)
    setUniId(universityId ?? "")
    setCounterpartyName("")
    setDirectionId("")
    setProductId("")
    setProgramId("")
    setOwnerId("")
    setTitle("")
  }

  const submit = async () => {
    if (!valid) return
    setBusy(true)
    const result = await createEngagement({
      segment,
      directionId,
      ...(segment === "B2B"
        ? { universityId: uniId, counterpartyType: "UNIVERSITY" as const }
        : { counterpartyType, counterpartyName: counterpartyName.trim() }),
      ...(productId ? { productId } : {}),
      ...(programId ? { programId } : {}),
      ...(canAssign && ownerId ? { ownerId } : {}),
      ...(title.trim() ? { title: title.trim() } : {}),
    })
    setBusy(false)
    if (!result.ok) {
      toast.error("Взаимодействие не создано", result.error)
      return
    }
    toast.success("Взаимодействие создано", result.item.counterpartyName)
    reset()
    onOpenChange(false)
    navigate(`/interactions/${result.item.id}`)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Новое взаимодействие</DialogTitle>
          <DialogDescription>Начнётся с первого этапа действующего процесса сегмента</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {!universityId && (
            <div className="flex gap-1 rounded-lg border p-1">
              {(["B2B", "B2C"] as const).map((seg) => (
                <button
                  key={seg}
                  type="button"
                  onClick={() => setSegment(seg)}
                  className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium ${
                    segment === seg ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {seg === "B2B" ? "B2B · вуз" : "B2C · слушатель"}
                </button>
              ))}
            </div>
          )}

          {segment === "B2B" ? (
            <div className="space-y-1.5">
              <Label htmlFor="ce-university">Вуз</Label>
              <select
                id="ce-university"
                value={uniId}
                disabled={Boolean(universityId)}
                onChange={(e) => setUniId(e.target.value)}
                className={selectClass}
              >
                <option value="">Выберите вуз</option>
                {universities.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.shortName ? `${u.shortName} — ${u.name}` : u.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="grid grid-cols-[1fr_2fr] gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="ce-type">Контрагент</Label>
                <select
                  id="ce-type"
                  value={counterpartyType}
                  onChange={(e) => setCounterpartyType(e.target.value as "PERSON" | "COMPANY")}
                  className={selectClass}
                >
                  <option value="PERSON">Физлицо</option>
                  <option value="COMPANY">Компания</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ce-name">{counterpartyType === "PERSON" ? "ФИО" : "Название"}</Label>
                <Input
                  id="ce-name"
                  value={counterpartyName}
                  onChange={(e) => setCounterpartyName(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="ce-direction">Направление</Label>
            <select
              id="ce-direction"
              value={directionId}
              onChange={(e) => {
                setDirectionId(e.target.value)
                setProgramId("")
              }}
              className={selectClass}
            >
              <option value="">Выберите направление</option>
              {activeDirections.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="ce-product">ИТ-продукт</Label>
              <select id="ce-product" value={productId} onChange={(e) => setProductId(e.target.value)} className={selectClass}>
                <option value="">—</option>
                {products.filter((p) => p.isActive).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ce-program">Программа</Label>
              <select id="ce-program" value={programId} onChange={(e) => setProgramId(e.target.value)} className={selectClass}>
                <option value="">—</option>
                {directionPrograms.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {canAssign && (
            <div className="space-y-1.5">
              <Label htmlFor="ce-owner">Ответственный</Label>
              <select id="ce-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={selectClass}>
                <option value="">Я ({user?.displayName})</option>
                {assignable
                  .filter((e) => e.id !== user?.id)
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.displayName}
                    </option>
                  ))}
              </select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="ce-title">Название (необязательно)</Label>
            <Input id="ce-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Отмена
          </Button>
          <Button onClick={() => void submit()} disabled={!valid || busy}>
            {busy ? "Создание…" : "Создать"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
