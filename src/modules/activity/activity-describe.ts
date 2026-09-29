import type { ActivitySource, ActivityType } from '../../generated/prisma/enums.js';

/** Всё, что нужно для подписи события ленты. */
export interface DescribableActivity {
  type: ActivityType;
  source: ActivitySource;
  stageLabel: string | null;
  details: Record<string, unknown> | null;
  /** Начало текста заметки — для NOTE_*. */
  noteExcerpt?: string | null;
  /** Имя файла — для ATTACHMENT_*. */
  fileName?: string | null;
  /** Название и срок задачи — для TASK_*. */
  taskTitle?: string | null;
  taskDueDate?: string | null;
  /** Имена прежнего и нового ответственного — для OWNER_CHANGED. */
  fromOwnerName?: string | null;
  toOwnerName?: string | null;
}

export interface ActivityDescription {
  /** Короткий заголовок: «Смена статуса», «Новая заметка». */
  title: string;
  /** Суть: что именно изменилось. */
  summary: string;
}

const INTEREST_LABELS: Record<string, string> = {
  HIGH: 'высокая',
  MEDIUM: 'средняя',
  LOW: 'низкая',
};

const FIELD_LABELS: Record<string, string> = {
  title: 'название',
  programId: 'программа',
};

/**
 * Подпись события ленты на русском языке.
 *
 * Тексты собираются на сервере, а не в интерфейсе: у ленты несколько
 * потребителей — экран, уведомления, выгрузка, — и формулировки должны
 * совпадать везде. Данные для собственной подачи интерфейс получает рядом,
 * в полях details, stage, note, attachment и task.
 *
 * Формулировки безличные («Смена статуса», а не «Иванова перевела»): автор
 * показывается отдельно, а глагол прошедшего времени в русском языке
 * требует рода, которого система о человеке не знает.
 */
