import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  Progress,
  CircularProgress,
} from "@/shared/ui/progress"
import {
  BarChart,
  LineChart,
  DonutChart,
  HorizontalBarChart,
  SparkLine,
} from "@/shared/ui/chart"
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card"

// ========================================
// Progress
// ========================================
const progressMeta: Meta<typeof Progress> = {
  title: "Widgets/Progress",
  component: Progress,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
}
export default progressMeta
type ProgressStory = StoryObj<typeof Progress>

export const Linear: ProgressStory = {
  render: () => (
    <div className="space-y-6 max-w-md">
      <Progress value={72} />
      <Progress value={45} color="success" />
      <Progress value={88} color="info" />
      <Progress value={23} color="warning" />
      <Progress value={10} color="destructive" />
      <Progress value={60} color="accent" />
    </div>
  ),
}

export const Sizes: ProgressStory = {
  render: () => (
    <div className="space-y-5 max-w-md">
      <Progress value={65} size="sm" showLabel />
      <Progress value={65} size="md" showLabel />
      <Progress value={65} size="lg" showLabel />
    </div>
  ),
}

export const WithLabel: ProgressStory = {
  render: () => (
    <div className="space-y-5 max-w-md">
      <Progress value={72} showLabel />
      <Progress value={45} color="success" showLabel />
      <Progress value={100} color="info" showLabel />
    </div>
  ),
}

// ========================================
// CircularProgress
// ========================================
export const Circular: ProgressStory = {
  render: () => (
    <div className="flex items-center gap-8">
      <CircularProgress value={72} />
      <CircularProgress value={45} color="success" size={80} strokeWidth={6} />
      <CircularProgress value={90} color="info" size={50} strokeWidth={4} />
      <CircularProgress value={23} color="warning" />
      <CircularProgress value={100} color="accent" />
    </div>
  ),
}

// ========================================
// Bar Chart
// ========================================
const barMeta: Meta<typeof BarChart> = {
  title: "Widgets/BarChart",
  component: BarChart,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
}
export const BarChartDefault: StoryObj<typeof BarChart> = {
  render: () => (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Заявки по месяцам</CardTitle>
      </CardHeader>
      <CardContent>
        <BarChart
          data={[
            { label: "Янв", value: 120 },
            { label: "Фев", value: 85 },
            { label: "Мар", value: 200 },
            { label: "Апр", value: 150 },
            { label: "Май", value: 175 },
            { label: "Июн", value: 90 },
          ]}
          height={220}
        />
      </CardContent>
    </Card>
  ),
}

export const BarChartColors: StoryObj<typeof BarChart> = {
  render: () => (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Студенты по вузам</CardTitle>
      </CardHeader>
      <CardContent>
        <BarChart
          data={[
            { label: "МГУ", value: 340, color: "fill-primary" },
            { label: "СПбПУ", value: 210, color: "fill-accent" },
            { label: "НГУ", value: 180, color: "fill-success" },
            { label: "УрФУ", value: 95, color: "fill-info" },
            { label: "КФУ", value: 45, color: "fill-warning" },
          ]}
          height={200}
        />
      </CardContent>
    </Card>
  ),
}

// ========================================
// Line Chart
// ========================================
const lineMeta: Meta<typeof LineChart> = {
  title: "Widgets/LineChart",
  component: LineChart,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
}
export const LineChartDefault: StoryObj<typeof LineChart> = {
  render: () => (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Динамика взаимодействий</CardTitle>
      </CardHeader>
      <CardContent>
        <LineChart
          labels={["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл"]}
          datasets={[
            {
              label: "Новые",
              data: [12, 19, 15, 25, 22, 30, 28],
            },
            {
              label: "Завершённые",
              data: [5, 8, 12, 15, 18, 20, 24],
            },
          ]}
          height={220}
        />
      </CardContent>
    </Card>
  ),
}

export const LineChartSingle: StoryObj<typeof LineChart> = {
  render: () => (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Конверсия заявок</CardTitle>
      </CardHeader>
      <CardContent>
        <LineChart
          labels={["Нед 1", "Нед 2", "Нед 3", "Нед 4", "Нед 5", "Нед 6"]}
          datasets={[
            {
              label: "Конверсия %",
              data: [65, 72, 68, 80, 75, 85],
              color: "stroke-primary",
            },
          ]}
          height={180}
          showArea
        />
      </CardContent>
    </Card>
  ),
}

