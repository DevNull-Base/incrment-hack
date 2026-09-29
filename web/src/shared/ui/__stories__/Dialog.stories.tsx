import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"

const meta: Meta<typeof Dialog> = {
  title: "UI/Dialog",
  component: Dialog,
  tags: ["autodocs"],
}
export default meta
type Story = StoryObj<typeof Dialog>

export const Default: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Открыть диалог</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Заголовок диалога</DialogTitle>
          <DialogDescription>Описание действия, которое будет выполнено.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline">Отмена</Button>
          <Button>Подтвердить</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}

export const ConfirmationDialog: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="destructive">Удалить вуз</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Удалить вуз?</DialogTitle>
          <DialogDescription>
            Это действие нельзя отменить. Все связанные взаимодействия, документы и лицензии будут удалены.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline">Отмена</Button>
          <Button variant="destructive">Удалить</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}

export const FormDialog: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Добавить контакт</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новое контактное лицо</DialogTitle>
          <DialogDescription>Добавьте контактное лицо вуза</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>ФИО</Label>
            <Input placeholder="Иванов Иван Иванович" />
          </div>
          <div className="space-y-2">
            <Label>Должность</Label>
            <Input placeholder="Зав. кафедрой" />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input type="email" placeholder="ivanov@university.ru" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline">Отмена</Button>
          <Button>Добавить</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}
