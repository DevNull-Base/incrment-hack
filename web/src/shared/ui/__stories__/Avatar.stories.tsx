import type { Meta, StoryObj } from "@storybook/react-vite"
import { Avatar, AvatarFallback, AvatarImage } from "@/shared/ui/avatar"

const meta: Meta<typeof Avatar> = {
  title: "UI/Avatar",
  component: Avatar,
  tags: ["autodocs"],
}
export default meta
type Story = StoryObj<typeof Avatar>

export const Default: Story = {
  render: () => (
    <Avatar>
      <AvatarImage src="https://github.com/shadcn.png" alt="Avatar" />
      <AvatarFallback>CN</AvatarFallback>
    </Avatar>
  ),
}

export const Fallback: Story = {
  render: () => (
    <Avatar>
      <AvatarFallback>АП</AvatarFallback>
    </Avatar>
  ),
}

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Avatar className="size-6">
        <AvatarFallback className="text-[8px]">АП</AvatarFallback>
      </Avatar>
      <Avatar className="size-8">
        <AvatarFallback className="text-xs">АП</AvatarFallback>
      </Avatar>
      <Avatar className="size-10">
        <AvatarFallback className="text-sm">АП</AvatarFallback>
      </Avatar>
      <Avatar className="size-14">
        <AvatarFallback className="text-lg">АП</AvatarFallback>
      </Avatar>
    </div>
  ),
}

export const Branded: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Avatar className="size-10">
        <AvatarFallback className="bg-primary text-primary-foreground font-semibold">РТ</AvatarFallback>
      </Avatar>
      <Avatar className="size-10">
        <AvatarFallback className="bg-blue-500 text-white font-semibold">МГ</AvatarFallback>
      </Avatar>
      <Avatar className="size-10">
        <AvatarFallback className="bg-green-500 text-white font-semibold">СП</AvatarFallback>
      </Avatar>
      <Avatar className="size-10">
        <AvatarFallback className="bg-orange-500 text-white font-semibold">НГ</AvatarFallback>
      </Avatar>
    </div>
  ),
}

export const Group: Story = {
  render: () => (
    <div className="flex -space-x-2">
      {["ИП", "СД", "ПМ", "КЕ"].map((initials, i) => (
        <Avatar key={i} className="size-8 border-2 border-background">
          <AvatarFallback className="bg-primary text-primary-foreground text-xs">{initials}</AvatarFallback>
        </Avatar>
      ))}
      <Avatar className="size-8 border-2 border-background">
        <AvatarFallback className="bg-muted text-muted-foreground text-xs">+3</AvatarFallback>
      </Avatar>
    </div>
  ),
}
