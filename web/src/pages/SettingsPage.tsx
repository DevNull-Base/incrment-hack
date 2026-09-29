import { Link } from "react-router-dom"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Shield, Users, Wrench, Database } from "@mynaui/icons-react"
import { useStore } from "@/app/store"
import { selectAdminUsers } from "@/app/store/selectors"
import { ROLE_LABELS } from "@/shared/lib/roles"
import { dataSource } from "@/shared/config"
import { NotificationSettingsCard } from "@/components/NotificationSettingsCard"

const isApi = dataSource === "api"

const SECURITY_MEASURES = [
  "Вход через Keycloak; три роли — КАМ, руководитель, администратор",
  "Видимость данных ограничивается по вузам, направлениям, продуктам и регионам",
  "Журнал аудита — цепочка хэшей: правка или удаление записи задним числом обнаруживается проверкой",
  "Обращения к персональным данным пишутся в журнал, сами данные в журнале маскируются",
  "Обезличивание контакта по требованию субъекта и сроки хранения",
  "Загружаемые файлы проверяются антивирусом",
]

export function SettingsPage() {
  const employees = useStore(selectAdminUsers)
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Настройки</h1>
        <p className="text-sm text-muted-foreground">Администрирование, роли, интеграции</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Users & Roles */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="size-4" />
              Пользователи и роли
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {employees.map((emp) => (
              <div key={emp.id} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <div className="text-sm font-medium">{emp.displayName}</div>
                  <div className="text-xs text-muted-foreground">{emp.email}</div>
                </div>
                <Badge variant={emp.isActive ? "outline" : "destructive"}>
                  {ROLE_LABELS[emp.role]}{emp.isActive ? "" : " · заблокирован"}
                </Badge>
              </div>
            ))}
            {isApi && (
              <Link to="/admin/users">
                <Button variant="outline" className="w-full">Управление пользователями</Button>
              </Link>
            )}
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
          <CardContent className="space-y-4">
            {/* Меры приложения, а не отметка «соблюдается»: по 152-ФЗ и приказу
                ФСТЭК № 117 аттестуется контур развёртывания (так сказано на
                Q&A-сессии), см. docs/security-compliance.md. */}
            <p className="text-sm text-muted-foreground">
              Меры защиты на уровне приложения. Соответствие 152-ФЗ и приказу ФСТЭК № 117
              подтверждается аттестацией контура, в котором система развёрнута.
            </p>
            <ul className="space-y-2 text-sm">
              {SECURITY_MEASURES.map((measure) => (
                <li key={measure} className="flex items-start gap-2">
                  <Shield className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <span>{measure}</span>
                </li>
              ))}
            </ul>
            <Link to="/settings/audit">
              <Button variant="outline" className="w-full mt-2">Аудит-лог</Button>
            </Link>
          </CardContent>
        </Card>

        {/* Integrations */}
        {isApi ? (
          <NotificationSettingsCard />
        ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wrench className="size-4" />
              Интеграции
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { name: "LMS (Двусторонняя)", status: "Настроено", desc: "Прогресс обучения, материалы, лицензии" },
              { name: "Сайт ИТ-Школы", status: "Ожидает", desc: "Приём заявок на обучение" },
              { name: "Email (SMTP)", status: "Настроено", desc: "Уведомления менеджерам и вузам" },
              { name: "Telegram Bot", status: "Планируется", desc: "Быстрые уведомления" },
            ].map((integration) => (
              <div key={integration.name} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <div className="text-sm font-medium">{integration.name}</div>
                  <div className="text-xs text-muted-foreground">{integration.desc}</div>
                </div>
                <Badge variant={integration.status === "Настроено" ? "default" : integration.status === "Ожидает" ? "outline" : "secondary"}>
                  {integration.status}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
        )}

        {/* Data */}
        {isApi ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Database className="size-4" />
                Данные и обмен
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { to: "/admin/integrations", title: "Интеграции", desc: "LMS и сайт: источники, синхронизация, журнал прогонов" },
                { to: "/admin/import", title: "Импорт", desc: "Загрузка вузов и взаимодействий из таблицы" },
                { to: "/admin/persons", title: "Персональные данные", desc: "152-ФЗ: сроки хранения, обезличивание" },
                { to: "/analytics", title: "Отчёты", desc: "Выгрузка отчётов по взаимодействиям" },
              ].map((item) => (
                <Link key={item.to} to={item.to} className="block rounded-lg border p-3 hover:bg-muted/50">
                  <div className="text-sm font-medium">{item.title}</div>
                  <div className="text-xs text-muted-foreground">{item.desc}</div>
                </Link>
              ))}
            </CardContent>
          </Card>
        ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="size-4" />
              Данные
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg border p-4">
              <div className="text-sm font-medium">Массив статистических данных</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Источник метрик для ранжирования программ
              </div>
              <Button variant="outline" size="sm" className="mt-2">
                Синхронизировать
              </Button>
            </div>
            <div className="rounded-lg border p-4">
              <div className="text-sm font-medium">Экспорт данных</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Выгрузка отчётов для федеральных проектов
              </div>
              <Button variant="outline" size="sm" className="mt-2">
                Экспорт CSV
              </Button>
            </div>
          </CardContent>
        </Card>
        )}
      </div>
    </div>
  )
}
