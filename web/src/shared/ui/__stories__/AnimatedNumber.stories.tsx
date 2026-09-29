import type { Meta, StoryObj } from "@storybook/react-vite"
import { AnimatedNumber } from "@/shared/ui/animated-number"

const meta: Meta<typeof AnimatedNumber> = {
  title: "UI/AnimatedNumber",
  component: AnimatedNumber,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
}
export default meta
type Story = StoryObj<typeof AnimatedNumber>

export const CountUp: Story = {
  args: {
    value: 128,
  },
}

export const LargeNumber: Story = {
  args: {
    value: 15420,
    duration: 1200,
  },
}

export const WithDelay: Story = {
  args: {
    value: 42,
    delay: 600,
  },
}

export const StringPassthrough: Story = {
  args: {
    value: "—",
  },
}
