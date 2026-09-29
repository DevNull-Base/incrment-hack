import { Download } from "lucide-react"
import { downloadChartPdf, downloadChartPng, type ChartSpec } from "@/shared/lib/chart-export"

/** Кнопки выгрузки диаграммы: PNG — для презентаций, PDF — для печати и рассылки. */
export function ChartExportButtons({ spec, fileName }: { spec: () => ChartSpec; fileName: string }) {
  const button =
    "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Выгрузить диаграмму">
      <button type="button" className={button} onClick={() => downloadChartPng(spec(), fileName)} title="Скачать диаграмму в PNG">
        <Download className="size-3.5" />
        PNG
      </button>
      <button type="button" className={button} onClick={() => downloadChartPdf(spec(), fileName)} title="Скачать диаграмму в PDF">
        <Download className="size-3.5" />
        PDF
      </button>
    </div>
  )
}
