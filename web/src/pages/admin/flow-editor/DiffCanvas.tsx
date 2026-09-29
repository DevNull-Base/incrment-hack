import * as React from "react"
import { cn } from "cn"
import type { WorkflowDefinitionV1 } from "@/shared/api/workflow-definition"
import type { MatchResult } from "@/shared/api/flow-editor-ops"
import { CanvasNode } from "./CanvasNode"
import { InsertZone } from "./InsertZone"

interface DiffCanvasProps {
  base: WorkflowDefinitionV1
  draft: WorkflowDefinitionV1
  match: MatchResult
  /** Счётчик заявок на удаляемых этапах (бейджи). */
  engagementCounts: Record<string, number>
  baseVersionLabel: string
}

const LINK_H = 56

/**
 * Diff-канвас режима «Сравнение»: сверху активная редакция (старый путь),
 * снизу черновик (новый путь), между ними штриховые SVG-линии по ключу.
 * Только просмотр — без палитры, drag-ручек и зон вставки.
 * Координаты центров меряются по data-center-key и пересчитываются
 * при ресайзе контента (вставка/удаление узлов).
 */
export function DiffCanvas({ base, draft, match, engagementCounts, baseVersionLabel }: DiffCanvasProps) {
  const contentRef = React.useRef<HTMLDivElement>(null)
  const svgRef = React.useRef<SVGSVGElement>(null)
  const [centers, setCenters] = React.useState<Record<string, number>>({})
  const [svgW, setSvgW] = React.useState(0)

  const measure = React.useCallback(() => {
    const container = contentRef.current
    const svg = svgRef.current
    if (!container || !svg) return
    // Единая система координат: origin = левый край самого svg-слоя,
    // иначе padding контейнера (px-5) сдвигает каждую линию на 20px.
    const origin = svg.getBoundingClientRect().left
    const next: Record<string, number> = {}
    container.querySelectorAll<HTMLElement>("[data-center-key]").forEach((el) => {
      const key = el.dataset.centerKey
      if (!key) return
      const r = el.getBoundingClientRect()
      next[key] = r.left - origin + r.width / 2
    })
    setSvgW(svg.getBoundingClientRect().width)
    setCenters(next)
  }, [])

  React.useLayoutEffect(() => {
    measure()
    const container = contentRef.current
    if (!container) return
    const ro = new ResizeObserver(() => measure())
    ro.observe(container)
    if (svgRef.current) ro.observe(svgRef.current)
    Array.from(container.children).forEach((child) => ro.observe(child))
    window.addEventListener("resize", measure)
    return () => {
      ro.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [measure, base, draft])

  const removedKeys = new Set(match.removed)
  const addedKeys = new Set(match.added)
  const renamedKeys = new Set(match.renamed)

  // Линии: пары по ключу (включая renamed) + обрывы для removed/added.
  const links: { id: string; x1: number; x2: number; cls: string }[] = []
  const pairKeys = base.states
    .filter((s) => draft.states.some((d) => d.key === s.key))
    .map((s) => s.key)
  for (const key of pairKeys) {
    const x1 = centers[`base:${key}`]
    const x2 = centers[`draft:${key}`]
    if (x1 === undefined || x2 === undefined) continue
    links.push({
      id: `pair-${key}`,
      x1,
      x2,
      cls: renamedKeys.has(key) ? "stroke-info/70" : "stroke-border",
    })
  }
  for (const key of match.removed) {
    const x = centers[`base:${key}`]
    if (x === undefined) continue
    links.push({ id: `rem-${key}`, x1: x, x2: x, cls: "stroke-destructive/60" })
  }
  for (const key of match.added) {
    const x = centers[`draft:${key}`]
    if (x === undefined) continue
    links.push({ id: `add-${key}`, x1: x, x2: x, cls: "stroke-success/60" })
  }

  return (
    <div className="overflow-x-auto rounded-xl border bg-muted/20">
      <div ref={contentRef} className="relative min-w-max px-5 py-5">
        {/* Верхний ряд: активная редакция (старый путь) */}
        <div className="sticky left-0 z-10 mb-2 flex w-fit items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Старый путь · {baseVersionLabel}
          </span>
          <span className="text-[11px] text-muted-foreground">·</span>
          <span className="text-[11px] text-muted-foreground">
            {base.states.length} этапов · только просмотр
          </span>
        </div>
        <div className="flex items-stretch gap-2">
          {base.states.map((s, i) => (
            <React.Fragment key={s.key}>
              {i > 0 && (
                <div aria-hidden className="relative w-2 shrink-0 self-stretch">
                  <span className="absolute inset-x-0 top-1/2 border-t-2 border-dashed border-border" />
                </div>
              )}
              <CanvasNode
                state={s}
                row="base"
                diff={
                  removedKeys.has(s.key)
                    ? "removed"
                    : renamedKeys.has(s.key)
                      ? "renamed"
                      : "matched"
                }
                engagementCount={engagementCounts[s.key]}
                oldLabel={
                  renamedKeys.has(s.key)
                    ? draft.states.find((d) => d.key === s.key)?.label
                    : undefined
                }
              />
            </React.Fragment>
          ))}
          {/* Хвостовый спейсер — зеркало хвостовой зоны нижнего ряда,
              чтобы ряды имели одинаковую геометрию и линии оставались вертикальными. */}
          <div aria-hidden className="w-2 shrink-0" />
        </div>

        {/* Слой штриховых связей */}
        <div className="relative my-2 w-full" style={{ height: LINK_H }} aria-hidden>
          <svg
            ref={svgRef}
            className="absolute inset-0 overflow-visible"
            width={svgW || undefined}
            height={LINK_H}
            viewBox={svgW ? `0 0 ${svgW} ${LINK_H}` : undefined}
          >
            {svgW === 0 ? null : (
              <>
                {links.map((l) => (
                  <line
                    key={l.id}
                    x1={l.x1}
                    y1={0}
                    x2={l.x2}
                    y2={LINK_H}
                    strokeDasharray="6 5"
                    strokeLinecap="round"
                    className={cn("motion-safe:chart-fade", l.cls)}
                  />
                ))}
                {links.length === 0 && (
                  <text x={8} y={LINK_H / 2 + 4} className="fill-muted-foreground text-[11px]">
                    Пары «старый → новый» появятся после правок
                  </text>
                )}
              </>
            )}
          </svg>
        </div>

        {/* Нижний ряд: черновик (новый путь) */}
        <div className="sticky left-0 z-10 mb-2 flex w-fit items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
            Новый путь · черновик
          </span>
          <span className="text-[11px] text-muted-foreground">·</span>
          <span className="text-[11px] text-muted-foreground">{draft.states.length} этапов</span>
        </div>
        <div className="flex items-stretch gap-2">
          {draft.states.map((s, i) => (
            <React.Fragment key={s.key}>
              {i > 0 && (
                <InsertZone
                  variant="gap"
                  afterIndex={i - 1}
                  onInsertClick={() => {}}
                  armed={false}
                  readOnly
                />
              )}
              <CanvasNode
                state={s}
                row="draft"
                diff={
                  addedKeys.has(s.key)
                    ? "added"
                    : renamedKeys.has(s.key)
                      ? "renamed"
                      : "matched"
                }
                engagementCount={engagementCounts[s.key]}
                oldLabel={
                  renamedKeys.has(s.key)
                    ? base.states.find((d) => d.key === s.key)?.label
                    : undefined
                }
              />
            </React.Fragment>
          ))}
          <InsertZone variant="gap" afterIndex={null} onInsertClick={() => {}} armed={false} readOnly />
        </div>

        <p className="mt-3 text-[11px] text-muted-foreground">
          Штриховые линии связывают этапы старого и нового пути по ключу: зелёный — добавлен,
          красный — удаляется, синий — переименован. Режим «Сравнение» — только просмотр.
        </p>
      </div>
    </div>
  )
}
