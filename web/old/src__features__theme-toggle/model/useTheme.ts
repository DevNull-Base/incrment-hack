import { useState, useEffect } from "react"

type Theme = "light" | "dark"

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("crm_theme") as Theme | null
      if (stored) return stored
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    }
    return "light"
  })

  useEffect(() => {
    const root = document.documentElement
    if (theme === "dark") {
      root.classList.add("dark")
    } else {
      root.classList.remove("dark")
    }
    localStorage.setItem("crm_theme", theme)
  }, [theme])

  const toggleTheme = () => setThemeState((prev) => (prev === "light" ? "dark" : "light"))

  return { theme, toggleTheme }
}
