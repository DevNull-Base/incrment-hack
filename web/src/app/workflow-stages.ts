import type { Segment } from "@/shared/api"
import type { WorkflowDefinitionV1 } from "@/shared/api/workflow-definition"
import { STAGE_DESCRIPTIONS } from "@/shared/api/stage-descriptions"
import { WORKFLOW_STAGES, type WorkflowStage } from "@/types"

// ========================================
// Справочник этапов по сегментам.
//
// Этапы — это состояния действующего шаблона процесса. В режиме API
// они берутся из определения шаблона бэкенда (ключи вида CONTACT_SEARCH,
// DOCUMENTS_EXCHANGE, …); в демо-режиме — из WORKFLOW_STAGES моков.
// Страницы не должны опираться на конкретные ключи: процесс редактируется
// администратором, и после публикации набор этапов меняется.
// ========================================

export interface StageInfo {
  key: string
  label: string
  /** Номер по порядку, с 1. */
  step: number
  /** Завершающее состояние: переходов из него нет. */
  isFinal: boolean
  /** Отказ — завершение без результата; в прогресс не засчитывается. */
  isRejected: boolean
  description?: string
  slaDays?: number
  requiresAttachment?: boolean
}

export type StageCatalog = Record<Segment, StageInfo[]>

/** Отказ в базовых процессах бэкенда — REJECTED; в демо-моках отказа нет. */
function isRejectedKey(key: string): boolean {
  return key === "REJECTED"
}

export function stagesFromDefinition(definition: WorkflowDefinitionV1): StageInfo[] {
  return [...definition.states]
    .sort((a, b) => a.order - b.order)
    .map((state, index) => ({
      key: state.key,
      label: state.label,
      step: index + 1,
      isFinal: state.kind === "final",
      isRejected: isRejectedKey(state.key),
      description: state.description,
      slaDays: state.slaDays,
      requiresAttachment: state.requiresAttachment,
    }))
}

/** Демо-режим: 14 этапов из моков, «Контроль этапов» — итог. */
function mockStages(): StageInfo[] {
  return WORKFLOW_STAGES.map((stage) => ({
    key: stage.key,
    label: stage.label,
    step: stage.step,
    isFinal: stage.key === "STAGE_CONTROL",
    isRejected: false,
    description: STAGE_DESCRIPTIONS[stage.key as WorkflowStage],
  }))
}

/** Демо-моки B2C — короткая воронка из шести этапов. */
const MOCK_B2C_KEYS = ["SEARCH_CONTACTS", "COMMUNICATION", "DOCUMENT_EXCHANGE", "SIGNING", "MATERIALS_TRANSFER", "STAGE_CONTROL"]

export const MOCK_STAGE_CATALOG: StageCatalog = {
  B2B: mockStages(),
  B2C: mockStages()
    .filter((s) => MOCK_B2C_KEYS.includes(s.key))
    .map((s, index) => ({ ...s, step: index + 1 })),
}

export const EMPTY_STAGE_CATALOG: StageCatalog = { B2B: [], B2C: [] }

export interface StageProgress {
  /** Индекс в списке этапов, -1 — этап неизвестен. */
  index: number
  /** Сколько этапов пройдено, включая текущий. */
  completed: number
  /** Этапов на пути к результату (без отказа). */
  total: number
  pct: number
  stage: StageInfo | undefined
}

/**
 * Прогресс по этапам. Отказ считается нулём, а не «последним этапом»:
 * иначе заявка, от которой отказались, выглядела бы завершённой на 100%.
 */
export function stageProgress(stages: StageInfo[], key: string): StageProgress {
  const path = stages.filter((s) => !s.isRejected)
  const stage = stages.find((s) => s.key === key)
  const index = path.findIndex((s) => s.key === key)
  const total = path.length || 1
  if (!stage || stage.isRejected || index < 0) {
    return { index, completed: 0, total, pct: 0, stage }
  }
  const completed = index + 1
  return { index, completed, total, pct: Math.round((completed / total) * 100), stage }
}

/** Взаимодействие завершено: стоит в финальном состоянии (итог или отказ). */
export function isClosedStage(stages: StageInfo[], key: string): boolean {
  return stages.find((s) => s.key === key)?.isFinal ?? false
}

/** Порядковый индекс этапа (для сравнений «дошла ли заявка до встречи»). */
export function stageIndexOf(stages: StageInfo[], key: string): number {
  return stages.findIndex((s) => s.key === key)
}

// ---------------------------------------- группы колонок канбана

export interface StageGroup {
  title: string
  tone: "sky" | "amber" | "emerald" | "violet" | "slate"
  stages: StageInfo[]
}

/**
 * Смысловые группы этапов. Таблица покрывает ключи демо-моков и базовых
 * процессов бэкенда; этапы, добавленные администратором, попадают в
 * группу «Другие этапы», завершающие — в «Итог».
 */
const GROUP_TABLE: Record<Segment, { title: string; tone: StageGroup["tone"]; keys: string[] }[]> = {
  B2B: [
    { title: "Подготовка", tone: "sky", keys: ["SEARCH_CONTACTS", "CONTACT_SEARCH", "COMMUNICATION", "MEETING"] },
    {
      title: "Документы",
      tone: "amber",
      keys: ["DOCUMENT_EXCHANGE", "DOCUMENTS_EXCHANGE", "DOCUMENT_REVISION", "DOCUMENTS_REVISION", "SIGNING"],
    },
    {
      title: "Внедрение",
      tone: "emerald",
      keys: ["MATERIALS_TRANSFER", "IMPLEMENTATION_SUPPORT", "IMPLEMENTATION", "TEACHER_TRAINING", "PROGRAM_UPDATE"],
    },
    {
      title: "Эксплуатация",
      tone: "violet",
      keys: ["CLASSES_RUNNING", "CLASSES", "DOCUMENTATION_UPDATE", "DOCS_UPDATE", "TEACHER_ADVANCED_TRAINING", "QUALIFICATION"],
    },
  ],
  B2C: [
    { title: "Контакт и сделка", tone: "sky", keys: ["SEARCH_CONTACTS", "COMMUNICATION", "REQUEST", "QUALIFICATION", "OFFER"] },
    { title: "Документы", tone: "amber", keys: ["DOCUMENT_EXCHANGE", "SIGNING", "CONTRACT"] },
    { title: "Обучение и контроль", tone: "emerald", keys: ["MATERIALS_TRANSFER", "STAGE_CONTROL", "ACCESS_GRANTED", "LEARNING"] },
  ],
}

export function kanbanGroups(stages: StageInfo[], segment: Segment): StageGroup[] {
  const used = new Set<string>()
  const groups: StageGroup[] = []
  for (const g of GROUP_TABLE[segment]) {
    const members = stages.filter((s) => g.keys.includes(s.key) && !(s.isFinal && s.key !== "STAGE_CONTROL"))
    members.forEach((s) => used.add(s.key))
    if (members.length > 0) groups.push({ title: g.title, tone: g.tone, stages: members })
  }
  const other = stages.filter((s) => !used.has(s.key) && !s.isFinal)
  if (other.length > 0) groups.push({ title: "Другие этапы", tone: "violet", stages: other })
  const finals = stages.filter((s) => !used.has(s.key) && s.isFinal)
  if (finals.length > 0) groups.push({ title: "Итог", tone: "slate", stages: finals })
  return groups
}
