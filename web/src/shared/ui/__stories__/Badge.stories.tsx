import type { Meta, StoryObj } from "@storybook/react-vite"
import { Badge } from "@/shared/ui/badge"

const meta: Meta<typeof Badge> = {
  title: "UI/Badge",
  component: Badge,
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "secondary", "outline", "destructive"],
    },
  },
}
export default meta
type Story = StoryObj<typeof Badge>

export const Default: Story = {
  args: { children: "Активный" },
}

export const Secondary: Story = {
  args: { children: "Черновик", variant: "secondary" },
}

export const Outline: Story = {
  args: { children: "На согласовании", variant: "outline" },
}

export const Destructive: Story = {
  args: { children: "Отклонён", variant: "destructive" },
}

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge>Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="outline">Outline</Badge>
      <Badge variant="destructive">Destructive</Badge>
    </div>
  ),
}
