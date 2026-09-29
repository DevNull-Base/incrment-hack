import { describe, expect, it } from "vitest"
import { formatNotificationTime, notificationTarget } from "../notifications"

describe("уведомления", () => {
  it("заявка ведёт в карточку, задача — в календарь, прочее — в список", () => {
    expect(notificationTarget({ entityType: "engagement", entityId: "e1" })).toBe("/interactions/e1")
    expect(notificationTarget({ entityType: "task", entityId: "t1" })).toBe("/calendar")
    expect(notificationTarget({ entityType: "engagement", entityId: null })).toBe("/notifications")
    expect(notificationTarget({ entityType: null, entityId: null })).toBe("/notifications")
  })

  it("время выводится датой и часами, а не строкой ISO", () => {
    const text = formatNotificationTime("2026-09-28T09:00:00.000Z")
    expect(text).toMatch(/^28\.09\.2026, \d{2}:00$/)
    expect(formatNotificationTime("не дата")).toBe("")
  })
})
