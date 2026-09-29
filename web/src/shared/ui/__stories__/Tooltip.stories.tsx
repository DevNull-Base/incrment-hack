import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui/tooltip"
import { Button } from "@/shared/ui/button"
import { HelpCircle, Info, AlertTriangle } from "lucide-react"

const meta: Meta<typeof Tooltip> = {
  title: "UI/Tooltip",
  component: Tooltip,
  tags: ["autodocs"],
  decorators: [(Story) => <TooltipProvider><Story /></TooltipProvider>],
}
export default meta
type Story = StoryObj<typeof Tooltip>

export const Default: Story = {
  render: () => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" size="icon">
          <HelpCircle className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>Подсказка</p>
      </TooltipContent>
    </Tooltip>
  ),
}

export const WithDescription: Story = {
  render: () => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon">
          <Info className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[250px]">
        <p>Этап 5 — опциональный. Переход возможен напрямую с этапа 4 на этап 6.</p>
      </TooltipContent>
    </Tooltip>
  ),
}

export const OnIcon: Story = {
  render: () => (
    <div className="flex gap-3">
      <Tooltip>
        <TooltipTrigger>
          <HelpCircle className="size-4 text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent>Справка</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger>
          <Info className="size-4 text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent>Информация</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger>
          <AlertTriangle className="size-4 text-warning" />
        </TooltipTrigger>
        <TooltipContent>Внимание</TooltipContent>
      </Tooltip>
    </div>
  ),
}

export const Placements: Story = {
  render: () => (
    <div className="flex items-center gap-8 p-16">
      <Tooltip>
        <TooltipTrigger asChild><Button variant="outline" size="sm">Сверху</Button></TooltipTrigger>
        <TooltipContent side="top">Подсказка сверху</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild><Button variant="outline" size="sm">Справа</Button></TooltipTrigger>
        <TooltipContent side="right">Подсказка справа</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild><Button variant="outline" size="sm">Снизу</Button></TooltipTrigger>
        <TooltipContent side="bottom">Подсказка снизу</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild><Button variant="outline" size="sm">Слева</Button></TooltipTrigger>
        <TooltipContent side="left">Подсказка слева</TooltipContent>
      </Tooltip>
    </div>
  ),
}
