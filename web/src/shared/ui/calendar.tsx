import * as React from "react"
import { cn } from "@/lib/utils"
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Tag,
  FileText,
  Bell,
  Users,
  Pencil,
  Check,
  X,
  LayoutList,
  Rows3,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import type { CalendarEvent, CalendarEventColor } from "@/types"
import { toast } from "@/shared/lib/toast-store"

// ========================================
// Цвета событий
// ========================================
const EVENT_COLORS: Record<
  CalendarEventColor,
  { bg: string; border: string; text: string; dot: string }
> = {
  purple: {
    bg: "bg-primary/10",
    border: "border-l-primary",
    text: "text-primary",
    dot: "bg-primary",
  },
  orange: {
    bg: "bg-accent/10",
    border: "border-l-accent",
    text: "text-accent",
    dot: "bg-accent",
  },
  green: {
    bg: "bg-success/10",
    border: "border-l-success",
    text: "text-success",
    dot: "bg-success",
  },
  blue: {
    bg: "bg-info/10",
    border: "border-l-info",
    text: "text-info",
    dot: "bg-info",
  },
  red: {
    bg: "bg-destructive/10",
    border: "border-l-destructive",
    text: "text-destructive",
    dot: "bg-destructive",
  },
  gray: {
    bg: "bg-muted",
    border: "border-l-muted-foreground",
    text: "text-muted-foreground",
    dot: "bg-muted-foreground",
  },
}

const COLOR_OPTIONS: { value: CalendarEventColor; label: string }[] = [
  { value: "purple", label: "Фиолетовый" },
  { value: "orange", label: "Оранжевый" },
  { value: "green", label: "Зелёный" },
  { value: "blue", label: "Синий" },
  { value: "red", label: "Красный" },
  { value: "gray", label: "Серый" },
]

const TYPE_LABELS: Record<CalendarEvent["type"], string> = {
  meeting: "Встреча",
  note: "Заметка",
  reminder: "Напоминание",
}

// ========================================
// Утилиты для дат
// ========================================
const MONTHS_RU = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
]

const DAYS_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    weekday: "short",
  })
}

function getWeekDays(center: Date): Date[] {
  const days: Date[] = []
  const start = new Date(center)
  start.setDate(start.getDate() - 3)
  for (let i = 0; i < 7; i++) {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    days.push(d)
  }
  return days
}

function EventIcon({
  type,
  className,
}: {
  type: CalendarEvent["type"]
  className?: string
}) {
  if (type === "meeting") return <Users className={className} />
  if (type === "note") return <FileText className={className} />
  return <Bell className={className} />
}

// ========================================
// DateScroller — горизонтальный скролл дат
// ========================================
interface DateScrollerProps {
  selected: Date
  onSelect: (date: Date) => void
  events?: CalendarEvent[]
}

function DateScroller({ selected, onSelect, events = [] }: DateScrollerProps) {
  const weekDays = getWeekDays(selected)

  const hasEventsOnDay = (day: Date) =>
    events.some((e) => isSameDay(new Date(e.start), day))

  return (
    <div className="flex min-w-0 items-center gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => {
          const prev = new Date(selected)
          prev.setDate(prev.getDate() - 7)
          onSelect(prev)
        }}
        className="shrink-0"
        aria-label="Предыдущая неделя"
      >
        <ChevronLeft className="size-4" />
      </Button>

      {/* Раньше это был обычный flex без overflow — на узких экранах 7 карточек
          не помещались, а внешний контейнер Calendar (overflow-hidden для
          скруглённых углов) просто обрезал последние дни без намёка на скролл.
          Теперь лента дней скроллится сама, независимо от стрелок. */}
      <div
        className={cn(
          "flex min-w-0 flex-1 gap-1 overflow-x-auto scroll-smooth",
          "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
      >
        {weekDays.map((day) => {
          const isSelected = isSameDay(day, selected)
          const isToday = isSameDay(day, new Date())
          const hasEvents = hasEventsOnDay(day)

          return (
            <button
              key={day.toISOString()}
              onClick={() => onSelect(day)}
              className={cn(
                "relative flex shrink-0 flex-col items-center gap-0.5 rounded-xl px-3 py-2 transition-all duration-150 min-w-[52px] select-none",
                isSelected
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "hover:bg-muted text-foreground",
                isToday && !isSelected && "ring-1 ring-primary/30",
              )}
            >
              <span
                className={cn(
                  "text-[10px] font-medium uppercase tracking-wider",
                  isSelected
                    ? "text-primary-foreground/70"
                    : "text-muted-foreground",
                )}
              >
                {DAYS_SHORT[(day.getDay() + 6) % 7]}
              </span>
              <span className="text-lg font-semibold leading-tight">
                {day.getDate()}
              </span>
              {hasEvents && (
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    isSelected ? "bg-primary-foreground" : "bg-primary",
                  )}
                />
              )}
            </button>
          )
        })}
      </div>

      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => {
          const next = new Date(selected)
          next.setDate(next.getDate() + 7)
          onSelect(next)
        }}
        className="shrink-0"
        aria-label="Следующая неделя"
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  )
}

