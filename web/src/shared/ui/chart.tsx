import * as React from "react"
import { cn } from "cn"

// ========================================
// Утилита контрастности текста
// ========================================
const COLOR_BRIGHTNESS: Record<string, number> = {
  "fill-primary": 0.52,
  "fill-accent": 0.60,
  "fill-success": 0.62,
  "fill-info": 0.60,
  "fill-warning": 0.72,
  "fill-destructive": 0.55,
  "fill-muted": 0.95,
  "bg-primary": 0.52,
  "bg-accent": 0.60,
  "bg-success": 0.62,
  "bg-info": 0.60,
  "bg-warning": 0.72,
  "bg-destructive": 0.55,
  "bg-muted": 0.95,
}

const DARK_THRESHOLD = 0.65

function getContrastText(colorClass: string): string {
  const brightness = COLOR_BRIGHTNESS[colorClass]
  if (brightness === undefined) return "text-foreground"
  return brightness < DARK_THRESHOLD ? "text-white" : "text-foreground"
}

function getContrastSvgText(colorClass: string): string {
  const brightness = COLOR_BRIGHTNESS[colorClass]
  if (brightness === undefined) return "fill-foreground"
  return brightness < DARK_THRESHOLD ? "fill-white" : "fill-foreground"
}

// ========================================
// ChartTooltip — ховер-подсказка с跟随 курсора
// ========================================
interface TooltipState {
  visible: boolean
  x: number
  y: number
  label: string
  value: string | number
  extra?: string
}

const INITIAL_TOOLTIP: TooltipState = {
  visible: false,
  x: 0,
  y: 0,
  label: "",
  value: 0,
}

function ChartTooltip({
  state,
}: {
  state: TooltipState
}) {
  if (!state.visible) return null

  return (
    <div
      className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full"
      style={{ left: state.x, top: state.y - 12 }}
    >
      <div className="rounded-lg bg-foreground px-3 py-2 shadow-lg">
        <p className="text-[11px] font-medium text-background/70">{state.label}</p>
        <p className="text-sm font-bold text-background tabular-nums">{state.value}</p>
        {state.extra && (
          <p className="text-[10px] text-background/60 mt-0.5">{state.extra}</p>
        )}
      </div>
      <div className="mx-auto size-2 -mt-1 rotate-45 bg-foreground" />
    </div>
  )
}

function useChartTooltip() {
  const [tip, setTip] = React.useState<TooltipState>(INITIAL_TOOLTIP)

  const show = (e: React.MouseEvent, data: { label: string; value: string | number; extra?: string }) => {
    setTip({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      ...data,
    })
  }

  const move = (e: React.MouseEvent) => {
    setTip((prev) =>
      prev.visible
        ? { ...prev, x: e.clientX, y: e.clientY }
        : prev,
    )
  }

  const hide = () => setTip(INITIAL_TOOLTIP)

  return { tip, show, move, hide }
}

// ========================================
// Типы
// ========================================
interface ChartDataPoint {
  label: string
  value: number
  color?: string
}

interface ChartDataset {
  label: string
  data: number[]
  color?: string
}

// ========================================
// BarChart — столбчатая диаграмма
// ========================================
interface BarChartProps {
  data: ChartDataPoint[]
  height?: number
  showValues?: boolean
  showGrid?: boolean
  className?: string
}

const BAR_PALETTE = [
  "fill-primary",
  "fill-accent",
  "fill-success",
  "fill-info",
  "fill-warning",
  "fill-destructive",
]

