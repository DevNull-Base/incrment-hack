import { useCallback, useEffect, useMemo, useState } from "react"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import {
  AlertTriangle,
  CheckCircle,
  GitBranch,
  LayoutGrid,
  List,
  Plus,
  Save,
} from "lucide-react"
import { cn } from "cn"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useStore } from "@/app/store"
import { useMediaQuery } from "@/hooks/useMediaQuery"
import { toast } from "@/shared/lib/toast-store"
import { dataSource } from "@/shared/config"
import type { WorkflowPublishPreviewDto, WorkflowTemplateSummaryDto } from "@/shared/api"

const isApi = dataSource === "api"

/**
 * Режим API: бэкенд хранит все редакции процесса (действующую, прошлые,
 * черновики). В переключателе — по одной на процесс: действующая, а если
 * её ещё нет — последний черновик.
 */
function editorHeads(templates: WorkflowTemplateSummaryDto[]): WorkflowTemplateSummaryDto[] {
  const byKey = new Map<string, WorkflowTemplateSummaryDto>()
  for (const t of templates) {
    const current = byKey.get(t.key)
    const better =
      !current ||
      (t.isActive && !current.isActive) ||
      (!current.isActive && !t.isActive && t.version > current.version)
    if (better) byKey.set(t.key, t)
  }
  return [...byKey.values()].sort((a, b) => a.segment.localeCompare(b.segment) || a.name.localeCompare(b.name))
}
import {
  diffStates,
  parseDefinition,
  type WorkflowDefinitionV1,
  type WorkflowStateDef,
} from "@/shared/api/workflow-definition"
import {
  insertStateAfter,
  matchStates,
  mockPublishPreview,
  mockStateCounts,
  removeStateWithRemap,
  reorderStates,
  TOOL_BLOCKS,
  type ToolBlock,
} from "@/shared/api/flow-editor-ops"
import { ToolDragPreview, ToolPalette } from "./flow-editor/ToolPalette"
import { DiffCanvas } from "./flow-editor/DiffCanvas"
import { EditCanvas } from "./flow-editor/EditCanvas"
import { StageListMode } from "./flow-editor/StageListMode"
import { EditorHintBanner, type SpotlightTarget } from "./flow-editor/EditorHintBanner"
import { ChangeList } from "./flow-editor/ChangeList"
import { SaveStatus, type SaveStatusKind } from "./flow-editor/SaveStatus"
import type { ZoneDrag } from "./flow-editor/InsertZone"
import { CreateFlowDialog } from "./flow-editor/CreateFlowDialog"
import { MigrationDialog, type PendingRemoval } from "./flow-editor/MigrationDialog"
import { PublishPreviewDialog } from "./flow-editor/PublishPreviewDialog"
import { PublishConfirmDialog } from "./flow-editor/PublishConfirmDialog"

type EditorMode = "canvas" | "list"
/** Разделённые режимы: правка черновика или read-only сравнение с base. */
type Segment = "edit" | "compare"
type DialogKind = null | "migration" | "preview" | "publish"

const DEFAULT_TOOL = TOOL_BLOCKS[0]

/** Diff-бейдж в шапке — это кнопка: клик уводит в «Сравнение» к изменению. */
const DIFF_BADGE =
  "inline-flex h-5 shrink-0 cursor-pointer items-center gap-1 rounded-4xl border px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Редактор flow для модератора (ADMIN). Два разделённых режима:
 * «Редактирование» (только черновик, DnD + аккордеон правки) и «Сравнение»
 * (read-only diff-канвас + текстовый список изменений). Вид — канвас/список,
 * на узких экранах список принудительно. Палитра tool-blocks, миграция
 * заявок при удалении этапа, publish-flow (preview → confirm → publish).
 * Режим API — черновик на сервере через api.workflowTemplates; демо — на сторе.
 */