// ========================================
// Timeline — вертикальная временная лента
// ========================================
const HOURS = Array.from({ length: 13 }, (_, i) => i + 8) // 8:00 … 20:00
const HOUR_HEIGHT = 56
// Отступы сверху/снизу самой координатной сетки — без них подпись "8:00"
// уезжала за верхний край контейнера (translate вверх для центрирования
// на линии), а снизу не было запаса под тень/ring последнего события.
const TIMELINE_PADDING_TOP = 16
const TIMELINE_PADDING_BOTTOM = 24
// Диапазон сетки — ровно 12 часов между линией 8:00 и линией 20:00.
const GRID_MINUTES = (HOURS.length - 1) * 60 // 720
const GRID_HEIGHT = (HOURS.length - 1) * HOUR_HEIGHT // 672
const TIMELINE_HEIGHT = TIMELINE_PADDING_TOP + GRID_HEIGHT + TIMELINE_PADDING_BOTTOM
const COMPACT_EVENT_THRESHOLD = 56
const MIN_EVENT_HEIGHT = 24

// Единая функция перевода "минут с начала дня-сетки" в пиксели.
// Используется и для часовых линий, и для событий, и для линии "сейчас" —
// раньше события считались по отдельной (рассинхронизированной) формуле,
// из-за чего блок в 14:00 визуально оказывался на месте 14:30.
function minutesToY(minutesFromStart: number) {
  return TIMELINE_PADDING_TOP + (minutesFromStart / 60) * HOUR_HEIGHT
}

interface TimelineProps {
  events: CalendarEvent[]
  onEventClick: (event: CalendarEvent) => void
  selectedDate: Date
}

