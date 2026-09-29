import { useParams, Link } from "react-router-dom"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useStore } from "@/app/store"
import { selectDocuments, selectInteractions, selectUniversities } from "@/app/store/selectors"
import { ArrowLeft, FileText } from "@mynaui/icons-react"

const typeLabels: Record<string, string> = {
  contract: "Договор",
  appendix: "Приложение",
  act: "Акт",
  license_agreement: "Лицензионное соглашение",
  other: "Другое",
}

const statusLabels: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  draft: { label: "Черновик", variant: "secondary" },
  review: { label: "На согласовании", variant: "outline" },
  signed: { label: "Подписан", variant: "default" },
  rejected: { label: "Отклонён", variant: "destructive" },
}

export function DocumentDetailPage() {
  const documents = useStore(selectDocuments)
  const universities = useStore(selectUniversities)
  const interactions = useStore(selectInteractions)
  const { id } = useParams()
  const doc = documents.find((d) => d.id === id)

  if (!doc) return <div className="p-6">Документ не найден</div>

  const interaction = interactions.find((i) => i.id === doc.interactionId)
  const uni = universities.find((u) => u.id === interaction?.universityId)
  const status = statusLabels[doc.status]

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/documents">
          <Button variant="ghost" size="icon" aria-label="Назад"><ArrowLeft className="size-4" /></Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{doc.name}</h1>
          <p className="text-sm text-muted-foreground">{typeLabels[doc.type]} · v{doc.version}</p>
        </div>
        <Badge variant={status.variant} className="ml-auto">{status.label}</Badge>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Информация</CardTitle></CardHeader>
          <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div><span className="text-muted-foreground">Тип:</span> {typeLabels[doc.type]}</div>
              <div><span className="text-muted-foreground">Версия:</span> v{doc.version}</div>
              <div><span className="text-muted-foreground">Создан:</span> {doc.createdAt}</div>
              <div><span className="text-muted-foreground">Обновлён:</span> {doc.updatedAt}</div>
              <div><span className="text-muted-foreground">Статус:</span> <Badge variant={status.variant} className="ml-1">{status.label}</Badge></div>
              {doc.fileUrl && <div><span className="text-muted-foreground">Файл:</span> <a href={doc.fileUrl} className="text-primary hover:underline">Скачать</a></div>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Привязка</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {interaction && (
              <>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <div className="text-sm text-muted-foreground">Взаимодействие</div>
                    <div className="text-sm font-medium">{uni?.shortName} — {interaction.directionName}</div>
                  </div>
                  <Link to={`/interactions/${interaction.id}`}><Button variant="ghost" size="sm">Открыть</Button></Link>
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <div className="text-sm text-muted-foreground">Вуз</div>
                    <div className="text-sm font-medium">{uni?.name}</div>
                  </div>
                  <Link to={`/universities/${uni?.id}`}><Button variant="ghost" size="sm">Открыть</Button></Link>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <Card>
        <CardHeader><CardTitle className="text-base">Действия</CardTitle></CardHeader>
        <CardContent className="flex gap-3">
          {doc.status === "draft" && <Button>Отправить на согласование</Button>}
          {doc.status === "review" && <Button>Подписать</Button>}
          {doc.status === "review" && <Button variant="destructive">Отклонить</Button>}
          {doc.status === "signed" && <span className="text-sm text-muted-foreground flex items-center gap-2"><FileText className="size-4" />Документ подписан, действий не требуется</span>}
          <Button variant="outline">Загрузить новую версию</Button>
        </CardContent>
      </Card>
    </div>
  )
}