export function describeActivity(event: DescribableActivity): ActivityDescription {
  const details = event.details ?? {};

  switch (event.type) {
    case 'ENGAGEMENT_CREATED':
      return {
        title: 'Заявка заведена',
        summary: text(details.importFile)
          ? `Загрузкой таблицы «${text(details.importFile)}»`
          : event.stageLabel
            ? `Начальный этап «${event.stageLabel}»`
            : 'Заявка заведена',
      };

    case 'STATE_CHANGED': {
      const from = text(details.fromStateLabel);
      const to = text(details.toStateLabel) ?? event.stageLabel ?? '—';

      const title =
        event.source === 'WORKFLOW'
          ? 'Перенос при изменении процесса'
          : event.source === 'INTEGRATION'
            ? 'Статус изменён внешней системой'
            : 'Смена статуса';

      return { title, summary: from ? `«${from}» → «${to}»` : `Статус «${to}»` };
    }

    case 'INTEREST_CHANGED': {
      const from = interestLabel(details.fromLevel);
      const to = interestLabel(details.toLevel);

      if (from === to) {
        return {
          title: 'Оценка заинтересованности',
          summary: to ? `Обновлено обоснование: заинтересованность ${to}` : 'Обоснование снято',
        };
      }

      return {
        title: 'Оценка заинтересованности',
        summary: `${from ?? 'без оценки'} → ${to ?? 'оценка снята'}`,
      };
    }

    case 'OWNER_CHANGED':
      return {
        title: 'Смена ответственного',
        summary: `${event.fromOwnerName ?? 'прежний ответственный'} → ${event.toOwnerName ?? 'новый ответственный'}`,
      };

    case 'ENGAGEMENT_UPDATED': {
      const fields = Array.isArray(details.fields) ? details.fields.map(String) : [];
      const labels = fields.map((field) => FIELD_LABELS[field] ?? field);
      const program = fields.includes('programId')
        ? `: программа «${text(details.programFrom) ?? 'не указана'}» → «${text(details.programTo) ?? 'не указана'}»`
        : '';

      return {
        title: 'Карточка изменена',
        summary: labels.length > 0 ? `Изменено: ${labels.join(', ')}${program}` : 'Карточка изменена',
      };
    }

    case 'NOTE_ADDED':
      return {
        title: 'Новая заметка',
        summary: withPlace(event.noteExcerpt ?? 'заметка', event.stageLabel),
      };

    case 'NOTE_UPDATED': {
      const changed = Array.isArray(details.changed) ? details.changed.map(String) : [];

      if (changed.length === 1 && changed[0] === 'pinned') {
        return {
          title: details.pinned ? 'Заметка закреплена' : 'Заметка откреплена',
          summary: event.noteExcerpt ?? 'заметка',
        };
      }

      if (changed.includes('stage')) {
        return {
          title: 'Заметка перенесена',
          summary: `${stageOrGeneral(text(details.fromStateLabel))} → ${stageOrGeneral(text(details.toStateLabel))}`,
        };
      }

      return {
        title: 'Заметка изменена',
        summary: withPlace(event.noteExcerpt ?? 'заметка', event.stageLabel),
      };
    }

    case 'NOTE_DELETED':
      return { title: 'Заметка удалена', summary: withPlace('заметка удалена', event.stageLabel) };

    case 'ATTACHMENT_ADDED':
      return { title: 'Файл приложен', summary: withPlace(event.fileName ?? 'файл', event.stageLabel) };

    case 'ATTACHMENT_DELETED':
      return { title: 'Файл удалён', summary: withPlace(event.fileName ?? 'файл', event.stageLabel) };

    case 'TASK_CREATED':
      return { title: 'Задача поставлена', summary: taskSummary(event) };

    case 'TASK_UPDATED':
      return { title: 'Задача изменена', summary: taskSummary(event) };

    case 'TASK_COMPLETED':
      return { title: 'Задача выполнена', summary: taskSummary(event) };

    case 'TASK_REOPENED':
      return { title: 'Задача возвращена в работу', summary: taskSummary(event) };

    case 'TASK_DELETED':
      return { title: 'Задача удалена', summary: taskSummary(event) };

    case 'PAYMENT_CONFIRMED': {
      const order = text(details.orderNumber);
      const stream = text(details.stream);
      const parts = [order ? `заказ ${order}` : null, stream ? `поток ${stream}` : null].filter(Boolean);

      return {
        title: 'Оплата подтверждена',
        summary: parts.length > 0 ? parts.join(', ') : 'оплата подтверждена',
      };
    }

    case 'LMS_EXPORTED':
      return {
        title: 'Передано в LMS',
        summary: text(details.stream) ? `Слушатель выгружен для загрузки, поток ${text(details.stream)}` : 'Слушатель выгружен для загрузки',
      };

    case 'ENGAGEMENT_ARCHIVED':
      return {
        title: 'Отправлена в архив',
        summary: text(details.reason) ? `Причина: ${text(details.reason)}` : 'Работа по заявке завершена',
      };

    case 'ENGAGEMENT_RESTORED':
      return { title: 'Возвращена из архива', summary: 'Работа по заявке продолжается' };

    case 'MEETING_SCHEDULED':
      return { title: 'Встреча назначена', summary: meetingWhen(details) };

    case 'MEETING_UPDATED': {
      const changed = Array.isArray(details.changed) ? details.changed.map(String) : [];

      if (changed.includes('status') && details.status === 'COMPLETED') {
        return { title: 'Встреча проведена', summary: meetingWhen(details) };
      }

      if (changed.includes('status') && details.status === 'CANCELLED') {
        return { title: 'Встреча отменена', summary: meetingWhen(details) };
      }

      if (changed.includes('scheduledAt')) {
        return { title: 'Встреча перенесена', summary: meetingWhen(details) };
      }

      return { title: 'Встреча изменена', summary: meetingWhen(details) };
    }
  }
}

/** Русская подпись оценки заинтересованности; null — оценки нет. */
export function interestLabel(value: unknown): string | null {
  return typeof value === 'string' ? (INTEREST_LABELS[value] ?? value) : null;
}

function withPlace(subject: string, stageLabel: string | null): string {
  return stageLabel ? `${subject} — этап «${stageLabel}»` : `${subject} — ко всей заявке`;
}

function stageOrGeneral(label: string | null): string {
  return label ? `«${label}»` : 'вся заявка';
}

function taskSummary(event: DescribableActivity): string {
  const title = event.taskTitle ? `«${event.taskTitle}»` : 'задача';
  return event.taskDueDate ? `${title} на ${formatDate(event.taskDueDate)}` : title;
}

/** Дата и время встречи — в часовом поясе организации, записанные при действии. */
function meetingWhen(details: Record<string, unknown>): string {
  const date = text(details.date);
  const time = text(details.time);

  if (!date) {
    return 'встреча';
  }

  return time ? `${formatDate(date)} в ${time}` : formatDate(date);
}

/** 2026-09-30 → 30.09.2026. */
function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-');
  return year && month && day ? `${day}.${month}.${year}` : isoDate;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
