import type { Meta, StoryObj } from "@storybook/react-vite"
import { WORKFLOW_STAGES } from "@/types"

const StageProgressExample = ({ stages }: { stages: Record<string, string> }) => (
  <div className="grid grid-cols-7 gap-2">
    {WORKFLOW_STAGES.map((stage) => {
      const status = stages[stage.key] || "not_started"
      const colors: Record<string, string> = {
        not_started: "bg-muted text-muted-foreground",
        in_progress: "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300",
        completed: "bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-300",
        blocked: "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300",
      }
      return (
        <div key={stage.key} className={`rounded-lg border p-2 text-center text-xs ${colors[status]}`}>
          <div className="font-mono text-[10px] mb-1">{stage.step}</div>
          <div className="truncate">{stage.label}</div>
        </div>
      )
    })}
  </div>
)

const meta: Meta<typeof StageProgressExample> = {
  title: "Widgets/StageProgress",
  component: StageProgressExample,
  tags: ["autodocs"],
}
export default meta
type Story = StoryObj<typeof StageProgressExample>

export const InProgress: Story = {
  args: {
    stages: {
      search_contacts: "completed",
      communication: "completed",
      meeting: "completed",
      document_exchange: "completed",
      document_signing: "completed",
      materials_transfer: "completed",
      implementation_support: "completed",
      teacher_training: "in_progress",
    },
  },
}

export const EarlyStage: Story = {
  args: {
    stages: {
      search_contacts: "completed",
      communication: "in_progress",
    },
  },
}

export const WithBlocked: Story = {
  args: {
    stages: {
      search_contacts: "completed",
      communication: "completed",
      meeting: "completed",
      document_exchange: "blocked",
    },
  },
}
