import type { Meta, StoryObj } from "@storybook/react-vite"
import { Calendar, DateScroller, Timeline, TaskList, DayCardModal } from "@/shared/ui/calendar"
import { calendarEvents } from "@/mock/data"
import { useState } from "react"
import type { CalendarEvent } from "@/types"

const meta: Meta<typeof Calendar> = {
  title: "UI/Calendar",
  component: Calendar,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
}
export default meta
type Story = StoryObj<typeof Calendar>

function DateScrollerStory() {
  const [selected, setSelected] = useState(new Date())
  return (
    <div className="mx-auto max-w-md">
      <DateScroller selected={selected} onSelect={setSelected} events={calendarEvents} />
    </div>
  )
}

function TaskListStory() {
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)
  const [open, setOpen] = useState(false)
  return (
    <div className="flex h-[500px] flex-col">
      <TaskList
        events={calendarEvents}
        onEventClick={(e) => {
          setSelectedEvent(e)
          setOpen(true)
        }}
        selectedDate={new Date()}
      />
      <DayCardModal event={selectedEvent} open={open} onOpenChange={setOpen} />
    </div>
  )
}

function DayCardModalStory() {
  const [open, setOpen] = useState(true)
  const event: CalendarEvent = {
    id: "demo",
    title: "Встреча с МГУ — обучение преподавателей",
    description:
      "Обсуждение программы обучения преподавателей по курсу «Программная инженерия». Презентация методических материалов и расписание занятий на следующий семестр.",
    start: new Date().toISOString().split("T")[0] + "T09:00:00",
    end: new Date().toISOString().split("T")[0] + "T10:30:00",
    color: "purple",
    labels: ["МГУ", "Важно", "Преподаватели", "Q4 2025"],
    type: "meeting",
  }
  return (
    <div className="flex flex-col items-center gap-4">
      <DayCardModal event={event} open={open} onOpenChange={setOpen} />
    </div>
  )
}

function TimelineStory() {
  const [selected] = useState(new Date())
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)
  const [open, setOpen] = useState(false)
  return (
    <div className="flex h-[700px] flex-col">
      <Timeline
        events={calendarEvents}
        onEventClick={(e) => {
          setSelectedEvent(e)
          setOpen(true)
        }}
        selectedDate={selected}
      />
      <DayCardModal event={selectedEvent} open={open} onOpenChange={setOpen} />
    </div>
  )
}

export const Default: Story = {
  args: {
    events: calendarEvents,
  },
  parameters: {
    layout: "fullscreen",
  },
}

export const WithEvents: Story = {
  args: {
    events: calendarEvents,
  },
}

export const Empty: Story = {
  args: {
    events: [],
  },
}

export const ListMode: Story = {
  args: {
    events: calendarEvents,
  },
  play: async ({ canvasElement }) => {
    // Click the list toggle button
    const listBtn = canvasElement.querySelector('[class*="LayoutList"]')?.closest("button")
    listBtn?.click()
  },
}

export const DateScrollerOnly: Story = {
  render: () => <DateScrollerStory />,
}

export const TaskListOnly: Story = {
  render: () => <TaskListStory />,
}

export const DayCardModalDemo: Story = {
  render: () => <DayCardModalStory />,
}

export const TimelineOnly: Story = {
  render: () => <TimelineStory />,
}

export const AllColors: Story = {
  render: () => {
    const colors: CalendarEvent["color"][] = [
      "purple",
      "orange",
      "green",
      "blue",
      "red",
      "gray",
    ]
    const types: CalendarEvent["type"][] = ["meeting", "note", "reminder"]
    const baseDate = new Date()
    const baseStr = baseDate.toISOString().split("T")[0]

    const events: CalendarEvent[] = colors.map((color, i) => ({
      id: `color-${color}`,
      title: `Событие: ${color}`,
      description: `Пример события с цветом ${color}`,
      start: `${baseStr}T${9 + i}:00:00`,
      end: `${baseStr}T${9 + i}:30:00`,
      color,
      labels: [color, types[i % 3]],
      type: types[i % 3],
    }))

    return <Calendar events={events} />
  },
}