function Timeline({ events, onEventClick, selectedDate }: TimelineProps) {
  const dayEvents = events
    .filter((e) => isSameDay(new Date(e.start), selectedDate))
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())

  const getEventStyle = (event: CalendarEvent) => {
    const start = new Date(event.start)
    const end = new Date(event.end)
    const startMin = (start.getHours() - 8) * 60 + start.getMinutes()
    const endMin = (end.getHours() - 8) * 60 + end.getMinutes()
    const top = minutesToY(startMin)
    const rawHeight = ((endMin - startMin) / 60) * HOUR_HEIGHT
    const isCompact = rawHeight < COMPACT_EVENT_THRESHOLD
    const height = Math.max(rawHeight, MIN_EVENT_HEIGHT)
    return { top, height, isCompact }
  }

  // Simple overlap detection: split into columns
  const columns: CalendarEvent[][] = []
  const colEnds: number[] = []
  for (const event of dayEvents) {
    const start = new Date(event.start).getTime()
    let placed = false
    for (let c = 0; c < colEnds.length; c++) {
      if (start >= colEnds[c]) {
        columns[c] = [...(columns[c] || []), event]
        colEnds[c] = new Date(event.end).getTime()
        placed = true
        break
      }
    }
    if (!placed) {
      columns.push([event])
      colEnds.push(new Date(event.end).getTime())
    }
  }

  const colCount = Math.max(columns.length, 1)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="relative" style={{ height: TIMELINE_HEIGHT }}>
        {HOURS.map((hour) => (
          <div
            key={hour}
            className="absolute left-0 right-0 flex items-start"
            style={{ top: minutesToY((hour - 8) * 60) }}
          >
            <span className="w-14 shrink-0 pr-3 text-right text-xs font-medium text-muted-foreground tabular-nums select-none -translate-y-1.5">
              {String(hour).padStart(2, "0")}:00
            </span>
            <div className="flex-1 border-t border-border/60" />
          </div>
        ))}

        {dayEvents.map((event) => {
          const style = getEventStyle(event)
          const colors = EVENT_COLORS[event.color] || EVENT_COLORS.gray
          let colIdx = 0
          for (let c = 0; c < columns.length; c++) {
            if (columns[c]?.includes(event)) {
              colIdx = c
              break
            }
          }
          const width = colCount > 1 ? `${88 / colCount}%` : "88%"
          const left =
            colCount > 1
              ? `calc(56px + ${colIdx} * ${88 / colCount}%)`
              : "56px"

          return (
            <button
              key={event.id}
              onClick={() => onEventClick(event)}
              title={`${event.title} · ${formatTime(event.start)} — ${formatTime(event.end)}`}
              className={cn(
                "absolute rounded-lg border-l-[3px] text-left transition-all duration-150 hover:ring-2 hover:ring-primary/20 cursor-pointer group overflow-hidden z-[1]",
                style.isCompact ? "px-2 py-1" : "p-2.5",
                colors.bg,
                colors.border,
                "hover:z-[2]",
              )}
              style={{
                top: style.top,
                height: style.height,
                left,
                width,
              }}
            >
              {style.isCompact ? (
                <div className="flex h-full items-center gap-1.5">
                  <span className={cn("size-1.5 shrink-0 rounded-full", colors.dot)} />
                  <p className={cn("min-w-0 flex-1 truncate text-[11px] font-semibold leading-none", colors.text)}>
                    {event.title}
                  </p>
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {formatTime(event.start)}
                  </span>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "text-[13px] font-semibold leading-tight truncate",
                          colors.text,
                        )}
                      >
                        {event.title}
                      </p>
                      <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Clock className="size-3 shrink-0" />
                        {formatTime(event.start)} — {formatTime(event.end)}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-md opacity-0 transition-opacity group-hover:opacity-100",
                        colors.bg,
                      )}
                    >
                      <EventIcon type={event.type} className={cn("size-3.5", colors.text)} />
                    </span>
                  </div>
                  {event.labels.length > 0 && style.height > 90 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {event.labels.map((label) => (
                        <Badge
                          key={label}
                          variant="secondary"
                          className="text-[9px] h-3.5 px-1 py-0"
                        >
                          {label}
                        </Badge>
                      ))}
                    </div>
                  )}
                </>
              )}
            </button>
          )
        })}

        {isSameDay(selectedDate, new Date()) &&
          (() => {
            const now = new Date()
            const nowMin = (now.getHours() - 8) * 60 + now.getMinutes()
            if (nowMin < 0 || nowMin > GRID_MINUTES) return null
            const top = minutesToY(nowMin)
            return (
              <div
                className="absolute left-14 right-0 z-10 flex items-center pointer-events-none"
                style={{ top }}
              >
                <span className="size-2.5 rounded-full bg-primary shadow-[0_0_6px_var(--color-primary)]" />
                <div className="h-px flex-1 bg-primary/40" />
              </div>
            )
          })()}
      </div>
    </div>
  )
}

// ========================================
// TaskList — список задач на день
// ========================================
interface TaskListProps {
  events: CalendarEvent[]
  onEventClick: (event: CalendarEvent) => void
  selectedDate: Date
}

