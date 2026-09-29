import * as React from "react"
import { cn } from "cn"
import {
  Search,
  ArrowUpRight,
  Check,
  Users,
  Download,
  ArrowUpDown,
  Plus,
  ChevronLeft,
  ChevronRight,
  X,
  MoreHorizontal,
  CalendarDays,
  FileText,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DonutChart, BarChart } from "@/components/ui/chart"
import { Separator } from "@/components/ui/separator"

// ========================================
// KPI Cards
// ========================================
const kpiCards = [
  {
    title: "Выручка",
    value: "99 560 ₽",
    trend: "+2.1%",
    trendUp: true,
    color: "bg-blue-500/15 text-blue-400",
    iconColor: "bg-blue-500/20 text-blue-400",
  },
  {
    title: "Заказы",
    value: "35",
    trend: "-0.8%",
    trendUp: false,
    color: "bg-orange-500/15 text-orange-400",
    iconColor: "bg-orange-500/20 text-orange-400",
  },
  {
    title: "Посетители",
    value: "45 600",
    trend: "-1.2%",
    trendUp: false,
    color: "bg-red-500/15 text-red-400",
    iconColor: "bg-red-500/20 text-red-400",
  },
  {
    title: "Чистая прибыль",
    value: "60 450 ₽",
    trend: "+4.6%",
    trendUp: true,
    color: "bg-emerald-500/15 text-emerald-400",
    iconColor: "bg-emerald-500/20 text-emerald-400",
  },
]

// ========================================
// Revenue chart data
// ========================================
const revenueData = [
  { label: "1 авг", value: 18000 },
  { label: "2 авг", value: 12000 },
  { label: "3 авг", value: 20000 },
  { label: "4 авг", value: 16000 },
  { label: "5 авг", value: 15000 },
  { label: "6 авг", value: 18000 },
  { label: "7 авг", value: 22000 },
  { label: "8 авг", value: 19000 },
]

// ========================================
// Donut chart data
// ========================================
const salesData = [
  { label: "MacBook Air M2", value: 35, color: "fill-blue-500" },
  { label: "Watch Series 9", value: 25, color: "fill-orange-400" },
  { label: "JBL Charge 5", value: 15, color: "fill-yellow-400" },
  { label: "Divoom SongBird", value: 10, color: "fill-pink-400" },
  { label: "AirPods Pro 2", value: 5, color: "fill-red-500" },
]

// ========================================
// Order status cards
// ========================================
const orderStatuses = [
  { title: "Новые", count: 12, trend: "+3.8%", trendUp: true, accent: "border-l-blue-500", badge: "bg-blue-500/15 text-blue-400" },
  { title: "Ожидают", count: 20, trend: "-2.5%", trendUp: false, accent: "border-l-yellow-500", badge: "bg-yellow-500/15 text-yellow-400" },
  { title: "В пути", count: 57, trend: "-1.6%", trendUp: false, accent: "border-l-orange-500", badge: "bg-orange-500/15 text-orange-400" },
  { title: "Доставлены", count: 98, trend: "+8.2%", trendUp: true, accent: "border-l-emerald-500", badge: "bg-emerald-500/15 text-emerald-400" },
]

// ========================================
// Table data
// ========================================
const orders = Array.from({ length: 8 }, (_, i) => ({
  id: `№6а83${i}`,
  customer: "Kris Poyer",
  phone: "099-758-9092",
  category: "Ноутбуки",
  price: "1 302,38 ₽",
  date: "26.07.2024",
  payment: "PayPal",
  status: i % 3 === 0 ? "В пути" : "Доставлен",
}))

const statusColors: Record<string, string> = {
  "В пути": "bg-orange-500/20 text-orange-400",
  "Доставлен": "bg-emerald-500/20 text-emerald-400",
  "Новый": "bg-blue-500/20 text-blue-400",
}

