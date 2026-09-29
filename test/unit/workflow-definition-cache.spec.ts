import { describe, expect, it, vi } from 'vitest';
import { WorkflowService } from '../../src/modules/workflow/workflow.service.js';
import { BASE_WORKFLOW_DEFINITION } from '../../src/modules/workflow/base-template.js';

/**
 * Кэш определений процесса.
 *
 * Карточка и переход берут определение из кэша: редакцию, по которой
 * ведутся заявки, изменить нельзя. Черновик правится, поэтому его
 * определение каждый раз читается заново.
 */
function service(template: { isActive: boolean; publishedAt: Date | null }) {
  const findUnique = vi.fn().mockResolvedValue({ definition: BASE_WORKFLOW_DEFINITION, ...template });
  const prisma = { workflowTemplate: { findUnique } };
  const logger = { setContext: () => undefined };
  const workflow = new WorkflowService(prisma as never, {} as never, {} as never, {} as never, logger as never);
  return { workflow, findUnique };
}

describe('кэш определений процесса', () => {
  it('действующая редакция читается из базы один раз', async () => {
    const { workflow, findUnique } = service({ isActive: true, publishedAt: new Date() });

    const first = await workflow.definitionOf('t1');
    const second = await workflow.definitionOf('t1');

    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(first.states.length).toBe(BASE_WORKFLOW_DEFINITION.states.length);
  });

  it('черновик читается каждый раз: его правят', async () => {
    const { workflow, findUnique } = service({ isActive: false, publishedAt: null });

    await workflow.definitionOf('draft');
    await workflow.definitionOf('draft');

    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});
