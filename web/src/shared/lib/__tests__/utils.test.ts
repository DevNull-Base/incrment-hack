import { describe, it, expect } from "vitest"
import { cn } from "@/shared/lib/utils"

describe("cn utility", () => {
  it("should merge class names", () => {
    const result = cn("text-red-500", "text-blue-500")
    expect(result).toBe("text-blue-500")
  })

  it("should handle conditional classes", () => {
    const result = cn("base", false && "hidden", "extra")
    expect(result).toContain("base")
    expect(result).toContain("extra")
    expect(result).not.toContain("hidden")
  })

  it("should handle undefined and null", () => {
    const result = cn("base", undefined, null, "end")
    expect(result).toContain("base")
    expect(result).toContain("end")
  })

  it("should handle arrays", () => {
    const result = cn(["a", "b"], "c")
    expect(result).toContain("a")
    expect(result).toContain("b")
    expect(result).toContain("c")
  })
})
