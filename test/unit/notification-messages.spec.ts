import { describe, expect, it } from 'vitest';
import {
  buildEscalationForManagerText,
  buildEscalationText,
  buildOrphanedEscalationText,
  buildTaskAssignedText,
  buildTaskCompletedText,
  buildTaskReminderText,
  buildTransitionText,
  escalationDedupeKey,
  formatTaskDue,
  pluralizeDays,
  taskReminderDedupeKey,
} from '../../src/modules/notification/notification-messages.js';

/**
 * Тексты напоминаний и ключи повторной отправки.
 *
 * Ключ проверяется тщательнее текстов: от него зависит, придёт напоминание
 * один раз или будет повторяться при каждом прогоне планировщика. Ошибка
 * здесь не ломает систему, а делает её невыносимой — пользователь получает
 * одно и то же сообщение ежедневно и перестаёт читать уведомления вовсе.
 */

const engagement = {
  id: 'eng-1',
  counterpartyName: 'МГТУ им. Баумана',
  stateLabel: 'Подписание документов',
};

const enteredAt = new Date('2026-09-01T10:00:00.000Z');

describe('ключ повторной отправки напоминания', () => {
  it('одинаков для одной и той же ситуации', () => {
    const first = escalationDedupeKey({
      engagementId: 'eng-1',
      stateKey: 'SIGNING',
      enteredAt,
      userId: 'user-1',
    });
    const second = escalationDedupeKey({
      engagementId: 'eng-1',
      stateKey: 'SIGNING',
      enteredAt: new Date('2026-09-01T10:00:00.000Z'),
      userId: 'user-1',
    });

    expect(first).toBe(second);
  });

  it('различается для ответственного и его руководителя', () => {
    // Одно напоминание адресуется двоим: общий ключ подавил бы доставку
    // второму, и руководитель не узнал бы о задержке.
    const owner = escalationDedupeKey({
      engagementId: 'eng-1',
      stateKey: 'SIGNING',
      enteredAt,
      userId: 'user-1',
    });
    const manager = escalationDedupeKey({
      engagementId: 'eng-1',
      stateKey: 'SIGNING',
      enteredAt,
      userId: 'user-2',
    });

    expect(owner).not.toBe(manager);
  });

  it('различается при повторном входе в тот же статус', () => {
    // Возврат на предыдущий шаг процессом предусмотрен. Если заявка снова
    // застряла в том же статусе — это новая ситуация, и напоминание должно
    // прийти заново, а не считаться уже отправленным.
    const first = escalationDedupeKey({
      engagementId: 'eng-1',
      stateKey: 'SIGNING',
      enteredAt,
      userId: 'user-1',
    });
    const afterReturn = escalationDedupeKey({
      engagementId: 'eng-1',
      stateKey: 'SIGNING',
      enteredAt: new Date('2026-10-15T08:00:00.000Z'),
      userId: 'user-1',
    });

    expect(first).not.toBe(afterReturn);
  });

  it('не содержит канал доставки', () => {
    // Канал добавляет служба отправки: иначе одно и то же сообщение ушло бы
    // только первым каналом, а остальные посчитались бы повтором.
    const key = escalationDedupeKey({
      engagementId: 'eng-1',
      stateKey: 'SIGNING',
      enteredAt,
      userId: 'user-1',
    });

    expect(key).not.toContain('IN_APP');
    expect(key).not.toContain('TELEGRAM');
  });
});

describe('склонение числа дней', () => {
  it.each([
    [1, 'день'],
    [2, 'дня'],
    [4, 'дня'],
    [5, 'дней'],
    [11, 'дней'],
    [14, 'дней'],
    [21, 'день'],
    [22, 'дня'],
    [25, 'дней'],
  ])('%i → %s', (days, expected) => {
    expect(pluralizeDays(days)).toBe(expected);
  });
});

describe('тексты уведомлений', () => {
  it('напоминание называет контрагента, статус и срок простоя', () => {
    const text = buildEscalationText(engagement, 21);

    expect(text.subject).toContain('21 день');
    expect(text.body).toContain('МГТУ им. Баумана');
    expect(text.body).toContain('Подписание документов');
  });

  it('руководителю дополнительно называется ответственный', () => {
    // Без имени ответственного руководителю пришлось бы искать его вручную.
    const text = buildEscalationForManagerText(engagement, 15, 'Иванова Анна');

    expect(text.body).toContain('Иванова Анна');
    expect(text.subject).toContain('подчинённого');
  });

  it('сообщение о переходе называет прежний статус, когда он известен', () => {
    const withFrom = buildTransitionText('ИТМО', 'Обмен документами', 'Подписание', 'Орлов Дмитрий');
    const withoutFrom = buildTransitionText('ИТМО', null, 'Подписание', 'Орлов Дмитрий');

    expect(withFrom.body).toContain('из «Обмен документами»');
    expect(withoutFrom.body).not.toContain('из «');
    expect(withoutFrom.body).toContain('Орлов Дмитрий');
  });
});

describe('уведомления о задачах календаря', () => {
  const task = {
    id: 'task-1',
    title: 'Позвонить на кафедру',
    dueDate: '2026-09-30',
    dueTime: '15:00',
    counterpartyName: 'НИЯУ МИФИ',
  };

  it('срок читается по-человечески: с временем и без', () => {
    expect(formatTaskDue(task)).toBe('30.09.2026 в 15:00');
    expect(formatTaskDue({ dueDate: '2026-09-30', dueTime: null })).toBe('30.09.2026');
  });

  it('напоминание называет задачу, срок и заявку', () => {
    const text = buildTaskReminderText(task);

    expect(text.subject).toBe('Напоминание: Позвонить на кафедру');
    expect(text.body).toContain('30.09.2026 в 15:00');
    expect(text.body).toContain('«НИЯУ МИФИ»');
  });

  it('поручение называет, кто его поставил', () => {
    expect(buildTaskAssignedText(task, 'Петров Сергей').body).toContain('Петров Сергей');
  });

  it('о выполнении сообщается постановщику с именем исполнителя', () => {
    const text = buildTaskCompletedText({ ...task, counterpartyName: null }, 'Иванова Анна');

    expect(text.subject).toBe('Задача выполнена: Позвонить на кафедру');
    expect(text.body).toContain('Иванова Анна');
    expect(text.body).not.toContain('Заявка');
  });

  it('перенос напоминания — новое напоминание, повтор прогона — нет', () => {
    const first = taskReminderDedupeKey('task-1', new Date('2026-09-30T06:00:00Z'));

    expect(taskReminderDedupeKey('task-1', new Date('2026-09-30T06:00:00Z'))).toBe(first);
    expect(taskReminderDedupeKey('task-1', new Date('2026-09-30T07:00:00Z'))).not.toBe(first);
  });
});

describe('напоминание о заявке заблокированного сотрудника', () => {
  it('имеет свой ключ повтора — не глушится обычным напоминанием', () => {
    const base = { engagementId: 'e-1', stateKey: 'CONTRACT', enteredAt: new Date('2026-09-01T00:00:00Z'), userId: 'm-1' };

    expect(escalationDedupeKey({ ...base, kind: 'orphaned' })).not.toBe(escalationDedupeKey(base));
  });

  it('называет заблокированного и просит передать заявку', () => {
    const text = buildOrphanedEscalationText({ id: 'e-1', counterpartyName: 'ООО «Пример»', stateLabel: 'Договор' }, 15, 'Орлов Дмитрий');

    expect(text.body).toContain('Орлов Дмитрий');
    expect(text.body).toContain('заблокирован');
    expect(text.subject).toContain('15 дней');
  });
});
