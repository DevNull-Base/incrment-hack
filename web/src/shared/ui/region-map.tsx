import * as React from "react"
import { cn } from "cn"
import { Maximize2, Minimize2 } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "./sheet"
import { AnimatedNumber } from "./animated-number"
import { ChartTooltip, useChartTooltip } from "./chart"
import { levelRanges, regionLevel } from "./region-map-levels"

// ========================================
// RegionMap — SVG-карта регионов России с хороплетом, тултипом,
// панелью статистики региона, CSV-выгрузкой и полноэкранным режимом.
// Источник карты: "ISO codes of subjects of Russia.svg" (Gajmar,
// Wikimedia Commons, CC0 / Public Domain Dedication).
// ========================================
export interface RegionMapStat {
  region: string
  universityCount: number
  interactionCount: number
  overdueCount: number
  /** Обучаются сейчас — сумма по идущим потокам вузов региона. */
  studentsCount: number
  applicationCount: number
  universities: { name: string; city?: string }[]
}

/** Показатель, по которому раскрашиваются регионы. */
export type RegionMapMetric = "universityCount" | "interactionCount" | "overdueCount" | "studentsCount" | "applicationCount"

export interface RegionMapProps {
  stats: RegionMapStat[]
  className?: string
  /** Раскраска по показателю: чем больше значение, тем насыщеннее регион. Без него — «есть вузы / нет». */
  metric?: RegionMapMetric
  /** Подпись показателя в подсказке и легенде. */
  metricLabel?: string
  title?: string
}

/** Ступени раскраски: четыре уровня насыщенности от меньших значений к большим. */
const LEVEL_CLASSES = [
  "fill-primary/15 stroke-primary/40 hover:fill-primary/25",
  "fill-primary/30 stroke-primary/50 hover:fill-primary/40",
  "fill-primary/50 stroke-primary/60 hover:fill-primary/60",
  "fill-primary/75 stroke-primary/80 hover:fill-primary/85",
]
const LEVEL_SWATCHES = [
  "border-primary/40 bg-primary/15",
  "border-primary/50 bg-primary/30",
  "border-primary/60 bg-primary/50",
  "border-primary/80 bg-primary/75",
]
const EMPTY_FILL = "fill-card stroke-border hover:fill-primary/10"

/** Коды ISO 3166-2:RU → русские названия (по данным самой карты). */
const REGION_NAMES: Record<string, string> = {
  AD: "Адыгея",
  AL: "Республика Алтай",
  ALT: "Алтайский край",
  AMU: "Амурская область",
  ARK: "Архангельская область",
  AST: "Астраханская область",
  BA: "Башкортостан",
  BEL: "Белгородская область",
  BRY: "Брянская область",
  BU: "Республика Бурятия",
  CE: "Чеченская Республика",
  CHE: "Челябинская область",
  CHU: "Чукотский автономный округ",
  CU: "Чувашская Республика",
  DA: "Республика Дагестан",
  IRK: "Иркутская область",
  IVA: "Ивановская область",
  KB: "Кабардино-Балкарская Республика",
  KC: "Карачаево-Черкесская Республика",
  KDA: "Краснодарский край",
  KEM: "Кемеровская область",
  KGD: "Калининградская область",
  KGN: "Курганская область",
  KHA: "Республика Хакасия",
  KHM: "Ханты-Мансийский автономный округ",
  KIR: "Кировская область",
  KK: "Республика Калмыкия",
  KLU: "Калужская область",
  KOS: "Костромская область",
  KRS: "Курская область",
  KYA: "Красноярский край",
  LEN: "Ленинградская область",
  LIP: "Липецкая область",
  MAG: "Магаданская область",
  ME: "Республика Марий Эл",
  MO: "Республика Мордовия",
  MOS: "Московская область",
  MOW: "Москва",
  MUR: "Мурманская область",
  NEN: "Ненецкий автономный округ",
  NGR: "Новгородская область",
  NIZ: "Нижегородская область",
  NVS: "Новосибирская область",
  OMS: "Омская область",
  ORE: "Оренбургская область",
  ORL: "Орловская область",
  PER: "Пермский край",
  PNZ: "Пензенская область",
  PRI: "Приморский край",
  PSK: "Псковская область",
  ROS: "Ростовская область",
  RYA: "Рязанская область",
  SA: "Республика Саха (Якутия)",
  SAK: "Сахалинская область",
  SAM: "Самарская область",
  SAR: "Саратовская область",
  SE: "Республика Северная Осетия — Алания",
  SMO: "Смоленская область",
  SPE: "Санкт-Петербург",
  STA: "Ставропольский край",
  SVE: "Свердловская область",
  TA: "Республика Татарстан",
  TAM: "Тамбовская область",
  TOM: "Томская область",
  TUL: "Тульская область",
  TVE: "Тверская область",
  TY: "Республика Тыва",
  TYU: "Тюменская область",
  UD: "Удмуртская Республика",
  ULY: "Ульяновская область",
  VGG: "Волгоградская область",
  VLA: "Владимирская область",
  VLG: "Вологодская область",
  VOR: "Воронежская область",
  YAN: "Ямало-Ненецкий автономный округ",
  YAR: "Ярославская область",
  YEV: "Еврейская автономная область",
  Zabaykalsky: "Забайкальский край",
}

