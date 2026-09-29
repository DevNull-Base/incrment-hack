import * as React from "react"
import { cn } from "cn"
import { AnimatedNumber } from "./animated-number"

// ========================================
// Progress — линейный прогресс-бар
// ========================================
interface ProgressProps extends React.ComponentProps<"div"> {
  value?: number
  max?: number
  size?: "sm" | "md" | "lg"
  color?: "primary" | "success" | "warning" | "destructive" | "info" | "accent"
  showLabel?: boolean
}

const PROGRESS_COLORS = {
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  info: "bg-info",
  accent: "bg-accent",
}

const PROGRESS_TRACK = "bg-muted"

const PROGRESS_SIZES = {
  sm: "h-1.5",
  md: "h-2.5",
  lg: "h-3.5",
}

function Progress({
  value = 0,
  max = 100,
  size = "md",
  color = "primary",
  showLabel = false,
  className,
  ...props
}: ProgressProps) {
  const pct = Math.min(Math.max((value / max) * 100, 0), 100)

  return (
    <div className={cn("w-full", className)} {...props}>
      {showLabel && (
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Прогресс</span>
          <span className="text-xs font-semibold tabular-nums">
            <AnimatedNumber value={Math.round(pct)} duration={700} />%
          </span>
        </div>
      )}
      <div
        className={cn(
          "w-full overflow-hidden rounded-full",
          PROGRESS_TRACK,
          PROGRESS_SIZES[size],
        )}
      >
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500 ease-out chart-grow-x",
            PROGRESS_COLORS[color],
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ========================================
// CircularProgress — круговой прогресс
// ========================================
interface CircularProgressProps {
  value?: number
  max?: number
  size?: number
  strokeWidth?: number
  color?: "primary" | "success" | "warning" | "destructive" | "info" | "accent"
  showLabel?: boolean
  className?: string
}

const CIRCLE_COLORS = {
  primary: "stroke-primary",
  success: "stroke-success",
  warning: "stroke-warning",
  destructive: "stroke-destructive",
  info: "stroke-info",
  accent: "stroke-accent",
}

function CircularProgress({
  value = 0,
  max = 100,
  size = 72,
  strokeWidth = 6,
  color = "primary",
  showLabel = true,
  className,
}: CircularProgressProps) {
  const pct = Math.min(Math.max((value / max) * 100, 0), 100)
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (pct / 100) * circumference

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          className="stroke-muted"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          className={cn(CIRCLE_COLORS[color], "transition-all duration-700 ease-out chart-pop")}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      {showLabel && (
        <span className="absolute text-xs font-semibold tabular-nums">
          <AnimatedNumber value={Math.round(pct)} duration={700} />%
        </span>
      )}
    </div>
  )
}

export { Progress, CircularProgress, type ProgressProps, type CircularProgressProps }
