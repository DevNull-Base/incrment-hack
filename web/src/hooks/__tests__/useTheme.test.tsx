import { describe, it, expect, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useTheme } from "@/hooks/useTheme"

describe("useTheme singleton", () => {
  afterEach(() => {
    // Вернуть исходную тему, чтобы не протекать в другие тесты.
    const { result } = renderHook(() => useTheme())
    const initial = localStorage.getItem("crm_theme")
    if (initial === "light" || initial === "dark") {
      act(() => result.current.setTheme(initial))
    }
    localStorage.removeItem("crm_theme")
  })

  it("два инстанса хука синхронны (хедер + страница)", () => {
    const a = renderHook(() => useTheme())
    const b = renderHook(() => useTheme())
    expect(a.result.current.theme).toBe(b.result.current.theme)

    const before = a.result.current.theme
    const after = before === "light" ? "dark" : "light"
    act(() => a.result.current.toggleTheme())

    expect(a.result.current.theme).toBe(after)
    expect(b.result.current.theme).toBe(after)
    expect(document.documentElement.classList.contains("dark")).toBe(after === "dark")
    expect(localStorage.getItem("crm_theme")).toBe(after)
  })
})
