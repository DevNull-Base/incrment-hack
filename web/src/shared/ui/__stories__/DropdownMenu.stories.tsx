import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu"
import { Button } from "@/shared/ui/button"

const meta: Meta<typeof DropdownMenu> = {
  title: "UI/DropdownMenu",
  component: DropdownMenu,
  tags: ["autodocs"],
}
export default meta
type Story = StoryObj<typeof DropdownMenu>

export const Default: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Открыть меню</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Действия</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Редактировать</DropdownMenuItem>
        <DropdownMenuItem>Дублировать</DropdownMenuItem>
        <DropdownMenuItem>Архивировать</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive">Удалить</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}

export const UserMenu: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="rounded-full p-2">
          <div className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
            АП
          </div>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Иванов А.П.</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Профиль</DropdownMenuItem>
        <DropdownMenuItem>Настройки</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive">Выйти</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}

export const ActionsMenu: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">Действия</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Создать документ</DropdownMenuItem>
        <DropdownMenuItem>Назначить встречу</DropdownMenuItem>
        <DropdownMenuItem>Отправить письмо</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Экспорт в CSV</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}
