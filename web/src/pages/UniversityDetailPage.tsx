import { useEffect, useState } from "react"
import { useParams, Link, useNavigate } from "react-router-dom"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useStore } from "@/app/store"
import {
  selectDocuments,
  selectInteractions,
  selectPrograms,
  selectStreams,
  selectUniversities,
} from "@/app/store/selectors"
import { ArrowLeft, Globe, MapPin, Plus } from "@mynaui/icons-react"
import { Input } from "@/components/ui/input"
import { dataSource } from "@/shared/config"
import type { Interaction } from "@/types"
import { STREAM_STATUS_LABELS, studyingNow } from "@/shared/lib/streams"
import { trackVisit, useDraft } from "@/shared/lib/workspace"
import { toast } from "@/shared/lib/toast-store"
import { useStageCatalog } from "@/app/use-stages"
import { stageProgress } from "@/app/workflow-stages"
import { CreateEngagementDialog } from "@/components/CreateEngagementDialog"

const isApi = dataSource === "api"

const VALIDITY_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  ACTIVE: { label: "Действует", variant: "default" },
  EXPIRED: { label: "Истекла", variant: "destructive" },
  UNKNOWN: { label: "Срок не указан", variant: "secondary" },
}

const TRANSFER_LABELS: Record<string, string> = {
  NOT_STARTED: "не передана",
  IN_PROGRESS: "передаётся",
  TRANSFERRED: "передана",
  REJECTED: "отклонена",
}

/** Заметка в ленте вуза: по вузу целиком либо по одному из его взаимодействий. */
interface UniversityFeedNote {
  id: string
  body: string
  authorName: string
  createdAt: string
  isPinned: boolean
  engagementId: string | null
  stateLabel: string | null
}

/** Локальный id для fallback-создания, когда бек недоступен (вне render-scope). */
function localInteractionId(): string {
  return `i-${Date.now()}`
}

