import type { ReactNode } from "react"

// ========================================
// Минимальный Markdown для встроенных руководств (docs/guides):
// заголовки, абзацы, списки, таблицы, иллюстрации, **жирный** и `код`.
// Разметка превращается в React-элементы, а не в HTML-строку, —
// содержимое не может внедрить скрипт даже в теории.
// ========================================

function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > last) parts.push(text.slice(last, index))
    const token = match[0]
    parts.push(
      token.startsWith("**") ? (
        <strong key={index}>{token.slice(2, -2)}</strong>
      ) : (
        <code key={index} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">
          {token.slice(1, -1)}
        </code>
      ),
    )
    last = index + token.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

/** Иллюстрация отдельной строкой: ![подпись](images/имя.png). */
const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/

/**
 * Адрес иллюстрации: только снимки из каталога руководств, которые отдаёт
 * бэкенд. Внешние адреса не подставляются — руководство работает и
 * в закрытом контуре, а текст не может подгрузить чужой ресурс.
 */
export function guideImageSrc(src: string): string | null {
  const match = /^images\/([a-z0-9][a-z0-9-]*\.png)$/.exec(src)
  return match ? `/api/v1/guides/images/${match[1]}` : null
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim())

export function Markdown({ source }: { source: string }) {
  // Заголовок файла (front matter) — служебные поля, не текст.
  const body = source.replace(/^---\n[\s\S]*?\n---\n/, "")
  const lines = body.split(/\r?\n/)
  const blocks: ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1].length
      const cls = ["text-xl font-bold", "mt-4 text-lg font-semibold", "mt-3 text-base font-semibold", "mt-2 text-sm font-semibold"][level - 1]
      const Tag = (["h2", "h3", "h4", "h5"] as const)[level - 1]
      blocks.push(<Tag key={i} className={cls}>{inline(heading[2])}</Tag>)
      i++
      continue
    }

    const image = IMAGE_LINE.exec(line.trim())
    if (image) {
      const src = guideImageSrc(image[2])
      if (src) {
        blocks.push(
          <figure key={i} className="space-y-1.5">
            {/* Не шире исходного размера: снимок диалога не раздувается на всю колонку. */}
            <img src={src} alt={image[1]} loading="lazy" className="h-auto max-w-full rounded-lg border shadow-sm" />
            {image[1] && <figcaption className="text-xs text-muted-foreground">{image[1]}</figcaption>}
          </figure>,
        )
      }
      i++
      continue
    }

    if (line.trim().startsWith("|")) {
      const rows: string[] = []
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(lines[i++])
      const [head, , ...rest] = rows
      blocks.push(
        <div key={i} className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {cells(head).map((c, k) => (
                  <th key={k} className="border-b px-2 py-1.5 text-left font-medium">{inline(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rest.map((r, k) => (
                <tr key={k}>
                  {cells(r).map((c, n) => (
                    <td key={n} className="border-b border-border/50 px-2 py-1.5 align-top">{inline(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    const listItem = /^\s*([-*]|\d+\.)\s+/
    if (listItem.test(line)) {
      const ordered = /^\s*\d+\./.test(line)
      const items: string[] = []
      // Строка с отступом после пункта — его продолжение (перенос длинного
      // пункта), а не новый абзац.
      while (i < lines.length && (listItem.test(lines[i]) || (items.length > 0 && /^\s{2,}\S/.test(lines[i])))) {
        if (listItem.test(lines[i])) items.push(lines[i++].replace(listItem, ""))
        else items[items.length - 1] += ` ${lines[i++].trim()}`
      }
      const List = ordered ? "ol" : "ul"
      blocks.push(
        <List key={i} className={`${ordered ? "list-decimal" : "list-disc"} space-y-1 pl-5 text-sm`}>
          {items.map((item, k) => (
            <li key={k}>{inline(item)}</li>
          ))}
        </List>,
      )
      continue
    }

    const paragraph: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4})\s/.test(lines[i]) &&
      !lines[i].trim().startsWith("|") &&
      !IMAGE_LINE.test(lines[i].trim()) &&
      !listItem.test(lines[i])
    ) {
      paragraph.push(lines[i++].trim())
    }
    blocks.push(<p key={i} className="text-sm leading-relaxed">{inline(paragraph.join(" "))}</p>)
  }

  return <div className="space-y-3">{blocks}</div>
}
