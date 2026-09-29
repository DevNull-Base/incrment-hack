import { describe, expect, it } from 'vitest';
import { describeActivity } from '../../src/modules/activity/activity-describe.js';

/**
 * Подписи событий ленты действий.
 *
 * Менеджер восстанавливает по ленте ход работы спустя недели, поэтому
 * подпись обязана называть суть изменения, а не только его тип, и не
 * должна показывать то, что пользователь из карточки убрал.
 */

describe('смена статуса', () => {
  it('называет прежний и новый статус', () => {
    const text = describeActivity({
      type: 'STATE_CHANGED',
      source: 'USER',
      stageLabel: 'Обмен документами',
      details: { fromStateLabel: 'Организация встречи', toStateLabel: 'Обмен документами' },
    });

    expect(text).toEqual({ title: 'Смена статуса', summary: '«Организация встречи» → «Обмен документами»' });
  });

  it('различает происхождение перехода', () => {
    const base = { type: 'STATE_CHANGED' as const, stageLabel: 'Сопровождение', details: {} };

    expect(describeActivity({ ...base, source: 'WORKFLOW' }).title).toBe('Перенос при изменении процесса');
    expect(describeActivity({ ...base, source: 'INTEGRATION' }).title).toBe(
      'Статус изменён внешней системой',
    );
  });
});

describe('заинтересованность', () => {
  it('показывает прежнюю и новую оценку по-русски', () => {
    const text = describeActivity({
      type: 'INTEREST_CHANGED',
      source: 'USER',
      stageLabel: null,
      details: { fromLevel: 'MEDIUM', toLevel: 'HIGH' },
    });

    expect(text.summary).toBe('средняя → высокая');
  });

  it('первая оценка и снятие оценки читаются понятно', () => {
    expect(
      describeActivity({
        type: 'INTEREST_CHANGED',
        source: 'USER',
        stageLabel: null,
        details: { fromLevel: null, toLevel: 'LOW' },
      }).summary,
    ).toBe('без оценки → низкая');
    expect(
      describeActivity({
        type: 'INTEREST_CHANGED',
        source: 'USER',
        stageLabel: null,
        details: { fromLevel: 'HIGH', toLevel: null },
      }).summary,
    ).toBe('высокая → оценка снята');
  });

  it('смена одного обоснования не выдаётся за смену оценки', () => {
    const text = describeActivity({
      type: 'INTEREST_CHANGED',
      source: 'USER',
      stageLabel: null,
      details: { fromLevel: 'HIGH', toLevel: 'HIGH' },
    });

    expect(text.summary).toBe('Обновлено обоснование: заинтересованность высокая');
  });
});

describe('заметки и файлы', () => {
  it('указывают этап либо то, что запись относится ко всей заявке', () => {
    expect(
      describeActivity({
        type: 'NOTE_ADDED',
        source: 'USER',
        stageLabel: 'Подписание',
        details: null,
        noteExcerpt: 'Ректор в отпуске',
      }).summary,
    ).toBe('Ректор в отпуске — этап «Подписание»');
    expect(
      describeActivity({
        type: 'NOTE_ADDED',
        source: 'USER',
        stageLabel: null,
        details: null,
        noteExcerpt: 'Ректор в отпуске',
      }).summary,
    ).toBe('Ректор в отпуске — ко всей заявке');
  });

  it('закрепление заметки не называется её правкой', () => {
    const text = describeActivity({
      type: 'NOTE_UPDATED',
      source: 'USER',
      stageLabel: null,
      details: { changed: ['pinned'], pinned: true },
      noteExcerpt: 'Важное',
    });

    expect(text.title).toBe('Заметка закреплена');
  });

  it('перенос заметки называет оба этапа', () => {
    const text = describeActivity({
      type: 'NOTE_UPDATED',
      source: 'USER',
      stageLabel: 'Подписание',
      details: { changed: ['stage'], fromStateLabel: null, toStateLabel: 'Подписание' },
    });

    expect(text).toEqual({ title: 'Заметка перенесена', summary: 'вся заявка → «Подписание»' });
  });

  it('удалённая заметка не показывает текст', () => {
    const text = describeActivity({
      type: 'NOTE_DELETED',
      source: 'USER',
      stageLabel: null,
      details: null,
      noteExcerpt: null,
    });

    expect(text.summary).toBe('заметка удалена — ко всей заявке');
  });

  it('файл называется по имени', () => {
    expect(
      describeActivity({
        type: 'ATTACHMENT_ADDED',
        source: 'USER',
        stageLabel: 'Подписание',
        details: null,
        fileName: 'договор.pdf',
      }).summary,
    ).toBe('договор.pdf — этап «Подписание»');
  });
});