function TaskList({ events, onEventClick, selectedDate }: TaskListProps) {
  const dayEvents = events
    .filter((e) => isSameDay(new Date(e.start), selectedDate))
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())

  if (dayEvents.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
        Нет событий на этот день
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
      {dayEvents.map((event) => {
        const colors = EVENT_COLORS[event.color] || EVENT_COLORS.gray
        return (
          <button
            key={event.id}
            onClick={() => onEventClick(event)}
            className={cn(
              "w-full flex items-start gap-3 rounded-xl border-l-[3px] p-3.5 text-left transition-all duration-150 hover:ring-2 hover:ring-primary/20 cursor-pointer group",
              colors.bg,
              colors.border,
            )}
          >
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-lg mt-0.5",
                colors.bg,
              )}
            >
              <EventIcon type={event.type} className={cn("size-4", colors.text)} />
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn("truncate text-sm font-semibold leading-tight", colors.text)}>
                {event.title}
              </p>
              {event.description && (
                <p
                  className="mt-1 text-xs text-muted-foreground line-clamp-2"
                  title={event.description}
                >
                  {event.description}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Clock className="size-3" />
                  {formatTime(event.start)} — {formatTime(event.end)}
                </span>
                <span>{TYPE_LABELS[event.type]}</span>
              </div>
              {event.labels.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {event.labels.map((label) => (
                    <Badge key={label} variant="secondary" className="text-[10px] h-4">
                      {label}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ========================================
// DayCardModal — модалка карточки события
// ========================================
interface DayCardModalProps {
  event: CalendarEvent | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave?: (event: CalendarEvent) => void
}

function DayCardModal({ event, open, onOpenChange, onSave }: DayCardModalProps) {
  const [editing, setEditing] = React.useState(false)
  const [form, setForm] = React.useState({
    title: "",
    description: "",
    color: "purple" as CalendarEventColor,
    labels: "",
    type: "meeting" as CalendarEvent["type"],
  })

  React.useEffect(() => {
    if (event) {
      setForm({
        title: event.title,
        description: event.description || "",
        color: event.color,
        labels: event.labels.join(", "),
        type: event.type,
      })
      setEditing(false)
    }
  }, [event])

  if (!event) return null

  const colors = EVENT_COLORS[form.color] || EVENT_COLORS.gray

  const handleSave = () => {
    if (!event) return
    if (!form.title.trim()) {
      toast.error("Не удалось сохранить", "Укажите название события")
      return
    }
    const updated: CalendarEvent = {
      ...event,
      title: form.title,
      description: form.description,
      color: form.color,
      labels: form.labels
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean),
      type: form.type,
    }
    onSave?.(updated)
    setEditing(false)
    toast.success("Событие сохранено", updated.title)
  }

  const handleCancel = () => {
    if (!event) return
    setForm({
      title: event.title,
      description: event.description || "",
      color: event.color,
      labels: event.labels.join(", "),
      type: event.type,
    })
    setEditing(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setEditing(false)
        onOpenChange(o)
      }}
    >
      {/* max-h + flex-col + overflow-hidden на контейнере, скролл — только
          в теле. Раньше высота ничем не ограничивалась: на мобильном с
          открытой клавиатурой в режиме редактирования кнопки сохранения
          могли оказаться за пределами экрана без какого-либо скролла. */}
      <DialogContent
        className="flex max-h-[85vh] flex-col overflow-hidden p-0 sm:max-w-lg"
        showCloseButton={false}
      >
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4">
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "flex size-10 items-center justify-center rounded-xl shrink-0",
                colors.bg,
              )}
            >
              <EventIcon type={event.type} className={cn("size-5", colors.text)} />
            </span>
            <div className="flex-1 min-w-0 pt-0.5">
              {editing ? (
                <Input
                  value={form.title}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, title: e.target.value }))
                  }
                  className="h-8 text-base font-semibold"
                  autoFocus
                />
              ) : (
                <DialogTitle className="text-base leading-snug">
                  {event.title}
                </DialogTitle>
              )}
              <DialogDescription className="mt-1">
                {TYPE_LABELS[event.type]} &middot; {formatDate(event.start)} &middot;{" "}
                {formatTime(event.start)} — {formatTime(event.end)}
              </DialogDescription>
            </div>
            <div className="shrink-0 pt-0.5">
              {editing ? (
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon-sm" aria-label="Отменить" onClick={handleCancel}>
                    <X className="size-4" />
                  </Button>
                  <Button variant="default" size="icon-sm" aria-label="Сохранить" onClick={handleSave}>
                    <Check className="size-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Редактировать"
                    onClick={() => setEditing(true)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <DialogClose
                    render={
                      <Button variant="ghost" size="icon-sm" aria-label="Закрыть" />
                    }
                  >
                    <X className="size-4" />
                  </DialogClose>
                </div>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-6">
          {/* Описание */}
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Описание
            </Label>
            {editing ? (
              <textarea
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                rows={3}
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm resize-none outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 placeholder:text-muted-foreground"
                placeholder="Добавьте описание..."
              />
            ) : (
              <p className="text-sm text-muted-foreground leading-relaxed break-words">
                {event.description || "Нет описания"}
              </p>
            )}
          </div>

          {/* Тип */}
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Тип
            </Label>
            {editing ? (
              <div className="flex flex-wrap gap-2">
                {(Object.keys(TYPE_LABELS) as CalendarEvent["type"][]).map(
                  (t) => (
                    <button
                      key={t}
                      onClick={() => setForm((f) => ({ ...f, type: t }))}
                      className={cn(
                        "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-all",
                        form.type === t
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:bg-muted",
                      )}
                    >
                      <EventIcon type={t} className="size-3.5" />
                      {TYPE_LABELS[t]}
                    </button>
                  ),
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <EventIcon type={event.type} className={cn("size-4", colors.text)} />
                <span className="text-sm">{TYPE_LABELS[event.type]}</span>
              </div>
            )}
          </div>

          {/* Цвет */}
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Цвет
            </Label>
            {editing ? (
              <div className="flex flex-wrap gap-2">
                {COLOR_OPTIONS.map((c) => {
                  const cColors = EVENT_COLORS[c.value]
                  return (
                    <button
                      key={c.value}
                      onClick={() => setForm((f) => ({ ...f, color: c.value }))}
                      aria-label={c.label}
                      className={cn(
                        "size-7 rounded-full transition-all ring-offset-2 ring-offset-background",
                        cColors.dot,
                        form.color === c.value
                          ? "ring-2 ring-foreground scale-110"
                          : "ring-1 ring-border hover:scale-110",
                      )}
                      title={c.label}
                    />
                  )
                })}
              </div>
            ) : (
              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "size-5 rounded-full ring-1 ring-border",
                    colors.dot,
                  )}
                />
                <span className="text-sm">{COLOR_OPTIONS.find((c) => c.value === event.color)?.label}</span>
              </div>
            )}
          </div>

          {/* Метки */}
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              <Tag className="size-3 inline mr-1 -mt-0.5" />
              Метки
            </Label>
            {editing ? (
              <Input
                value={form.labels}
                onChange={(e) =>
                  setForm((f) => ({ ...f, labels: e.target.value }))
                }
                placeholder="Через запятую: МГУ, Важно"
                className="h-8 text-sm"
              />
            ) : event.labels.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {event.labels.map((label) => (
                  <Badge key={label} variant="secondary">
                    {label}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Нет меток</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ========================================
// Calendar — основной компонент
// ========================================
type CalendarViewMode = "timeline" | "list"

interface CalendarProps {
  events?: CalendarEvent[]
  className?: string
  onEventUpdate?: (event: CalendarEvent) => void
}

function Calendar({ events = [], className, onEventUpdate }: CalendarProps) {
  const [selectedDate, setSelectedDate] = React.useState<Date>(new Date())
  const [viewMode, setViewMode] = React.useState<CalendarViewMode>("timeline")
  const [selectedEvent, setSelectedEvent] =
    React.useState<CalendarEvent | null>(null)
  const [modalOpen, setModalOpen] = React.useState(false)

  const [localEvents, setLocalEvents] =
    React.useState<CalendarEvent[]>(events)

  React.useEffect(() => {
    setLocalEvents(events)
  }, [events])

  const handleEventClick = (event: CalendarEvent) => {
    setSelectedEvent(event)
    setModalOpen(true)
  }

  const handleSave = (updated: CalendarEvent) => {
    setLocalEvents((prev) =>
      prev.map((e) => (e.id === updated.id ? updated : e)),
    )
    setSelectedEvent(updated)
    onEventUpdate?.(updated)
  }

  const monthLabel = `${MONTHS_RU[selectedDate.getMonth()]} ${selectedDate.getFullYear()}`

  return (
    <div
      className={cn(
        "flex flex-col bg-card rounded-xl ring-1 ring-foreground/10 overflow-hidden h-full",
        className,
      )}
    >
      {/* Header */}
      <div className="border-b border-border shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3 pb-2">
          <h2 className="min-w-0 truncate text-base font-semibold">{monthLabel}</h2>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setSelectedDate(new Date())}
            >
              Сегодня
            </Button>
            <div className="flex items-center rounded-lg border border-border bg-background p-0.5 ml-1">
              <button
                onClick={() => setViewMode("timeline")}
                aria-label="Вид: лента"
                aria-pressed={viewMode === "timeline"}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-all",
                  viewMode === "timeline"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Rows3 className="size-3.5" />
              </button>
              <button
                onClick={() => setViewMode("list")}
                aria-label="Вид: список"
                aria-pressed={viewMode === "list"}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-all",
                  viewMode === "list"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <LayoutList className="size-3.5" />
              </button>
            </div>
          </div>
        </div>
        <div className="px-2 pb-2">
          <DateScroller
            selected={selectedDate}
            onSelect={setSelectedDate}
            events={localEvents}
          />
        </div>
      </div>

      {/* Content */}
      {viewMode === "timeline" ? (
        <Timeline
          events={localEvents}
          onEventClick={handleEventClick}
          selectedDate={selectedDate}
        />
      ) : (
        <TaskList
          events={localEvents}
          onEventClick={handleEventClick}
          selectedDate={selectedDate}
        />
      )}

      {/* Modal */}
      <DayCardModal
        event={selectedEvent}
        open={modalOpen}
        onOpenChange={setModalOpen}
        onSave={handleSave}
      />
    </div>
  )
}

export {
  Calendar,
  DateScroller,
  Timeline,
  TaskList,
  DayCardModal,
  EVENT_COLORS,
  type CalendarProps,
  type DateScrollerProps,
  type TimelineProps,
  type TaskListProps,
  type DayCardModalProps,
}