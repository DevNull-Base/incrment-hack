import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { useStore } from "@/app/store"
import { useStageCatalog } from "@/app/use-stages"
import { isClosedStage } from "@/app/workflow-stages"
import { dataSource, keycloak } from "@/shared/config"
import { selectActivityEvents, selectEmployees, selectWorkingInteractions } from "@/app/store/selectors"
import { ROLE_LABELS } from "@/shared/lib/roles"
import { toast } from "@/shared/lib/toast-store"
import { User, Shield, Bell, ChartBar, Clock1 } from "@mynaui/icons-react"

export function ProfilePage() {
  const user = useStore((s) => s.user)
  const interactions = useStore(selectWorkingInteractions)
  const activityEvents = useStore(selectActivityEvents)
  const employees = useStore(selectEmployees)
  const catalog = useStageCatalog()
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean>>({
    email: true,
    inApp: true,
    telegram: false,
    deadlines: true,
    stageChanges: true,
    meetings: true,
    newApplications: true,
  })

  const handleChangePassword = () => {
    if (!newPassword) {
      toast.error("Не удалось сохранить", "Введите новый пароль")
      return
    }
    if (newPassword.length < 6) {
      toast.error("Не удалось сохранить", "Пароль должен содержать минимум 6 символов")
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error("Не удалось сохранить", "Пароли не совпадают")
      return
    }
    setNewPassword("")
    setConfirmPassword("")
    toast.success("Пароль обновлён")
  }

  if (!user) return null
  const myInteractions = interactions.filter((i) => i.ownerId === user.id)
  const myActivity = activityEvents.filter((e) => e.userId === user.id).slice(0, 8)

  const activeInteractions = myInteractions.filter((i) => !isClosedStage(catalog[i.segment], i.currentStateKey))
  const completedCount = myInteractions.filter((i) => {
    const stage = catalog[i.segment].find((s) => s.key === i.currentStateKey)
    return stage?.isFinal && !stage.isRejected
  }).length
  const overdueCount = myInteractions.filter((i) => i.isOverdue).length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Мой профиль</h1>
        <p className="text-sm text-muted-foreground">Личные данные, уведомления, статистика</p>
      </div>

      {/* Profile header */}
      <Card>
        <CardContent className="flex items-center gap-6 p-6">
          <Avatar className="size-20">
            <AvatarFallback className="bg-primary text-primary-foreground text-2xl font-bold">
              {user.displayName.split(" ").map((n) => n[0]).join("").slice(0, 2)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <h2 className="text-xl font-bold">{user.displayName}</h2>
            <p className="text-muted-foreground">{user.email}</p>
            <div className="mt-2 flex items-center gap-2">
          <Badge>{ROLE_LABELS[user.role]}</Badge>
              <Badge variant="outline">{user.email}</Badge>
            </div>
          </div>
          {/* Профиль ведётся в учётной записи Keycloak — править здесь нечего. */}
          {!keycloak && <Button variant="outline">Редактировать</Button>}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Personal data */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="size-4" />
              Личные данные
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>ФИО</Label>
              <Input value={user.displayName} readOnly />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={user.email} readOnly />
            </div>
            <div className="space-y-2">
              <Label>Роль</Label>
          <Input value={ROLE_LABELS[user.role] || user.role} readOnly />
            </div>
            <div className="space-y-2">
              <Label>Руководитель</Label>
              {/* Имя — из профиля (API) или справочника (демо); идентификатор человеку ничего не скажет. */}
              <Input
                value={
                  user.managerName ??
                  employees.find((e) => e.id === user.managerId)?.displayName ??
                  (user.managerId ? "Назначен" : "Не назначен")
                }
                readOnly
              />
            </div>
          </CardContent>
        </Card>

        {/* Security */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="size-4" />
              Безопасность
            </CardTitle>
          </CardHeader>
          {keycloak ? (
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Пароль и второй фактор входа хранит Keycloak — меняются в личном кабинете учётной записи.
              </p>
              <a href={`${keycloak.url}/realms/${encodeURIComponent(keycloak.realm)}/account`} target="_blank" rel="noreferrer">
                <Button variant="outline" className="w-full">Открыть учётную запись</Button>
              </a>
            </CardContent>
          ) : (
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Текущий пароль</Label>
              <Input type="password" value="••••••••" readOnly />
            </div>
            <div className="space-y-2">
              <Label>Новый пароль</Label>
              <Input
                type="password"
                placeholder="Введите новый пароль"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Подтверждение</Label>
              <Input
                type="password"
                placeholder="Повторите новый пароль"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            <Button variant="outline" className="w-full" onClick={handleChangePassword}>
              Сменить пароль
            </Button>
          </CardContent>
          )}
        </Card>

        {/* Notification preferences */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bell className="size-4" />
              Уведомления
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {dataSource === "api" && (
              <p className="text-sm text-muted-foreground">
                Каналы доставки и правила эскалации настраивает администратор (раздел «Настройки»).
                Уведомления в системе приходят всегда.
              </p>
            )}
            {dataSource !== "api" && [
              { key: "email", label: "Email-уведомления" },
              { key: "inApp", label: "Уведомления в системе" },
              { key: "telegram", label: "Telegram-бот" },
              { key: "deadlines", label: "Дедлайны и просрочки" },
              { key: "stageChanges", label: "Смена этапов" },
              { key: "meetings", label: "Встречи с вузами" },
              { key: "newApplications", label: "Новые заявки" },
            ].map((item) => (
              <div key={item.key} className="flex items-center justify-between rounded-lg border p-3">
                <span className="text-sm">{item.label}</span>
                <Badge
                  className="cursor-pointer"
                  variant={notifPrefs[item.key] ? "default" : "secondary"}
                  onClick={() => {
                    const next = !notifPrefs[item.key]
                    setNotifPrefs((prev) => ({ ...prev, [item.key]: next }))
                    toast.success(
                      "Настройка сохранена",
                      `${item.label} — ${next ? "вкл" : "выкл"}`,
                    )
                  }}
                >
                  {notifPrefs[item.key] ? "Вкл" : "Выкл"}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Stats */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ChartBar className="size-4" />
              Моя статистика
            </CardTitle>
          </CardHeader>
          <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {[
                { label: "Всего взаимодействий", value: myInteractions.length },
                { label: "Активных", value: activeInteractions.length },
                { label: "Завершённых", value: completedCount },
                { label: "Просроченных", value: overdueCount },
              ].map((stat) => (
                <div key={stat.label} className="rounded-lg border p-3 text-center">
                  <div className="text-2xl font-bold">{stat.value}</div>
                  <div className="text-xs text-muted-foreground">{stat.label}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-2">
              <div className="text-sm font-medium">Мои активные взаимодействия:</div>
              {activeInteractions.map((i) => {
                const uni = ["", "МГУ", "СПбПУ", "НГУ", "КФУ", "УрФУ"]
                return (
                  <div key={i.id} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                    <span>
                      {i.universityId != null
                        ? uni[parseInt(i.universityId.slice(1))] || i.universityId
                        : i.universityShortName || i.counterpartyName}
                    </span>
                    <Badge variant="outline">{i.currentStateLabel}</Badge>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent activity */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock1 className="size-4" />
            Недавняя активность
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {myActivity.map((event) => (
              <div key={event.id} className="flex items-start gap-3 rounded-lg border p-3">
                <div className="mt-0.5 size-2 rounded-full bg-primary" />
                <div className="flex-1">
                  <div className="text-sm">{event.description}</div>
                  <div className="text-xs text-muted-foreground">{new Date(event.createdAt).toLocaleDateString("ru-RU")}</div>
                </div>
                <Badge variant="outline" className="text-xs">{event.type}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
