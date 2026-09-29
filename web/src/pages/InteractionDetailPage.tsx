import { useEffect, useRef, useState } from "react"
import { useParams, Link } from "react-router-dom"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useStore } from "@/app/store"
import {
  selectActivityEvents,
  selectDocuments,
  selectInteractions,
} from "@/app/store/selectors"
import { ArrowLeft, FileText, ChartBubble } from "@mynaui/icons-react"
import {
  ArrowRight,
  Building2,
  Gauge,
  GitBranch,
  ListTodo,
  MessageSquareText,
  Trash2,
  UserRound,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "@/shared/lib/toast-store"
import { api, type AttachmentDto, type AvailableTransitionDto, type UniversityContactDto } from "@/shared/api"
import { dataSource } from "@/shared/config"
import { StageCanvas, type GraphNode } from "@/components/ui/stage-canvas"
import { useStages } from "@/app/use-stages"
import { stageProgress } from "@/app/workflow-stages"
import { TransitionDialog, type PendingTransition } from "@/components/TransitionDialog"
import { MeetingsCard } from "@/components/MeetingsCard"
import { trackVisit, useDraft } from "@/shared/lib/workspace"
import { ROLE_LABELS } from "@/shared/lib/roles"

const stageStatusColors: Record<string, string> = {
  not_started: "bg-muted text-muted-foreground",
  in_progress: "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800/30",
  completed: "bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800/30",
  blocked: "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800/30",
}

const SCAN_LABELS: Record<AttachmentDto["scanStatus"], { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  CLEAN: { label: "Проверен", variant: "default" },
  SKIPPED: { label: "Без проверки", variant: "secondary" },
  PENDING: { label: "Проверяется", variant: "outline" },
  INFECTED: { label: "Угроза", variant: "destructive" },
  ERROR: { label: "Ошибка проверки", variant: "destructive" },
}

const isApi = dataSource === "api"
const EMPTY_UNIVERSITY_CONTACTS: UniversityContactDto[] = []

const formatDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString("ru-RU") : "—"

const formatDateTime = (value: string) =>
  new Date(value).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

export function InteractionDetailPage() {
  const interactions = useStore(selectInteractions)
  const documents = useStore(selectDocuments)
  const activityEvents = useStore(selectActivityEvents)
  const notes = useStore((s) => s.notes)
  const addNote = useStore((s) => s.addNote)
  const archivedIds = useStore((s) => s.archivedIds)
  const archiveInteraction = useStore((s) => s.archiveInteraction)
  const restoreInteraction = useStore((s) => s.restoreInteraction)
  const user = useStore((s) => s.user)
  const employees = useStore((s) => s.adminUsers)
  const details = useStore((s) => s.engagementDetails)
  const attachmentsById = useStore((s) => s.attachments)
  const timelines = useStore((s) => s.timelines)
  const tasks = useStore((s) => s.calendarTasks)
  const loadEngagement = useStore((s) => s.loadEngagement)
  const loadNotes = useStore((s) => s.loadNotes)
  const loadAttachments = useStore((s) => s.loadAttachments)
  const loadTimeline = useStore((s) => s.loadTimeline)
  const loadUniversityExtras = useStore((s) => s.loadUniversityExtras)
  const performTransition = useStore((s) => s.performTransition)
  const uploadAttachment = useStore((s) => s.uploadAttachment)
  const removeAttachment = useStore((s) => s.removeAttachment)
  const reassignEngagement = useStore((s) => s.reassignEngagement)
  const createTask = useStore((s) => s.createTask)
  const toggleTask = useStore((s) => s.toggleTask)
  const removeNote = useStore((s) => s.removeNote)
  const { id } = useParams()
  // Недописанная заметка — черновик рабочего контекста (ТЗ, п. 13).
  const noteDraft = useDraft("engagement.note", id)
  const noteText = noteDraft.text
  const setNoteText = noteDraft.setText
  const [pending, setPending] = useState<PendingTransition | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [taskTitle, setTaskTitle] = useState("")
  const [taskDue, setTaskDue] = useState("")
  const fileInput = useRef<HTMLInputElement>(null)

  const interaction = interactions.find((i) => i.id === id)
  const universityContacts = useStore((s) => (
    interaction?.universityId
      ? s.universityContacts[interaction.universityId] ?? EMPTY_UNIVERSITY_CONTACTS
      : EMPTY_UNIVERSITY_CONTACTS
  ))

  // Режим API: карточка, заметки, вложения и история — с бэкенда.
  useEffect(() => {
    if (!id || !isApi) return
    void loadEngagement(id)
    void loadNotes(id)
    void loadAttachments(id)
    void loadTimeline(id)
  }, [id, loadEngagement, loadNotes, loadAttachments, loadTimeline])

  useEffect(() => {
    if (isApi && interaction?.universityId && universityContacts.length === 0) {
      void loadUniversityExtras(interaction.universityId)
    }
  }, [interaction?.universityId, universityContacts.length, loadUniversityExtras])

  const stages = useStages(interaction?.segment ?? "B2B")
  const visitTitle = interaction
    ? [interaction.universityShortName ?? interaction.counterpartyName, interaction.directionName].join(" · ")
    : ""
  useEffect(() => {
    if (id && visitTitle) trackVisit("ENGAGEMENT", id, visitTitle)
  }, [id, visitTitle])

  if (!interaction) return <div className="p-6">Взаимодействие не найдено</div>

  const detail = details[interaction.id]
  const title = interaction.universityShortName ?? interaction.counterpartyName
  const interDocs = documents.filter((d) => d.interactionId === interaction.id)
  const interAttachments = attachmentsById[interaction.id] ?? []
  const interTasks = tasks.filter((t) => t.engagement?.id === interaction.id)
  const interActivity = isApi
    ? (timelines[interaction.id] ?? [])
    : activityEvents.filter((e) => e.entityId === interaction.id)
  const archived = detail?.isArchived ?? archivedIds.includes(interaction.id)
  const progress = stageProgress(stages, interaction.currentStateKey)
  const currentIdx = stages.findIndex((s) => s.key === interaction.currentStateKey)
  const currentStage = stages[currentIdx]
  const interNotes = notes[interaction.id] ?? []
  const canManage = user?.role === "MANAGER" || user?.role === "ADMIN"

  // Этапы, пройденные по журналу переходов: для отказа это честнее,
  // чем «всё до текущего по порядку».
  const visitedLabels = new Set(
    (detail?.history ?? []).flatMap((h) => [h.fromStateLabel, h.toStateLabel]).filter(Boolean) as string[],
  )

  const graphNodes: GraphNode[] = stages.map((stage, stageIdx) => {
    let status: GraphNode["status"] = "not_started"
    if (stage.key === interaction.currentStateKey) {
      status = interaction.isOverdue || stage.isRejected ? "blocked" : "in_progress"
    } else if (currentStage?.isRejected ? visitedLabels.has(stage.label) : stageIdx < currentIdx) {
      status = "completed"
    }
    const summary = detail?.stages?.find((s) => s.key === stage.key)
    const stageNoteCount = summary?.noteCount ?? interNotes.filter((n) => n.stateKey === stage.key).length
    return {
      id: stage.key,
      label: stage.label,
      step: stage.step,
      status,
      description: stage.description,
      date:
        stage.key === interaction.currentStateKey
          ? formatDate(interaction.updatedAt)
          : status === "completed" && !isApi
            ? formatDate(interaction.createdAt)
            : undefined,
      assignee: interaction.ownerName,
      notes: stageNoteCount > 0 ? String(stageNoteCount) : undefined,
    }
  })

  const handleArchive = async () => {
    const reason = archived ? "" : window.prompt("Причина переноса в архив (необязательно)")
    if (reason === null) return
    const result = archived
      ? await restoreInteraction(interaction.id)
      : await archiveInteraction(interaction.id, reason || undefined)
    if (result.ok) toast.success(archived ? "Взаимодействие возвращено" : "Взаимодействие в архиве", title)
    else toast.error(archived ? "Не удалось вернуть" : "Не удалось архивировать", result.error)
  }

  const openTransition = (t: AvailableTransitionDto) => {
    setPending({
      engagementId: interaction.id,
      toStateKey: t.toStateKey,
      label: t.label,
      fromLabel: interaction.currentStateLabel,
      toLabel: t.toStateLabel,
      requiresComment: t.requiresComment,
    })
  }

  const confirmTransition = async (comment: string) => {
    if (!pending) return
    setBusy(true)
    const result = await performTransition(pending.engagementId, pending.toStateKey, comment)
    setBusy(false)
    if (result.ok) {
      toast.success("Этап обновлён", pending.toLabel)
      setPending(null)
    } else {
      toast.error("Этап не изменён", result.error)
    }
  }

  const handleUpload = async (file: File) => {
    setUploading(true)
    const result = await uploadAttachment(interaction.id, file, interaction.currentStateKey)
    setUploading(false)
    if (fileInput.current) fileInput.current.value = ""
    if (result.ok) toast.success("Файл загружен", file.name)
    else toast.error("Файл не загружен", result.error)
  }

  const handleDownload = async (a: AttachmentDto) => {
    try {
      const response = await api.attachments.download(interaction.id, a.id)
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement("a")
      link.href = url
      link.download = a.fileName
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      // ошибку показал клиент API
    }
  }

  const handleRemove = async (a: AttachmentDto) => {
    if (!window.confirm(`Удалить файл «${a.fileName}»?`)) return
    const result = await removeAttachment(interaction.id, a.id)
    if (result.ok) toast.success("Файл удалён", a.fileName)
    else toast.error("Файл не удалён", result.error)
  }

  const handleReassign = async (ownerId: string) => {
    if (!ownerId || ownerId === interaction.ownerId) return
    const result = await reassignEngagement(interaction.id, ownerId)
    const owner = employees.find((e) => e.id === ownerId)
    if (result.ok) toast.success("Ответственный изменён", owner?.displayName)
    else toast.error("Не удалось переназначить", result.error)
  }

  const handleAddTask = async () => {
    if (!taskTitle.trim() || !taskDue) return
    const result = await createTask({ title: taskTitle.trim(), dueDate: taskDue, engagementId: interaction.id })
    if (result.ok) {
      toast.success("Задача добавлена", taskTitle.trim())
      setTaskTitle("")
      setTaskDue("")
    } else {
      toast.error("Задача не добавлена", result.error)
    }
  }

  const submitNote = async (body: string, stage?: { key: string; label: string }) => {
    const result = await addNote(
      interaction.id,
      body,
      { id: user?.id ?? "system", name: user?.displayName ?? "Система" },
      stage,
    )
    if (result.ok) toast.success(stage ? "Заметка к этапу добавлена" : "Заметка сохранена", stage?.label)
    else toast.error("Заметка не сохранена", result.error)
    return result.ok
  }

  const handleRemoveNote = async (noteId: string) => {
    if (!window.confirm("Удалить заметку?")) return
    const result = await removeNote(interaction.id, noteId)
    if (result.ok) toast.success("Заметка удалена")
    else toast.error("Не удалось удалить заметку", result.error)
  }

  const primaryUniversityContact = universityContacts.find((c) => c.isPrimary) ?? universityContacts[0]

  const infoCells: { label: string; value: React.ReactNode }[] = [
    { label: "Сегмент", value: interaction.segment },
    { label: "Этап", value: interaction.currentStateLabel },
    { label: "Срок этапа", value: interaction.slaDueAt ? formatDate(interaction.slaDueAt) : "без срока" },
    { label: "Направление", value: interaction.directionName },
    { label: "ИТ-продукт", value: interaction.productName ?? "—" },
    { label: "Программа", value: detail?.programName ?? "—" },
    { label: "Создано", value: formatDate(interaction.createdAt) },
    { label: "Обновлено", value: formatDate(interaction.updatedAt) },
    { label: "Версия карточки", value: detail?.version ?? "—" },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <Link to="/interactions">
          <Button variant="ghost" size="icon" aria-label="Назад"><ArrowLeft className="size-4" /></Button>
        </Link>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{detail?.title ?? `${title} — ${interaction.directionName}`}</h1>
          <p className="text-sm text-muted-foreground">
            {interaction.universityName ?? interaction.counterpartyName} · Отв: {interaction.ownerName}
          </p>
        </div>
        <Badge className="ml-auto">{interaction.currentStateLabel}</Badge>
        {interaction.isOverdue && <Badge variant="destructive">Просрочено</Badge>}
        {archived && <Badge variant="secondary">В архиве</Badge>}
        <Button variant="outline" size="sm" onClick={() => void handleArchive()}>
          {archived ? "Вернуть" : "В архив"}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_30%]">
        <div className="space-y-6 min-w-0">
      {/* Сведения */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="size-4 text-sky-600 dark:text-sky-400" />
              Сведения
            </CardTitle>
            {isApi && canManage && employees.length > 0 && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Ответственный
                <select
                  value={interaction.ownerId}
                  disabled={archived}
                  onChange={(e) => void handleReassign(e.target.value)}
                  className="rounded-md border bg-transparent px-2 py-1 text-sm text-foreground"
                >
                  {!employees.some((e) => e.id === interaction.ownerId) && (
                    <option value={interaction.ownerId}>{interaction.ownerName}</option>
                  )}
                  {employees
                    .filter((e) => e.isActive)
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.displayName} · {ROLE_LABELS[e.role]}
                      </option>
                    ))}
                </select>
              </label>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {infoCells.map((cell) => (
              <div key={cell.label} className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">{cell.label}</div>
                <div className="truncate text-sm font-medium">{cell.value}</div>
              </div>
            ))}
          </div>
          {archived && detail?.archiveReason && (
            <p className="mt-3 text-sm text-muted-foreground">
              В архиве: {detail.archiveReason}
              {detail.archivedByName ? ` (${detail.archivedByName}, ${formatDate(detail.archivedAt)})` : ""}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Переходы по процессу (режим API): доступные из текущего этапа */}
      {isApi && (
        <>
          {primaryUniversityContact && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <UserRound className="size-4 text-emerald-600 dark:text-emerald-400" />
                  Контактное лицо вуза
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="font-medium text-foreground">{primaryUniversityContact.fullName}</div>
                {(primaryUniversityContact.position || primaryUniversityContact.role) && (
                  <div className="text-muted-foreground">
                    {primaryUniversityContact.position ?? primaryUniversityContact.role}
                    {primaryUniversityContact.role && primaryUniversityContact.position && ` · ${primaryUniversityContact.role}`}
                  </div>
                )}
                {primaryUniversityContact.email && (
                  <div>
                    <span className="text-muted-foreground">Email: </span>
                    <a href={`mailto:${primaryUniversityContact.email}`} className="text-primary underline-offset-2 hover:underline">
                      {primaryUniversityContact.email}
                    </a>
                  </div>
                )}
                {primaryUniversityContact.phone && (
                  <div>
                    <span className="text-muted-foreground">Телефон: </span>
                    <a href={`tel:${primaryUniversityContact.phone}`} className="text-primary underline-offset-2 hover:underline">
                      {primaryUniversityContact.phone}
                    </a>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ArrowRight className="size-4 text-amber-600 dark:text-amber-400" />
                Следующий шаг
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!detail && <p className="text-sm text-muted-foreground">Загрузка…</p>}
              {detail && archived && (
                <p className="text-sm text-muted-foreground">Архивное взаимодействие доступно только для чтения.</p>
              )}
              {detail && !archived && detail.availableTransitions.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {currentStage?.isFinal ? "Процесс завершён." : "Из текущего этапа переходов нет."}
                </p>
              )}
              {detail && !archived && detail.availableTransitions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {detail.availableTransitions.map((t) => (
                    <Button
                      key={t.toStateKey}
                      variant={t.toStateKey === "REJECTED" ? "outline" : "default"}
                      size="sm"
                      disabled={!t.allowed}
                      title={t.blockedReason ?? `→ ${t.toStateLabel}`}
                      onClick={() => openTransition(t)}
                    >
                      {t.label}
                    </Button>
                  ))}
                </div>
              )}
              {detail && !archived &&
                detail.availableTransitions
                  .filter((t) => !t.allowed && t.blockedReason)
                  .map((t) => (
                    <p key={t.toStateKey} className="text-xs text-muted-foreground">
                      «{t.label}»: {t.blockedReason}
                    </p>
                  ))}
              {detail && detail.history.length > 0 && (
                <div className="border-t pt-3">
                  <div className="mb-2 text-xs font-medium text-muted-foreground">Журнал переходов</div>
                  <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                    {detail.history.map((h) => (
                      <div key={h.id} className="text-sm">
                        <span className="text-muted-foreground">{formatDate(h.createdAt)} · {h.actorName}: </span>
                        {h.fromStateLabel ? `${h.fromStateLabel} → ` : ""}
                        {h.toStateLabel}
                        {h.comment && <span className="text-muted-foreground"> — {h.comment}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Флоу-канвас: готовый виджет StageCanvas */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <GitBranch className="size-4 text-violet-600 dark:text-violet-400" />
            Этапы флоу
          </CardTitle>
        </CardHeader>
        <CardContent>
          <StageCanvas
            nodes={graphNodes}
            onAddNote={archived ? undefined : (node, body) => void submitNote(body, { key: node.id, label: node.label })}
          />
        </CardContent>
      </Card>

      {/* Progress overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="size-4 text-blue-600 dark:text-blue-400" />
            Прогресс: {progress.pct}% ({progress.completed}/{progress.total} этапов)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 h-3 w-full rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress.pct}%` }} />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
            {graphNodes.map((node) => (
              <div key={node.id} className={cn("rounded-lg border p-2 text-center text-xs", stageStatusColors[node.status])}>
                <div className="font-mono text-[10px] mb-1">{node.step}</div>
                <div className="truncate">{node.label}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {isApi ? (
          /* Задачи по взаимодействию (календарь бэкенда) */
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ListTodo className="size-4 text-orange-600 dark:text-orange-400" />
                Задачи ({interTasks.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {interTasks.length === 0 && <p className="text-sm text-muted-foreground">Задач пока нет</p>}
              {interTasks.map((t) => (
                <label key={t.id} className={cn("flex items-start gap-3 rounded-lg border p-3", t.isCompleted && "opacity-60")}>
                  <input
                    type="checkbox"
                    checked={t.isCompleted}
                    disabled={!t.canEdit}
                    onChange={() => void toggleTask(t.id)}
                    className="mt-0.5 size-4 accent-primary"
                  />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-sm font-medium", t.isCompleted && "line-through")}>{t.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t.isOverdue && !t.isCompleted && <span className="text-destructive">Просрочена · </span>}
                      {formatDate(t.dueDate)}
                      {t.dueTime ? ` ${t.dueTime}` : ""}
                      {t.owner?.displayName ? ` · ${t.owner.displayName}` : ""}
                    </span>
                  </span>
                </label>
              ))}
              {!archived && (
                <div className="flex gap-2">
                  <Input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="Новая задача…" className="h-9" />
                  <Input type="date" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} className="h-9 w-40" aria-label="Срок" />
                  <Button size="sm" disabled={!taskTitle.trim() || !taskDue} onClick={() => void handleAddTask()}>
                    Добавить
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}

        <MeetingsCard engagementId={interaction.id} universityId={interaction.universityId} archived={archived} />

        {isApi ? (
          /* Вложения взаимодействия: загрузка на текущий этап */
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="size-4 text-rose-600 dark:text-rose-400" />
                  Файлы ({interAttachments.length})
                </CardTitle>
                {!archived && (
                  <>
                    <input
                      ref={fileInput}
                      type="file"
                      className="hidden"
                      aria-label="Файл для загрузки"
                      // Форматы ТЗ; окончательную проверку по содержимому делает бэкенд.
                      accept=".png,.jpg,.jpeg,.pdf,.zip,.gz,.rar,.doc,.docx,.xls,.xlsx"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) void handleUpload(file)
                      }}
                    />
                    <Button variant="outline" size="sm" disabled={uploading} onClick={() => fileInput.current?.click()}>
                      {uploading ? "Загрузка…" : "Загрузить"}
                    </Button>
                  </>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {currentStage?.requiresAttachment && !archived && (
                <p className="text-xs text-muted-foreground">
                  Для выхода из этапа «{currentStage.label}» нужен хотя бы один файл на этом этапе.
                </p>
              )}
              {interAttachments.length === 0 && <p className="text-sm text-muted-foreground">Файлов пока нет</p>}
              {interAttachments.map((a) => {
                const scan = SCAN_LABELS[a.scanStatus]
                return (
                  <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg border p-3">
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => void handleDownload(a)}
                        className="block max-w-full truncate text-left text-sm font-medium hover:text-primary"
                      >
                        {a.fileName}
                      </button>
                      <div className="text-xs text-muted-foreground">
                        {formatSize(a.sizeBytes)} · {typeof a.stateLabel === "string" ? `${a.stateLabel} · ` : ""}
                        {a.uploadedByName} · {formatDate(a.createdAt)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Badge variant={scan.variant}>{scan.label}</Badge>
                      {!archived && (
                        <Button variant="ghost" size="sm" onClick={() => void handleRemove(a)} aria-label={`Удалить ${a.fileName}`}>
                          ✕
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        ) : (
        /* Documents */
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="size-4" />
                Документы ({interDocs.length})
              </CardTitle>
              <Button variant="outline" size="sm">Создать из шаблона</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {interDocs.length === 0 && <p className="text-sm text-muted-foreground">Документов пока нет</p>}
            {interDocs.map((d) => (
              <div key={d.id} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <div className="text-sm font-medium">{d.name}</div>
                  <div className="text-xs text-muted-foreground">v{d.version} · {d.updatedAt}</div>
                </div>
                <Badge variant={d.status === "signed" ? "default" : d.status === "review" ? "outline" : "secondary"}>
                  {d.status === "signed" ? "Подписан" : d.status === "review" ? "На согласовании" : "Черновик"}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
        )}
      </div>

      {/* Activity timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
                <ChartBubble className="size-4 text-cyan-600 dark:text-cyan-400" />
            Активность
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
            {interActivity.length === 0 && <p className="text-sm text-muted-foreground">Активности пока нет</p>}
            {interActivity.map((event) => {
              const actor = event.actorName ?? employees.find((e) => e.id === event.userId)?.displayName
              return (
                <div key={event.id} className="flex items-start gap-3">
                  <div className="mt-1.5 size-2 rounded-full bg-primary shrink-0" />
                  <div>
                    <div className="text-sm">{event.description}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateTime(event.createdAt)}
                      {actor ? ` · ${actor}` : ""}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
        </div>

        {/* Заметки-чат по взаимодействию (30% экрана, бейджик — счётчик) */}
        <aside>
          <Card className="sticky top-6">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <MessageSquareText className="size-4 text-pink-600 dark:text-pink-400" />
                  Заметки по взаимодействию
                </CardTitle>
                <Badge variant="secondary">{interNotes.length}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
                {interNotes.length === 0 && (
                  <p className="text-sm text-muted-foreground">Заметок пока нет</p>
                )}
                {interNotes.map((n) => (
                  <div key={n.id} className="min-w-0 rounded-lg border bg-muted/40 p-3">
                    <div className="flex items-start justify-between gap-2 text-xs">
                      <div className="min-w-0 [overflow-wrap:anywhere]">
                        <span className="font-medium">{n.author.name}</span>
                        <span className="ml-2 text-muted-foreground">{formatDateTime(n.createdAt)}</span>
                      </div>
                      {n.canDelete && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => void handleRemoveNote(n.id)}
                          aria-label={`Удалить заметку ${n.author.name}`}
                          title="Удалить заметку"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                    {n.stateLabel && (
                      <Badge variant="outline" className="mt-1.5 text-[10px]">{n.stateLabel}</Badge>
                    )}
                    <p className="mt-1 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{n.body}</p>
                  </div>
                ))}
              </div>
              {!archived && (
                <div className="flex gap-2">
                  <Input
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Новая заметка…"
                    className="h-9"
                  />
                  <Button
                    size="sm"
                    disabled={!noteText.trim()}
                    onClick={async () => {
                      if (await submitNote(noteText.trim())) noteDraft.clear()
                    }}
                  >
                    Отправить
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>

      <TransitionDialog
        pending={pending}
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={(comment) => void confirmTransition(comment)}
      />
    </div>
  )
}
