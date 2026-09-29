import { WorkflowDefinition, WorkflowState } from './workflow-definition.js';

/**
 * Сравнение редакций процесса и подбор сопоставления статусов.
 *
 * Вынесено отдельным модулем из чистых функций: это самая ответственная
 * часть публикации — от неё зависит, куда переедут заявки, — и она должна
 * проверяться тестами без базы данных и без Nest.
 *
 * Постановка задачи со стороны заказчика: процесс един для всех, версии
 * не сосуществуют, а при удалении статуса заявки из него переносятся
 * «на соседний, лучше всего предыдущий или следующий».
 */

/** Статус, исчезающий из процесса, и куда предлагается перевести заявки. */
export interface RemovedState {
  key: string;
  label: string;
  /** Предлагаемая цель переноса; null — подобрать не удалось. */
  suggestedTarget: string | null;
}

export interface RenamedState {
  key: string;
  fromLabel: string;
  toLabel: string;
}

export interface WorkflowDiff {
  addedStates: Array<{ key: string; label: string }>;
  removedStates: RemovedState[];
  renamedStates: RenamedState[];
  /** Изменился ли состав переходов. */
  transitionsChanged: boolean;
}

/**
 * Сравнивает действующую редакцию с новой.
 *
 * Статус опознаётся по ключу: смена подписи при том же ключе — это
 * переименование, а смена ключа — удаление и добавление. Иначе «мягкое»
 * переименование ключа привело бы к молчаливой потере заявок.
 */
export function diffDefinitions(
  current: WorkflowDefinition,
  next: WorkflowDefinition,
): WorkflowDiff {
  const currentByKey = new Map(current.states.map((state) => [state.key, state]));
  const nextByKey = new Map(next.states.map((state) => [state.key, state]));

  const addedStates = next.states
    .filter((state) => !currentByKey.has(state.key))
    .map((state) => ({ key: state.key, label: state.label }));

  const removedStates = current.states
    .filter((state) => !nextByKey.has(state.key))
    .map((state) => ({
      key: state.key,
      label: state.label,
      suggestedTarget: suggestTarget(current, next, state),
    }));

  const renamedStates = current.states
    .filter((state) => {
      const updated = nextByKey.get(state.key);
      return updated !== undefined && updated.label !== state.label;
    })
    .map((state) => ({
      key: state.key,
      fromLabel: state.label,
      toLabel: nextByKey.get(state.key)?.label ?? state.label,
    }));

  return {
    addedStates,
    removedStates,
    renamedStates,
    transitionsChanged: !sameTransitions(current, next),
  };
}

/**
 * Подбирает статус, в который логично перевести заявки из удаляемого.
 *
 * Порядок поиска задан ответом заказчика: сначала ближайший предыдущий
 * статус действующего процесса, затем ближайший следующий. Оба кандидата
 * проверяются на присутствие в новой редакции — предлагать статус, который
 * тоже удаляется, бессмысленно.
 *
 * Если не подошёл ни один, возвращается null: подсказки не будет, и
 * администратор укажет цель сам. Придумывать за него начальный статус
 * нельзя — это откатило бы заявки в начало процесса.
 */
function suggestTarget(
  current: WorkflowDefinition,
  next: WorkflowDefinition,
  removed: WorkflowState,
): string | null {
  const survivingKeys = new Set(next.states.map((state) => state.key));

  const ordered = [...current.states].sort((a, b) => a.order - b.order);
  const position = ordered.findIndex((state) => state.key === removed.key);

  if (position === -1) {
    return null;
  }

  for (let i = position - 1; i >= 0; i--) {
    const candidate = ordered[i];
    if (candidate && survivingKeys.has(candidate.key)) {
      return candidate.key;
    }
  }

  for (let i = position + 1; i < ordered.length; i++) {
    const candidate = ordered[i];
    if (candidate && survivingKeys.has(candidate.key)) {
      return candidate.key;
    }
  }

  return null;
}

/** Сравнение набора переходов без учёта порядка их перечисления. */
function sameTransitions(current: WorkflowDefinition, next: WorkflowDefinition): boolean {
  const fingerprint = (definition: WorkflowDefinition): string =>
    definition.transitions
      .map(
        (transition) =>
          `${transition.from}>${transition.to}|${transition.label}|${String(
            transition.requiresComment,
          )}|${[...transition.allowedRoles].sort().join(',')}`,
      )
      .sort()
      .join(';');

  return fingerprint(current) === fingerprint(next);
}

/**
 * Проверяет полноту сопоставления статусов, заданного администратором.
 *
 * Возвращает перечень проблем, а не бросает исключение: вызывающий код
 * складывает их в одно сообщение, чтобы администратор увидел все незакрытые
 * статусы разом, а не исправлял их по одному.
 */
export function validateMapping(
  diff: WorkflowDiff,
  next: WorkflowDefinition,
  mapping: Record<string, string>,
  /** Статусы, в которых реально стоят заявки; остальные переносить не нужно. */
  occupiedKeys: Set<string>,
): Array<{ field: string; message: string }> {
  const issues: Array<{ field: string; message: string }> = [];
  const nextKeys = new Set(next.states.map((state) => state.key));

  for (const removed of diff.removedStates) {
    // Пустой статус исчезает бесследно: переносить нечего.
    if (!occupiedKeys.has(removed.key)) {
      continue;
    }

    const target = mapping[removed.key];

    if (!target) {
      issues.push({
        field: `stateMapping.${removed.key}`,
        message: `Укажите, в какой статус перевести заявки из «${removed.label}»`,
      });
      continue;
    }

    if (!nextKeys.has(target)) {
      issues.push({
        field: `stateMapping.${removed.key}`,
        message: `Статус ${target} отсутствует в новой редакции процесса`,
      });
    }
  }

  return issues;
}
