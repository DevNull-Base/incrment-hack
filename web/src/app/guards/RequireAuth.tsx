import { Navigate, useLocation } from "react-router-dom"
import { useStore } from "@/app/store"
import { Button } from "@/components/ui/button"
import { dataSource } from "@/shared/config"

/**
 * Гвард сессии: аноним → /login. Читает sessionStatus из стора.
 * В режиме API ещё и ждёт первой загрузки данных: страницы рассчитаны
 * на заполненный стор, и без этого на миг показывали бы «не найдено».
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const status = useStore((s) => s.sessionStatus)
  const dataStatus = useStore((s) => s.dataStatus)
  const dataError = useStore((s) => s.dataError)
  const loadData = useStore((s) => s.loadData)
  const location = useLocation()

  if (status === "loading") return null
  if (status !== "authenticated") {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  if (dataSource === "api" && dataStatus !== "ready") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        {dataStatus === "error" ? (
          <div className="w-full max-w-sm space-y-4 text-center">
            <p className="text-sm font-medium">Не удалось загрузить данные</p>
            <p className="text-sm text-muted-foreground">{dataError}</p>
            <Button onClick={() => void loadData()} className="w-full">
              Повторить
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground" role="status">
            Загрузка данных…
          </p>
        )}
      </div>
    )
  }
  return <>{children}</>
}
