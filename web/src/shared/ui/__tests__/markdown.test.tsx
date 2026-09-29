import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { Markdown, guideImageSrc } from "../markdown"

describe("иллюстрации в руководстве", () => {
  it("снимок из каталога руководств — картинка с подписью", () => {
    const html = renderToStaticMarkup(<Markdown source={"Текст\n\n![Фильтры канбана](images/interactions-filters.png)\n\nЕщё текст"} />)
    expect(html).toContain('src="/api/v1/guides/images/interactions-filters.png"')
    expect(html).toContain("<figcaption")
    expect(html).toContain("Фильтры канбана")
  })

  it("внешние адреса и выход из каталога не подставляются", () => {
    expect(guideImageSrc("https://example.com/x.png")).toBeNull()
    expect(guideImageSrc("images/../secret.png")).toBeNull()
    expect(guideImageSrc("images/shot.svg")).toBeNull()
    const html = renderToStaticMarkup(<Markdown source={"![x](https://example.com/x.png)"} />)
    expect(html).not.toContain("<img")
  })
})

describe("списки в руководстве", () => {
  it("строка с отступом продолжает пункт, а не начинает абзац", () => {
    const html = renderToStaticMarkup(
      <Markdown source={"- **Ответственные** — ФИО и роль\n  («практика», «договоры»); основной первым.\n- Второй пункт"} />,
    )
    expect(html).toContain("ФИО и роль («практика», «договоры»); основной первым.</li>")
    expect(html).not.toContain("<p")
    expect(html.match(/<li>/g)).toHaveLength(2)
  })
})
