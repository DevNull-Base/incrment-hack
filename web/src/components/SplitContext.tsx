import * as React from "react"
import { useNavigate } from "react-router-dom"
import { addSplitRecent } from "@/shared/lib/split-recent"

interface SplitContextType {
  enabled: boolean
  leftPage: string | null
  rightPage: string | null
  activeSide: "left" | "right"
  setLeftPage: (path: string) => void
  setRightPage: (path: string) => void
  setActiveSide: (side: "left" | "right") => void
  toggle: () => void
  reset: () => void
}

const SplitContext = React.createContext<SplitContextType | null>(null)

export function useSplit() {
  const ctx = React.useContext(SplitContext)
  if (!ctx) throw new Error("useSplit must be used within SplitProvider")
  return ctx
}

// ========================================
// Split-состояние хранится в query-параметрах (?l=…&r=…&s=…),
// поэтому перезагрузка, «назад/вперёд» и shareable-ссылки работают.
// ========================================
interface SplitUrlState {
  enabled: boolean
  leftPage: string | null
  rightPage: string | null
  activeSide: "left" | "right"
}

function parseSplitSearch(search: string): SplitUrlState {
  const params = new URLSearchParams(search)
  const left = params.get("l")
  return {
    enabled: !!left,
    leftPage: left,
    rightPage: params.get("r"),
    activeSide: params.get("s") === "left" ? "left" : "right",
  }
}

function buildSplitSearch(
  left: string | null,
  right: string | null,
  side: "left" | "right",
): string {
  const params = new URLSearchParams()
  if (left) params.set("l", left)
  if (right) params.set("r", right)
  params.set("s", side)
  const qs = params.toString()
  return qs ? `?${qs}` : ""
}

