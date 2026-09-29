import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useStore } from "@/app/store"
import { Inbox } from "@mynaui/icons-react"
import { selectApplications, selectPrograms, selectUniversities } from "@/app/store/selectors"
import { Link } from "react-router-dom"
import { dataSource } from "@/shared/config"

const isApi = dataSource === "api"

const statusLabels: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  new: { label: "Новая", variant: "outline" },
  processing: { label: "В обработке", variant: "secondary" },
  enrolled: { label: "Зачислен", variant: "default" },
  rejected: { label: "Отклонена", variant: "secondary" },
}

const sourceLabels: Record<string, string> = {
  website: "Сайт",
  university: "Вуз",
  lms: "LMS",
  crm: "CRM",
}

export function ApplicationsPage() {
  const applications = useStore(selectApplications)
  const programs = useStore(selectPrograms)
  const universities = useStore(selectUniversities)
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Заявки на обучение</h1>
        <p className="text-sm text-muted-foreground">
          {isApi
            ? "Обращения слушателей и компаний — B2C-взаимодействия маршрута прямых продаж"
            : "Входящие заявки от студентов и вузов"}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: "Новые", count: applications.filter((a) => a.status === "new").length, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-950/40" },
          { label: "В обработке", count: applications.filter((a) => a.status === "processing").length, color: "text-orange-600 dark:text-orange-400", bg: "bg-orange-50 dark:bg-orange-950/40" },
          { label: "Зачислены", count: applications.filter((a) => a.status === "enrolled").length, color: "text-green-600 dark:text-green-400", bg: "bg-green-50 dark:bg-green-950/40" },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="flex items-center gap-4 p-4">
              <div className={`flex size-10 items-center justify-center rounded-full ${stat.bg}`}>
                <Inbox className={`size-5 ${stat.color}`} />
              </div>
              <div>
                <div className="text-2xl font-bold">{stat.count}</div>
                <div className="text-sm text-muted-foreground">{stat.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Все заявки ({applications.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Заявитель</TableHead>
                {isApi ? <TableHead>Этап</TableHead> : <TableHead>Email</TableHead>}
                <TableHead>Программа</TableHead>
                {!isApi && <TableHead>Вуз</TableHead>}
                <TableHead>Источник</TableHead>
                <TableHead>Дата</TableHead>
                <TableHead>Статус</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {applications.map((app) => {
                const prog = programs.find((p) => p.id === app.programId)
                const uni = app.universityId ? universities.find((u) => u.id === app.universityId) : null
                const status = statusLabels[app.status]
                return (
                  <TableRow key={app.id}>
                    <TableCell className="font-medium">
                      {app.engagementId ? (
                        <Link to={`/interactions/${app.engagementId}`} className="hover:text-primary">
                          {app.applicantName}
                        </Link>
                      ) : (
                        app.applicantName
                      )}
                    </TableCell>
                    {isApi ? (
                      <TableCell className="text-sm">{app.stateLabel}</TableCell>
                    ) : (
                      <TableCell className="text-sm text-muted-foreground">{app.applicantEmail}</TableCell>
                    )}
                    <TableCell className="whitespace-normal">
                      {prog?.name ?? app.programName ?? (
                        <span className="text-muted-foreground">{app.directionName ?? "—"}</span>
                      )}
                    </TableCell>
                    {!isApi && <TableCell>{uni?.shortName || "—"}</TableCell>}
                    <TableCell><Badge variant="outline">{sourceLabels[app.source]}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(app.createdAt).toLocaleDateString("ru-RU")}
                    </TableCell>
                    <TableCell><Badge variant={status.variant}>{status.label}</Badge></TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
