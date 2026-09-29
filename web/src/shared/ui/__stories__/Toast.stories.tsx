import type { Meta, StoryObj } from "@storybook/react-vite"
import { Toaster } from "@/shared/ui/toast"
import { toast } from "@/shared/lib/toast-store"
import { Button } from "@/shared/ui/button"

const meta: Meta<typeof Toaster> = {
  title: "UI/Toast",
  component: Toaster,
  tags: ["autodocs"],
}
export default meta
type Story = StoryObj<typeof Toaster>

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Toaster />
      <Button onClick={() => toast.success("Сохранено", "Изменения применены")}>
        Success
      </Button>
      <Button
        variant="destructive"
        onClick={() => toast.error("Не удалось сохранить", "Проверьте соединение")}
      >
        Error
      </Button>
      <Button variant="outline" onClick={() => toast.warning("Есть несохранённые изменения")}>
        Warning
      </Button>
      <Button variant="ghost" onClick={() => toast.info("Черновик обновлён")}>
        Info
      </Button>
      <Button variant="ghost" onClick={() => toast.error("Критично", undefined, { duration: 0 })}>
        Persistent error
      </Button>
    </div>
  ),
}
