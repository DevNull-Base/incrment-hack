import type { StateCreator } from "zustand"
import {
  api,
  ApiError,
  type Segment,
  type WorkflowPublishPreviewDto,
  type WorkflowPublishResultDto,
  type WorkflowTemplateSummaryDto,
  type ProgramSource,
} from "@/shared/api"
import { dataSource } from "@/shared/config"
import {
  parseDefinition,
  toBackendDefinition,
  type WorkflowDefinitionV1,
  type WorkflowStateDef,
} from "@/shared/api/workflow-definition"
import { MOCK_STAGE_CATALOG, type StageCatalog } from "@/app/workflow-stages"
import { loadWorkflow } from "./api-data"
import type { StoreState } from "./types"

// ========================================
// Шаблоны workflow: сегменты B2B/B2C + свои
// флоу проектов (sz-rt, edu-rt). Сиды ниже — демо-режим;
// в режиме API шаблоны и редакции приходят с бэкенда.
// ========================================
interface SeedEntry {
  summary: WorkflowTemplateSummaryDto
  definition: WorkflowDefinitionV1
}

/** Линейный definition из списка состояний (переходы t1..tN). */
function linearDefinition(
  prefix: string,
  states: WorkflowStateDef[],
  description: string,
): WorkflowDefinitionV1 {
  const transitions = states.slice(1).map((s, idx) => ({
    key: `${prefix}-t${idx + 1}`,
    from: states[idx].key,
    to: s.key,
    label: `→ ${s.label}`,
  }))
  return { schemaVersion: 1, states, transitions, meta: { description } }
}

function seedEntry(input: {
  id: string
  key: string
  name: string
  segment: Segment
  siteSource?: ProgramSource
  description: string
  isDefault: boolean
  states: WorkflowStateDef[]
}): SeedEntry {
  return {
    summary: {
      id: input.id,
      key: input.key,
      version: 1,
      name: input.name,
      description: input.description,
      segment: input.segment,
      siteSource: input.siteSource ?? null,
      isActive: true,
      isDefault: input.isDefault,
      publishedAt: "2025-09-01T00:00:00Z",
      stateCount: input.states.length,
      engagementCount: 0,
    },
    definition: linearDefinition(
      input.key.replace(/[^a-z0-9]+/g, "-"),
      input.states,
      input.description,
    ),
  }
}

// --- Определения сидов -----------------------------------------
const B2B_STATES: WorkflowStateDef[] = [
  { key: "SEARCH_CONTACTS", label: "Поиск контактов", kind: "initial", order: 1, slaHours: 72 },
  { key: "COMMUNICATION", label: "Коммуникация", kind: "normal", order: 2, slaHours: 120 },
  { key: "MEETING", label: "Организация встречи", kind: "normal", order: 3, meetingRequired: true, slaHours: 72 },
  { key: "DOCUMENT_EXCHANGE", label: "Обмен документами", kind: "normal", order: 4 },
  { key: "SIGNING", label: "Подписание документов", kind: "normal", order: 5 },
  { key: "MATERIALS_TRANSFER", label: "Передача материалов", kind: "normal", order: 6 },
  { key: "IMPLEMENTATION_SUPPORT", label: "Внедрение IT-продукта", kind: "normal", order: 7 },
  { key: "TEACHER_TRAINING", label: "Обучение преподавателей", kind: "normal", order: 8, meetingRequired: true },
  { key: "STAGE_CONTROL", label: "Контроль этапов", kind: "final", order: 9 },
]

const B2C_STATES: WorkflowStateDef[] = [
  { key: "SEARCH_CONTACTS", label: "Поиск контактов", kind: "initial", order: 1, slaHours: 48 },
  { key: "COMMUNICATION", label: "Коммуникация", kind: "normal", order: 2, slaHours: 72 },
  { key: "DOCUMENT_EXCHANGE", label: "Обмен документами", kind: "normal", order: 3 },
  { key: "SIGNING", label: "Подписание документов", kind: "normal", order: 4 },
  { key: "MATERIALS_TRANSFER", label: "Передача материалов", kind: "normal", order: 5 },
  { key: "STAGE_CONTROL", label: "Контроль этапов", kind: "final", order: 6 },
]

