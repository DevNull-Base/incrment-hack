import { describe, expect, it } from 'vitest';
import { diffDefinitions, validateMapping } from '../../src/modules/workflow/workflow-diff.js';
import type { WorkflowDefinition } from '../../src/modules/workflow/workflow-definition.js';

/**
 * Сравнение редакций процесса и перенос заявок.
 *
 * Это самая ответственная часть редактора: заказчик потребовал, чтобы
 * процесс был един для всех и чтобы при изменении схемы текущая работа
 * не вставала. Значит, у каждой заявки после публикации обязан остаться
 * существующий статус. Ошибка здесь не проявляется как отказ — заявки
 * просто оказываются в несуществующем статусе и выпадают из воронки.
 */

const state = (
  key: string,
  label: string,
  order: number,
  extra: Partial<WorkflowDefinition['states'][number]> = {},
): WorkflowDefinition['states'][number] => ({
  key,
  label,
  order,
  isInitial: order === 0,
  isFinal: false,
  requiresAttachment: false,
  ...extra,
});

const current: WorkflowDefinition = {
  states: [
    state('CONTACT', 'Поиск контактов', 0),
    state('MEETING', 'Встреча', 1),
    state('REVISION', 'Корректировка документов', 2),
    state('SIGNING', 'Подписание', 3),
    state('DONE', 'Завершено', 4, { isFinal: true }),
  ],
  transitions: [
    { from: 'CONTACT', to: 'MEETING', label: 'Дальше', requiresComment: false, allowedRoles: [] },
    { from: 'MEETING', to: 'REVISION', label: 'Правки', requiresComment: false, allowedRoles: [] },
    { from: 'REVISION', to: 'SIGNING', label: 'Готово', requiresComment: false, allowedRoles: [] },
    { from: 'SIGNING', to: 'DONE', label: 'Финал', requiresComment: false, allowedRoles: [] },
  ],
};

/** Та же схема без промежуточного статуса «Корректировка документов». */
const withoutRevision: WorkflowDefinition = {
  states: current.states.filter((item) => item.key !== 'REVISION'),
  transitions: [
    { from: 'CONTACT', to: 'MEETING', label: 'Дальше', requiresComment: false, allowedRoles: [] },
    { from: 'MEETING', to: 'SIGNING', label: 'Готово', requiresComment: false, allowedRoles: [] },
    { from: 'SIGNING', to: 'DONE', label: 'Финал', requiresComment: false, allowedRoles: [] },
  ],
};

describe('сравнение редакций процесса', () => {
  it('различает переименование статуса и смену его ключа', () => {
    const renamed: WorkflowDefinition = {
      ...current,
      states: current.states.map((item) =>
        item.key === 'MEETING' ? { ...item, label: 'Очная встреча' } : item,
      ),
    };

    const diff = diffDefinitions(current, renamed);

    expect(diff.renamedStates).toEqual([
      { key: 'MEETING', fromLabel: 'Встреча', toLabel: 'Очная встреча' },
    ]);
    // Переименование не должно выглядеть как удаление: заявки остаются
    // на месте, переносить их некуда и незачем.
    expect(diff.removedStates).toHaveLength(0);
    expect(diff.addedStates).toHaveLength(0);
  });

  it('смена ключа считается удалением и добавлением', () => {
    const rekeyed: WorkflowDefinition = {
      states: current.states.map((item) =>
        item.key === 'MEETING' ? { ...item, key: 'MEETING_V2' } : item,
      ),
      transitions: [
        { from: 'CONTACT', to: 'MEETING_V2', label: 'Дальше', requiresComment: false, allowedRoles: [] },
        { from: 'MEETING_V2', to: 'REVISION', label: 'Правки', requiresComment: false, allowedRoles: [] },
        { from: 'REVISION', to: 'SIGNING', label: 'Готово', requiresComment: false, allowedRoles: [] },
        { from: 'SIGNING', to: 'DONE', label: 'Финал', requiresComment: false, allowedRoles: [] },
      ],
    };

    const diff = diffDefinitions(current, rekeyed);

    expect(diff.removedStates.map((item) => item.key)).toEqual(['MEETING']);
    expect(diff.addedStates.map((item) => item.key)).toEqual(['MEETING_V2']);
  });

  it('предлагает предыдущий статус для удалённого', () => {
    const diff = diffDefinitions(current, withoutRevision);

    expect(diff.removedStates).toEqual([
      { key: 'REVISION', label: 'Корректировка документов', suggestedTarget: 'MEETING' },
    ]);
  });

  it('берёт следующий статус, когда предыдущего не осталось', () => {
    // Удаляются начальный статус и следующий за ним: предлагать нечего,
    // кроме ближайшего сохранившегося статуса дальше по маршруту.
    const tailOnly: WorkflowDefinition = {
      states: [
        state('SIGNING', 'Подписание', 3, { isInitial: true }),
        state('DONE', 'Завершено', 4, { isFinal: true }),
      ],
      transitions: [
        { from: 'SIGNING', to: 'DONE', label: 'Финал', requiresComment: false, allowedRoles: [] },
      ],
    };

    const diff = diffDefinitions(current, tailOnly);
    const contact = diff.removedStates.find((item) => item.key === 'CONTACT');

    expect(contact?.suggestedTarget).toBe('SIGNING');
  });

  it('замечает изменение состава переходов', () => {
    const extraTransition: WorkflowDefinition = {
      ...current,
      transitions: [
        ...current.transitions,
        { from: 'MEETING', to: 'SIGNING', label: 'Без правок', requiresComment: false, allowedRoles: [] },
      ],
    };

    expect(diffDefinitions(current, extraTransition).transitionsChanged).toBe(true);
    // Перестановка переходов местами изменением не является.
    expect(
      diffDefinitions(current, { ...current, transitions: [...current.transitions].reverse() })
        .transitionsChanged,
    ).toBe(false);
  });
});

describe('проверка сопоставления статусов', () => {
  const diff = diffDefinitions(current, withoutRevision);

  it('требует указать цель для удалённого статуса с заявками', () => {
    const issues = validateMapping(diff, withoutRevision, {}, new Set(['REVISION']));

    expect(issues).toHaveLength(1);
    expect(issues[0]?.field).toBe('stateMapping.REVISION');
  });

  it('не требует переноса из пустого статуса', () => {
    // Статус исчезает бесследно, если в нём нет ни одной заявки:
    // заставлять администратора выбирать цель незачем.
    expect(validateMapping(diff, withoutRevision, {}, new Set())).toHaveLength(0);
  });

  it('отвергает перенос в несуществующий статус', () => {
    const issues = validateMapping(
      diff,
      withoutRevision,
      { REVISION: 'NOWHERE' },
      new Set(['REVISION']),
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('отсутствует');
  });

  it('принимает корректное сопоставление', () => {
    expect(
      validateMapping(diff, withoutRevision, { REVISION: 'MEETING' }, new Set(['REVISION'])),
    ).toHaveLength(0);
  });
});