describe('прочие события', () => {
  it('задача с датой в привычном формате', () => {
    expect(
      describeActivity({
        type: 'TASK_CREATED',
        source: 'USER',
        stageLabel: null,
        details: null,
        taskTitle: 'Позвонить',
        taskDueDate: '2026-09-30',
      }).summary,
    ).toBe('«Позвонить» на 30.09.2026');
  });

  it('смена ответственного называет обоих', () => {
    expect(
      describeActivity({
        type: 'OWNER_CHANGED',
        source: 'USER',
        stageLabel: null,
        details: {},
        fromOwnerName: 'Иванова Анна',
        toOwnerName: 'Орлов Дмитрий',
      }).summary,
    ).toBe('Иванова Анна → Орлов Дмитрий');
  });

  it('правка карточки перечисляет поля и смену программы', () => {
    const text = describeActivity({
      type: 'ENGAGEMENT_UPDATED',
      source: 'USER',
      stageLabel: null,
      details: { fields: ['title', 'programId'], programFrom: null, programTo: 'Основы DevOps' },
    });

    expect(text.summary).toBe('Изменено: название, программа: программа «не указана» → «Основы DevOps»');
  });
});

describe('архив', () => {
  it('показывает причину, если незавершённую заявку убрал руководитель', () => {
    const text = describeActivity({
      type: 'ENGAGEMENT_ARCHIVED',
      source: 'USER',
      stageLabel: 'Организация встречи',
      details: { reason: 'Вуз свернул направление', finished: false },
    });

    expect(text).toEqual({ title: 'Отправлена в архив', summary: 'Причина: Вуз свернул направление' });
  });

  it('без причины называет заявку завершённой', () => {
    const text = describeActivity({
      type: 'ENGAGEMENT_ARCHIVED',
      source: 'USER',
      stageLabel: 'Обучение пройдено',
      details: { reason: null, finished: true },
    });

    expect(text.summary).toBe('Работа по заявке завершена');
  });

  it('отмечает возврат из архива', () => {
    const text = describeActivity({ type: 'ENGAGEMENT_RESTORED', source: 'USER', stageLabel: null, details: {} });

    expect(text.title).toBe('Возвращена из архива');
  });
});

describe('заявка из таблицы', () => {
  it('называет файл, которым заявка заведена', () => {
    const text = describeActivity({
      type: 'ENGAGEMENT_CREATED',
      source: 'USER',
      stageLabel: 'Организация встречи',
      details: { importFile: 'вузы-сентябрь.xlsx', importJobId: 'x' },
    });

    expect(text.summary).toBe('Загрузкой таблицы «вузы-сентябрь.xlsx»');
  });
});

describe('встречи', () => {
  const when = { meetingId: 'm-1', date: '2026-10-05', time: '10:00' };

  it('назначение называет дату и время', () => {
    const text = describeActivity({
      type: 'MEETING_SCHEDULED',
      source: 'USER',
      stageLabel: 'Организация встречи',
      details: { ...when, status: 'SCHEDULED' },
    });

    expect(text).toEqual({ title: 'Встреча назначена', summary: '05.10.2026 в 10:00' });
  });

  it('различает проведённую, отменённую и перенесённую встречу', () => {
    const base = { type: 'MEETING_UPDATED' as const, source: 'USER' as const, stageLabel: null };

    expect(describeActivity({ ...base, details: { ...when, status: 'COMPLETED', changed: ['status', 'protocol'] } }).title).toBe(
      'Встреча проведена',
    );
    expect(describeActivity({ ...base, details: { ...when, status: 'CANCELLED', changed: ['status'] } }).title).toBe(
      'Встреча отменена',
    );
    expect(describeActivity({ ...base, details: { ...when, status: 'SCHEDULED', changed: ['scheduledAt'] } }).title).toBe(
      'Встреча перенесена',
    );
    expect(describeActivity({ ...base, details: { ...when, status: 'SCHEDULED', changed: ['agenda'] } }).title).toBe(
      'Встреча изменена',
    );
  });

  it('статус без его смены не выдаётся за проведение встречи', () => {
    // Правка протокола уже проведённой встречи — не «встреча проведена».
    const text = describeActivity({
      type: 'MEETING_UPDATED',
      source: 'USER',
      stageLabel: null,
      details: { ...when, status: 'COMPLETED', changed: ['protocol'] },
    });

    expect(text.title).toBe('Встреча изменена');
  });
});
