import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { api, type RecentItemDto } from "@/shared/api"
import { dataSource } from "@/shared/config"

// ========================================
// Рабочий контекст пользователя — требование ТЗ (п. 13, «кэш работы
// действий пользователя»): фильтры экранов, недописанные заметки и
// недавно открытые объекты. В режиме API хранятся на сервере
// (/activity/*) и доступны с любого устройства; в демо-режиме — в браузере.
// Сбой хранения работу не прерывает: контекст — удобство, а не данные.
// ========================================

const isApi = dataSource === "api"
const SAVE_DELAY_MS = 600
const LOCAL_PREFIX = "crm_ws:"

function readLocal<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(LOCAL_PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeLocal(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(LOCAL_PREFIX + key)
    else localStorage.setItem(LOCAL_PREFIX + key, JSON.stringify(value))
  } catch {
    // хранилище браузера недоступно — контекст просто не сохранится
  }
}

/**
 * Состояние экрана, переживающее перезагрузку и смену устройства:
 * `[state, setState, loaded]`. Сохраняется с задержкой, чтобы ввод
 * в поле поиска не превращался в запрос на каждый символ.
 */
export function useWorkspaceState<T extends object>(
  scopeKey: string,
  initial: T,
): [T, (next: T | ((prev: T) => T)) => void, boolean] {
  const [state, setStateRaw] = useState<T>(initial)
  const [loaded, setLoaded] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const initialRef = useRef(initial)

  useEffect(() => {
    let cancelled = false
    const apply = (saved: Partial<T> | null) => {
      if (cancelled) return
      if (saved && typeof saved === "object") setStateRaw({ ...initialRef.current, ...saved })
      setLoaded(true)
    }
    if (isApi) {
      api.activity.getState(scopeKey, { silent: true }).then(
        (result) => apply(result.state as Partial<T>),
        () => apply(null),
      )
    } else {
      apply(readLocal<Partial<T>>(`state:${scopeKey}`))
    }
    return () => {
      cancelled = true
    }
  }, [scopeKey])

  const setState = useCallback(
    (next: T | ((prev: T) => T)) => {
      setStateRaw((prev) => {
        const value = typeof next === "function" ? (next as (p: T) => T)(prev) : next
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => {
          if (isApi) void api.activity.saveState(scopeKey, { state: value }, { silent: true }).catch(() => {})
          else writeLocal(`state:${scopeKey}`, value)
        }, SAVE_DELAY_MS)
        return value
      })
    },
    [scopeKey],
  )

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return [state, setState, loaded]
}

/**
 * Черновик ввода: недописанная заметка восстанавливается после
 * перезагрузки или на другом устройстве. `clear` — после отправки.
 */
export function useDraft(
  entityType: string,
  entityId: string | undefined,
): { text: string; setText: (text: string) => void; clear: () => void } {
  const key = `draft:${entityType}:${entityId ?? "new"}`
  // Текст привязан к ключу: при переходе к другой карточке прежний
  // черновик не показывается, пока не загрузится её собственный.
  const [entry, setEntry] = useState<{ key: string; text: string } | null>(null)
  const localSaved = useMemo(() => (isApi || !entityId ? null : readLocal<string>(key)), [key, entityId])
  const text = entry?.key === key ? entry.text : (localSaved ?? "")
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!isApi || !entityId) return
    let cancelled = false
    api.activity.getDraft(entityType, entityId, { silent: true }).then(
      (draft) => {
        const saved = draft?.payload?.text
        if (cancelled || typeof saved !== "string") return
        // Уже начатый ввод загруженным черновиком не перетирается.
        setEntry((prev) => (prev?.key === key ? prev : { key, text: saved }))
      },
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [entityType, entityId, key])

  const persist = useCallback(
    (value: string) => {
      if (!entityId) return
      if (isApi) {
        const call = value.trim()
          ? api.activity.saveDraft(entityType, entityId, { payload: { text: value } }, { silent: true })
          : api.activity.deleteDraft(entityType, entityId, { silent: true })
        void call.catch(() => {})
      } else {
        writeLocal(key, value.trim() ? value : null)
      }
    },
    [entityType, entityId, key],
  )

  const setText = useCallback(
    (value: string) => {
      setEntry({ key, text: value })
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => persist(value), SAVE_DELAY_MS)
    },
    [key, persist],
  )

  const clear = useCallback(() => {
    window.clearTimeout(timer.current)
    setEntry({ key, text: "" })
    persist("")
  }, [key, persist])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return { text, setText, clear }
}

/** Типы объектов в списке недавних — те же, что пишет интерфейс. */
export type RecentEntity = "ENGAGEMENT" | "UNIVERSITY" | "PROGRAM"

const RECENT_LOCAL_LIMIT = 20

/** Отметить, что объект открывали: он появится в «Недавних» поиска. */
export function trackVisit(entityType: RecentEntity, entityId: string, title: string): void {
  if (!entityId || !title) return
  if (isApi) {
    void api.activity.trackVisit(entityType, entityId, { title }, { silent: true }).catch(() => {})
    return
  }
  const list = (readLocal<RecentItemDto[]>("recent") ?? []).filter(
    (item) => !(item.entityType === entityType && item.entityId === entityId),
  )
  writeLocal("recent", [{ entityType, entityId, title, visitedAt: new Date().toISOString() }, ...list].slice(0, RECENT_LOCAL_LIMIT))
}

/** Недавно открытые объекты, новые первыми. */
export async function loadRecent(): Promise<RecentItemDto[]> {
  if (!isApi) return readLocal<RecentItemDto[]>("recent") ?? []
  try {
    return await api.activity.recent({ silent: true })
  } catch {
    return []
  }
}

/** Адрес страницы объекта из списка недавних. */
export function recentPath(item: Pick<RecentItemDto, "entityType" | "entityId">): string | null {
  switch (item.entityType) {
    case "ENGAGEMENT":
      return `/interactions/${item.entityId}`
    case "UNIVERSITY":
      return `/universities/${item.entityId}`
    case "PROGRAM":
      return `/programs/${item.entityId}`
    default:
      return null
  }
}
