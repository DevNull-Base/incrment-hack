import { useEffect, useState } from "react"

/**
 * Отслеживает медиа-запрос браузера. Нужен, чтобы на узких экранах
 * автоматически уходить в вид «список» (двухколоночный канвас не влезает).
 * Без matchMedia считаем, что экран большой — деградируем к канвасу.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : true,
  )

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return
    const list = window.matchMedia(query)
    const onChange = () => setMatches(list.matches)
    onChange()
    list.addEventListener("change", onChange)
    return () => list.removeEventListener("change", onChange)
  }, [query])

  return matches
}