export function Demo2Page() {
  const [filters, setFilters] = React.useState(["Ноутбуки", "PayPal"])

  return (
    <div className="space-y-8">
      {/* ======================================== */}
      {/* Greeting */}
      {/* ======================================== */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Привет, Барбара! <span className="inline-block animate-[wave_0.5s_ease-in-out]">👋</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Вот что происходит в вашем магазине в этом месяце
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="rounded-full px-3 py-1 text-xs gap-1.5">
            <CalendarDays className="size-3.5" />
            Этот месяц
          </Badge>
        </div>
      </div>

      {/* ======================================== */}
      {/* KPI Grid: 2×2 cards + Revenue Chart */}
      {/* ======================================== */}
      <div className="grid grid-cols-3 gap-4">
        {/* Left: 2×2 KPI cards */}
        <div className="col-span-1 grid grid-cols-2 gap-4">
          {kpiCards.map((kpi) => (
            <Card key={kpi.title} className="relative overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className={cn("flex size-8 items-center justify-center rounded-lg", kpi.iconColor)}>
                    <span className="text-xs font-bold">₽</span>
                  </div>
                  <Button variant="ghost" size="icon-xs" className="text-muted-foreground">
                    <ArrowUpRight className="size-3.5" />
                  </Button>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">{kpi.title}</p>
                <p className="mt-1 text-xl font-bold tabular-nums">{kpi.value}</p>
                <div className="mt-2 flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                      kpi.trendUp
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-red-500/15 text-red-400",
                    )}
                  >
                    {kpi.trendUp ? "▲" : "▼"} {kpi.trend}
                  </span>
                  <span className="text-[10px] text-muted-foreground">к прошлому мес.</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Right: Revenue chart */}
        <Card className="col-span-2">
          <CardHeader className="flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-base">Выручка</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Этот месяц vs прошлый</p>
            </div>
            <Button variant="ghost" size="icon-xs" className="text-muted-foreground">
              <ArrowUpRight className="size-3.5" />
            </Button>
          </CardHeader>
          <CardContent className="pb-4">
            <BarChart data={revenueData} height={220} />
          </CardContent>
        </Card>
      </div>

      {/* ======================================== */}
      {/* Middle Row: Stats + Donut */}
      {/* ======================================== */}
      <div className="grid grid-cols-3 gap-4">
        {/* Left: Order/Completion stats */}
        <Card className="col-span-1">
          <CardContent className="p-5 space-y-5">
            {/* Completed orders */}
            <div className="flex items-start gap-4">
              <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/15">
                <Check className="size-5 text-emerald-400" />
              </div>
              <div className="flex-1">
                <p className="text-2xl font-bold">98 <span className="text-sm font-normal text-muted-foreground">заказов</span></p>
                <p className="mt-1 text-xs text-muted-foreground">
                  12 заказов <span className="text-orange-400 font-medium">ожидают</span> подтверждения
                </p>
              </div>
            </div>

            <Separator />

            {/* Customers */}
            <div className="flex items-start gap-4">
              <div className="flex size-10 items-center justify-center rounded-xl bg-blue-500/15">
                <Users className="size-5 text-blue-400" />
              </div>
              <div className="flex-1">
                <p className="text-2xl font-bold">17 <span className="text-sm font-normal text-muted-foreground">клиентов</span></p>
                <p className="mt-1 text-xs text-muted-foreground">
                  17 клиентов <span className="text-orange-400 font-medium">ждут</span> ответа
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Right: Sales by Category donut */}
        <Card className="col-span-2">
          <CardHeader className="flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-base">Продажи по категориям</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Этот месяц vs прошлый</p>
            </div>
            <Button variant="ghost" size="icon-xs" className="text-muted-foreground">
              <ArrowUpRight className="size-3.5" />
            </Button>
          </CardHeader>
          <CardContent className="pb-4">
            <DonutChart data={salesData} size={180} strokeWidth={22} />
          </CardContent>
        </Card>
      </div>

      {/* ======================================== */}
      {/* Order List Section */}
      {/* ======================================== */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold">Список заказов</h2>

        {/* Status cards */}
        <div className="grid grid-cols-4 gap-4">
          {orderStatuses.map((s) => (
            <Card key={s.title} className={cn("border-l-[3px]", s.accent)}>
              <CardContent className="p-4">
                <Badge className={cn("rounded-full text-[10px] font-medium", s.badge)} variant="secondary">
                  {s.title}
                </Badge>
                <p className="mt-2 text-3xl font-bold tabular-nums">{s.count}</p>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span
                    className={cn(
                      "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                      s.trendUp
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-red-500/15 text-red-400",
                    )}
                  >
                    {s.trendUp ? "▲" : "▼"} {s.trend}
                  </span>
                  <span className="text-[10px] text-muted-foreground">к прошлой неделе</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative max-w-xs flex-1">
              <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Поиск..." className="h-9 pl-9 rounded-full text-sm" />
            </div>
            <span className="text-sm text-muted-foreground">180 заказов</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground">
              <Download className="size-3.5" />
              Экспорт
            </Button>
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground">
              <ArrowUpDown className="size-3.5" />
              Сортировка
            </Button>
            <Button size="sm" className="gap-1.5 rounded-full">
              <Plus className="size-3.5" />
              Добавить
            </Button>
          </div>
        </div>

        {/* Active filters */}
        {filters.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Фильтры:</span>
            {filters.map((f) => (
              <Badge
                key={f}
                variant="secondary"
                className="rounded-full gap-1 pr-1.5 cursor-pointer hover:bg-muted"
                onClick={() => setFilters((prev) => prev.filter((x) => x !== f))}
              >
                {f}
                <X className="size-3" />
              </Badge>
            ))}
            <button
              onClick={() => setFilters([])}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-1"
            >
              Очистить ({filters.length})
            </button>
          </div>
        )}

        {/* Table */}
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="w-10 px-4 py-3">
                    <input type="checkbox" className="size-3.5 rounded border-border" />
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Заказ
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Клиент
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Категория
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Цена
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Дата
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Оплата
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Статус
                  </th>
                  <th className="w-10 px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {orders.map((order, i) => (
                  <tr
                    key={i}
                    className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <input type="checkbox" className="size-3.5 rounded border-border" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="flex size-6 items-center justify-center rounded bg-blue-500/15">
                          <FileText className="size-3 text-blue-400" />
                        </span>
                        <span className="text-sm font-medium">{order.id}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium">{order.customer}</p>
                      <p className="text-xs text-muted-foreground">{order.phone}</p>
                    </td>
                    <td className="px-4 py-3 text-sm">{order.category}</td>
                    <td className="px-4 py-3 text-sm font-medium tabular-nums">{order.price}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground tabular-nums">{order.date}</td>
                    <td className="px-4 py-3 text-sm">{order.payment}</td>
                    <td className="px-4 py-3">
                      <Badge
                        className={cn(
                          "rounded-full text-[10px] font-medium",
                          statusColors[order.status] || "bg-muted text-muted-foreground",
                        )}
                        variant="secondary"
                      >
                        {order.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Button variant="ghost" size="icon-xs" className="text-muted-foreground">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <span className="text-xs text-muted-foreground">Показано 8 из 180</span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon-xs" disabled>
                <ChevronLeft className="size-3.5" />
              </Button>
              <span className="text-xs text-muted-foreground">1 из 23</span>
              <Button variant="ghost" size="icon-xs">
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