// ========================================
// Donut Chart
// ========================================
const donutMeta: Meta<typeof DonutChart> = {
  title: "Widgets/DonutChart",
  component: DonutChart,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
}
export const DonutChartDefault: StoryObj<typeof DonutChart> = {
  render: () => (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Статус взаимодействий</CardTitle>
      </CardHeader>
      <CardContent>
        <DonutChart
          data={[
            { label: "Активные", value: 5 },
            { label: "Завершённые", value: 9 },
            { label: "Ожидают", value: 3 },
          ]}
        />
      </CardContent>
    </Card>
  ),
}

export const DonutChartDetailed: StoryObj<typeof DonutChart> = {
  render: () => (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Продукты</CardTitle>
      </CardHeader>
      <CardContent>
        <DonutChart
          data={[
            { label: "IntelliJ IDEA", value: 12 },
            { label: "Kaspersky", value: 8 },
            { label: "Яндекс.Облако", value: 15 },
            { label: "1С:Предприятие", value: 5 },
          ]}
          size={180}
          strokeWidth={24}
        />
      </CardContent>
    </Card>
  ),
}

// ========================================
// Horizontal Bar Chart
// ========================================
const hbarMeta: Meta<typeof HorizontalBarChart> = {
  title: "Widgets/HorizontalBarChart",
  component: HorizontalBarChart,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
}
export const HorizontalBarDefault: StoryObj<typeof HorizontalBarChart> = {
  render: () => (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Прогресс по этапам</CardTitle>
      </CardHeader>
      <CardContent>
        <HorizontalBarChart
          data={[
            { label: "Поиск контактов", value: 100 },
            { label: "Коммуникация", value: 85 },
            { label: "Встречи", value: 70 },
            { label: "Документы", value: 50 },
            { label: "Внедрение", value: 30 },
          ]}
        />
      </CardContent>
    </Card>
  ),
}

// ========================================
// SparkLine
// ========================================
const sparkMeta: Meta<typeof SparkLine> = {
  title: "Widgets/SparkLine",
  component: SparkLine,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
}
export const SparkLineDefault: StoryObj<typeof SparkLine> = {
  render: () => (
    <div className="flex items-end gap-6">
      <div className="text-center">
        <SparkLine data={[10, 15, 13, 18, 22, 20, 28]} color="primary" />
        <p className="mt-1 text-xs text-muted-foreground">Заявки</p>
      </div>
      <div className="text-center">
        <SparkLine data={[5, 8, 12, 10, 15, 18, 22]} color="success" />
        <p className="mt-1 text-xs text-muted-foreground">Завершены</p>
      </div>
      <div className="text-center">
        <SparkLine data={[20, 18, 22, 15, 12, 14, 10]} color="destructive" />
        <p className="mt-1 text-xs text-muted-foreground">Отмены</p>
      </div>
      <div className="text-center">
        <SparkLine data={[60, 65, 62, 70, 75, 72, 85]} color="info" />
        <p className="mt-1 text-xs text-muted-foreground">Конверсия %</p>
      </div>
    </div>
  ),
}

// ========================================
// Dashboard Example — всё вместе
// ========================================
export const DashboardExample: StoryObj = {
  render: () => (
    <div className="grid grid-cols-2 gap-4 max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Заявки по месяцам</CardTitle>
        </CardHeader>
        <CardContent>
          <BarChart
            data={[
              { label: "Янв", value: 120 },
              { label: "Фев", value: 85 },
              { label: "Мар", value: 200 },
              { label: "Апр", value: 150 },
              { label: "Май", value: 175 },
            ]}
            height={160}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Статус взаимодействий</CardTitle>
        </CardHeader>
        <CardContent>
          <DonutChart
            data={[
              { label: "Активные", value: 5 },
              { label: "Завершённые", value: 9 },
              { label: "Ожидают", value: 3 },
            ]}
            size={140}
            strokeWidth={18}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Динамика</CardTitle>
        </CardHeader>
        <CardContent>
          <LineChart
            labels={["1", "2", "3", "4", "5", "6", "7"]}
            datasets={[
              { label: "Новые", data: [12, 19, 15, 25, 22, 30, 28] },
              { label: "Завершённые", data: [5, 8, 12, 15, 18, 20, 24] },
            ]}
            height={160}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Прогресс этапов</CardTitle>
        </CardHeader>
        <CardContent>
          <HorizontalBarChart
            data={[
              { label: "Контакты", value: 100 },
              { label: "Документы", value: 70 },
              { label: "Внедрение", value: 40 },
            ]}
          />
        </CardContent>
      </Card>

      <Card className="col-span-2">
        <CardHeader>
          <CardTitle className="text-sm">Общий прогресс</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-8">
            <Progress value={68} size="lg" showLabel className="flex-1" />
            <CircularProgress value={68} size={56} strokeWidth={5} />
          </div>
        </CardContent>
      </Card>
    </div>
  ),
}