export function UniversityDetailPage() {
  const universities = useStore(selectUniversities)
  const programs = useStore(selectPrograms)
  const interactions = useStore(selectInteractions)
  const documents = useStore(selectDocuments)
  const streams = useStore(selectStreams)
  const directions = useStore((s) => s.directions)
  const user = useStore((s) => s.user)
  const addInteraction = useStore((s) => s.addInteraction)
  const notes = useStore((s) => s.notes)
  const addUniversityNote = useStore((s) => s.addUniversityNote)
  const [creating, setCreating] = useState(false)
  const [savingNote, setSavingNote] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const { id } = useParams()
  // Недописанная заметка по вузу — черновик рабочего контекста (ТЗ, п. 13).
  const draft = useDraft("university.note", id)
  const noteDraft = draft.text
  const setNoteDraft = draft.setText
  const navigate = useNavigate()
  const uni = universities.find((u) => u.id === id)
  const visitTitle = uni ? (uni.shortName ?? uni.name) : ""
  useEffect(() => {
    if (id && visitTitle) trackVisit("UNIVERSITY", id, visitTitle)
  }, [id, visitTitle])
  const catalog = useStageCatalog()
  const contacts = useStore((s) => (id ? s.universityContacts[id] : undefined))
  const contracts = useStore((s) => (id ? s.universityContracts[id] : undefined))
  const universityNotes = useStore((s) => (id ? s.universityNotes[id] : undefined))
  const loadUniversityExtras = useStore((s) => s.loadUniversityExtras)
  const loadNotes = useStore((s) => s.loadNotes)
  const loadAttachments = useStore((s) => s.loadAttachments)
  const engagementIds = interactions.filter((i) => i.universityId === id).map((i) => i.id).join(",")

  // Режим API: контакты, договоры и заметки вуза, а также заметки
  // и файлы его взаимодействий — в общую ленту карточки.
  useEffect(() => {
    if (!isApi || !id) return
    void loadUniversityExtras(id)
    for (const engagementId of engagementIds.split(",").filter(Boolean)) {
      void loadNotes(engagementId)
      void loadAttachments(engagementId)
    }
  }, [id, engagementIds, loadUniversityExtras, loadNotes, loadAttachments])

  if (!uni) return <div className="p-6">Вуз не найден</div>

  const uniInteractions = interactions.filter((i) => i.universityId === uni.id)
  const uniStreams = streams
    .filter((s) => s.universityId === uni.id)
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
  const studyingHere = studyingNow(uniStreams)
  const interactionIds = uniInteractions.map((i) => i.id)
  const uniDocs = documents.filter((d) => interactionIds.includes(d.interactionId))
  // Лента заметок: закреплённые по вузу первыми, дальше всё по времени.
  const uniNotes: UniversityFeedNote[] = [
    ...(universityNotes ?? []).map((n) => ({
      id: n.id,
      body: n.body,
      authorName: n.author.name,
      createdAt: n.createdAt,
      isPinned: n.isPinned,
      engagementId: null,
      stateLabel: null,
    })),
    ...(isApi
      ? interactionIds.flatMap((engagementId) =>
          (notes[engagementId] ?? []).map((n) => ({
            id: n.id,
            body: n.body,
            authorName: n.author.name,
            createdAt: n.createdAt,
            isPinned: false,
            engagementId,
            stateLabel: n.stateLabel || null,
          })),
        )
      : []),
  ].sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || +new Date(b.createdAt) - +new Date(a.createdAt))

  const submitNote = async () => {
    const body = noteDraft.trim()
    if (!body || savingNote) return
    setSavingNote(true)
    const result = await addUniversityNote(uni.id, body, {
      id: user?.id ?? "system",
      name: user?.displayName ?? "Система",
    })
    setSavingNote(false)
    if (!result.ok) {
      toast.error("Заметка не сохранена", result.error)
      return
    }
    draft.clear()
    toast.success("Заметка добавлена")
  }

  const handleCreate = async () => {
    if (isApi) {
      setCreateOpen(true)
      return
    }
    if (creating) return
    const dir = directions.find((d) => d.isActive) ?? directions[0]
    if (!dir) return
    setCreating(true)
    // Демо-режим: взаимодействие создаётся локально на первом этапе.
    const first = catalog.B2B[0]
    const now = new Date().toISOString().slice(0, 10)
    const item: Interaction = {
      id: localInteractionId(),
      segment: "B2B",
      counterpartyType: "COMPANY",
      counterpartyName: uni.name,
      universityName: uni.name,
      universityShortName: uni.shortName,
      universityId: uni.id,
      directionName: dir.name,
      directionId: dir.id,
      productName: null,
      ownerName: user?.displayName ?? "—",
      ownerId: user?.id ?? "",
      currentStateKey: first?.key ?? "",
      currentStateLabel: first?.label ?? "",
      slaDueAt: null,
      isOverdue: false,
      createdAt: now,
      updatedAt: now,
    } as Interaction
    addInteraction(item)
    setCreating(false)
    toast.success("Взаимодействие создано", uni.shortName ?? undefined)
    navigate(`/interactions/${item.id}`)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/universities">
          <Button variant="ghost" size="icon" aria-label="Назад"><ArrowLeft className="size-4" /></Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{uni.shortName}</h1>
          <p className="text-sm text-muted-foreground">{uni.name}</p>
        </div>
        <Badge variant={uni.isActive ? "default" : "secondary"} className="ml-auto">
          {uni.isActive ? "Активный" : "Неактивный"}
        </Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_30%]">
        <div className="space-y-6 min-w-0">
      {/* Info + Contacts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Информация</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 text-sm"><MapPin className="size-4 text-muted-foreground" />{uni.city}, {uni.region}</div>
            {uni.website && <div className="flex items-center gap-2 text-sm"><Globe className="size-4 text-muted-foreground" /><a href={uni.website} target="_blank" rel="noreferrer" className="text-primary hover:underline">{uni.website}</a></div>}
            <div className="text-sm text-muted-foreground">ИНН: {uni.inn ?? "—"}</div>
            <div className="text-sm text-muted-foreground">Взаимодействий: {uni.engagementCount}</div>
            <div className="text-sm text-muted-foreground">Создан: {new Date(uni.createdAt).toLocaleDateString("ru-RU")}</div>
          </CardContent>
        </Card>

        {isApi ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ответственные от вуза ({contacts?.length ?? 0})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!contacts && <p className="text-sm text-muted-foreground">Загрузка…</p>}
              {contacts?.length === 0 && <p className="text-sm text-muted-foreground">Контактов пока нет</p>}
              {contacts?.map((c) => (
                <div key={c.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{c.fullName}</span>
                    {c.isPrimary && <Badge variant="outline">основной</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {[c.position, c.role].filter(Boolean).join(" · ") || "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {[c.email, c.phone].filter(Boolean).join(" · ")}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Контакты и реквизиты</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg border p-3">
              <div className="text-sm text-muted-foreground">ИНН</div>
              <div className="font-medium text-sm font-mono">{uni.inn ?? "—"}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-sm text-muted-foreground">Сайт</div>
              {uni.website ? (
                <a href={uni.website} target="_blank" rel="noreferrer" className="font-medium text-sm text-primary hover:underline">{uni.website}</a>
              ) : (
                <div className="font-medium text-sm">—</div>
              )}
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-sm text-muted-foreground">Взаимодействий</div>
              <div className="font-medium text-sm">{uni.engagementCount}</div>
            </div>
          </CardContent>
        </Card>
        )}
      </div>

      {/* Interactions */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Взаимодействия ({uniInteractions.length})</CardTitle>
            <Button
              variant="outline"
              size="sm"
              disabled={creating || directions.length === 0}
              onClick={handleCreate}
            >
              <Plus className="size-3.5" />Новое взаимодействие
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Направление</TableHead>
                <TableHead>IT-продукт</TableHead>
                <TableHead>Этап</TableHead>
                <TableHead>Прогресс</TableHead>
                <TableHead>Обновлено</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {uniInteractions.map((inter) => {
                const { pct } = stageProgress(catalog[inter.segment], inter.currentStateKey)
                return (
                  // Строка целиком ведёт в карточку: отдельная колонка с кнопкой
                  // «Открыть» не помещалась в карточку и обрезалась.
                  <TableRow
                    key={inter.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/interactions/${inter.id}`)}
                  >
                    <TableCell className="whitespace-normal font-medium">{inter.directionName}</TableCell>
                    <TableCell>{inter.productName ?? "—"}</TableCell>
                    <TableCell><Badge>{inter.currentStateLabel}</Badge></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-2 min-w-16 flex-1 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs font-mono">{pct}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{new Date(inter.updatedAt).toLocaleDateString("ru-RU")}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Договоры, потоки, файлы: карточка делит ширину с заметками, поэтому не больше двух колонок */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Договоры и лицензии ({contracts?.length ?? 0})</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {!contracts && <p className="text-sm text-muted-foreground">{isApi ? "Загрузка…" : "Договоров пока нет"}</p>}
            {contracts?.length === 0 && <p className="text-sm text-muted-foreground">Договоров пока нет</p>}
            {contracts?.map((c) => (
              <div key={c.id} className="rounded-lg border p-3 text-sm">
                <div className="font-medium">Договор {c.number}</div>
                <div className="text-xs text-muted-foreground">
                  {c.signedAt ? `подписан ${new Date(c.signedAt).toLocaleDateString("ru-RU")}` : "дата подписания не указана"}
                  {c.comment ? ` · ${c.comment}` : ""}
                </div>
                <div className="mt-2 space-y-1.5">
                  {c.licenses.map((l) => {
                    const validity = VALIDITY_LABELS[l.validity] ?? VALIDITY_LABELS.UNKNOWN
                    return (
                      <div key={l.id} className="rounded-md bg-muted/40 px-2 py-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate">
                            {l.productName} <span className="text-xs text-muted-foreground">· {l.vendorName}</span>
                          </span>
                          <Badge variant={validity.variant} className="shrink-0 text-[10px]">{validity.label}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {[
                            l.validUntil ? `до ${new Date(l.validUntil).toLocaleDateString("ru-RU")}` : null,
                            TRANSFER_LABELS[l.transferStatus] ?? l.transferStatus,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </div>
                    )
                  })}
                  {c.licenses.length === 0 && <div className="text-xs text-muted-foreground">Лицензий по договору нет</div>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Потоки ({uniStreams.length})</CardTitle>
            {studyingHere > 0 && (
              <p className="text-xs text-muted-foreground">Обучается сейчас: {studyingHere}</p>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {uniStreams.length === 0 && <p className="text-sm text-muted-foreground">Потоков пока нет</p>}
            {uniStreams.map((s) => {
              const prog = programs.find((p) => p.id === s.programId)
              const status = STREAM_STATUS_LABELS[s.status]
              return (
                <div key={s.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium">{prog?.name ?? s.programName}</div>
                      {s.name && <div className="text-xs text-muted-foreground">{s.name}</div>}
                    </div>
                    <Badge variant={status.variant} className="shrink-0 text-xs">{status.label}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {s.studentsCount} обучающихся · старт {new Date(s.startDate).toLocaleDateString("ru-RU")}
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>

        {isApi ? (
          <Card>
            <CardHeader><CardTitle className="text-base">Файлы взаимодействий ({uniDocs.length})</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {uniDocs.length === 0 && <p className="text-sm text-muted-foreground">Файлов пока нет</p>}
              {uniDocs.map((d) => (
                <Link key={d.id} to={`/interactions/${d.interactionId}`} className="block rounded-lg border p-3 text-sm hover:bg-muted/50">
                  <div className="font-medium truncate">{d.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {[d.attachment?.stateLabel, d.attachment?.uploadedByName, new Date(d.createdAt).toLocaleDateString("ru-RU")]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader><CardTitle className="text-base">Документы ({uniDocs.length})</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {uniDocs.map((d) => (
                <div key={d.id} className="rounded-lg border p-3 text-sm">
                  <div className="font-medium truncate">{d.name}</div>
                  <div className="text-xs text-muted-foreground">v{d.version}</div>
                  <Badge variant={d.status === "signed" ? "default" : d.status === "review" ? "outline" : "secondary"} className="mt-1 text-xs">
                    {d.status === "signed" ? "Подписан" : d.status === "review" ? "На согласовании" : "Черновик"}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

          {/* Длинная кнопка создания — после всей информации */}
          <Button
            className="h-11 w-full"
            disabled={creating || directions.length === 0}
            onClick={handleCreate}
          >
            <Plus className="size-4" />
            {creating ? "Создание…" : "Добавить взаимодействие"}
          </Button>
        </div>

        {/* Заметки-чат по вузу (30% экрана) */}
        <aside>
          <Card className="sticky top-6">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Заметки по вузу</CardTitle>
                <Badge variant="secondary">{uniNotes.length}</Badge>
              </div>
              {isApi && (
                <p className="text-xs text-muted-foreground">Вместе с заметками из карточек взаимодействий вуза</p>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
                {uniNotes.length === 0 && (
                  <p className="text-sm text-muted-foreground">Заметок пока нет</p>
                )}
                {uniNotes.map((n) => (
                  <div key={n.id} className={`rounded-lg border p-3 ${n.isPinned ? "border-primary/30 bg-primary/5" : "bg-muted/40"}`}>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium">{n.authorName}</span>
                      <span className="text-muted-foreground">
                        {new Date(n.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    {n.engagementId ? (
                      <Link to={`/interactions/${n.engagementId}`} className="mt-1 inline-block">
                        <Badge variant="outline" className="text-[10px]">{n.stateLabel ?? "Взаимодействие"}</Badge>
                      </Link>
                    ) : (
                      n.isPinned && <Badge variant="secondary" className="mt-1 text-[10px]">Закреплена</Badge>
                    )}
                    <p className="mt-1 whitespace-pre-wrap text-sm">{n.body}</p>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submitNote()
                  }}
                  placeholder="Заметка по вузу…"
                  className="h-9"
                />
                <Button size="sm" disabled={!noteDraft.trim() || savingNote} onClick={() => void submitNote()}>
                  Отправить
                </Button>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
      <CreateEngagementDialog open={createOpen} onOpenChange={setCreateOpen} universityId={uni.id} />
    </div>
  )
}
