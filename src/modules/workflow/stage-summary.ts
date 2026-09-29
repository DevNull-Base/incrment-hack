import type { WorkflowDefinition } from './workflow-definition.js';

/** Этап процесса в карточке заявки — с тем, что к нему приложено. */
export interface StageSummary {
  key: string;
  label: string;
  isCurrent: boolean;
  isInitial: boolean;
  isFinal: boolean;
  /**
   * Этапа нет в действующей схеме: администратор удалил его, а заметки
   * или файлы, оставленные на нём раньше, сохранились. Такие этапы идут
   * в конце списка под той подписью, с которой их видели при записи.
   */
  isRemoved: boolean;
  requiresAttachment: boolean;
  slaDays: number | null;
  noteCount: number;
  attachmentCount: number;
}

/** Сколько заметок либо файлов на этапе и под какой подписью они записаны. */
export interface StageCount {
  stateKey: string;
  stateLabel: string | null;
  count: number;
}

/**
 * Собирает список этапов для карточки заявки.
 *
 * Этапы идут в порядке схемы процесса — так интерфейс рисует путь без
 * собственной сортировки. Каждый несёт число заметок и файлов, чтобы
 * значки на шагах пути не требовали отдельного запроса на каждый шаг.
 */
export function buildStageSummary(
  definition: WorkflowDefinition,
  currentStateKey: string,
  notes: readonly StageCount[],
  attachments: readonly StageCount[],
): StageSummary[] {
  const noteCounts = sumByKey(notes);
  const attachmentCounts = sumByKey(attachments);

  const known = [...definition.states]
    .sort((left, right) => left.order - right.order)
    .map((state) => ({
      key: state.key,
      label: state.label,
      isCurrent: state.key === currentStateKey,
      isInitial: state.isInitial,
      isFinal: state.isFinal,
      isRemoved: false,
      requiresAttachment: state.requiresAttachment,
      slaDays: state.slaDays ?? null,
      noteCount: noteCounts.get(state.key) ?? 0,
      attachmentCount: attachmentCounts.get(state.key) ?? 0,
    }));

  const knownKeys = new Set(known.map((stage) => stage.key));
  const removedLabels = new Map<string, string>();

  for (const row of [...notes, ...attachments]) {
    if (!knownKeys.has(row.stateKey) && row.count > 0 && !removedLabels.has(row.stateKey)) {
      removedLabels.set(row.stateKey, row.stateLabel ?? row.stateKey);
    }
  }

  const removed = [...removedLabels.entries()].map(([key, label]) => ({
    key,
    label,
    isCurrent: false,
    isInitial: false,
    isFinal: false,
    isRemoved: true,
    requiresAttachment: false,
    slaDays: null,
    noteCount: noteCounts.get(key) ?? 0,
    attachmentCount: attachmentCounts.get(key) ?? 0,
  }));

  return [...known, ...removed];
}

/**
 * Складывает счётчики по ключу этапа.
 *
 * Группировка в базе идёт по паре «ключ + подпись», поэтому один этап,
 * переименованный между двумя заметками, приходит двумя строками — а в
 * карточке это один шаг пути.
 */
function sumByKey(rows: readonly StageCount[]): Map<string, number> {
  const result = new Map<string, number>();

  for (const row of rows) {
    result.set(row.stateKey, (result.get(row.stateKey) ?? 0) + row.count);
  }

  return result;
}