// Флоу федерального проекта sz-rt.ru: 5 шагов записи + обучение/финал.
const SZ_RT_STATES: WorkflowStateDef[] = [
  { key: "APPLICATION", label: "Заявка на обучение", kind: "initial", order: 1, slaHours: 24 },
  { key: "WORK_RU_CONFIRM", label: "Подтверждение заявки в «Работе России»", kind: "normal", order: 2, slaHours: 168 },
  { key: "CAREER_GUIDANCE", label: "Профориентация в ЦЗН", kind: "normal", order: 3, meetingRequired: true, slaHours: 72 },
  { key: "EMPLOYER_CONSENT", label: "Согласие работодателя на договор", kind: "normal", order: 4, slaHours: 72 },
  { key: "TRIPARTITE_CONTRACT", label: "Трёхсторонний договор", kind: "normal", order: 5, slaHours: 48 },
  { key: "ENROLLMENT_DOCS", label: "Документы на зачисление", kind: "normal", order: 6, slaHours: 48 },
  { key: "TRAINING", label: "Обучение (поток, формат ДОТ)", kind: "normal", order: 7, slaHours: 720 },
  { key: "JOB_OR_DIPLOMA", label: "Трудоустройство и документ", kind: "final", order: 8 },
]

// Флоу edu-rt.ru: коммерческие программы, интеграция LMS, кадровый резерв.
const EDU_RT_STATES: WorkflowStateDef[] = [
  { key: "CONSULTATION", label: "Консультация и подбор программы", kind: "initial", order: 1, slaHours: 48 },
  { key: "LMS_INTEGRATION", label: "Интеграция LMS (FLOW → Odin)", kind: "normal", order: 2, slaHours: 120 },
  { key: "CONTRACT", label: "Договор с организацией", kind: "normal", order: 3, slaHours: 72 },
  { key: "STREAM_ONBOARD", label: "Зачисление потока и доступы", kind: "normal", order: 4, slaHours: 48 },
  { key: "TRAINING", label: "Обучение и промежуточная аттестация", kind: "normal", order: 5, meetingRequired: true, slaHours: 720 },
  { key: "ATTESTATION", label: "Итоговая аттестация (модуль РАНХиГС)", kind: "normal", order: 6, slaHours: 168 },
  { key: "RESERVE_SUPPORT", label: "Кадровый резерв и сопровождение", kind: "final", order: 7 },
]

const SEEDS: SeedEntry[] = [
  seedEntry({
    id: "tpl-b2b-1",
    key: "default-b2b",
    name: "Флоу B2B (вузы)",
    segment: "B2B",
    description: "B2B — базовый флоу работы с вузами",
    isDefault: true,
    states: B2B_STATES,
  }),
  seedEntry({
    id: "tpl-b2c-1",
    key: "default-b2c",
    name: "Флоу B2C (физлица)",
    segment: "B2C",
    description: "B2C — базовый флоу для частных лиц",
    isDefault: true,
    states: B2C_STATES,
  }),
  seedEntry({
    id: "tpl-sz-rt-1",
    key: "sz-rt-aktivnye-mery",
    name: "Активные меры · sz-rt",
    segment: "B2C",
    siteSource: "sz-rt",
    description: "Федеральный проект занятости: заявка → «Работа России» → ЦЗН → договор → обучение",
    isDefault: false,
    states: SZ_RT_STATES,
  }),
  seedEntry({
    id: "tpl-edu-rt-1",
    key: "edu-rt-lms",
    name: "LMS и кадровый резерв · edu-rt",
    segment: "B2B",
    siteSource: "edu-rt",
    description: "Коммерческие программы: интеграция LMS (FLOW → Odin), обучение, кадровый резерв",
    isDefault: false,
    states: EDU_RT_STATES,
  }),
]

