import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/shared/ui/sheet"
import { Button } from "@/shared/ui/button"
import { Badge } from "@/shared/ui/badge"

const meta: Meta<typeof Sheet> = {
  title: "UI/Sheet",
  component: Sheet,
  tags: ["autodocs"],
}
export default meta
type Story = StoryObj<typeof Sheet>

export const Right: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger asChild>
        <Button>Открыть панель</Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Детали вуза</SheetTitle>
          <SheetDescription>Информация о взаимодействии с МГУ</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4">
          <div className="rounded-lg border p-3">
            <div className="text-sm font-medium">Программная инженерия</div>
            <div className="text-xs text-muted-foreground">IntelliJ IDEA · Этап 9/14</div>
            <Badge className="mt-2">Обучение преподавателей</Badge>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-sm font-medium">Контактное лицо</div>
            <div className="text-xs text-muted-foreground">Кузнецов А.И. — Зав. кафедрой</div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  ),
}

export const Left: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">Фильтры</Button>
      </SheetTrigger>
      <SheetContent side="left">
        <SheetHeader>
          <SheetTitle>Фильтры</SheetTitle>
          <SheetDescription>Настройте параметры отображения</SheetDescription>
        </SheetHeader>
        <div className="px-4 space-y-4">
          <div className="text-sm">Регион</div>
          <div className="text-sm">Статус</div>
          <div className="text-sm">Программа</div>
        </div>
      </SheetContent>
    </Sheet>
  ),
}
