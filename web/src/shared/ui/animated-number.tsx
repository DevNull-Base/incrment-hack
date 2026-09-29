import * as React from "react"

interface UseCountUpOptions {
  duration?: number
  delay?: number
  enabled?: boolean
}

/** Плавный отсчёт от нуля к значению при появлении. Уважает prefers-reduced-motion. */
export function useCountUp(
  target: number,
  { duration = 900, delay = 0, enabled = true }: UseCountUpOptions = {},
): number {
  const [value, setValue] = React.useState(enabled ? 0 : target)

  React.useEffect(() => {
    if (!enabled || !Number.isFinite(target)) {
      setValue(target)
      return
    }
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reduce) {
      setValue(target)
      return
    }

    let raf = 0
    setValue(0)
    const timer = window.setTimeout(() => {
      const start = performance.now()
      const step = (now: number) => {
        const p = Math.min((now - start) / duration, 1)
        const eased = 1 - Math.pow(1 - p, 3)
        setValue(Math.round(target * eased))
        if (p < 1) raf = requestAnimationFrame(step)
      }
      raf = requestAnimationFrame(step)
    }, delay)

    return () => {
      window.clearTimeout(timer)
      cancelAnimationFrame(raf)
    }
  }, [target, duration, delay, enabled])

  return value
}

interface AnimatedNumberProps {
  value: number | string
  duration?: number
  delay?: number
  className?: string
}

/** Число с анимацией от нуля. Строки («—», «3 из 5») рендерятся как есть. */
export function AnimatedNumber({
  value,
  duration = 900,
  delay = 0,
  className,
}: AnimatedNumberProps) {
  const numeric = typeof value === "number" && Number.isFinite(value)
  const count = useCountUp(numeric ? value : 0, { duration, delay, enabled: numeric })
  return <span className={className}>{numeric ? count : value}</span>
}
