import type { WorkflowStage } from "@/types"

/**
 * Человеческие описания 14 этапов workflow.
 * Ключи совпадают с `currentStateKey` контракта бекенда (openapi.json).
 * Единый источник для страницы «Путь обращения» и виджета StageCanvas.
 */
export const STAGE_DESCRIPTIONS: Record<WorkflowStage, string> = {
  SEARCH_CONTACTS: "Поиск и анализ контактов вуза для установления связи",
  COMMUNICATION: "Установление первичной коммуникации с представителями вуза",
  MEETING: "Организация и проведение встречи для обсуждения сотрудничества",
  DOCUMENT_EXCHANGE: "Обмен необходимыми документами между сторонами",
  DOCUMENT_REVISION: "Корректировка и согласование документов",
  SIGNING: "Подписание итоговых документов",
  MATERIALS_TRANSFER: "Передача учебных материалов и ресурсов",
  IMPLEMENTATION_SUPPORT: "Сопровождение внедрения IT-продукта в вуз",
  TEACHER_TRAINING: "Обучение преподавателей работе с продуктом",
  PROGRAM_UPDATE: "Актуализация образовательной программы",
  CLASSES_RUNNING: "Ведение занятий по программе",
  DOCUMENTATION_UPDATE: "Актуализация сопроводительной документации",
  TEACHER_ADVANCED_TRAINING: "Повышение квалификации преподавателей",
  STAGE_CONTROL: "Контроль и мониторинг этапов процесса",
}
