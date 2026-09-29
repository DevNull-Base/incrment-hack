import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Calendar, Users } from "@mynaui/icons-react"
import { useStore } from "@/app/store"
import { toast } from "@/shared/lib/toast-store"
import { dataSource } from "@/shared/config"
import type { Meeting } from "@/types"

const isApi = dataSource === "api"

const STATUS_LABELS: Record<Meeting["status"], { label: string; variant: "default" | "outline" | "secondary" }> = {
  scheduled: { label: "Запланирована", variant: "outline" },
  completed: { label: "Проведена", variant: "default" },
  cancelled: { label: "Отменена", variant: "secondary" },
}

const DURATIONS = [30, 45, 60, 90]

/** Завтрашний день, YYYY-MM-DD — по умолчанию в форме назначения. */
function tomorrow(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/**
 * Встречи с представителями вуза по взаимодействию: список, назначение,
 * итоги. Встреча не удаляется — несостоявшаяся отменяется и остаётся
 * в истории работы с вузом.
 */
export function MeetingsCard({
  engagementId,
  universityId,
  archived,
}: {
  engagementId: string
  universityId: string | null
  archived: boolean
}) {
  const meetings = useStore((s) => s.meetings)
  const contacts = useStore((s) => (universityId ? s.universityContacts[universityId] : undefined))
  const loadMeetings = useStore((s) => s.loadMeetings)
  const loadUniversityExtras = useStore((s) => s.loadUniversityExtras)
  const scheduleMeeting = useStore((s) => s.scheduleMeeting)
  const updateMeeting = useStore((s) => s.updateMeeting)

  const [createOpen, setCreateOpen] = useState(false)
  const [closing, setClosing] = useState<Meeting | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void loadMeetings(engagementId)
  }, [engagementId, loadMeetings])

  // Представителей для приглашения берём из ответственных вуза.
  useEffect(() => {
    if (isApi && universityId && !contacts) void loadUniversityExtras(universityId)
  }, [universityId, contacts, loadUniversityExtras])

  const list = meetings
    .filter((m) => m.interactionId === engagementId)
    .sort((a, b) => +new Date(b.date) - +new Date(a.date))

  const cancel = async (meeting: Meeting) => {
    if (!window.confirm("Отменить встречу? Она останется в истории со статусом «Отменена».")) return
    const result = await updateMeeting(engagementId, meeting.id, { status: "CANCELLED" })
    if (result.ok) toast.success("Встреча отменена")
    else toast.error("Не удалось отменить", result.error)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Calendar className="size-4" />
            Встречи ({list.length})
          </CardTitle>
          {!archived && (
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
              Назначить встречу
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {list.length === 0 && <p className="text-sm text-muted-foreground">Встреч пока нет</p>}
        {list.map((m) => {
          const status = STATUS_LABELS[m.status]
          const editable = !archived && m.canEdit !== false && m.status === "scheduled"
          return (
            <div key={m.id} className="rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">
                  {new Date(m.date).toLocaleDateString("ru-RU")}{" "}
                  {new Date(m.date).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                  {m.durationMinutes ? <span className="text-muted-foreground"> · {m.durationMinutes} мин</span> : null}
                </div>
                <Badge variant={status.variant}>{status.label}</Badge>
              </div>
              {m.location && <div className="mt-0.5 text-xs text-muted-foreground">{m.location}</div>}
              {m.agenda && <div className="mt-1 text-sm text-muted-foreground">{m.agenda}</div>}
              {m.participants.length > 0 && (
                <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                  <Users className="size-3" />
                  {m.participants.join(", ")}
                </div>
              )}
              {m.protocol && (
                <div className="mt-2 rounded bg-muted p-2 text-xs">
                  <strong>Итоги:</strong> {m.protocol}
                </div>
              )}
              {editable && (
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setClosing(m)}>
                    Встреча проведена
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void cancel(m)}>
                    Отменить
                  </Button>
                </div>
              )}
            </div>
          )
        })}
      </CardContent>

      <ScheduleDialog
        open={createOpen}
        busy={busy}
        contacts={(contacts ?? []).map((c) => ({ id: c.id, name: c.fullName, position: c.position }))}
        onCancel={() => setCreateOpen(false)}
        onSubmit={async (input) => {
          setBusy(true)
          const result = await scheduleMeeting(engagementId, input)
          setBusy(false)
          if (!result.ok) {
            toast.error("Встреча не назначена", result.error)
            return
          }
          setCreateOpen(false)
          toast.success("Встреча назначена", "Она появится в календаре участников")
        }}
      />

      <ProtocolDialog
        meeting={closing}
        busy={busy}
        onCancel={() => setClosing(null)}
        onSubmit={async (protocol) => {
          if (!closing) return
          setBusy(true)
          const result = await updateMeeting(engagementId, closing.id, { status: "COMPLETED", protocol })
          setBusy(false)
          if (!result.ok) {
            toast.error("Не удалось сохранить итоги", result.error)
            return
          }
          setClosing(null)
          toast.success("Итоги встречи сохранены")
        }}
      />
    </Card>
  )
}

