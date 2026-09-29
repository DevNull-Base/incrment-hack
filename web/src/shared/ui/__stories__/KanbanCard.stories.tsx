import type { Meta, StoryObj } from "@storybook/react-vite"
import { Card, CardContent } from "@/shared/ui/card"
import { BrowserRouter } from "react-router-dom"

const KanbanCardExample = ({ university, program, product, progress, responsible }: {
  university: string; program: string; product: string; progress: number; responsible: string
}) => (
  <Card className="w-[240px] group cursor-grab hover:shadow-md hover:border-primary/20 transition-[shadow,border-color]">
    <CardContent className="p-3">
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-sm font-semibold">{university}</span>
      </div>
      <div className="flex flex-wrap gap-1 mb-2.5">
        <span className="inline-flex items-center rounded-md bg-primary/8 text-primary text-[10px] font-medium px-1.5 py-0.5">{program}</span>
        <span className="inline-flex items-center rounded-md bg-muted text-muted-foreground text-[10px] font-medium px-1.5 py-0.5">{product}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
        </div>
        <span className="text-[10px] font-mono text-muted-foreground">{progress}%</span>
      </div>
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
        <span className="text-[10px] text-muted-foreground">{responsible}</span>
        <span className="text-[10px] text-muted-foreground/50">2025-09-01</span>
      </div>
    </CardContent>
  </Card>
)

const meta: Meta<typeof KanbanCardExample> = {
  title: "Widgets/KanbanCard",
  component: KanbanCardExample,
  tags: ["autodocs"],
  decorators: [(Story: React.ComponentType) => <BrowserRouter><Story /></BrowserRouter>],
}
export default meta
type Story = StoryObj<typeof KanbanCardExample>

export const Default: Story = {
  args: {
    university: "МГУ",
    program: "Программная инженерия",
    product: "IntelliJ IDEA",
    progress: 57,
    responsible: "Иванов А.П.",
  },
}

export const Completed: Story = {
  args: {
    university: "НГУ",
    program: "AI/ML",
    product: "Яндекс.Облако",
    progress: 100,
    responsible: "Иванов А.П.",
  },
}

export const EarlyStage: Story = {
  args: {
    university: "КФУ",
    program: "Основы прогр.",
    product: "1С:Предприятие",
    progress: 7,
    responsible: "Иванов А.П.",
  },
}

export const MultipleCards: Story = {
  render: () => (
    <BrowserRouter>
      <div className="flex gap-3 p-4 bg-muted/30 rounded-xl">
        <KanbanCardExample university="МГУ" program="Прогр. инж." product="IntelliJ IDEA" progress={57} responsible="Иванов А.П." />
        <KanbanCardExample university="СПбПУ" program="ИБ" product="Kaspersky" progress={43} responsible="Петрова М.С." />
        <KanbanCardExample university="НГУ" program="AI/ML" product="Яндекс.Облако" progress={50} responsible="Иванов А.П." />
      </div>
    </BrowserRouter>
  ),
}
