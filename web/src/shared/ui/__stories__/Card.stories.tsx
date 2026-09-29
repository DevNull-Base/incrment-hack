import type { Meta, StoryObj } from "@storybook/react-vite"
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card"
import { Badge } from "@/shared/ui/badge"
import { Building, Users, TrendingUp, GitBranch } from "@mynaui/icons-react"

const meta: Meta<typeof Card> = {
  title: "UI/Card",
  component: Card,
  tags: ["autodocs"],
}
export default meta
type Story = StoryObj<typeof Card>

export const Default: Story = {
  render: () => (
    <Card className="w-[350px]">
      <CardHeader>
        <CardTitle>Заголовок карточки</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">Содержимое карточки с описанием.</p>
      </CardContent>
    </Card>
  ),
}

export const StatCard: Story = {
  render: () => (
    <Card className="w-[280px]">
      <CardContent className="flex items-center gap-4 p-4">
        <div className="flex size-10 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-950/40">
          <Building className="size-5 text-blue-600 dark:text-blue-400" />
        </div>
        <div>
          <div className="text-2xl font-bold">4</div>
          <div className="text-sm text-muted-foreground">Активных вузов</div>
        </div>
      </CardContent>
    </Card>
  ),
}

export const StatCardsGrid: Story = {
  render: () => (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {[
        { label: "Активных вузов", value: "4", icon: Building, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-950/40" },
        { label: "Взаимодействий", value: "5", icon: GitBranch, color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-50 dark:bg-violet-950/40" },
        { label: "Обучающихся", value: "5 860", icon: Users, color: "text-green-600 dark:text-green-400", bg: "bg-green-50 dark:bg-green-950/40" },
        { label: "Программ", value: "4", icon: TrendingUp, color: "text-orange-600 dark:text-orange-400", bg: "bg-orange-50 dark:bg-orange-950/40" },
      ].map((stat) => (
        <Card key={stat.label}>
          <CardContent className="flex items-center gap-4 p-4">
            <div className={`flex size-10 items-center justify-center rounded-full ${stat.bg}`}>
              <stat.icon className={`size-5 ${stat.color}`} />
            </div>
            <div>
              <div className="text-2xl font-bold">{stat.value}</div>
              <div className="text-sm text-muted-foreground">{stat.label}</div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  ),
}

export const CardWithBadge: Story = {
  render: () => (
    <Card className="w-[350px]">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">МГУ</CardTitle>
          <Badge>Активный</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">Московский государственный университет им. М.В. Ломоносова</p>
        <div className="mt-3 flex gap-2">
          <Badge variant="outline">Программная инженерия</Badge>
          <Badge variant="secondary">3 взаимодействия</Badge>
        </div>
      </CardContent>
    </Card>
  ),
}
