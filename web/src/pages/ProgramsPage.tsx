import { useNavigate } from "react-router-dom"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { TrendingUp, Users, LayersOne, FileText } from "@mynaui/icons-react"
import { useStore } from "@/app/store"
import { selectApplications, selectPrograms, selectStreams } from "@/app/store/selectors"
import { activeStreams, studyingNow } from "@/shared/lib/streams"

export function ProgramsPage() {
  const programs = useStore(selectPrograms)
  const streams = useStore(selectStreams)
  const applications = useStore(selectApplications)
  // Обучающиеся и параллельные потоки — по идущим потокам (ранжирование по ТЗ).
  const studentsOf = (programId: string) => studyingNow(streams.filter((s) => s.programId === programId))
  const appsOf = (programId: string) =>
    applications.filter((a) => a.programId === programId).length
  const streamsOf = (programId: string) =>
    activeStreams(streams.filter((s) => s.programId === programId)).length
  const convOf = (programId: string) => {
    const apps = applications.filter((a) => a.programId === programId)
    if (apps.length === 0) return 0
    const enrolled = apps.filter((a) => a.status === "enrolled").length
    return Math.round((enrolled / apps.length) * 100)
  }
  const navigate = useNavigate()
  const sorted = [...programs].sort(
    (a, b) => studentsOf(b.id) - studentsOf(a.id) || appsOf(b.id) - appsOf(a.id) || a.name.localeCompare(b.name, "ru"),
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Образовательные программы</h1>
        <p className="text-sm text-muted-foreground">IT-направления с метриками востребованности</p>
      </div>

      {/* Top metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex size-10 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-950/40">
              <FileText className="size-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <div className="text-2xl font-bold">
                {applications.length.toLocaleString("ru-RU")}
              </div>
              <div className="text-sm text-muted-foreground">Заявок всего</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex size-10 items-center justify-center rounded-full bg-green-50 dark:bg-green-950/40">
              <Users className="size-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <div className="text-2xl font-bold">
                {studyingNow(streams).toLocaleString("ru-RU")}
              </div>
              <div className="text-sm text-muted-foreground">Обучающихся</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex size-10 items-center justify-center rounded-full bg-violet-50 dark:bg-violet-950/40">
              <LayersOne className="size-5 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <div className="text-2xl font-bold">
                {activeStreams(streams).length}
              </div>
              <div className="text-sm text-muted-foreground">Параллельных потоков</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Ranking table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="size-4" />
            Ранжирование программ
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>Программа</TableHead>
                <TableHead>Направление</TableHead>
                <TableHead>Продукт</TableHead>
                <TableHead className="text-right">Заявки</TableHead>
                <TableHead className="text-right">Обучающиеся</TableHead>
                <TableHead className="text-right">Потоки</TableHead>
                <TableHead className="text-right">Конверсия</TableHead>
                <TableHead>Статус</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((program, idx) => (
                <TableRow key={program.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/programs/${program.id}`)}>
                  <TableCell className="font-mono text-muted-foreground">{idx + 1}</TableCell>
                  <TableCell className="min-w-48 whitespace-normal font-medium">{program.name}</TableCell>
                  <TableCell className="whitespace-normal">{program.directionName}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {program.productName ?? "—"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {appsOf(program.id).toLocaleString("ru-RU")}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {studentsOf(program.id).toLocaleString("ru-RU")}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {streamsOf(program.id)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {convOf(program.id)}%
                  </TableCell>
                  <TableCell>
                    <Badge variant={program.isActive ? "default" : "secondary"}>
                      {program.isActive ? "Активна" : "Архив"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
