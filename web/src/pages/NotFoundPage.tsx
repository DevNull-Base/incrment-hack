import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"

/** Страница для неизвестного адреса: объясняет ситуацию и ведёт назад. */
export function NotFoundPage() {
  const navigate = useNavigate()

  return (
    <div className="flex h-full min-h-64 flex-col items-center justify-center gap-1 text-center">
      <p className="text-sm font-medium">Страница не найдена</p>
      <p className="text-xs text-muted-foreground">
        Адрес введён с ошибкой или такой страницы больше нет.
      </p>
      <Button variant="outline" size="sm" className="mt-4" onClick={() => navigate("/")}>
        На дашборд
      </Button>
    </div>
  )
}
