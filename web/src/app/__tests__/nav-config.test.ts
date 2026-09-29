import { describe, expect, it } from "vitest"
import { visiblePages, visibleSections } from "../nav-config"

const menuPaths = (role: Parameters<typeof visibleSections>[0]) =>
  visibleSections(role).flatMap((section) => section.items.map((item) => item.to))

// Q&A-сессия: статусы процесса правит администратор, руководитель — нет.
describe("меню: редактор процесса", () => {
  it("виден только администратору", () => {
    expect(menuPaths("ADMIN")).toContain("/admin/flow-editor")
    expect(menuPaths("MANAGER")).not.toContain("/admin/flow-editor")
    expect(menuPaths("USER")).not.toContain("/admin/flow-editor")
    expect(visiblePages("MANAGER").map((p) => p.path)).not.toContain("/admin/flow-editor")
  })

  it("описание процесса доступно всем ролям", () => {
    for (const role of ["USER", "MANAGER", "ADMIN"] as const) expect(menuPaths(role)).toContain("/workflow")
  })
})
