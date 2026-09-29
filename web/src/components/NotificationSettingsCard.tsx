import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Bell } from "@mynaui/icons-react"
import { api, type ChannelSettingsDto, type NotificationSettingsDto } from "@/shared/api"
import { toast } from "@/shared/lib/toast-store"

const CHANNEL_LABELS: Record<ChannelSettingsDto["channel"], string> = {
  IN_APP: "В системе",
  EMAIL: "Email",
  TELEGRAM: "Telegram",
  MAX: "MAX",
}

/**
 * Уведомления и эскалации (ADMIN): порог «зависшей» заявки, кого
 * уведомлять и каналы доставки. Готовность канала и тестовую отправку
 * проверяет бэкенд — адреса ботов и SMTP задаются конфигурацией сервера.
 */
export function NotificationSettingsCard() {
  const [settings, setSettings] = useState<NotificationSettingsDto | null>(null)
  const [days, setDays] = useState("")
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    api.notifications.settings().then(
      (s) => {
        setSettings(s)
        setDays(String(s.escalationDays))
      },
      () => {},
    )
  }, [])

  const updatePolicy = async (patch: Partial<Pick<NotificationSettingsDto, "escalationDays" | "notifyOwnerOnTransition" | "notifyManagerOnEscalation">>) => {
    setBusy("policy")
    try {
      const next = await api.notifications.updatePolicy(patch)
      setSettings(next)
      setDays(String(next.escalationDays))
      toast.success("Настройки уведомлений сохранены")
    } catch {
      // ошибку показал клиент API
    } finally {
      setBusy(null)
    }
  }

  const toggleChannel = async (channel: ChannelSettingsDto) => {
    setBusy(channel.channel)
    try {
      const updated = await api.notifications.updateChannel(channel.channel, { isEnabled: !channel.isEnabled })
      setSettings((s) => s && { ...s, channels: s.channels.map((c) => (c.channel === updated.channel ? updated : c)) })
      toast.success(updated.isEnabled ? "Канал включён" : "Канал выключен", CHANNEL_LABELS[updated.channel])
    } catch {
      // ошибку показал клиент API
    } finally {
      setBusy(null)
    }
  }

  const testChannel = async (channel: ChannelSettingsDto) => {
    setBusy(channel.channel)
    try {
      const updated = await api.notifications.testChannel(channel.channel)
      setSettings((s) => s && { ...s, channels: s.channels.map((c) => (c.channel === updated.channel ? updated : c)) })
      if (updated.lastTestDelivered) toast.success("Тестовое сообщение доставлено", CHANNEL_LABELS[updated.channel])
      else toast.error("Тестовое сообщение не доставлено", updated.lastTestDetail ?? undefined)
    } catch {
      // ошибку показал клиент API
    } finally {
      setBusy(null)
    }
  }

  const runEscalation = async () => {
    setBusy("escalation")
    try {
      await api.notifications.runEscalation()
      toast.success("Эскалация запущена", "Уведомления о зависших заявках разосланы")
    } catch {
      // ошибку показал клиент API
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bell className="size-4" />
          Уведомления и эскалации
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!settings && <p className="text-sm text-muted-foreground">Загрузка…</p>}
        {settings && (
          <>
            <div className="flex items-end gap-2 rounded-lg border p-3">
              <label className="flex-1 text-sm">
                <span className="block text-xs text-muted-foreground">Заявка «зависла» без движения, дней</span>
                <Input
                  type="number"
                  min={1}
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  className="mt-1 h-9"
                />
              </label>
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null || !days || Number(days) === settings.escalationDays}
                onClick={() => void updatePolicy({ escalationDays: Number(days) })}
              >
                Сохранить
              </Button>
            </div>
            {(
              [
                ["notifyOwnerOnTransition", "Уведомлять ответственного о смене этапа"],
                ["notifyManagerOnEscalation", "Уведомлять руководителя об эскалации"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                {label}
                <input
                  type="checkbox"
                  checked={settings[key]}
                  disabled={busy !== null}
                  onChange={() => void updatePolicy({ [key]: !settings[key] })}
                  className="size-4 accent-primary"
                />
              </label>
            ))}
            <div className="space-y-2">
              {settings.channels.map((c) => (
                <div key={c.channel} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {CHANNEL_LABELS[c.channel]}
                      <Badge variant={c.ready ? "default" : "secondary"}>{c.ready ? "готов" : "не настроен"}</Badge>
                    </div>
                    <div className="flex gap-1">
                      {c.channel !== "IN_APP" && (
                        <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void testChannel(c)}>
                          Проверить
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant={c.isEnabled ? "outline" : "default"}
                        disabled={busy !== null || c.channel === "IN_APP"}
                        onClick={() => void toggleChannel(c)}
                      >
                        {c.isEnabled ? "Выключить" : "Включить"}
                      </Button>
                    </div>
                  </div>
                  {(c.readinessDetail || c.lastTestDetail) && (
                    <p className="mt-1 text-xs text-muted-foreground">{c.lastTestDetail ?? c.readinessDetail}</p>
                  )}
                </div>
              ))}
            </div>
            <Button variant="outline" className="w-full" disabled={busy !== null} onClick={() => void runEscalation()}>
              {busy === "escalation" ? "Выполняется…" : "Запустить эскалацию сейчас"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