/** Сопредельные страны на карте — отдельный тон, без статистики. */
const FOREIGN_IDS = new Set([
  "AM", "AZ", "BY", "CN", "DK", "EE", "FI", "GE", "IQ", "IR",
  "JP", "KP", "KR", "KZ", "LT", "LV", "MN", "NO", "PL", "SE",
  "TM", "TR", "UA", "US", "UZ",
])

const SKIP_IDS = new Set(["District_Outline", "Other_State_Boundarys", "g4164"])
const STRUCTURAL_ID = /^(rect|text|path\d|polygon\d|g\d)/

function normalizeRegion(value: string): string {
  return value.trim().toLowerCase().replace(/^республика\s+/, "")
}

const NORM_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(REGION_NAMES).map(([code, name]) => [normalizeRegion(name), code]),
)

interface MapRegion {
  code: string
  name: string
  paths: string[]
}

interface ParsedMap {
  viewBox: string
  regions: MapRegion[]
  rfBase: string[]
  foreign: string[]
}

async function loadRussiaMap(): Promise<ParsedMap> {
  const res = await fetch("/maps/russia-subjects.svg")
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = await res.text()
  const doc = new DOMParser().parseFromString(text, "image/svg+xml")
  const svg = doc.documentElement
  const viewBox = svg.getAttribute("viewBox") ?? "0 0 1091.992 630.119"

  const claimed = new Set<Element>()
  const regions: MapRegion[] = []
  for (const el of Array.from(svg.querySelectorAll("[id]"))) {
    const id = el.getAttribute("id") ?? ""
    const name = REGION_NAMES[id]
    if (!name) continue
    const paths: string[] = []
    const sources =
      el.tagName.toLowerCase() === "path" ? [el] : Array.from(el.querySelectorAll("path"))
    for (const p of sources) {
      const d = p.getAttribute("d")
      if (d) {
        paths.push(d)
        claimed.add(p)
      }
    }
    if (paths.length > 0) regions.push({ code: id, name, paths })
  }

  const foreignSet = new Set<Element>()
  for (const el of Array.from(svg.querySelectorAll("[id]"))) {
    const id = el.getAttribute("id") ?? ""
    if (!FOREIGN_IDS.has(id)) continue
    const sources =
      el.tagName.toLowerCase() === "path" ? [el] : Array.from(el.querySelectorAll("path"))
    for (const p of sources) foreignSet.add(p)
  }

  const rfBase: string[] = []
  const foreign: string[] = []
  for (const p of Array.from(svg.querySelectorAll("path"))) {
    if (claimed.has(p)) continue
    const id = p.getAttribute("id") ?? ""
    if (SKIP_IDS.has(id) || STRUCTURAL_ID.test(id)) continue
    const d = p.getAttribute("d")
    if (!d) continue
    if (foreignSet.has(p) || FOREIGN_IDS.has(id)) foreign.push(d)
    else rfBase.push(d)
  }

  return { viewBox, regions, rfBase, foreign }
}

