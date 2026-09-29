// ========================================
// Выгрузка диаграмм в PNG и PDF — требование ТЗ («визуализация … диаграммы,
// графики в форматах png, pdf»). Диаграмма рисуется заново по данным, а не
// снимком экрана: файл не зависит от темы, ширины окна и прокрутки, подписи
// не обрезаются, а цифры те же, что на экране.
// ========================================

export interface ChartRow {
  label: string
  value: number
  /** Подпись справа от столбца; по умолчанию — само значение. */
  caption?: string
}

export interface ChartSpec {
  title: string
  subtitle?: string
  rows: ChartRow[]
  /** Разделы («B2B», «B2C»): строка с group начинает новый раздел. */
  groups?: { index: number; title: string }[]
}

const WIDTH = 1200
const SCALE = 2
const PADDING = 40
const LABEL_WIDTH = 420
const ROW_HEIGHT = 34
const BAR_HEIGHT = 20
const COLORS = { text: "#1f2230", muted: "#6b7080", track: "#eef0f5", bar: "#7c3aed", grid: "#e2e5ee" }
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let end = text.length
  while (end > 1 && ctx.measureText(`${text.slice(0, end)}…`).width > maxWidth) end--
  return `${text.slice(0, end)}…`
}

/** Горизонтальная столбчатая диаграмма на белом фоне. */
export function renderBarChart(spec: ChartSpec): HTMLCanvasElement {
  const groupStarts = new Map((spec.groups ?? []).map((g) => [g.index, g.title]))
  const headerHeight = spec.subtitle ? 96 : 72
  const height = headerHeight + spec.rows.length * ROW_HEIGHT + groupStarts.size * ROW_HEIGHT + 56
  const canvas = document.createElement("canvas")
  canvas.width = WIDTH * SCALE
  canvas.height = height * SCALE
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas недоступен")
  ctx.scale(SCALE, SCALE)

  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, WIDTH, height)

  ctx.fillStyle = COLORS.text
  ctx.font = `600 22px ${FONT}`
  ctx.textBaseline = "top"
  ctx.fillText(fitText(ctx, spec.title, WIDTH - PADDING * 2), PADDING, PADDING - 8)
  if (spec.subtitle) {
    ctx.fillStyle = COLORS.muted
    ctx.font = `14px ${FONT}`
    ctx.fillText(fitText(ctx, spec.subtitle, WIDTH - PADDING * 2), PADDING, PADDING + 24)
  }

  const max = Math.max(1, ...spec.rows.map((r) => r.value))
  const barLeft = PADDING + LABEL_WIDTH
  const barWidth = WIDTH - barLeft - PADDING - 90
  let y = headerHeight

  spec.rows.forEach((row, index) => {
    const group = groupStarts.get(index)
    if (group) {
      ctx.fillStyle = COLORS.muted
      ctx.font = `600 13px ${FONT}`
      ctx.textBaseline = "middle"
      ctx.fillText(group.toUpperCase(), PADDING, y + ROW_HEIGHT / 2)
      y += ROW_HEIGHT
    }
    const mid = y + ROW_HEIGHT / 2
    ctx.textBaseline = "middle"
    ctx.fillStyle = COLORS.text
    ctx.font = `14px ${FONT}`
    ctx.fillText(fitText(ctx, row.label, LABEL_WIDTH - 16), PADDING, mid)

    ctx.fillStyle = COLORS.track
    ctx.fillRect(barLeft, mid - BAR_HEIGHT / 2, barWidth, BAR_HEIGHT)
    const w = row.value > 0 ? Math.max(3, (row.value / max) * barWidth) : 0
    ctx.fillStyle = COLORS.bar
    ctx.fillRect(barLeft, mid - BAR_HEIGHT / 2, w, BAR_HEIGHT)

    ctx.fillStyle = COLORS.text
    ctx.font = `600 14px ${FONT}`
    ctx.fillText(row.caption ?? row.value.toLocaleString("ru-RU"), barLeft + barWidth + 12, mid)
    y += ROW_HEIGHT
  })

  if (spec.rows.length === 0) {
    ctx.fillStyle = COLORS.muted
    ctx.font = `14px ${FONT}`
    ctx.fillText("Нет данных для отображения", PADDING, y + 8)
  }

  ctx.strokeStyle = COLORS.grid
  ctx.beginPath()
  ctx.moveTo(PADDING, height - 40)
  ctx.lineTo(WIDTH - PADDING, height - 40)
  ctx.stroke()
  ctx.fillStyle = COLORS.muted
  ctx.font = `12px ${FONT}`
  ctx.textBaseline = "middle"
  ctx.fillText(`CRM ИТ Школы РТК · сформировано ${new Date().toLocaleString("ru-RU")}`, PADDING, height - 22)
  return canvas
}

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

export function downloadChartPng(spec: ChartSpec, fileName: string): void {
  renderBarChart(spec).toBlob((blob) => {
    if (blob) download(blob, `${fileName}.png`)
  }, "image/png")
}

const encoder = new TextEncoder()

/**
 * PDF из одного JPEG-изображения, вписанного в лист A4 (альбомный или
 * книжный — по пропорциям диаграммы). Формат PDF здесь минимальный:
 * страница, изображение и команда его вывести — этого достаточно любой
 * программе просмотра, а библиотека ради этого не нужна.
 */
export function jpegToPdf(jpeg: Uint8Array, width: number, height: number): Uint8Array {
  const landscape = width >= height
  const pageW = landscape ? 842 : 595
  const pageH = landscape ? 595 : 842
  const margin = 28
  const scale = Math.min((pageW - margin * 2) / width, (pageH - margin * 2) / height)
  const drawW = width * scale
  const drawH = height * scale
  const x = (pageW - drawW) / 2
  const y = pageH - margin - drawH

  const content = `q ${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q`
  const parts: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0
  const push = (chunk: Uint8Array | string) => {
    const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk
    parts.push(bytes)
    length += bytes.length
  }
  const object = (body: () => void) => {
    offsets.push(length)
    push(`${offsets.length} 0 obj\n`)
    body()
    push("\nendobj\n")
  }

  push("%PDF-1.4\n")
  object(() => push("<< /Type /Catalog /Pages 2 0 R >>"))
  object(() => push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"))
  object(() =>
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`),
  )
  object(() => {
    push(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`)
    push(jpeg)
    push("\nendstream")
  })
  object(() => push(`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}\nendstream`))

  const xref = length
  push(`xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`)
  for (const offset of offsets) push(`${String(offset).padStart(10, "0")} 00000 n \n`)
  push(`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)

  const result = new Uint8Array(length)
  let position = 0
  for (const part of parts) {
    result.set(part, position)
    position += part.length
  }
  return result
}

export function downloadChartPdf(spec: ChartSpec, fileName: string): void {
  const canvas = renderBarChart(spec)
  canvas.toBlob(
    async (blob) => {
      if (!blob) return
      const jpeg = new Uint8Array(await blob.arrayBuffer())
      const pdf = jpegToPdf(jpeg, canvas.width, canvas.height)
      download(new Blob([pdf.buffer as ArrayBuffer], { type: "application/pdf" }), `${fileName}.pdf`)
    },
    "image/jpeg",
    0.92,
  )
}
