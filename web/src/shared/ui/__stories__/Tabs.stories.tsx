import type { Meta, StoryObj } from "@storybook/react-vite"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card"
import { Badge } from "@/shared/ui/badge"

const meta: Meta<typeof Tabs> = {
  title: "UI/Tabs",
  component: Tabs,
  tags: ["autodocs"],
}
export default meta
type Story = StoryObj<typeof Tabs>

export const Default: Story = {
  render: () => (
    <Tabs defaultValue="overview" className="w-[400px]">
      <TabsList>
        <TabsTrigger value="overview">Обзор</TabsTrigger>
        <TabsTrigger value="documents">Документы</TabsTrigger>
        <TabsTrigger value="activity">Активность</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Общая информация</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Основные данные о взаимодействии</p>
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="documents">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Документы</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-lg border p-3">
                <span className="text-sm">Договор</span>
                <Badge>Подписан</Badge>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <span className="text-sm">Приложение №1</span>
                <Badge variant="outline">На согласовании</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="activity">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Активность</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Последние действия по взаимодействию</p>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  ),
}

export const ProgramTabs: Story = {
  render: () => (
    <Tabs defaultValue="all" className="w-[500px]">
      <TabsList>
        <TabsTrigger value="all">Все (4)</TabsTrigger>
        <TabsTrigger value="active">Активные (3)</TabsTrigger>
        <TabsTrigger value="archived">Архив (1)</TabsTrigger>
      </TabsList>
      <TabsContent value="all">
        <div className="text-sm text-muted-foreground">Показаны все программы</div>
      </TabsContent>
      <TabsContent value="active">
        <div className="text-sm text-muted-foreground">Показаны активные программы</div>
      </TabsContent>
      <TabsContent value="archived">
        <div className="text-sm text-muted-foreground">Показаны архивные программы</div>
      </TabsContent>
    </Tabs>
  ),
}