export function FlowEditorPage() {
  const allTemplates = useStore((s) => s.workflowTemplates)
  const workflowTemplates = useMemo(
    () => (isApi ? editorHeads(allTemplates) : allTemplates),
    [allTemplates],
  )
  const interactions = useStore((s) => s.interactions)
  const serverDraftFor = useStore((s) => s.serverDraftFor)
  const saveServerDraft = useStore((s) => s.saveServerDraft)
  const previewPublish = useStore((s) => s.previewPublish)
  const publishServerDraft = useStore((s) => s.publishServerDraft)
  const [serverDraftId, setServerDraftId] = useState<string | null>(null)
  const definitionFor = useStore((s) => s.definitionFor)
  const saveDefinitionDraft = useStore((s) => s.saveDefinitionDraft)
  const publishDefinition = useStore((s) => s.publishDefinition)
  const createTemplate = useStore((s) => s.createTemplate)

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [mode, setMode] = useState<EditorMode>("canvas")
  const [armed, setArmed] = useState<ToolBlock | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | undefined>()
  const [dialog, setDialog] = useState<DialogKind>(null)
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<WorkflowPublishPreviewDto | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [publishBusy, setPublishBusy] = useState(false)
  const [segment, setSegment] = useState<Segment>("edit")
  // < lg двухколоночный канвас не влезает — автоматически уходим в список.
  const isDesktop = useMediaQuery("(min-width: 1024px)")
  const [saveStatus, setSaveStatus] = useState<SaveStatusKind>("idle")
  // Растёт на каждую правку черновика — по нему ставится debounce автосейва.
  const [editRevision, setEditRevision] = useState(0)
  const [dragKind, setDragKind] = useState<ZoneDrag>(null)
  const [spotlight, setSpotlight] = useState<SpotlightTarget | null>(null)
  const [scrollTo, setScrollTo] = useState<{ row: "base" | "draft"; key: string } | null>(null)

  // Выбранный шаблон (флоу) + рабочая копия черновика.
  const activeTemplate = useMemo(
    () =>
      workflowTemplates.find((t) => t.id === selectedTemplateId) ??
      workflowTemplates.find((t) => t.isActive && t.isDefault) ??
      workflowTemplates[0],
    [workflowTemplates, selectedTemplateId],
  )
  const [openedVersion, setOpenedVersion] = useState<number | null>(null)
  const [baseDef, setBaseDef] = useState<WorkflowDefinitionV1 | null>(null)
  const [draft, setDraft] = useState<WorkflowDefinitionV1 | null>(null)

  // Открыть выбранный шаблон (init + при переключении флоу).
  const openActive = useCallback(
    (templateId: string | null) => {
      const t = workflowTemplates.find((x) => x.id === templateId)
      if (!t) {
        setBaseDef(null)
        setDraft(null)
        setOpenedVersion(null)
        return
      }
      const def = definitionFor(t.id)
      if (!def) return
      // Режим API: правки, сохранённые ранее, лежат в черновике следующей редакции.
      const serverDraft = isApi ? serverDraftFor(t.id) : undefined
      const draftDef = serverDraft && serverDraft.id !== t.id ? definitionFor(serverDraft.id) : undefined
      setServerDraftId(serverDraft?.id ?? null)
      setBaseDef(structuredClone(def))
      setDraft(structuredClone(draftDef ?? def))
      setOpenedVersion(t.version)
      setMapping({})
      setPreview(null)
      setSelectedKey(undefined)
      setArmed(null)
      setSaveStatus("idle")
      setEditRevision(0)
    },
    [workflowTemplates, definitionFor, serverDraftFor],
  )

  const switchTemplate = (nextId: string) => {
    if (nextId === selectedTemplateId) return
    if (draft && baseDef && JSON.stringify(draft) !== JSON.stringify(baseDef)) {
      // Не теряем правки при переключении флоу — сохраняем черновик.
      if (isApi && activeTemplate) {
        void saveServerDraft(activeTemplate.id, draft).then((r) =>
          r.ok ? toast.success("Черновик сохранён", activeTemplate.name) : toast.error("Не удалось сохранить черновик", r.error),
        )
      } else {
        const res = saveDefinitionDraft(activeTemplate?.id ?? "", draft)
        if (!res.ok) {
          toast.error("Не удалось сохранить черновик", res.error)
          return
        }
        toast.success("Черновик сохранён", activeTemplate?.name)
      }
    }
    setSelectedTemplateId(nextId)
    openActive(nextId)
  }

  // Открытие при первом рендере / смене активного шаблона.
  const [initialized, setInitialized] = useState(false)
  useEffect(() => {
    if (!initialized && activeTemplate?.id) {
      setSelectedTemplateId(activeTemplate.id)
      openActive(activeTemplate.id)
      setInitialized(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized, activeTemplate?.id])

  const dirty = Boolean(draft && baseDef && JSON.stringify(draft) !== JSON.stringify(baseDef))
  const match = useMemo(
    () => (baseDef && draft ? matchStates(baseDef, draft) : null),
    [baseDef, draft],
  )
  const diff = useMemo(
    () => (baseDef && draft ? diffStates(baseDef, draft) : null),
    [baseDef, draft],
  )
  const validationError = useMemo(() => {
    if (!draft) return null
    try {
      parseDefinition(draft)
      return null
    } catch (e) {
      return e instanceof Error ? e.message : "Некорректный definition"
    }
  }, [draft])

  const baseCounts = useMemo(() => {
    if (!baseDef) return {}
    if (!isApi) return mockStateCounts(baseDef.states)
    // Заявки ведутся только по действующей редакции сегмента.
    const out: Record<string, { engagementCount: number; noteCount: number; attachmentCount: number }> = {}
    for (const state of baseDef.states) out[state.key] = { engagementCount: 0, noteCount: 0, attachmentCount: 0 }
    if (activeTemplate?.isActive) {
      for (const i of interactions) {
        if (i.segment === activeTemplate.segment && out[i.currentStateKey]) out[i.currentStateKey].engagementCount++
      }
    }
    return out
  }, [baseDef, activeTemplate, interactions])
  const engagementCounts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(baseCounts)) out[k] = v.engagementCount
    return out
  }, [baseCounts])

  // ---------------------------------------------------------------
  // Мутации черновика
  // ---------------------------------------------------------------
  /** Правка принята: взводим debounce автосейва и поднимаем статус. */
  const markEdited = () => {
    setEditRevision((r) => r + 1)
    setSaveStatus((s) => (s === "conflict" ? s : "pending"))
  }

  const handleInsert = (afterIndex: number | null, block?: ToolBlock) => {
    if (!draft) return
    const tool = block ?? armed ?? DEFAULT_TOOL
    const res = insertStateAfter(draft, afterIndex, tool)
    if (!res.ok) {
      toast.error("Не удалось вставить этап", res.error)
      return
    }
    setDraft(res.def)
    setArmed(null)
    const inserted = res.def.states.find(
      (s) => !draft.states.some((old) => old.key === s.key),
    )
    toast.success("Этап вставлен", inserted?.label ?? tool.label)
    markEdited()
  }

  const handleRemove = (stateKey: string) => {
    if (!draft) return
    const victim = draft.states.find((s) => s.key === stateKey)
    if (!victim) return
    if (victim.kind === "initial") {
      toast.error("Не удалось удалить", "Нельзя удалить начальный этап")
      return
    }
    const idx = draft.states.findIndex((s) => s.key === stateKey)
    const neighbour = draft.states[idx + 1] ?? draft.states[idx - 1]
    setPendingRemoval({
      key: stateKey,
      label: victim.label,
      counts: baseCounts[stateKey] ?? { engagementCount: 0, noteCount: 0, attachmentCount: 0 },
      suggestedTarget: neighbour?.key,
    })
    setDialog("migration")
  }

  const confirmRemoval = (targetKey: string) => {
    if (!draft || !pendingRemoval) return
    const res = removeStateWithRemap(draft, pendingRemoval.key, targetKey || undefined)
    if (!res.ok) {
      toast.error("Не удалось удалить этап", res.error)
      return
    }
    const hasCards = pendingRemoval.counts.engagementCount > 0
    if (hasCards && targetKey) {
      setMapping((m) => ({ ...m, [pendingRemoval.key]: targetKey }))
    }
    setDraft(res.def)
    setDialog(null)
    setPendingRemoval(null)
    setSelectedKey(undefined)
    toast.success(
      "Этап удалён",
      hasCards
        ? `данные перенесутся на «${res.def.states.find((s) => s.key === targetKey)?.label ?? targetKey}» при публикации`
        : "данных на этапе не было",
    )
    markEdited()
  }

  const handlePatch = (key: string, patch: Partial<WorkflowStateDef>) => {
    setDraft((d) =>
      d
        ? { ...d, states: d.states.map((s) => (s.key === key ? { ...s, ...patch } : s)) }
        : d,
    )
    // Переименование этапа меняет идентификатор выделения.
    if (patch.key !== undefined && patch.key !== key) setSelectedKey(patch.key)
    markEdited()
  }

  const handleReorder = (states: WorkflowStateDef[]) => {
    setDraft((d) => (d ? { ...d, states } : d))
    markEdited()
  }

  const handleSelect = (key: string) => {
    setSelectedKey((cur) => (cur === key ? undefined : key))
  }

  // ---------------------------------------------------------------
  // Сохранение / publish-flow
  // ---------------------------------------------------------------
  const persistDraft = async (manual: boolean): Promise<void> => {
    if (!draft || !activeTemplate || validationError) return
    if (manual && validationError) return
    // Конфликт-проверка (без ETag у шаблонов): сверяем версию с открытой.
    // Вместо автоматического перечитывания показываем CTA в индикаторе —
    // правки пользователя не теряются молча.
    if (openedVersion !== null && activeTemplate.version !== openedVersion) {
      setSaveStatus("conflict")
      toast.error("Редакция изменена другим администратором", "Выберите действие в шапке редактора")
      return
    }
    setSaveStatus("saving")
    if (isApi) {
      const r = await saveServerDraft(activeTemplate.id, draft)
      if (r.ok) {
        setServerDraftId(r.draftId)
        setSaveStatus("saved")
        if (manual) {
          toast.success("Черновик сохранён на сервере", `${draft.states.length} этапов · действующая редакция не изменена`)
        }
      } else {
        setSaveStatus("error")
        toast.error("Не удалось сохранить", r.error)
      }
      return
    }
    const res = saveDefinitionDraft(activeTemplate.id, draft)
    if (res.ok) {
      setSaveStatus("saved")
      if (manual) toast.success("Черновик сохранён", `${draft.states.length} этапов`)
    } else {
      setSaveStatus("error")
      toast.error("Не удалось сохранить", res.error)
    }
  }

  const conflicted = saveStatus === "conflict"

  // Автосохранение: правки сразу живут в draft, один запрос уходит после
  // паузы во вводе — быстрый тайпитинг не порождает спам запросами.
  useEffect(() => {
    if (editRevision === 0) return
    if (!draft || !activeTemplate || validationError || conflicted) return
    const timer = window.setTimeout(() => {
      void persistDraft(false)
    }, 1200)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editRevision, validationError, conflicted])

  /** CTA конфликта: перечитать черновик — прежнее поведение редактора. */
  const rereadDraft = () => {
    setSaveStatus("idle")
    openActive(selectedTemplateId)
    toast.success("Черновик перечитан", activeTemplate?.name ?? "")
  }

  /** CTA конфликта: оставить свой черновик и увидеть чужую редакцию сверху. */
  const showOtherAdminChanges = async () => {
    await useStore.getState().reloadWorkflow()
    const heads = editorHeads(useStore.getState().workflowTemplates)
    const latest =
      heads.find((t) => t.key === activeTemplate?.key) ??
      useStore.getState().workflowTemplates.find((t) => t.id === activeTemplate?.id) ??
      activeTemplate
    const latestDef = latest ? useStore.getState().definitionFor(latest.id) : undefined
    if (latestDef) setBaseDef(structuredClone(latestDef))
    if (latest) {
      setOpenedVersion(latest.version)
      setSelectedTemplateId(latest.id)
    }
    setSaveStatus("pending")
    setSegment("compare")
  }

  const openPreview = async () => {
    if (!baseDef || !draft || validationError) return
    setPreviewBusy(true)
    try {
      if (isApi && activeTemplate) {
        // Предпросмотр считает бэкенд — по черновику, сохранённому на сервере.
        const saved = await saveServerDraft(activeTemplate.id, draft)
        if (!saved.ok) {
          toast.error("Черновик не сохранён", saved.error)
          return
        }
        setServerDraftId(saved.draftId)
        const res = await previewPublish(saved.draftId)
        if (!res.ok) {
          toast.error("Предпросмотр недоступен", res.error)
          return
        }
        setPreview(res.preview)
        setMapping((m) => ({ ...(res.preview.suggestedMapping as Record<string, string>), ...m }))
        setDialog("preview")
        return
      }
      await delay(350)
      const p = mockPublishPreview(baseDef, draft, baseCounts)
      setPreview(p)
      // Рекомендации системы подставляем как начальный выбор маппинга.
      setMapping((m) => ({ ...p.suggestedMapping, ...m }))
      setDialog("preview")
    } finally {
      setPreviewBusy(false)
    }
  }

  const doPublish = async () => {
    if (!draft || !activeTemplate || !baseDef) return
    setPublishBusy(true)
    try {
      if (isApi) {
        if (!serverDraftId) {
          toast.error("Публикация отклонена", "Сначала откройте предпросмотр")
          setDialog(null)
          return
        }
        const res = await publishServerDraft(serverDraftId, mapping)
        if (!res.ok) {
          toast.error("Публикация отклонена", res.error)
          setDialog("preview")
          return
        }
        setMapping({})
        setPreview(null)
        setDialog(null)
        setServerDraftId(null)
        // Опубликованный черновик — теперь действующая редакция процесса.
        setSelectedTemplateId(res.result.templateId)
        setInitialized(false)
        toast.success(
          "Опубликовано",
          `Редакция v${res.result.version} · заявок переведено: ${res.result.movedEngagements}, перенесено из удалённых этапов: ${res.result.relocatedEngagements}`,
        )
        return
      }
      await delay(600)
      if (validationError) {
        toast.error("Публикация отклонена", validationError)
        setDialog("preview")
        return
      }
      const check = mockPublishPreview(baseDef, draft, baseCounts)
      if (check.blockingIssues.length > 0) {
        toast.error("Публикация отклонена", check.blockingIssues[0])
        setDialog("preview")
        return
      }
      publishDefinition(activeTemplate.id, structuredClone(draft))
      setBaseDef(structuredClone(draft))
      setOpenedVersion(activeTemplate.version + 1)
      setMapping({})
      setPreview(null)
      setDialog(null)
      toast.success(
        "Опубликовано",
        `Заявки переведены: ${check.affectedEngagements} · новая редакция v${activeTemplate.version + 1}`,
      )
    } finally {
      setPublishBusy(false)
    }
  }

  // ---------------------------------------------------------------
  // Единый DndContext: палитра (tool) + список (stage)
  // ---------------------------------------------------------------
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  )
  const [dragTool, setDragTool] = useState<ToolBlock | null>(null)

  const handleDragStart = (event: DragStartEvent) => {
    const type = event.active.data.current?.type
    if (type === "tool") {
      setDragTool(event.active.data.current?.block as ToolBlock)
      setDragKind("tool")
    } else if (type === "stage") {
      setDragKind("stage")
    }
  }

  const endDrag = () => {
    setDragTool(null)
    setDragKind(null)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    endDrag()
    const { active, over } = event
    if (!over || !draft) return
    const activeType = active.data.current?.type

    if (activeType === "tool") {
      const overId = String(over.id)
      if (!overId.startsWith("insert-")) return
      const afterIndex = overId === "insert-end" ? null : Number(overId.slice("insert-".length))
      handleInsert(
        Number.isNaN(afterIndex) ? null : afterIndex,
        active.data.current?.block as ToolBlock,
      )
      return
    }

    if (activeType === "stage") {
      const keys = draft.states.map((s) => s.key)
      const activeKey = String(active.data.current?.key ?? active.id)
      const oldIndex = keys.indexOf(activeKey)
      if (oldIndex < 0) return
      const overId = String(over.id)
      // Drop на раскрытую зону вставки — тоже reorder: зоны специально
      // раскрываются при drag и служат главной целью в канвасе.
      let newIndex = -1
      if (overId.startsWith("insert-")) {
        const afterIndex =
          overId === "insert-end" ? null : Number(overId.slice("insert-".length))
        if (afterIndex !== null && !Number.isNaN(afterIndex)) {
          newIndex = oldIndex <= afterIndex ? afterIndex : afterIndex + 1
        } else if (afterIndex === null) {
          newIndex = keys.length - 1
        }
      } else {
        newIndex = keys.indexOf(String(over.data.current?.key ?? over.id))
      }
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return
      handleReorder(reorderStates(draft.states, oldIndex, newIndex))
    }
  }

  const handleDragCancel = () => endDrag()

  const transitionsChanged = Boolean(
    baseDef &&
      draft &&
      JSON.stringify(baseDef.transitions.map((t) => `${t.from}->${t.to}`)) !==
        JSON.stringify(draft.transitions.map((t) => `${t.from}->${t.to}`)),
  )

  // На узких экранах двухколоночный канвас не влезает — принудительно список.
  const effectiveView: EditorMode = isDesktop ? mode : "list"

  const changeSegment = (next: Segment) => {
    setSegment(next)
    if (next === "compare") setArmed(null)
  }

  const jumpToChange = (kind: "added" | "removed" | "renamed") => {
    const first = diff?.[kind][0]
    changeSegment("compare")
    if (first) setScrollTo({ row: kind === "removed" ? "base" : "draft", key: first.key })
  }

  // Клик по бейджу/строке списка изменений прокручивает канвас к узлу.
  useEffect(() => {
    if (!scrollTo || segment !== "compare") return
    const el = document.querySelector<HTMLElement>(
      `[data-center-key="${scrollTo.row}:${scrollTo.key}"]`,
    )
    if (el) {
      const reduced =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center", inline: "center" })
    }
    setScrollTo(null)
  }, [scrollTo, segment])

  return (
    <div className="space-y-4">
      {/* Шапка */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <GitBranch className="size-6 text-primary" /> Редактор флоу
          </h1>
          <p className="text-sm text-muted-foreground">
            «Редактирование» — только черновик, «Сравнение» — действующая редакция сверху и
            черновик снизу. Удаление этапа всегда переносит заявки; публикация переводит заявки,
            использующие этот шаблон.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Флоу: список шаблонов + создание */}
          <div className="flex gap-1 rounded-lg border p-1">
            {workflowTemplates.map((t) => (
              <Button
                key={t.id}
                variant="ghost"
                size="sm"
                title={t.siteSource ? `${t.name} · сайт ${t.siteSource}` : t.name}
                onClick={() => switchTemplate(t.id)}
                className={cn(
                  "max-w-[11rem] justify-start rounded-md px-3 py-1.5 text-sm font-medium",
                  activeTemplate?.id === t.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {/* Многоточие — на тексте: у кнопки-flex обрезка съедала начало названия. */}
                <span className="min-w-0 truncate">{t.name}</span>
              </Button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              aria-label="Новый флоу"
              title="Создать новый флоу"
              onClick={() => setCreateOpen(true)}
              className="rounded-md px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Plus className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Статус + действия */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Сегмент-контрол: правка или read-only сравнение */}
          <div className="flex gap-1 rounded-lg border p-1" role="group" aria-label="Режим редактора">
            {(
              [
                ["edit", "Редактирование"],
                ["compare", "Сравнение"],
              ] as [Segment, string][]
            ).map(([value, label]) => (
              <Button
                key={value}
                variant="ghost"
                size="sm"
                aria-pressed={segment === value}
                onClick={() => changeSegment(value)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium",
                  segment === value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {label}
              </Button>
            ))}
          </div>
          {/* Вид — только на десктопе и только в режиме редактирования */}
          {segment === "edit" && isDesktop && (
            <div className="flex gap-1 rounded-lg border p-1" role="group" aria-label="Вид редактора">
              {(
                [
                  ["canvas", LayoutGrid, "Канвас"],
                  ["list", List, "Список"],
                ] as [EditorMode, typeof LayoutGrid, string][]
              ).map(([value, Icon, label]) => (
                <Button
                  key={value}
                  variant="ghost"
                  size="icon-sm"
                  aria-label={label}
                  title={label}
                  aria-pressed={effectiveView === value}
                  onClick={() => {
                    setMode(value)
                    setArmed(null)
                  }}
                  className={cn(
                    effectiveView === value && "bg-secondary text-foreground hover:bg-secondary",
                  )}
                >
                  <Icon className="size-4" />
                </Button>
              ))}
            </div>
          )}
          {activeTemplate && (
            <Badge variant="outline">
              {activeTemplate.name} · v{activeTemplate.version}
            </Badge>
          )}
          {dirty && <Badge className="border-warning/40 bg-warning/10 text-warning" variant="outline">черновик изменён</Badge>}
          {diff && diff.added.length > 0 && (
            <button
              type="button"
              onClick={() => jumpToChange("added")}
              title="Показать добавленные этапы"
              className={cn(DIFF_BADGE, "border-success/40 bg-success/10 text-success hover:bg-success/20")}
            >
              +{diff.added.length} добавлено
            </button>
          )}
          {diff && diff.removed.length > 0 && (
            <button
              type="button"
              onClick={() => jumpToChange("removed")}
              title="Показать удаляемые этапы"
              className={cn(DIFF_BADGE, "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20")}
            >
              −{diff.removed.length} удалено
            </button>
          )}
          {diff && diff.renamed.length > 0 && (
            <button
              type="button"
              onClick={() => jumpToChange("renamed")}
              title="Показать переименованные этапы"
              className={cn(DIFF_BADGE, "border-info/40 bg-info/10 text-info hover:bg-info/20")}
            >
              ~{diff.renamed.length} переименовано
            </button>
          )}
          {transitionsChanged && (
            <button
              type="button"
              onClick={() => changeSegment("compare")}
              title="Показать переходы в сравнении"
              className={cn(DIFF_BADGE, "bg-secondary text-secondary-foreground hover:bg-secondary/70")}
            >
              переходы изменены
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {saveStatus !== "conflict" && (
            <SaveStatus
              status={saveStatus}
              onRetry={() => void persistDraft(true)}
              onShowOtherChanges={() => void showOtherAdminChanges()}
              onRereadDraft={rereadDraft}
            />
          )}
          <Button
            variant="outline"
            disabled={!dirty || !!validationError || saveStatus === "saving"}
            onClick={() => void persistDraft(true)}
          >
            <Save className="size-4" /> Сохранить черновик
          </Button>
          <Button disabled={!!validationError || previewBusy} onClick={openPreview}>
            <CheckCircle className="size-4" />
            {previewBusy ? "Загрузка…" : "Предпросмотр публикации"}
          </Button>
        </div>
      </div>

      {saveStatus === "conflict" && (
        <SaveStatus
          status={saveStatus}
          onRetry={() => void persistDraft(true)}
          onShowOtherChanges={() => void showOtherAdminChanges()}
          onRereadDraft={rereadDraft}
        />
      )}

      {validationError && (
        <p className="flex items-center gap-1.5 text-sm text-destructive">
          <AlertTriangle className="size-4" /> {validationError}
        </p>
      )}

      {!baseDef || !draft ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Шаблон не выбран или у него нет definition. Выберите флоу в шапке или создайте
            кнопкой «+».
          </CardContent>
        </Card>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div className={cn("grid gap-4", segment === "edit" && "lg:grid-cols-[240px_1fr]")}>
            {/* Палитра — только в режиме редактирования */}
            {segment === "edit" && (
              <Card className="h-fit">
                <CardContent>
                  <ToolPalette
                    armed={armed}
                    onArm={setArmed}
                    spotlight={spotlight === "insert"}
                  />
                </CardContent>
              </Card>
            )}

            {/* Рабочая область */}
            <div className="min-w-0 space-y-4">
              {segment === "edit" && <EditorHintBanner onSpotlight={setSpotlight} />}

              {segment === "compare" ? (
                <>
                  <DiffCanvas
                    base={baseDef}
                    draft={draft}
                    match={match!}
                    engagementCounts={engagementCounts}
                    baseVersionLabel={`v${activeTemplate?.version ?? 1}`}
                  />
                  <ChangeList
                    base={baseDef}
                    draft={draft}
                    diff={diff!}
                    engagementCounts={engagementCounts}
                    mapping={mapping}
                    onJump={(row, key) => setScrollTo({ row, key })}
                  />
                </>
              ) : effectiveView === "canvas" ? (
                <EditCanvas
                  draft={draft}
                  engagementCounts={engagementCounts}
                  drag={dragKind}
                  armed={Boolean(armed)}
                  selectedKey={selectedKey}
                  onToggle={handleSelect}
                  onPatch={handlePatch}
                  onRemove={handleRemove}
                  onInsertClick={(afterIndex) => handleInsert(afterIndex)}
                  spotlight={spotlight}
                  versionLabel={`v${activeTemplate?.version ?? 1}`}
                />
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Plus className="size-4" /> Этапы процесса
                      <span className="ml-auto text-xs font-normal text-muted-foreground">
                        порядок — за ⇅; новый этап — из палитры в «+»
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <StageListMode
                      draft={draft}
                      addedKeys={new Set(match!.added)}
                      engagementCounts={engagementCounts}
                      selectedKey={selectedKey}
                      onPatch={handlePatch}
                      onRemove={handleRemove}
                      onSelect={handleSelect}
                      onInsertClick={(afterIndex) => handleInsert(afterIndex)}
                      armed={Boolean(armed)}
                      drag={dragKind}
                      spotlight={spotlight}
                    />
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          <DragOverlay dropAnimation={{ duration: 250, easing: "cubic-bezier(0.25, 1, 0.5, 1)" }}>
            {dragTool ? <ToolDragPreview block={dragTool} /> : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* Диалоги */}
      <MigrationDialog
        open={dialog === "migration"}
        pending={pendingRemoval}
        draft={draft ?? { schemaVersion: 1, states: [], transitions: [] }}
        onCancel={() => {
          setDialog(null)
          setPendingRemoval(null)
        }}
        onConfirm={confirmRemoval}
      />
      <PublishPreviewDialog
        open={dialog === "preview"}
        preview={preview}
        draft={draft ?? { schemaVersion: 1, states: [], transitions: [] }}
        mapping={mapping}
        onMappingChange={setMapping}
        busy={previewBusy}
        onClose={() => setDialog(null)}
        onNext={() => setDialog("publish")}
      />
      <PublishConfirmDialog
        open={dialog === "publish"}
        busy={publishBusy}
        affectedCount={preview?.affectedEngagements ?? 0}
        onCancel={() => setDialog("preview")}
        onConfirm={doPublish}
      />
      <CreateFlowDialog
        open={createOpen}
        templates={workflowTemplates}
        onOpenChange={setCreateOpen}
        onCreate={createTemplate}
        onCreated={(id) => {
          setSelectedTemplateId(id)
          openActive(id)
          const created = useStore.getState().workflowTemplates.find((t) => t.id === id)
          toast.success("Флоу создан", created?.name ?? id)
        }}
      />
    </div>
  )
}