export function SplitProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const initial = React.useMemo(() => parseSplitSearch(window.location.search), [])

  const [enabled, setEnabled] = React.useState(initial.enabled)
  const [leftPage, setLeftPageState] = React.useState<string | null>(initial.leftPage)
  const [rightPage, setRightPageState] = React.useState<string | null>(initial.rightPage)
  const [activeSide, setActiveSideState] = React.useState<"left" | "right">(initial.activeSide)

  // Рефы зеркалят состояние: перехватчик истории читает их синхронно,
  // не дожидаясь рекомпоновки.
  const enabledRef = React.useRef(initial.enabled)
  const leftRef = React.useRef(initial.leftPage)
  const rightRef = React.useRef(initial.rightPage)
  const activeSideRef = React.useRef<"left" | "right">(initial.activeSide)

  // Оригинальные методы history — их вызываем напрямую, минуя перехват.
  const origPushRef = React.useRef(window.history.pushState)
  const origReplaceRef = React.useRef(window.history.replaceState)

  const applyState = React.useCallback((next: SplitUrlState) => {
    enabledRef.current = next.enabled
    leftRef.current = next.leftPage
    rightRef.current = next.rightPage
    activeSideRef.current = next.activeSide
    setEnabled(next.enabled)
    setLeftPageState(next.leftPage)
    setRightPageState(next.rightPage)
    setActiveSideState(next.activeSide)
  }, [])

  const writeUrl = React.useCallback((mode: "push" | "replace") => {
    const url =
      window.location.pathname +
      buildSplitSearch(leftRef.current, rightRef.current, activeSideRef.current)
    const fn = mode === "push" ? origPushRef.current : origReplaceRef.current
    fn.call(window.history, null, "", url)
  }, [])

  const setActiveSide = React.useCallback((side: "left" | "right") => {
    if (activeSideRef.current === side) return
    activeSideRef.current = side
    setActiveSideState(side)
    if (enabledRef.current) writeUrl("replace")
  }, [writeUrl])

  // Перехватываем history.pushState/replaceState: любая навигация внутри
  // панели (Link или navigate) сохраняет URL контейнера, а путь пишет
  // в параметр активной панели. Строка истории при этом создаётся
  // по-настоящему, поэтому работает кнопка «назад».
  React.useEffect(() => {
    if (!enabled) return

    const origPush = window.history.pushState
    const origReplace = window.history.replaceState

    function intercept(
      mode: "push" | "replace",
      state: unknown,
      title: string,
      url: string | URL | null | undefined,
    ): boolean {
      if (!enabledRef.current) return false
      if (typeof url !== "string" || !url.startsWith("/") || url.startsWith("//")) {
        return false
      }

      const pathname = url.split(/[?#]/)[0]

      // Выход из системы (и любой guard-редирект на /login) должен
      // покинуть split, а не попасть внутрь панели.
      if (pathname === "/login") {
        applyState({ enabled: false, leftPage: null, rightPage: null, activeSide: "right" })
        return false
      }

      const nextLeft = activeSideRef.current === "left" ? url : leftRef.current
      const nextRight = activeSideRef.current === "right" ? url : rightRef.current
      const nextSide = activeSideRef.current

      enabledRef.current = true
      leftRef.current = nextLeft
      rightRef.current = nextRight
      activeSideRef.current = nextSide
      setEnabled(true)
      setLeftPageState(nextLeft)
      setRightPageState(nextRight)

      const nextUrl =
        window.location.pathname + buildSplitSearch(nextLeft, nextRight, nextSide)
      if (mode === "push") {
        origPush.call(window.history, state, title, nextUrl)
      } else {
        origReplace.call(window.history, state, title, nextUrl)
      }
      return true
    }

    window.history.pushState = function (state, title, url) {
      if (intercept("push", state, title, url)) return
      return origPush.call(window.history, state, title, url)
    }

    window.history.replaceState = function (state, title, url) {
      if (intercept("replace", state, title, url)) return
      return origReplace.call(window.history, state, title, url)
    }

    return () => {
      window.history.pushState = origPush
      window.history.replaceState = origReplace
    }
  }, [enabled, applyState])

  // Кнопка «назад»/«вперёд»: восстанавливаем панели из URL браузера.
  React.useEffect(() => {
    const onPopState = () => {
      applyState(parseSplitSearch(window.location.search))
    }
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [applyState])

  // Последняя страница правой панели — источник секции «Недавние» в chooser.
  React.useEffect(() => {
    if (rightPage) addSplitRecent(rightPage)
  }, [rightPage])

  const setLeftPage = React.useCallback(
    (path: string) => {
      leftRef.current = path
      setLeftPageState(path)
      if (enabledRef.current) writeUrl("push")
    },
    [writeUrl],
  )

  const setRightPage = React.useCallback(
    (path: string) => {
      rightRef.current = path
      setRightPageState(path)
      if (enabledRef.current) writeUrl("push")
    },
    [writeUrl],
  )

  const reset = React.useCallback(() => {
    const target =
      (activeSideRef.current === "left" ? leftRef.current : rightRef.current) ??
      leftRef.current
    applyState({ enabled: false, leftPage: null, rightPage: null, activeSide: "right" })
    if (target) {
      // Выходим из split на страницу активной панели: URL и router
      // синхронизируются, кнопка «назад» ведёт в историю панели.
      navigate(target)
    } else {
      origReplaceRef.current.call(window.history, null, "", window.location.pathname)
    }
  }, [applyState, navigate])

  const toggle = React.useCallback(() => {
    if (enabledRef.current) {
      reset()
      return
    }
    if (!leftRef.current) {
      leftRef.current = window.location.pathname + window.location.search
    }
    activeSideRef.current = "right"
    enabledRef.current = true
    setLeftPageState(leftRef.current)
    setActiveSideState("right")
    setEnabled(true)
    writeUrl("replace")
  }, [reset, writeUrl])

  // Ctrl+\ / Meta+\ — включить или свернуть split-screen.
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.code !== "Backslash") return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return
      e.preventDefault()
      toggle()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [toggle])

  return (
    <SplitContext.Provider
      value={{
        enabled,
        leftPage,
        rightPage,
        activeSide,
        setLeftPage,
        setRightPage,
        setActiveSide,
        toggle,
        reset,
      }}
    >
      {children}
    </SplitContext.Provider>
  )
}