function BarChart({
  data,
  height = 220,
  showValues = true,
  showGrid = true,
  className,
}: BarChartProps) {
  const maxVal = Math.max(...data.map((d) => d.value), 1)
  const barWidth = Math.min(48, (100 / data.length) * 0.65)
  const gap = 100 / data.length
  const { tip, show, move, hide } = useChartTooltip()

  return (
    <div
      className={cn("w-full relative", className)}
      onMouseMove={move}
      onMouseLeave={hide}
    >
      <svg viewBox="0 0 100 60" className="w-full" style={{ height }}>
        {showGrid &&
          [0, 25, 50, 75, 100].map((pct) => {
            const y = 55 - (pct / 100) * 50
            return (
              <g key={pct}>
                <line
                  x1="0" y1={y} x2="100" y2={y}
                  className="stroke-border" strokeWidth="0.15" strokeDasharray="1 1"
                />
                <text
                  x="-1" y={y + 1}
                  className="fill-muted-foreground" fontSize="3.5" textAnchor="end"
                >
                  {Math.round((pct / 100) * maxVal)}
                </text>
              </g>
            )
          })}

        {data.map((d, i) => {
          const barH = (d.value / maxVal) * 50
          const x = gap * i + (gap - barWidth) / 2
          const y = 55 - barH
          const color = d.color || BAR_PALETTE[i % BAR_PALETTE.length]
          const svgTextClass = getContrastSvgText(color)
          const showInside = barH > 12

          return (
            <g
              key={i}
              onMouseEnter={(e) => show(e, { label: d.label, value: d.value })}
              onMouseLeave={hide}
              className="cursor-pointer"
            >
              <rect
                x={x} y={y} width={barWidth} height={barH} rx="2.5"
                className={cn(color, "opacity-75 hover:opacity-100 transition-opacity chart-grow-y")}
                style={{ animationDelay: `${i * 60}ms` }}
              />
              {showValues && showInside && (
                <text
                  x={x + barWidth / 2} y={y + barH / 2 + 1.2}
                  className={cn(svgTextClass, "opacity-90")}
                  fontSize="3.5" fontWeight="700" textAnchor="middle"
                >
                  {d.value}
                </text>
              )}
              {showValues && !showInside && (
                <text
                  x={x + barWidth / 2} y={y - 1.2}
                  className="fill-foreground" fontSize="3.5" fontWeight="600" textAnchor="middle"
                >
                  {d.value}
                </text>
              )}
              <text
                x={x + barWidth / 2} y="58.5"
                className="fill-muted-foreground" fontSize="3.2" textAnchor="middle"
              >
                {d.label}
              </text>
            </g>
          )
        })}
      </svg>
      <ChartTooltip state={tip} />
    </div>
  )
}

// ========================================
// LineChart — линейная диаграмма
// ========================================
interface LineChartProps {
  datasets: ChartDataset[]
  labels: string[]
  height?: number
  showDots?: boolean
  showGrid?: boolean
  showArea?: boolean
  className?: string
}

const LINE_PALETTE_STROKE = [
  "stroke-primary",
  "stroke-accent",
  "stroke-success",
  "stroke-info",
  "stroke-warning",
]

const LINE_PALETTE_FILL = [
  "fill-primary/10",
  "fill-accent/10",
  "fill-success/10",
  "fill-info/10",
  "fill-warning/10",
]

function LineChart({
  datasets,
  labels,
  height = 220,
  showDots = true,
  showGrid = true,
  showArea = true,
  className,
}: LineChartProps) {
  const allValues = datasets.flatMap((ds) => ds.data)
  const maxVal = Math.max(...allValues, 1)
  const minVal = 0
  const range = maxVal - minVal || 1

  const chartW = 100
  const topPad = 2
  const bottomPad = 55
  const leftPad = 5
  const usableW = chartW - leftPad
  const usableH = bottomPad - topPad

  const { tip, show, move, hide } = useChartTooltip()

  const getX = (i: number, total: number) =>
    leftPad + (total <= 1 ? usableW / 2 : (i / (total - 1)) * usableW)
  const getY = (val: number) =>
    topPad + usableH - ((val - minVal) / range) * usableH

  return (
    <div
      className={cn("w-full relative", className)}
      onMouseMove={move}
      onMouseLeave={hide}
    >
      <svg viewBox={`-6 -2 ${chartW + 6} ${bottomPad + 4}`} className="w-full" style={{ height }}>
        {showGrid &&
          [0, 25, 50, 75, 100].map((pct) => {
            const y = topPad + usableH - (pct / 100) * usableH
            return (
              <g key={pct}>
                <line
                  x1={leftPad} y1={y} x2={chartW} y2={y}
                  className="stroke-border" strokeWidth="0.15" strokeDasharray="1 1"
                />
                <text
                  x={leftPad - 1} y={y + 1}
                  className="fill-muted-foreground" fontSize="3.5" textAnchor="end"
                >
                  {Math.round(minVal + (pct / 100) * range)}
                </text>
              </g>
            )
          })}

        {labels.map((label, i) => (
          <text
            key={i}
            x={getX(i, labels.length)} y={bottomPad + 3}
            className="fill-muted-foreground" fontSize="3.2" textAnchor="middle"
          >
            {label}
          </text>
        ))}

        {datasets.map((ds, dsIdx) => {
          const points = ds.data.map((v, i) => ({
            x: getX(i, ds.data.length),
            y: getY(v),
            val: v,
          }))

          const pathD = points
            .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
            .join(" ")

          const areaD =
            pathD + ` L ${points[points.length - 1].x} ${bottomPad} L ${points[0].x} ${bottomPad} Z`

          const strokeColor = ds.color || LINE_PALETTE_STROKE[dsIdx % LINE_PALETTE_STROKE.length]
          const fillColor = LINE_PALETTE_FILL[dsIdx % LINE_PALETTE_FILL.length]

          return (
            <g key={dsIdx} className="chart-fade">
              {showArea && (
                <path d={areaD} className={cn(fillColor, "opacity-60")} />
              )}
              <path
                d={pathD} className={cn(strokeColor, "chart-draw")} fill="none" pathLength={1}
                strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"
              />
              {showDots &&
                points.map((p, i) => (
                  <circle
                    key={i}
                    cx={p.x} cy={p.y} r="2.5"
                    className={cn(strokeColor, "fill-card stroke-2 cursor-pointer")}
                    onMouseEnter={(e) => show(e, { label: ds.label, value: p.val, extra: labels[i] })}
                    onMouseLeave={hide}
                  />
                ))}
            </g>
          )
        })}
      </svg>
      <ChartTooltip state={tip} />
    </div>
  )
}

