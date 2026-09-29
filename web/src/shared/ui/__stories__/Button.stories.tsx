import type { Meta, StoryObj } from "@storybook/react-vite"
import { Button } from "@/shared/ui/button"
import { Plus, Search, ArrowRight } from "lucide-react"

const meta: Meta<typeof Button> = {
  title: "UI/Button",
  component: Button,
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "secondary", "outline", "ghost", "link", "destructive"],
    },
    size: {
      control: "select",
      options: ["default", "sm", "lg", "icon"],
    },
  },
}
export default meta
type Story = StoryObj<typeof Button>

export const Default: Story = {
  args: { children: "Кнопка" },
}

export const Secondary: Story = {
  args: { children: "Вторичная", variant: "secondary" },
}

export const Outline: Story = {
  args: { children: "Контур", variant: "outline" },
}

export const Ghost: Story = {
  args: { children: "Призрак", variant: "ghost" },
}

export const Destructive: Story = {
  args: { children: "Удалить", variant: "destructive" },
}

export const Small: Story = {
  args: { children: "Маленькая", size: "sm" },
}

export const Large: Story = {
  args: { children: "Большая", size: "lg" },
}

export const WithIcon: Story = {
  render: () => (
    <div className="flex gap-2">
      <Button><Plus className="size-4" />Добавить</Button>
      <Button variant="outline"><Search className="size-4" />Поиск</Button>
      <Button variant="ghost">Далее<ArrowRight className="size-4" /></Button>
    </div>
  ),
}

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Button>Default</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="link">Link</Button>
    </div>
  ),
}
