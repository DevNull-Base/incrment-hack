import type { Meta, StoryObj } from "@storybook/react-vite"
import { Label } from "@/shared/ui/label"
import { Input } from "@/shared/ui/input"

const meta: Meta<typeof Label> = {
  title: "UI/Label",
  component: Label,
  tags: ["autodocs"],
}
export default meta
type Story = StoryObj<typeof Label>

export const Default: Story = {
  render: () => <Label>Имя поля</Label>,
}

export const WithInput: Story = {
  render: () => (
    <div className="space-y-2">
      <Label htmlFor="name">Название программы</Label>
      <Input id="name" placeholder="Программная инженерия" />
    </div>
  ),
}

export const Required: Story = {
  render: () => (
    <div className="space-y-2">
      <Label>
        Email <span className="text-destructive">*</span>
      </Label>
      <Input type="email" placeholder="your@rtk.ru" />
    </div>
  ),
}

export const FormLabels: Story = {
  render: () => (
    <div className="space-y-4 w-[300px]">
      <div className="space-y-2">
        <Label>ФИО</Label>
        <Input placeholder="Иванов Иван Иванович" />
      </div>
      <div className="space-y-2">
        <Label>
          Должность <span className="text-destructive">*</span>
        </Label>
        <Input placeholder="Зав. кафедрой" />
      </div>
      <div className="space-y-2">
        <Label>Email</Label>
        <Input type="email" placeholder="ivanov@university.ru" />
      </div>
    </div>
  ),
}