// ========================================
// DonutChart — кольцевая диаграмма
// ========================================
interface DonutChartProps {
  data: ChartDataPoint[]
  size?: number
  strokeWidth?: number
  showLegend?: boolean
  className?: string
}

const DONUT_PALETTE = [
  "fill-primary",
  "fill-accent",
  "fill-success",
  "fill-info",
  "fill-warning",
  "fill-destructive",
]

function DonutChart({
  data,
  size = 160,
  strokeWidth = 20,
  showLegend = true,
  className,
}: DonutChartProps) {
  const total = data.reduce((s, d) => d.value + s, 0) || 1
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  const dominantIdx = data.reduce(
    (maxI, d, i, arr) => (d.value > arr[maxI].value ? i : maxI),
    0,
  )
  const dominantColor = data[dominantIdx]?.color || DONUT_PALETTE[dominantIdx % DONUT_PALETTE.length]
  const centerTextClass = getContrastText(dominantColor)
  const centerBgClass = dominantColor

  const { tip, show, move, hide } = useChartTooltip()

  let accumulated = 0

  return (
    <div
      className={cn("flex items-center gap-6 relative", className)}
      onMouseMove={move}
      onMouseLeave={hide}
    >
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          {data.map((d, i) => {
            const pct = d.value / total
            const dashLen = pct * circumference
            const dashOff = -accumulated * circumference
            accumulated += pct
            const color = d.color || DONUT_PALETTE[i % DONUT_PALETTE.length]

            return (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                className={cn(color, "transition-all duration-500 cursor-pointer hover:opacity-80 chart-pop")}
                style={{ animationDelay: `${i * 80}ms` }}
                strokeWidth={strokeWidth}
                strokeDasharray={`${dashLen} ${circumference - dashLen}`}
                strokeDashoffset={dashOff}
                strokeLinecap="butt"
                onMouseEnter={(e) => show(e, { label: d.label, value: `${d.value} (${(pct * 100).toFixed(1)}%)` })}
                onMouseLeave={hide}
              />
            )
          })}
        </svg>
        <div
          className={cn(
            "absolute inset-0 flex flex-col items-center justify-center rounded-full transition-colors duration-300",
            centerBgClass,
          )}
          style={{ margin: strokeWidth * 0.6 }}
        >
          <span className={cn("text-lg font-bold tabular-nums", centerTextClass)}>
            {total}
          </span>
          <span className={cn("text-xs", centerTextClass, "opacity-80")}>
            всего
          </span>
        </div>
      </div>

      {showLegend && (
        <div className="space-y-2.5">
          {data.map((d, i) => {
            const pct = ((d.value / total) * 100).toFixed(1)
            const color = d.color || DONUT_PALETTE[i % DONUT_PALETTE.length]
            const dotTextClass = getContrastText(color)
            return (
              <div key={i} className="flex items-center gap-3">
                <span
                  className={cn(
                    "flex size-6 items-center justify-center rounded-md text-xs font-bold shrink-0",
                    color,
                    dotTextClass,
                  )}
                >
                  {d.value}
                </span>
                <span className="text-sm font-medium text-foreground">{d.label}</span>
                <span className="text-sm text-muted-foreground tabular-nums ml-auto">
                  {pct}%
                </span>
              </div>
            )
          })}
        </div>
      )}

      <ChartTooltip state={tip} />
    </div>
  )
}

