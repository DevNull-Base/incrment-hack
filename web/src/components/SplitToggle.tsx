import { SquareHalf, SquareHalfSolid } from "@mynaui/icons-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useSplit } from "./SplitContext"
import { cn } from "cn"

/**
 * Кнопка split-screen в хедере: включает разделение (слева — текущая страница,
 * справа — экран выбора) или сворачивает его. Подсказка — «Разделение экрана».
 */
export function SplitToggle() {
  const { enabled, toggle } = useSplit()

  return (
    <Tooltip>
      <TooltipTrigger
        onClick={toggle}
        aria-label="Разделение экрана"
        aria-pressed={enabled}
        className={cn(
          "cursor-pointer rounded-xl p-2.5 transition-all duration-150 ease-out",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
          enabled
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        {enabled ? (
          <SquareHalfSolid className="size-4.5" />
        ) : (
          <SquareHalf className="size-4.5" />
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom">Разделение экрана</TooltipContent>
    </Tooltip>
  )
}
