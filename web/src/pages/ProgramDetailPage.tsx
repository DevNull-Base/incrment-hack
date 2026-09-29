import { useEffect } from "react"
import { useParams, Link } from "react-router-dom"
import { trackVisit } from "@/shared/lib/workspace"
import { activeStreams, STREAM_STATUS_LABELS, studyingNow } from "@/shared/lib/streams"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useStageCatalog } from "@/app/use-stages"
import { stageProgress } from "@/app/workflow-stages"
import { useStore } from "@/app/store"
import {
  selectApplications,
  selectInteractions,
  selectPrograms,
  selectProducts,
  selectStreams,
  selectUniversities,
} from "@/app/store/selectors"
import { ArrowLeft, TrendingUp, Users, LayersOne, FileText } from "@mynaui/icons-react"

export function ProgramDetailPage() {
  const programs = useStore(selectPrograms)
  const universities = useStore(selectUniversities)
  const products = useStore(selectProducts)
  const interactions = useStore(selectInteractions)
  const streams = useStore(selectStreams)
  const applications = useStore(selectApplications)
  const catalog = useStageCatalog()
  const { id } = useParams()
  const program = programs.find((p) => p.id === id)
  const programName = program?.name ?? ""
  useEffect(() => {
    if (id && programName) trackVisit("PROGRAM", id, programName)
  }, [id, programName])

  if (!program) return <div className="p-6">Программа не найдена</div>

  const progInteractions = interactions.filter((i) => i.directionId === program.directionId)
  const progStreams = streams.filter((s) => s.programId === program.id)
  const progApplications = applications.filter((a) => a.programId === program.id)
  const progProducts = products.filter((p) => p.id === program.productId)
  const convRate = progApplications.length
    ? Math.round((progApplications.filter((a) => a.status === "enrolled").length / progApplications.length) * 100)
    : 0

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/programs">
          <Button variant="ghost" size="icon" aria-label="Назад"><ArrowLeft className="size-4" /></Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{program.name}</h1>
          <p className="text-sm text-muted-foreground">{program.directionName}{program.productName ? ` · ${program.productName}` : ""}</p>
        </div>
        <Badge variant={program.isActive ? "default" : "secondary"} className="ml-auto">
          {program.isActive ? "Активна" : "Архив"}
        </Badge>
      </div>

      <p className="text-muted-foreground">{program.hoursTotal ? `Часы: ${program.hoursTotal}` : "Часы не указаны"}{program.productName ? ` · Продукт: ${program.productName}` : ""}</p>

      {/* Metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Заявки", value: progApplications.length.toLocaleString("ru-RU"), icon: FileText, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-950/40" },
          { label: "Обучаются сейчас", value: studyingNow(progStreams).toLocaleString("ru-RU"), icon: Users, color: "text-green-600 dark:text-green-400", bg: "bg-green-50 dark:bg-green-950/40" },
          { label: "Потоков идёт", value: activeStreams(progStreams).length, icon: LayersOne, color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-50 dark:bg-violet-950/40" },
          { label: "Конверсия", value: `${convRate}%`, icon: TrendingUp, color: "text-orange-600 dark:text-orange-400", bg: "bg-orange-50 dark:bg-orange-950/40" },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="flex items-center gap-4 p-4">
              <div className={`flex size-10 items-center justify-center rounded-full ${stat.bg}`}>
                <stat.icon className={`size-5 ${stat.color}`} />
              </div>
              <div>
                <div className="text-2xl font-bold">{stat.value}</div>
                <div className="text-sm text-muted-foreground">{stat.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Streams */}
        <Card>
          <CardHeader><CardTitle className="text-base">Потоки ({progStreams.length})</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {progStreams.length === 0 && <p className="text-sm text-muted-foreground">Потоков пока нет</p>}
            {progStreams.map((s) => {
              const uni = s.universityId ? universities.find((u) => u.id === s.universityId) : undefined
              const status = STREAM_STATUS_LABELS[s.status]
              return (
                <div key={s.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <div className="text-sm font-medium">
                      {s.universityId ? (uni?.shortName ?? s.universityName ?? "Вуз") : "Набор на сайте"}
                      {s.name && <span className="text-muted-foreground"> · {s.name}</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {s.studentsCount} обучающихся · старт {new Date(s.startDate).toLocaleDateString("ru-RU")}
                    </div>
                  </div>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </div>
              )
            })}
          </CardContent>
        </Card>

        {/* Applications */}
        <Card>
          <CardHeader><CardTitle className="text-base">Заявки ({progApplications.length})</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {progApplications.length === 0 && <p className="text-sm text-muted-foreground">Заявок пока нет</p>}
            {progApplications.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <div className="text-sm font-medium">{a.applicantName}</div>
                  <div className="text-xs text-muted-foreground">{a.applicantEmail} · {a.source}</div>
                </div>
                <Badge variant={a.status === "enrolled" ? "default" : a.status === "new" ? "outline" : "secondary"}>
                  {a.status === "enrolled" ? "Зачислен" : a.status === "new" ? "Новая" : "В обработке"}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* IT Products */}
      <Card>
        <CardHeader><CardTitle className="text-base">IT-продукты ({progProducts.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Название</TableHead>
                <TableHead>Вендор</TableHead>
                <TableHead>Описание</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {progProducts.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="font-mono text-sm">{p.vendorName}</TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{p.description ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Linked interactions */}
      <Card>
        <CardHeader><CardTitle className="text-base">Взаимодействия ({progInteractions.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Вуз</TableHead>
                <TableHead>Продукт</TableHead>
                <TableHead>Этап</TableHead>
                <TableHead>Прогресс</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {progInteractions.map((inter) => {
                const uni = inter.universityId ? universities.find((u) => u.id === inter.universityId) : undefined
                const { pct } = stageProgress(catalog[inter.segment], inter.currentStateKey)
                return (
                  <TableRow key={inter.id}>
                    <TableCell className="font-medium">{uni?.shortName ?? inter.universityShortName ?? inter.counterpartyName}</TableCell>
                    <TableCell>{inter.productName ?? "—"}</TableCell>
                    <TableCell><Badge>{inter.currentStateLabel}</Badge></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs font-mono">{pct}%</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Link to={`/interactions/${inter.id}`}><Button variant="ghost" size="sm">Открыть</Button></Link>
                    </TableCell>
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
