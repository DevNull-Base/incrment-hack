import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { toast, toastStore } from "@/shared/lib/toast-store"

function read() {
  return toastStore.getSnapshot()
}

describe("toast store", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    toast.dismissAll()
  })

  afterEach(() => {
    vi.useRealTimers()
    toast.dismissAll()
  })

  it("pushes success and error toasts", () => {
    toast.success("Сохранено")
    toast.error("Ошибка", "Попробуйте ещё раз")
    expect(read()).toHaveLength(2)
    // Новый тост всегда сверху.
    expect(read()[0]).toMatchObject({ variant: "error", title: "Ошибка", description: "Попробуйте ещё раз" })
    expect(read()[1]).toMatchObject({ variant: "success", title: "Сохранено" })
  })

  it("deduplicates identical toasts and extends their lifetime", () => {
    toast.success("Сохранено")
    vi.advanceTimersByTime(2000)
    toast.success("Сохранено")
    expect(read()).toHaveLength(1)
    // Закрылся бы в 2500мс от первого вызова; продлён до 4500мс от повторного.
    vi.advanceTimersByTime(2000)
    expect(read()).toHaveLength(1)
    vi.advanceTimersByTime(500)
    expect(read()[0]?.closing).toBe(true)
    vi.advanceTimersByTime(200)
    expect(read()).toHaveLength(0)
  })

  it("auto-dismisses success toasts after the default duration", () => {
    toast.success("Готово")
    vi.advanceTimersByTime(2500)
    expect(read()[0]?.closing).toBe(true)
    vi.advanceTimersByTime(200)
    expect(read()).toHaveLength(0)
  })

  it("keeps toasts with duration 0 until dismissed", () => {
    toast.error("Критично", undefined, { duration: 0 })
    vi.advanceTimersByTime(60_000)
    expect(read()).toHaveLength(1)
    toast.dismiss(read()[0]!.id)
    vi.advanceTimersByTime(200)
    expect(read()).toHaveLength(0)
  })

  it("caps the queue at 4 toasts, dropping the oldest", () => {
    toast.info("1")
    toast.info("2")
    toast.info("3")
    toast.info("4")
    toast.info("5")
    expect(read()).toHaveLength(4)
    expect(read().map((t) => t.title)).toEqual(["5", "4", "3", "2"])
  })
})
