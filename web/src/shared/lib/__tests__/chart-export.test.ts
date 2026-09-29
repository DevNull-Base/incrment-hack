import { describe, expect, it } from "vitest"
import { jpegToPdf } from "../chart-export"

// PDF собирается вручную, поэтому проверяется его устройство: таблица
// перекрёстных ссылок обязана указывать точно на начало каждого объекта,
// иначе часть программ просмотра файл не откроет.
describe("PDF диаграммы", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9])
  const pdf = jpegToPdf(jpeg, 2400, 1200)
  const text = new TextDecoder("latin1").decode(pdf)

  it("начинается заголовком PDF и заканчивается маркером конца", () => {
    expect(text.startsWith("%PDF-1.4\n")).toBe(true)
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true)
  })

  it("смещения в xref указывают на объекты", () => {
    const xrefAt = Number(/startxref\n(\d+)/.exec(text)?.[1])
    expect(text.slice(xrefAt, xrefAt + 4)).toBe("xref")
    const offsets = [...text.slice(xrefAt).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]))
    expect(offsets).toHaveLength(5)
    offsets.forEach((offset, index) => {
      expect(text.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(`${index + 1} 0 obj`)
    })
  })

  it("изображение встроено как JPEG с верными размерами, лист альбомный", () => {
    expect(text).toContain("/Width 2400 /Height 1200")
    expect(text).toContain("/Filter /DCTDecode")
    expect(text).toContain(`/Length ${jpeg.length}`)
    expect(text).toContain("/MediaBox [0 0 842 595]")
  })
})
