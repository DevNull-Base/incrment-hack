import { cn } from "cn"

export interface FilterChipOption<T extends string> {
  value: T
  label: string
  count?: number
}

interface FilterChipsProps<T extends string> {
  options: readonly FilterChipOption<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel?: string
}

/**
 * Чипы-тумблеры фильтра (паттерн переключателя сегментов):
 * единая группа, активный — filled primary.
 */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: FilterChipsProps<T>) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg border p-1" role="group" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
            value === opt.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {opt.label}
          {opt.count !== undefined && (
            <span className="ml-1 tabular-nums opacity-70">{opt.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}