function downloadRegionCsv(stat: RegionMapStat) {
  const rows: string[] = ["Регион;Вуз;Город;Взаимодействий;Лицензий;Заявок;Просрочено"]
  for (const u of stat.universities) {
    rows.push(`${stat.region};${u.name};${u.city ?? ""};;;;`)
  }
  rows.push(
    `${stat.region};;ИТОГО;${stat.interactionCount};${stat.studentsCount};${stat.applicationCount};${stat.overdueCount}`,
  )
  const csv = "\uFEFF" + rows.join("\r\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  const slug = stat.region.replace(/[^\p{L}\d]+/gu, "-").replace(/^-|-$/g, "") || "region"
  a.href = url
  a.download = `region-${slug}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function RegionMap({ stats, className, metric, metricLabel, title = "Карта присутствия" }: RegionMapProps) {
  const [parsed, setParsed] = React.useState<ParsedMap | null>(null)
  const [error, setError] = React.useState(false)
  const [reload, setReload] = React.useState(0)
  const [selectedCode, setSelectedCode] = React.useState<string | null>(null)
  const [fullscreen, setFullscreen] = React.useState(false)
  const [markers, setMarkers] = React.useState<{ code: string; x: number; y: number }[]>([])
  const svgRef = React.useRef<SVGSVGElement>(null)
  const { tip, show, move, hide } = useChartTooltip()

  React.useEffect(() => {
    let cancelled = false
    loadRussiaMap()
      .then((map) => {
        if (!cancelled) setParsed(map)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [reload])

  const statByCode = React.useMemo(() => {
    const map = new Map<string, RegionMapStat>()
    for (const stat of stats) {
      const code = NORM_TO_CODE[normalizeRegion(stat.region)]
      if (code) map.set(code, stat)
    }
    return map
  }, [stats])

  const maxValue = metric ? Math.max(0, ...stats.map((s) => s[metric])) : 0
  const regionsWithValue = metric ? stats.filter((s) => s[metric] > 0).length : stats.length
  // Маркеры — только у регионов, где выбранный показатель не нулевой.
  const markedCodes = React.useMemo(
    () => [...statByCode].filter(([, stat]) => !metric || stat[metric] > 0).map(([code]) => code),
    [statByCode, metric],
  )

  // Центры регионов с данными — для пульсирующих маркеров
  React.useEffect(() => {
    if (!parsed || !svgRef.current) return
    const found: { code: string; x: number; y: number }[] = []
    for (const code of markedCodes) {
      const node = svgRef.current.querySelector(`g[data-code="${code}"]`)
      if (!node || typeof (node as SVGGElement).getBBox !== "function") continue
      const bbox = (node as SVGGElement).getBBox()
      if (bbox.width === 0) continue
      found.push({ code, x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 })
    }
    setMarkers(found)
  }, [parsed, markedCodes])

  React.useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [fullscreen])

  const selectedStat = selectedCode ? statByCode.get(selectedCode) : undefined
  const selectedName = selectedCode ? REGION_NAMES[selectedCode] : undefined

  const fillFor = (stat?: RegionMapStat) => {
    if (metric) {
      const level = regionLevel(stat?.[metric] ?? 0, maxValue)
      return level < 0 ? EMPTY_FILL : LEVEL_CLASSES[level]
    }
    return stat && stat.universityCount > 0 ? "fill-primary/40 stroke-primary/60 hover:fill-primary/55" : EMPTY_FILL
  }

  const tooltipValue = (stat?: RegionMapStat) => {
    if (!stat) return "Нет данных"
    if (!metric) return `Вузов: ${stat.universityCount}`
    const main = `${metricLabel ?? "Значение"}: ${stat[metric].toLocaleString("ru-RU")}`
    return metric === "universityCount" ? main : `${main} · вузов: ${stat.universityCount}`
  }

  const mapSvg = parsed ? (
    <svg
      ref={svgRef}
      viewBox={parsed.viewBox}
      preserveAspectRatio="xMidYMid meet"
      className="chart-fade h-full w-full"
      aria-label="Карта регионов России"
    >
      {parsed.foreign.map((d, i) => (
        <path
          key={`f${i}`}
          d={d}
          className="fill-muted/70 stroke-border/50"
          strokeWidth="0.5"
        />
      ))}
      {parsed.rfBase.map((d, i) => (
        <path key={`b${i}`} d={d} className="fill-muted/30 stroke-border" strokeWidth="0.5" />
      ))}
      {parsed.regions.map((region, i) => {
        const stat = statByCode.get(region.code)
        return (
          <g
            key={region.code}
            data-code={region.code}
            className="chart-fade"
            style={{ animationDelay: `${Math.min(i * 6, 400)}ms` }}
            onMouseEnter={(e) =>
              show(e, {
                label: region.name,
                value: tooltipValue(stat),
              })
            }
            onMouseMove={move}
            onMouseLeave={hide}
            onClick={() => setSelectedCode(region.code)}
          >
            {region.paths.map((d, j) => (
              <path
                key={j}
                d={d}
                className={cn(
                  "cursor-pointer stroke-[0.5] transition-[fill] duration-150",
                  fillFor(stat),
                )}
              />
            ))}
          </g>
        )
      })}
      {markers.map((m) => (
        <g key={`m${m.code}`} pointerEvents="none">
          <circle cx={m.x} cy={m.y} r="7" className="fill-primary/25" />
          <circle
            cx={m.x}
            cy={m.y}
            r="4"
            className="fill-primary stroke-card motion-safe:animate-pulse"
            strokeWidth="1.5"
          />
        </g>
      ))}
    </svg>
  ) : null

  const legend = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/60 px-4 py-2.5 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm border border-border bg-card" />
        {metric ? "0 или нет данных" : "Нет данных"}
      </span>
      {metric ? (
        levelRanges(maxValue).map((range) => (
          <span key={range.level} className="flex items-center gap-1.5 tabular-nums">
            <span className={cn("size-3 rounded-sm border", LEVEL_SWATCHES[range.level])} />
            {range.from === range.to ? range.from : `${range.from.toLocaleString("ru-RU")}–${range.to.toLocaleString("ru-RU")}`}
          </span>
        ))
      ) : (
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm border border-primary/60 bg-primary/40" />
          Есть вузы
        </span>
      )}
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm border border-border/50 bg-muted/70" />
        Сопредельные страны
      </span>
      <a
        href="https://commons.wikimedia.org/wiki/File:ISO_codes_of_subjects_of_Russia.svg"
        target="_blank"
        rel="noreferrer"
        className="ml-auto underline decoration-dotted underline-offset-2 hover:text-foreground"
      >
        Карта: Gajmar · Wikimedia Commons · CC0
      </a>
    </div>
  )

  const content = (
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1 bg-muted/20">
        {error && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <p>Карта не загрузилась</p>
            <button
              type="button"
              onClick={() => {
                setError(false)
                setReload((x) => x + 1)
              }}
              className="rounded-lg border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              Повторить
            </button>
          </div>
        )}
        {!error && !parsed && (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <span className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            Загрузка карты...
          </div>
        )}
        {!error && parsed && mapSvg}
      </div>
      {legend}
    </div>
  )

  return (
    <div className={cn("overflow-hidden rounded-xl border bg-card", className)}>
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground">
            {stats.length === 0
              ? "Нет данных по регионам"
              : metric
                ? `${metricLabel ?? "Показатель"} · регионов со значением: ${regionsWithValue}`
                : `Регионов с вузами: ${stats.length}`}
          </p>
        </div>
        <button
          type="button"
          aria-label="На весь экран"
          onClick={() => setFullscreen(true)}
          className="rounded-lg p-2 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none"
        >
          <Maximize2 className="size-4" />
        </button>
      </div>

      <div className="h-[440px]">{content}</div>

      <ChartTooltip state={tip} />

      {/* Панель статистики региона */}
      <Sheet open={selectedCode != null} onOpenChange={(open) => !open && setSelectedCode(null)}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{selectedName ?? "Регион"}</SheetTitle>
            <SheetDescription>
              {selectedStat
                ? `Вузов в регионе: ${selectedStat.universityCount}`
                : "По этому региону пока нет данных"}
            </SheetDescription>
          </SheetHeader>

          <div className="px-4 pb-4">
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ["Взаимодействий", selectedStat?.interactionCount ?? 0],
                  ["Просрочено", selectedStat?.overdueCount ?? 0],
                  ["Обучается", selectedStat?.studentsCount ?? 0],
                  ["Заявок", selectedStat?.applicationCount ?? 0],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="rounded-lg border border-border/60 p-3">
                  <div className="text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
                    {label}
                  </div>
                  <div className="mt-1 text-xl font-light">
                    <AnimatedNumber value={value} duration={700} />
                  </div>
                </div>
              ))}
            </div>

            {selectedStat && selectedStat.universities.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
                  Вузы региона
                </p>
                <div className="space-y-1.5">
                  {selectedStat.universities.map((u) => (
                    <div
                      key={u.name}
                      className="flex items-baseline justify-between gap-3 rounded-lg border border-border/60 px-3 py-2 text-sm"
                    >
                      <span className="font-medium">{u.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{u.city}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedStat && (
              <button
                type="button"
                onClick={() => downloadRegionCsv(selectedStat)}
                className="mt-5 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none"
              >
                Скачать статистику (CSV)
              </button>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Полноэкранный режим */}
      {fullscreen && (
        <div className="fixed inset-0 z-[200] flex flex-col bg-background p-6">
          <div className="flex items-center justify-between pb-4">
            <div>
              <p className="text-base font-semibold">Карта вузов</p>
              <p className="text-xs text-muted-foreground">
                География присутствия по регионам России
              </p>
            </div>
            <button
              type="button"
              aria-label="Закрыть полный экран"
              onClick={() => setFullscreen(false)}
              className="rounded-lg p-2 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none"
            >
              <Minimize2 className="size-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden rounded-xl border bg-card">{content}</div>
          <ChartTooltip state={tip} />
        </div>
      )}
    </div>
  )
}