/** Пустой definition для создания флоу «с нуля» (проходит parseDefinition). */
export function emptyDefinition(): WorkflowDefinitionV1 {
  return {
    schemaVersion: 1,
    states: [
      { key: "START", label: "Старт", kind: "initial", order: 1 },
      { key: "DONE", label: "Завершение", kind: "final", order: 2 },
    ],
    transitions: [{ key: "t1", from: "START", to: "DONE", label: "→ Завершение" }],
    meta: { description: "Новый флоу" },
  }
}

export type WorkflowResult<T = object> = ({ ok: true } & T) | { ok: false; error: string }

export interface WorkflowSlice {
  workflowTemplates: WorkflowTemplateSummaryDto[]
  workflowDefinitions: Record<string, WorkflowDefinitionV1>
  /** Этапы действующего процесса по сегментам (см. app/workflow-stages). */
  stageCatalog: StageCatalog
  /** Активный опубликованный шаблон сегмента. */
  templateForSegment: (segment: Segment) => WorkflowTemplateSummaryDto | undefined
  definitionFor: (templateId: string) => WorkflowDefinitionV1 | undefined
  /** Сохранить черновик definition (валидация через parseDefinition). */
  saveDefinitionDraft: (templateId: string, definition: unknown) => { ok: true } | { ok: false; error: string }
  /**
   * Публикация в демо-режиме: активирует definition и инкрементирует версию.
   * В режиме API публикует publishServerDraft (POST /workflow/templates/{id}/publish).
   */
  publishDefinition: (templateId: string, definition: WorkflowDefinitionV1) => void
  /**
   * Создать новый флоу («с нуля» или копированием существующего).
   * Режим API — POST /workflow/templates: черновик, до публикации заявок не касается.
   */
  createTemplate: (input: {
    name: string
    key: string
    segment: Segment
    siteSource?: ProgramSource | null
    baseTemplateId: string | null
  }) => Promise<WorkflowResult<{ id: string }>>

  // --- режим API: редакции процесса на бэкенде ---
  /** Черновик следующей редакции для процесса templateId (если уже есть). */
  serverDraftFor: (templateId: string) => WorkflowTemplateSummaryDto | undefined
  /**
   * Сохранить определение в черновик на сервере: правится существующий
   * черновик процесса либо создаётся следующая редакция по тому же ключу.
   * Действующая редакция неизменна до публикации.
   */
  saveServerDraft: (templateId: string, definition: WorkflowDefinitionV1) => Promise<WorkflowResult<{ draftId: string }>>
  previewPublish: (draftId: string) => Promise<WorkflowResult<{ preview: WorkflowPublishPreviewDto }>>
  publishServerDraft: (
    draftId: string,
    stateMapping: Record<string, string>,
  ) => Promise<WorkflowResult<{ result: WorkflowPublishResultDto }>>
  reloadWorkflow: () => Promise<void>
}

const isApi = dataSource === "api"

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : "Сервер недоступен"
}