// ========================================
// HorizontalBarChart — горизонтальные полосы
// ========================================
interface HorizontalBarChartProps {
  data: ChartDataPoint[]
  height?: number
  showValues?: boolean
  className?: string
}

const HBAR_PALETTE = [
  "bg-primary",
  "bg-accent",
  "bg-success",
  "bg-info",
  "bg-warning",
  "bg-destructive",
]

function HorizontalBarChart({
  data,
  height,
  showValues = true,
  className,
}: HorizontalBarChartProps) {
  const maxVal = Math.max(...data.map((d) => d.value), 1)
  const { tip, show, move, hide } = useChartTooltip()

  return (
    <div
      className={cn("w-full space-y-3 relative", className)}
      style={height ? { height } : undefined}
      onMouseMove={move}
      onMouseLeave={hide}
    >
      {data.map((d, i) => {
        const pct = (d.value / maxVal) * 100
        const color = d.color || HBAR_PALETTE[i % HBAR_PALETTE.length]
        const textClass = getContrastText(color)
        const showInside = pct > 25

        return (
          <div
            key={i}
            className="cursor-pointer"
            onMouseEnter={(e) => show(e, { label: d.label, value: d.value, extra: `${Math.round(pct)}% от максимума` })}
            onMouseLeave={hide}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-medium">{d.label}</span>
              {showValues && !showInside && (
                <span className="text-sm font-semibold tabular-nums text-muted-foreground">
                  {d.value}
                </span>
              )}
            </div>
            <div className="relative h-8 w-full overflow-hidden rounded-xl bg-muted">
              <div
                className={cn(
                  "absolute inset-y-0 left-0 flex items-center justify-end rounded-lg px-2.5 transition-all duration-700 ease-out",
                  color,
                  "chart-grow-x",
                )}
                style={{ width: `${pct}%`, animationDelay: `${i * 60}ms` }}
              >
                {showValues && showInside && (
                  <span className={cn("text-xs font-bold tabular-nums", textClass)}>
                    {d.value}
                  </span>
                )}
              </div>
            </div>
          </div>
        )
      })}
      <ChartTooltip state={tip} />
    </div>
  )
}

// ========================================
// SparkLine — мини-график
// ========================================
interface SparkLineProps {
  data: number[]
  color?: "primary" | "success" | "warning" | "destructive" | "info" | "accent"
  width?: number
  height?: number
  className?: string
}

const SPARK_COLORS = {
  primary: { stroke: "stroke-primary", fill: "fill-primary/15" },
  success: { stroke: "stroke-success", fill: "fill-success/15" },
  warning: { stroke: "stroke-warning", fill: "fill-warning/15" },
  destructive: { stroke: "stroke-destructive", fill: "fill-destructive/15" },
  info: { stroke: "stroke-info", fill: "fill-info/15" },
  accent: { stroke: "stroke-accent", fill: "fill-accent/15" },
}

function SparkLine({
  data,
  color = "primary",
  width = 120,
  height = 32,
  className,
}: SparkLineProps) {
  if (data.length < 2) return null

  const maxVal = Math.max(...data)
  const minVal = Math.min(...data)
  const range = maxVal - minVal || 1

  const getX = (i: number) => (i / (data.length - 1)) * width
  const getY = (v: number) => height - 2 - ((v - minVal) / range) * (height - 4)

  const pathD = data
    .map((v, i) => `${i === 0 ? "M" : "L"} ${getX(i)} ${getY(v)}`)
    .join(" ")

  const areaD =
    pathD + ` L ${width} ${height} L 0 ${height} Z`

  const colors = SPARK_COLORS[color]

  return (
    <div className={cn("inline-block", className)}>
      <svg width={width} height={height}>
        <path d={areaD} className={cn(colors.fill, "chart-fade")} />
        <path d={pathD} className={cn(colors.stroke, "chart-draw")} pathLength={1} fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

export {
  BarChart,
  LineChart,
  DonutChart,
  HorizontalBarChart,
  SparkLine,
  useChartTooltip,
  ChartTooltip,
  type TooltipState,
  type BarChartProps,
  type LineChartProps,
  type DonutChartProps,
  type HorizontalBarChartProps,
  type SparkLineProps,
  type ChartDataPoint,
  type ChartDataset,
}
