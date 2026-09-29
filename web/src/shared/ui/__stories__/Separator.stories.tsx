import type { Meta, StoryObj } from "@storybook/react-vite"
import { Separator } from "@/shared/ui/separator"

const meta: Meta<typeof Separator> = {
  title: "UI/Separator",
  component: Separator,
  tags: ["autodocs"],
}
export default meta
type Story = StoryObj<typeof Separator>

export const Horizontal: Story = {
  render: () => (
    <div className="w-[300px]">
      <div className="text-sm">Секция 1</div>
      <Separator className="my-4" />
      <div className="text-sm">Секция 2</div>
    </div>
  ),
}

export const Vertical: Story = {
  render: () => (
    <div className="flex h-8 items-center gap-4">
      <span className="text-sm">Пункт 1</span>
      <Separator orientation="vertical" />
      <span className="text-sm">Пункт 2</span>
      <Separator orientation="vertical" />
      <span className="text-sm">Пункт 3</span>
    </div>
  ),
}

export const InContext: Story = {
  render: () => (
    <div className="w-[300px] rounded-lg border p-4 space-y-3">
      <div className="text-sm font-medium">Заголовок карточки</div>
      <Separator />
      <div className="text-sm text-muted-foreground">Описание карточки с дополнительной информацией</div>
      <Separator />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Обновлено</span>
        <span>2025-09-15</span>
      </div>
    </div>
  ),
}