function ScheduleDialog({
  open,
  busy,
  contacts,
  onCancel,
  onSubmit,
}: {
  open: boolean
  busy: boolean
  contacts: { id: string; name: string; position: string | null }[]
  onCancel: () => void
  onSubmit: (input: {
    scheduledAt: string
    durationMinutes: number
    location?: string
    agenda?: string
    contactIds: string[]
  }) => void
}) {
  const [date, setDate] = useState(tomorrow)
  const [time, setTime] = useState("11:00")
  const [duration, setDuration] = useState(60)
  const [location, setLocation] = useState("")
  const [agenda, setAgenda] = useState("")
  const [contactIds, setContactIds] = useState<string[]>([])

  const toggleContact = (id: string) =>
    setContactIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))

  const submit = () => {
    // Время вводится по часам пользователя; бэкенд хранит момент в UTC.
    const scheduledAt = new Date(`${date}T${time}:00`).toISOString()
    onSubmit({
      scheduledAt,
      durationMinutes: duration,
      ...(location.trim() ? { location: location.trim() } : {}),
      ...(agenda.trim() ? { agenda: agenda.trim() } : {}),
      contactIds,
    })
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Назначить встречу</DialogTitle>
          <DialogDescription>Встреча появится в карточке, в истории и в календаре участников.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-1 space-y-1.5">
              <Label htmlFor="meeting-date">Дата</Label>
              <Input id="meeting-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="meeting-time">Время</Label>
              <Input id="meeting-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="meeting-duration">Длительность</Label>
              <select
                id="meeting-duration"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="h-9 w-full rounded-lg border bg-transparent px-2 text-sm"
              >
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>{d} мин</option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="meeting-location">Место или ссылка</Label>
            <Input
              id="meeting-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Кафедра, переговорная или ссылка на видеовстречу"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="meeting-agenda">Повестка</Label>
            <textarea
              id="meeting-agenda"
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
              rows={2}
              className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
            />
          </div>
          {contacts.length > 0 && (
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Представители вуза</legend>
              {contacts.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={contactIds.includes(c.id)}
                    onChange={() => toggleContact(c.id)}
                    className="size-4 accent-primary"
                  />
                  {c.name}
                  {c.position && <span className="text-xs text-muted-foreground">· {c.position}</span>}
                </label>
              ))}
            </fieldset>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={busy || !date || !time}>
            {busy ? "Сохранение…" : "Назначить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ProtocolDialog({
  meeting,
  busy,
  onCancel,
  onSubmit,
}: {
  meeting: Meeting | null
  busy: boolean
  onCancel: () => void
  onSubmit: (protocol: string) => void
}) {
  const [protocol, setProtocol] = useState("")

  return (
    <Dialog open={meeting !== null} onOpenChange={(value) => !value && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Итоги встречи</DialogTitle>
          <DialogDescription>О чём договорились — это увидят коллеги в карточке и в истории.</DialogDescription>
        </DialogHeader>
        <textarea
          aria-label="Итоги встречи"
          value={protocol}
          onChange={(e) => setProtocol(e.target.value)}
          rows={4}
          placeholder="Например: вуз готов к пилоту на одной группе, ждут проект договора"
          className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
        />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Отмена
          </Button>
          <Button
            onClick={() => {
              const text = protocol.trim()
              setProtocol("")
              onSubmit(text)
            }}
            disabled={busy || !protocol.trim()}
          >
            {busy ? "Сохранение…" : "Сохранить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
