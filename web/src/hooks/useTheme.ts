import { useState, useEffect } from "react"

type Theme = "light" | "dark"

// ========================================
// Тема как модульный singleton: несколько
// инстансов хука (хедер + страницы) всегда
// синхронны; storage-event синхронизирует вкладки.
// ========================================

function readInitialTheme(): Theme {
  if (typeof window === "undefined") return "light"
  const stored = localStorage.getItem("crm_theme") as Theme | null
  if (stored === "light" || stored === "dark") return stored
  if (typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  }
  return "light"
}

let current: Theme = readInitialTheme()
const listeners = new Set<(theme: Theme) => void>()

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark")
}

// Применить сохранённую тему до первого React-рендера (нет мигания светлым).
applyTheme(current)

function setTheme(theme: Theme) {
  if (theme === current) return
  current = theme
  applyTheme(theme)
  try {
    localStorage.setItem("crm_theme", theme)
  } catch {
    // приватный режим — тема живёт только до перезагрузки
  }
  listeners.forEach((l) => l(theme))
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== "crm_theme") return
    const next = (e.newValue ?? "") as Theme
    if (next === "light" || next === "dark") setTheme(next)
  })
}

export function useTheme(): { theme: Theme; toggleTheme: () => void; setTheme: (t: Theme) => void } {
  const [theme, setLocal] = useState<Theme>(current)

  useEffect(() => {
    const listener = (t: Theme) => setLocal(t)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  const toggle = () => setTheme(theme === "light" ? "dark" : "light")
  return { theme, toggleTheme: toggle, setTheme }
}