export const createWorkflowSlice: StateCreator<StoreState, [], [], WorkflowSlice> = (set, get) => {
  return {
    workflowTemplates: SEEDS.map((s) => s.summary),
    workflowDefinitions: Object.fromEntries(
      SEEDS.map((s) => [s.summary.id, parseDefinition(s.definition)]),
    ),
    stageCatalog: MOCK_STAGE_CATALOG,
    templateForSegment: (segment) =>
      get().workflowTemplates.find((t) => t.segment === segment && t.isActive && t.isDefault),
    definitionFor: (templateId) => get().workflowDefinitions[templateId],
    saveDefinitionDraft: (templateId, definition) => {
      try {
        const parsed = parseDefinition(definition)
        set((state) => ({
          workflowDefinitions: { ...state.workflowDefinitions, [templateId]: parsed },
        }))
        return { ok: true }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Некорректный definition" }
      }
    },
    publishDefinition: (templateId, definition) =>
      set((state) => {
        const target = state.workflowTemplates.find((t) => t.id === templateId)
        return {
          workflowDefinitions: { ...state.workflowDefinitions, [templateId]: definition },
          workflowTemplates: state.workflowTemplates.map((t) => {
            if (t.id === templateId) {
              return {
                ...t,
                version: t.version + 1,
                stateCount: definition.states.length,
                publishedAt: new Date().toISOString(),
                isActive: true,
                isDefault: true,
              }
            }
            // Ровно один isDefault на сегмент — иначе templateForSegment
            // возвращает первый попавшийся.
            if (target && t.segment === target.segment && t.isDefault) {
              return { ...t, isDefault: false }
            }
            return t
          }),
        }
      }),
    createTemplate: async ({ name, key, segment, siteSource, baseTemplateId }) => {
      if (!/^[a-z][a-z0-9-]{0,63}$/.test(key)) {
        return {
          ok: false,
          error: "Ключ: латиница, начинается с буквы, только a-z, 0-9 и дефис (до 64)",
        }
      }
      if (get().workflowTemplates.some((t) => t.key === key)) {
        return { ok: false, error: `Шаблон с ключом «${key}» уже существует` }
      }
      let definition: WorkflowDefinitionV1
      try {
        const base = baseTemplateId ? get().workflowDefinitions[baseTemplateId] : undefined
        definition = parseDefinition(base ? structuredClone(base) : emptyDefinition())
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Некорректный definition" }
      }
      if (isApi) {
        try {
          const created = await api.workflowTemplates.create({
            key,
            name,
            segment,
            siteSource: siteSource ?? null,
            definition: toBackendDefinition(definition) as unknown as object,
          }, { silent: true })
          await get().reloadWorkflow()
          return { ok: true, id: created.id }
        } catch (error) {
          return { ok: false, error: errorText(error) }
        }
      }
      const id = `tpl-${key}-1`
      const summary: WorkflowTemplateSummaryDto = {
        id,
        key,
        version: 1,
        name,
        description: "",
        segment,
        siteSource: siteSource ?? null,
        // Активируется первой публикацией — до этого не влияет на заявки.
        isActive: false,
        isDefault: false,
        publishedAt: null,
        stateCount: definition.states.length,
        engagementCount: 0,
      }
      set((state) => ({
        workflowTemplates: [...state.workflowTemplates, summary],
        workflowDefinitions: { ...state.workflowDefinitions, [id]: definition },
      }))
      return { ok: true, id }
    },

    serverDraftFor: (templateId) => {
      const templates = get().workflowTemplates
      const base = templates.find((t) => t.id === templateId)
      if (!base) return undefined
      if (!base.isActive && !base.publishedAt) return base
      return templates
        .filter((t) => t.key === base.key && !t.isActive && !t.publishedAt && t.version > base.version)
        .sort((a, b) => b.version - a.version)[0]
    },

    saveServerDraft: async (templateId, definition) => {
      const base = get().workflowTemplates.find((t) => t.id === templateId)
      if (!base) return { ok: false, error: "Процесс не найден" }
      const body = toBackendDefinition(definition) as unknown as object
      try {
        const existing = get().serverDraftFor(templateId)
        const draftId = existing
          ? (await api.workflowTemplates.update(existing.id, { definition: body }, { silent: true })).id
          : (
              await api.workflowTemplates.create({
                key: base.key,
                name: base.name,
                ...(base.description ? { description: base.description } : {}),
                segment: base.segment,
                definition: body,
              }, { silent: true })
            ).id
        await get().reloadWorkflow()
        return { ok: true, draftId }
      } catch (error) {
        return { ok: false, error: errorText(error) }
      }
    },

    previewPublish: async (draftId) => {
      try {
        return { ok: true, preview: await api.workflowTemplates.publishPreview(draftId, { silent: true }) }
      } catch (error) {
        return { ok: false, error: errorText(error) }
      }
    },

    publishServerDraft: async (draftId, stateMapping) => {
      try {
        const result = await api.workflowTemplates.publish(draftId, { confirm: true, stateMapping }, { silent: true })
        // Публикация переводит заявки сегмента на новую редакцию и
        // переносит их из исчезнувших этапов — перечитываем и то и другое.
        await Promise.all([get().reloadWorkflow(), get().reloadInteractions()])
        return { ok: true, result }
      } catch (error) {
        return { ok: false, error: errorText(error) }
      }
    },

    reloadWorkflow: async () => {
      if (!isApi) return
      const data = await loadWorkflow()
      set(data)
    },
  }
}
