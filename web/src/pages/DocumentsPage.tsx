import { useEffect } from "react"
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
import { FileText, Clock1, CheckCircle } from "@mynaui/icons-react"
import { useStore } from "@/app/store"
import { selectDocuments, selectInteractions, selectUniversities } from "@/app/store/selectors"
import { dataSource } from "@/shared/config"
import type { Document } from "@/types"

const SCAN_LABELS: Record<NonNullable<Document["attachment"]>["scanStatus"], { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  CLEAN: { label: "Проверен", variant: "default" },
  SKIPPED: { label: "Без проверки", variant: "secondary" },
  PENDING: { label: "Проверяется", variant: "outline" },
  INFECTED: { label: "Угроза", variant: "destructive" },
  ERROR: { label: "Ошибка проверки", variant: "destructive" },
}

/**
 * Режим API: реестр файлов взаимодействий. Документооборота со статусами
 * «черновик — согласование — подписан» у бэкенда нет; файлы прикладываются
 * к этапам процесса и проверяются антивирусом.
 */
function AttachmentsRegistry() {
  const documents = useStore(selectDocuments)
  const interactions = useStore(selectInteractions)
  const loaded = useStore((s) => s.allAttachmentsLoaded)
  const loadAllAttachments = useStore((s) => s.loadAllAttachments)
  const navigate = useNavigate()

  useEffect(() => {
    void loadAllAttachments()
  }, [loadAllAttachments])

  const sorted = [...documents].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
  const clean = documents.filter((d) => d.attachment?.scanStatus === "CLEAN").length
  const attention = documents.filter((d) => ["INFECTED", "ERROR", "PENDING"].includes(d.attachment?.scanStatus ?? "")).length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Документы</h1>
        <p className="text-sm text-muted-foreground">Файлы, приложенные к этапам взаимодействий</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: "Всего файлов", value: documents.length, icon: FileText },
          { label: "Проверено антивирусом", value: clean, icon: CheckCircle },
          { label: "Требуют внимания", value: attention, icon: Clock1 },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                <stat.icon className="size-5 text-muted-foreground" />
              </div>
              <div>
                <div className="text-2xl font-bold">{stat.value}</div>
                <div className="text-sm text-muted-foreground">{stat.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Все файлы ({documents.length}){!loaded && " · загрузка…"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Файл</TableHead>
                <TableHead>Взаимодействие</TableHead>
                <TableHead>Этап</TableHead>
                <TableHead>Загрузил</TableHead>
                <TableHead>Проверка</TableHead>
                <TableHead>Дата</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loaded && sorted.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-sm text-muted-foreground">Файлов пока нет</TableCell>
                </TableRow>
              )}
              {sorted.map((doc) => {
                const interaction = interactions.find((i) => i.id === doc.interactionId)
                const scan = doc.attachment ? SCAN_LABELS[doc.attachment.scanStatus] : null
                return (
                  <TableRow
                    key={doc.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/interactions/${doc.interactionId}`)}
                  >
                    {/* Длинные названия переносятся: иначе колонка даты уходит за край карточки. */}
                    <TableCell className="whitespace-normal font-medium">{doc.name}</TableCell>
                    <TableCell className="whitespace-normal">
                      {interaction ? `${interaction.universityShortName ?? interaction.counterpartyName} · ${interaction.directionName}` : "—"}
                    </TableCell>
                    <TableCell className="text-sm">{doc.attachment?.stateLabel ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{doc.attachment?.uploadedByName}</TableCell>
                    <TableCell>{scan && <Badge variant={scan.variant}>{scan.label}</Badge>}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(doc.createdAt).toLocaleDateString("ru-RU")}
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

const statusLabels: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  draft: { label: "Черновик", variant: "secondary" },
  review: { label: "На согласовании", variant: "outline" },
  signed: { label: "Подписан", variant: "default" },
  rejected: { label: "Отклонён", variant: "destructive" },
}

const typeLabels: Record<string, string> = {
  contract: "Договор",
  appendix: "Приложение",
  act: "Акт",
  license_agreement: "Лиц. соглашение",
  other: "Другое",
}

export function DocumentsPage() {
  return dataSource === "api" ? <AttachmentsRegistry /> : <DocumentsDemo />
}

/** Демо-режим: внутренний документооборот на моках. */
function DocumentsDemo() {
  const documents = useStore(selectDocuments)
  const universities = useStore(selectUniversities)
  const interactions = useStore(selectInteractions)
  const navigate = useNavigate()
  const signed = documents.filter((d) => d.status === "signed").length
  const inReview = documents.filter((d) => d.status === "review").length
  const drafts = documents.filter((d) => d.status === "draft").length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Документы</h1>
        <p className="text-sm text-muted-foreground">Управление документооборотом по взаимодействиям</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex size-10 items-center justify-center rounded-full bg-green-50 dark:bg-green-950/40">
              <CheckCircle className="size-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <div className="text-2xl font-bold">{signed}</div>
              <div className="text-sm text-muted-foreground">Подписано</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex size-10 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-950/40">
              <Clock1 className="size-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <div className="text-2xl font-bold">{inReview}</div>
              <div className="text-sm text-muted-foreground">На согласовании</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex size-10 items-center justify-center rounded-full bg-muted">
              <FileText className="size-5 text-muted-foreground" />
            </div>
            <div>
              <div className="text-2xl font-bold">{drafts}</div>
              <div className="text-sm text-muted-foreground">Черновиков</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Все документы ({documents.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Название</TableHead>
                <TableHead>Тип</TableHead>
                <TableHead>Вуз</TableHead>
                <TableHead>Версия</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Обновлён</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc) => {
                const interaction = interactions.find((i) => i.id === doc.interactionId)
                const uni = universities.find((u) => u.id === interaction?.universityId)
                const status = statusLabels[doc.status]
                return (
                  <TableRow key={doc.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/documents/${doc.id}`)}>
                    <TableCell className="font-medium">{doc.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{typeLabels[doc.type]}</Badge>
                    </TableCell>
                    <TableCell>{uni?.shortName}</TableCell>
                    <TableCell className="font-mono text-sm">v{doc.version}</TableCell>
                    <TableCell>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{doc.updatedAt}</TableCell>
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
