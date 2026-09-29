import type { Meta, StoryObj } from "@storybook/react-vite"
import { StageCanvas, type GraphNode } from "@/shared/ui/stage-canvas"

const nodes: GraphNode[] = [
  { id: "s1", label: "Поиск контактов", step: 1, status: "completed" },
  { id: "s2", label: "Коммуникация", step: 2, status: "completed" },
  { id: "s3", label: "Организация встречи", step: 3, status: "completed" },
  { id: "s4", label: "Обмен документами", step: 4, status: "in_progress" },
  {
    id: "s5",
    label: "Корректировка документов",
    step: 5,
    status: "not_started",
    description: "Согласование правок в пакете документов перед подписанием",
  },
  { id: "s6", label: "Подписание документов", step: 6, status: "not_started" },
  { id: "s7", label: "Передача материалов", step: 7, status: "not_started" },
  { id: "s8", label: "Внедрение продукта", step: 8, status: "not_started" },
]

const meta: Meta<typeof StageCanvas> = {
  title: "Widgets/StageCanvas",
  component: StageCanvas,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
}
export default meta
type Story = StoryObj<typeof StageCanvas>

export const Default: Story = {
  args: {
    nodes,
  },
}

export const AllCompleted: Story = {
  args: {
    nodes: nodes.map((n) => ({ ...n, status: "completed" as const })),
  },
}

export const WithBlocked: Story = {
  args: {
    nodes: nodes.map((n, i) =>
      i === 3 ? { ...n, status: "blocked" as const, date: "15.09.2025" } : n,
    ),
  },
}

export const Empty: Story = {
  args: {
    nodes: [],
  },
}
