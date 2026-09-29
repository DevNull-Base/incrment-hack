import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown } from "lucide-react"
import { matchesQuery } from "@/shared/lib/search"
import { cn } from "@/lib/utils"

export interface MultiSelectOption {
  value: string
  label: string
  hint?: string
}

/**
 * Выбор нескольких значений с поиском по списку. Ничего не выбрано —
 * отбора нет («все»): так отбор читается и в отчёте, и в API.
 */
export function MultiSelect({
  label,
  options,
  value,
  onChange,
  className,
  emptyLabel = "все",
}: {
  label: string
  options: readonly MultiSelectOption[]
  value: readonly string[]
  onChange: (next: string[]) => void
  className?: string
  /** Подпись пустого выбора: «все» для отбора, «ничего» для разрешений. */
  emptyLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  // Escape закрывает только список: внутри диалога он иначе закрыл бы
  // и сам диалог, а с ним — несохранённый выбор.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape" && open) {
      event.stopPropagation()
      event.preventDefault()
      setOpen(false)
    }
  }

  const visible = useMemo(() => options.filter((o) => matchesQuery(query, [o.label, o.hint])), [options, query])
  const selected = new Set(value)
  const toggle = (v: string) => onChange(selected.has(v) ? value.filter((x) => x !== v) : [...value, v])

  const summary =
    value.length === 0
      ? `${label}: ${emptyLabel}`
      : value.length === 1
        ? options.find((o) => o.value === value[0])?.label ?? `${label}: 1`
        : `${label}: ${value.length}`

  return (
    <div ref={boxRef} className={cn("relative", className)} onKeyDown={onKeyDown}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-lg border bg-transparent px-2.5 text-left text-sm",
          value.length > 0 && "border-primary/50 text-primary",
        )}
      >
        <span className="truncate">{summary}</span>
        <ChevronDown className="size-4 shrink-0 opacity-60" />
      </button>
      {open && (
        <div className="absolute left-0 top-10 z-40 w-72 max-w-[85vw] rounded-lg border bg-card p-2 shadow-lg">
          {options.length > 8 && (
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Найти…"
              aria-label={`Найти: ${label}`}
              className="mb-2 h-8 w-full rounded-md border bg-transparent px-2 text-sm"
            />
          )}
          <div role="listbox" aria-multiselectable className="max-h-64 space-y-0.5 overflow-y-auto">
            {visible.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">Ничего не найдено</p>}
            {visible.map((o) => (
              <label
                key={o.value}
                className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={selected.has(o.value)}
                  onChange={() => toggle(o.value)}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                />
                <span className="min-w-0">
                  <span className="block truncate">{o.label}</span>
                  {o.hint && <span className="block truncate text-xs text-muted-foreground">{o.hint}</span>}
                </span>
              </label>
            ))}
          </div>
          {value.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-2 w-full rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
            >
              Снять выбор
            </button>
          )}
        </div>
      )}
    </div>
  )
}
