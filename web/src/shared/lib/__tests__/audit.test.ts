import { describe, expect, it } from "vitest"
import { auditDetails, auditEntity } from "../audit"

describe("журнал аудита", () => {
  it("сущность — по-русски, неизвестная — как есть", () => {
    expect(auditEntity("Engagement")).toBe("Взаимодействие")
    expect(auditEntity("Person")).toBe("Контакт")
    expect(auditEntity("Нечто")).toBe("Нечто")
    expect(auditEntity(null)).toBe("—")
  })

  it("снимок — строкой полей без идентификаторов и вложенных структур", () => {
    expect(
      auditDetails({ attachmentId: "a1", fileName: "Акт.pdf", scanStatus: "CLEAN", deduplicated: false, stateKey: "SIGNING" }),
    ).toBe("файл: Акт.pdf · проверка: CLEAN · уже был загружен: нет")
    expect(auditDetails({ method: "GET", recordCount: 72, query: { page: "1", search: "Иванов" } })).toBe(
      "записей: 72 · поиск: «Иванов»",
    )
    expect(auditDetails(null)).toBe("—")
    expect(auditDetails({ engagementId: "e1" })).toBe("—")
  })
})
