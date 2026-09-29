import { Link } from "react-router-dom"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CheckCircle } from "@mynaui/icons-react"
import { useStore } from "@/app/store"
import { selectUnreadNotifications, selectReadNotifications } from "@/app/store/selectors"
import { toast } from "@/shared/lib/toast-store"
import { formatNotificationTime, notificationTarget } from "@/shared/lib/notifications"
import type { Notification } from "@/types"

const channelLabels: Record<string, { label: string; color: string }> = {
  IN_APP: { label: "В приложении", color: "text-blue-600 dark:text-blue-400" },
  EMAIL: { label: "Email", color: "text-orange-600 dark:text-orange-400" },
  TELEGRAM: { label: "Telegram", color: "text-green-600 dark:text-green-400" },
  MAX: { label: "MAX", color: "text-red-600 dark:text-red-400" },
}

export function NotificationsPage() {
  const unread = useStore(selectUnreadNotifications)
  const read = useStore(selectReadNotifications)
  const markAllNotificationsRead = useStore((s) => s.markAllNotificationsRead)
  const markNotificationRead = useStore((s) => s.markNotificationRead)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Уведомления</h1>
          <p className="text-sm text-muted-foreground">{unread.length} непрочитанных</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={unread.length === 0}
          onClick={() => {
            markAllNotificationsRead()
            toast.success("Все уведомления прочитаны")
          }}
        >
          <CheckCircle className="size-4" />Отметить все прочитанными
        </Button>
      </div>

      {unread.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Непрочитанные</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {unread.map((n) => (
              <NotificationItem key={n.id} notification={n} onRead={markNotificationRead} />
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Прочитанные</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {read.length === 0 && <p className="text-sm text-muted-foreground">Нет прочитанных уведомлений</p>}
          {read.map((n) => (
            <NotificationItem key={n.id} notification={n} onRead={markNotificationRead} />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function NotificationItem({
  notification: n,
  onRead,
}: {
  notification: Notification
  onRead: (id: string) => void
}) {
  const typeInfo = channelLabels[n.channel] || channelLabels.IN_APP
  const target = notificationTarget(n)
  const link = target === "/notifications" ? undefined : target

  const content = (
    <div className={`flex items-start gap-3 rounded-lg border p-3 ${!n.readAt ? "bg-primary/5 border-primary/20" : ""}`}>
      <div className={`mt-0.5 size-2 rounded-full shrink-0 ${!n.readAt ? "bg-primary" : "bg-muted"}`} />
      <div className="flex-1">
        <div className="text-sm font-medium">{n.subject}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{n.body}</div>
      </div>
      <div className="text-right shrink-0">
        <div className={`text-xs font-medium ${typeInfo.color}`}>{typeInfo.label}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{formatNotificationTime(n.createdAt)}</div>
      </div>
    </div>
  )

  if (link) {
    return (
      <Link
        to={link}
        className="block hover:opacity-80 transition-opacity"
        onClick={() => onRead(n.id)}
      >
        {content}
      </Link>
    )
  }
  return (
    <button
      type="button"
      className="block w-full text-left hover:opacity-80 transition-opacity"
      onClick={() => onRead(n.id)}
    >
      {content}
    </button>
  )
}
