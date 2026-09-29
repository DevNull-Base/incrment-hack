import { useState } from "react"
import { Link } from "react-router-dom"
import { Calendar } from "@/components/ui/calendar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { dataSource } from "@/shared/config"
import { Badge } from "@/components/ui/badge"
import { useStore } from "@/app/store"
import { selectCalendarEvents } from "@/app/store/selectors"
import { toast } from "@/shared/lib/toast-store"
import { cn } from "@/lib/utils"

export function CalendarPage() {
  const calendarEvents = useStore(selectCalendarEvents)
  const tasks = useStore((s) => s.calendarTasks)
  const toggleTask = useStore((s) => s.toggleTask)
  const createTask = useStore((s) => s.createTask)
  const [title, setTitle] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [dueTime, setDueTime] = useState("")
  const [saving, setSaving] = useState(false)

  const addTask = async () => {
    if (!title.trim() || !dueDate) return
    setSaving(true)
    const result = await createTask({ title: title.trim(), dueDate, ...(dueTime ? { dueTime } : {}) })
    setSaving(false)
    if (result.ok) {
      toast.success("Задача добавлена", title.trim())
      setTitle("")
      setDueDate("")
      setDueTime("")
    } else {
      toast.error("Задача не добавлена", result.error)
    }
  }
  const sorted = [...tasks].sort((a, b) => {
    if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1
    return a.dueDate.localeCompare(b.dueDate)
  })

  return (
    // На мобильных — обычная страница со скроллом (без жёсткого h-full),
    // на lg+ — деление на две колонки фиксированной общей высоты.
    <div className="flex flex-col gap-4 lg:h-full lg:min-h-0 lg:flex-row">
      <div className="flex min-w-0 flex-col gap-4 lg:min-h-0 lg:flex-1">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Календарь</h1>
            <p className="text-sm text-muted-foreground">
              {dataSource === "api" ? "Встречи с вузами, задачи и сроки этапов" : "Встречи, записки и напоминания"}
            </p>
          </div>
        </div>
        {/* Явная минимальная высота — календарь не схлопывается на мобильных,
            где у колонки нет заданной родителем высоты. */}
        <div className="min-h-[480px] flex-1 lg:min-h-0">
          <Calendar events={calendarEvents} className="h-full" />
        </div>
      </div>

      {/* Задачи календаря: режим API — api.calendarTasks */}
      <aside className="flex w-full flex-col gap-3 rounded-xl border bg-card p-4 lg:h-full lg:w-80 lg:min-h-0 xl:w-96">
        <div className="flex shrink-0 items-center justify-between">
          <h2 className="text-sm font-semibold">Задачи</h2>
          <Badge variant="outline" className="tabular-nums">
            {tasks.filter((t) => !t.isCompleted).length} активных
          </Badge>
        </div>
        {dataSource === "api" && (
          <div className="shrink-0 space-y-2 rounded-lg border p-3">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Новая задача…" className="h-9" />
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="h-9 w-full"
                  aria-label="Дата"
                />
              </div>
              <Input
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                className="h-9 w-28 shrink-0"
                aria-label="Время"
              />
            </div>
            <Button size="sm" className="w-full" disabled={!title.trim() || !dueDate || saving} onClick={() => void addTask()}>
              {saving ? "Сохранение…" : "Добавить задачу"}
            </Button>
          </div>
        )}
        {/* Список занимает всё оставшееся место в aside (а не фиксированные 420px),
            на мобильных ограничен по высоте, чтобы не растягивать страницу бесконечно. */}
        <div className="max-h-[50vh] flex-1 space-y-2 overflow-y-auto pr-1 lg:max-h-none lg:min-h-0">
          {sorted.length === 0 && (
            <p className="text-sm text-muted-foreground">Задач нет</p>
          )}
          {sorted.map((t) => (
            <label
              key={t.id}
              className={cn(
                "flex items-start gap-3 rounded-lg border p-3 transition-colors duration-150",
                t.canEdit ? "cursor-pointer hover:bg-muted/50" : "cursor-not-allowed",
                t.isCompleted && "opacity-60",
              )}
            >
              <input
                type="checkbox"
                checked={t.isCompleted}
                disabled={!t.canEdit}
                onChange={() => {
                  void toggleTask(t.id)
                  toast.success(
                    t.isCompleted ? "Задача снова в работе" : "Задача выполнена",
                    t.title,
                  )
                }}
                className="mt-0.5 size-4 shrink-0 accent-primary"
              />
              <span className="min-w-0 flex-1">
                <span className={cn("block break-words text-sm font-medium", t.isCompleted && "line-through")}>
                  {t.title}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {t.isOverdue && !t.isCompleted && (
                    <span className="text-destructive">Просрочена · </span>
                  )}
                  {/* 2026-09-28 → 28.09.2026: срок задачи — дата без часового пояса. */}
                  {t.dueDate.split("-").reverse().join(".")}
                  {t.dueTime ? ` в ${t.dueTime}` : ""}
                </span>
                {t.engagement?.id && (
                  <Link
                    to={`/interactions/${t.engagement.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="mt-0.5 block truncate text-xs text-primary hover:underline"
                  >
                    {t.engagement.counterpartyName ?? "Взаимодействие"}
                  </Link>
                )}
              </span>
            </label>
          ))}
        </div>
      </aside>
    </div>
  )
}