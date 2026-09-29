import { describe, expect, it } from 'vitest';
import { buildStageSummary } from '../../src/modules/workflow/stage-summary.js';
import type { WorkflowDefinition } from '../../src/modules/workflow/workflow-definition.js';

/**
 * Этапы в карточке заявки.
 *
 * По этому списку интерфейс рисует путь заявки со значками заметок и файлов.
 * Потеря этапа означала бы заметки, до которых нельзя добраться.
 */

const definition: WorkflowDefinition = {
  states: [
    {
      key: 'SIGNING',
      label: 'Подписание',
      order: 2,
      isInitial: false,
      isFinal: false,
      requiresAttachment: true,
      slaDays: 10,
    },
    {
      key: 'CONTACT',
      label: 'Поиск контактов',
      order: 0,
      isInitial: true,
      isFinal: false,
      requiresAttachment: false,
    },
    {
      key: 'MEETING',
      label: 'Встреча',
      order: 1,
      isInitial: false,
      isFinal: false,
      requiresAttachment: false,
    },
    {
      key: 'DONE',
      label: 'Сопровождение',
      order: 3,
      isInitial: false,
      isFinal: true,
      requiresAttachment: false,
    },
  ],
  transitions: [
    { from: 'CONTACT', to: 'MEETING', label: 'Далее', requiresComment: false, allowedRoles: [] },
    { from: 'MEETING', to: 'SIGNING', label: 'Далее', requiresComment: false, allowedRoles: [] },
    { from: 'SIGNING', to: 'DONE', label: 'Далее', requiresComment: false, allowedRoles: [] },
  ],
};

describe('сводка этапов', () => {
  it('идёт в порядке схемы процесса, а не в порядке объявления', () => {
    const stages = buildStageSummary(definition, 'MEETING', [], []);

    expect(stages.map((stage) => stage.key)).toEqual(['CONTACT', 'MEETING', 'SIGNING', 'DONE']);
  });

  it('отмечает текущий этап и переносит свойства из схемы', () => {
    const stages = buildStageSummary(definition, 'SIGNING', [], []);
    const signing = stages.find((stage) => stage.key === 'SIGNING');

    expect(stages.filter((stage) => stage.isCurrent)).toHaveLength(1);
    expect(signing).toMatchObject({
      isCurrent: true,
      requiresAttachment: true,
      slaDays: 10,
      isRemoved: false,
    });
  });

  it('складывает счётчики одного этапа, записанные под разными подписями', () => {
    const stages = buildStageSummary(
      definition,
      'MEETING',
      [
        { stateKey: 'MEETING', stateLabel: 'Встреча', count: 2 },
        { stateKey: 'MEETING', stateLabel: 'Организация встречи', count: 1 },
      ],
      [{ stateKey: 'SIGNING', stateLabel: 'Подписание', count: 4 }],
    );

    expect(stages.find((stage) => stage.key === 'MEETING')?.noteCount).toBe(3);
    expect(stages.find((stage) => stage.key === 'SIGNING')?.attachmentCount).toBe(4);
  });

  it('удалённый из схемы этап с заметками остаётся в конце под прежней подписью', () => {
    const stages = buildStageSummary(
      definition,
      'MEETING',
      [{ stateKey: 'REVISION', stateLabel: 'Корректировка документов', count: 2 }],
      [{ stateKey: 'REVISION', stateLabel: 'Корректировка документов', count: 1 }],
    );

    const last = stages[stages.length - 1];

    expect(last).toMatchObject({
      key: 'REVISION',
      label: 'Корректировка документов',
      isRemoved: true,
      isCurrent: false,
      noteCount: 2,
      attachmentCount: 1,
    });
  });

  it('удалённый этап без записей в сводку не попадает', () => {
    const stages = buildStageSummary(
      definition,
      'MEETING',
      [{ stateKey: 'REVISION', stateLabel: 'Корректировка документов', count: 0 }],
      [],
    );

    expect(stages.some((stage) => stage.key === 'REVISION')).toBe(false);
  });
});
