import type { Meta, StoryObj } from "@storybook/react-vite"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"
import { Search } from "lucide-react"

const meta: Meta<typeof Input> = {
  title: "UI/Input",
  component: Input,
  tags: ["autodocs"],
  argTypes: {
    type: {
      control: "select",
      options: ["text", "email", "password", "search", "number"],
    },
    disabled: { control: "boolean" },
  },
}
export default meta
type Story = StoryObj<typeof Input>

export const Default: Story = {
  args: {
    placeholder: "Введите текст...",
  },
}

export const WithLabel: Story = {
  render: () => (
    <div className="space-y-2 w-[300px]">
      <Label htmlFor="email">Email</Label>
      <Input id="email" type="email" placeholder="your@rtk.ru" />
    </div>
  ),
}

export const Password: Story = {
  render: () => (
    <div className="space-y-2 w-[300px]">
      <Label htmlFor="password">Пароль</Label>
      <Input id="password" type="password" placeholder="••••••••" />
    </div>
  ),
}

export const WithSearchIcon: Story = {
  render: () => (
    <div className="relative w-[300px]">
      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input className="pl-9" placeholder="Поиск по вузам..." />
    </div>
  ),
}

export const Disabled: Story = {
  args: {
    placeholder: "Недоступно",
    disabled: true,
  },
}

export const WithValue: Story = {
  args: {
    value: "Московский государственный университет",
    readOnly: true,
  },
}

export const FormExample: Story = {
  render: () => (
    <div className="space-y-4 w-[350px]">
      <div className="space-y-2">
        <Label>Название вуза</Label>
        <Input placeholder="Московский государственный университет" />
      </div>
      <div className="space-y-2">
        <Label>Короткое имя</Label>
        <Input placeholder="МГУ" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Регион</Label>
          <Input placeholder="Москва" />
        </div>
        <div className="space-y-2">
          <Label>Город</Label>
          <Input placeholder="Москва" />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Сайт</Label>
        <Input type="url" placeholder="https://www.msu.ru" />
      </div>
    </div>
  ),
}
