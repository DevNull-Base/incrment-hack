import { z } from 'zod';

/**
 * Описание шаблона workflow.
 *
 * Хранится в JSONB и валидируется этой схемой перед сохранением: определение
 * приходит из интерфейса редактора, и без проверки в базу попал бы автомат
 * с недостижимыми состояниями или ссылками на несуществующие статусы.
 *
 * Правка схемы не создаёт параллельных процессов: публикация новой редакции
 * переводит на неё все заявки сегмента (см. WorkflowTemplateService). Историю
 * при этом сохраняют подписи статусов, зафиксированные в журнале переходов,
 * в заметках и во вложениях на момент записи: переименование или удаление
 * статуса не меняет смысла уже сделанного, что прямо требуется ТЗ
 * («корректировка именования статусов»).
 */

/** Ключ состояния: латиница, цифры и подчёркивание. */
const stateKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Z][A-Z0-9_]*$/, 'Ключ состояния: заглавные латинские буквы, цифры и подчёркивание');

export const workflowStateSchema = z.object({
  key: stateKeySchema,
  /** Отображаемое название. Именно оно правится пользователем. */
  label: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  /** Порядок отображения на диаграмме пути. */
  order: z.number().int().min(0),
  /** Начальное состояние; ровно одно на шаблон. */
  isInitial: z.boolean().default(false),
  /** Завершающее состояние; из него переходов нет. */
  isFinal: z.boolean().default(false),
  /**
   * Норматив пребывания в состоянии, дни. По его истечении взаимодействие
   * попадает в список просроченных — это и есть «контроль за исполнением
   * каждого этапа» из пункта 14 базового процесса ТЗ.
   */
  slaDays: z.number().int().min(1).max(365).optional(),
  /** Требовать хотя бы одно вложение перед выходом из состояния. */
  requiresAttachment: z.boolean().default(false),
});

export const workflowTransitionSchema = z.object({
  from: stateKeySchema,
  to: stateKeySchema,
  /** Подпись кнопки перехода в интерфейсе. */
  label: z.string().min(1).max(200),
  /** Требовать комментарий при переходе. */
  requiresComment: z.boolean().default(false),
  /** Роли, которым разрешён переход. Пусто — разрешён всем. */
  allowedRoles: z.array(z.enum(['USER', 'MANAGER', 'ADMIN'])).default([]),
});

export const workflowDefinitionSchema = z
  .object({
    states: z.array(workflowStateSchema).min(2, 'Процесс должен содержать минимум два состояния'),
    transitions: z.array(workflowTransitionSchema).min(1),
  })
  .superRefine((definition, ctx) => {
    const keys = new Set<string>();

    for (const state of definition.states) {
      if (keys.has(state.key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['states'],
          message: `Дублирующийся ключ состояния: ${state.key}`,
        });
      }
      keys.add(state.key);
    }

    const initial = definition.states.filter((state) => state.isInitial);
    if (initial.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['states'],
        message: `Начальное состояние должно быть ровно одно, найдено: ${initial.length}`,
      });
    }

    if (!definition.states.some((state) => state.isFinal)) {
      ctx.addIssue({
        code: 'custom',
        path: ['states'],
        message: 'Процесс должен содержать хотя бы одно завершающее состояние',
      });
    }

    for (const transition of definition.transitions) {
      if (!keys.has(transition.from)) {
        ctx.addIssue({
          code: 'custom',
          path: ['transitions'],
          message: `Переход ссылается на несуществующее состояние: ${transition.from}`,
        });
      }
      if (!keys.has(transition.to)) {
        ctx.addIssue({
          code: 'custom',
          path: ['transitions'],
          message: `Переход ссылается на несуществующее состояние: ${transition.to}`,
        });
      }
    }

    // Из завершающего состояния переходов быть не должно — иначе
    // «завершённое» взаимодействие могло бы снова стать активным,
    // и отчёты по завершённым работам перестали бы сходиться.
    const finalKeys = new Set(definition.states.filter((s) => s.isFinal).map((s) => s.key));
    for (const transition of definition.transitions) {
      if (finalKeys.has(transition.from)) {
        ctx.addIssue({
          code: 'custom',
          path: ['transitions'],
          message: `Из завершающего состояния ${transition.from} не может быть переходов`,
        });
      }
    }

    // Проверка достижимости: состояние, в которое нельзя попасть,
    // почти всегда означает ошибку в редакторе процесса.
    const reachable = new Set<string>();
    const initialKey = initial[0]?.key;

    if (initialKey) {
      const queue = [initialKey];
      reachable.add(initialKey);

      while (queue.length > 0) {
        const current = queue.shift() as string;
        for (const transition of definition.transitions) {
          if (transition.from === current && !reachable.has(transition.to)) {
            reachable.add(transition.to);
            queue.push(transition.to);
          }
        }
      }

      for (const state of definition.states) {
        if (!reachable.has(state.key)) {
          ctx.addIssue({
            code: 'custom',
            path: ['states'],
            message: `Состояние ${state.key} недостижимо из начального`,
          });
        }
      }
    }
  });

export type WorkflowState = z.infer<typeof workflowStateSchema>;
export type WorkflowTransition = z.infer<typeof workflowTransitionSchema>;
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

/** Находит состояние по ключу. */
export function findState(definition: WorkflowDefinition, key: string): WorkflowState | undefined {
  return definition.states.find((state) => state.key === key);
}

/** Возвращает переходы, доступные из указанного состояния. */
export function transitionsFrom(definition: WorkflowDefinition, key: string): WorkflowTransition[] {
  return definition.transitions.filter((transition) => transition.from === key);
}

/** Начальное состояние процесса. */
export function initialState(definition: WorkflowDefinition): WorkflowState {
  const state = definition.states.find((item) => item.isInitial);

  if (!state) {
    // Схема это гарантирует; проверка защищает от данных, попавших в БД
    // в обход валидации (например, при ручной правке).
    throw new Error('В определении процесса отсутствует начальное состояние');
  }

  return state;
}
