import { z } from 'zod';
import { normalizeName } from '../../common/utils/text-normalization.js';

/**
 * Описание полей импортируемой таблицы.
 *
 * Состав соответствует перечню из технического задания. Для каждого поля
 * заданы синонимы заголовков: заказчик присылает файлы с разными
 * формулировками одних и тех же колонок («ВУЗ», «Название ВУЗа»,
 * «Наименование учебного заведения»), и требовать единственно верного
 * написания означало бы перекладывать работу по приведению файла
 * к нужному виду на пользователя.
 */

export const IMPORT_FIELDS = {
  universityName: {
    label: 'Название ВУЗа',
    required: true,
    synonyms: ['название вуза', 'вуз', 'наименование вуза', 'учебное заведение', 'университет', 'наименование учебного заведения'],
  },
  vendorName: {
    label: 'Вендор',
    required: false,
    synonyms: ['вендор', 'производитель', 'поставщик', 'правообладатель'],
  },
  productName: {
    label: 'ПО',
    required: false,
    synonyms: ['по', 'продукт', 'программное обеспечение', 'ит продукт', 'наименование по'],
  },
  contractNumber: {
    label: 'Номер договора',
    required: false,
    synonyms: ['номер договора', 'договор', 'реквизиты договора', 'no договора'],
  },
  licenseSignedAt: {
    label: 'Подписание лицензии',
    required: false,
    synonyms: ['подписание лицензии', 'дата подписания', 'дата лицензии', 'подписано'],
  },
  licenseValidYears: {
    label: 'Срок действия лицензии (год)',
    required: false,
    synonyms: ['срок действия лицензии', 'срок лицензии', 'срок действия', 'лет', 'срок действия лицензии год'],
  },
  transferStatus: {
    label: 'Статус по передаче',
    required: false,
    synonyms: ['статус по передаче', 'статус передачи', 'статус', 'передача'],
  },
  managerFullName: {
    label: 'ФИО Менеджера',
    required: false,
    synonyms: ['фио менеджера', 'менеджер', 'ответственный менеджер', 'кам', 'ответственный от школы'],
  },
  directionName: {
    label: 'Направление',
    required: false,
    synonyms: ['направление', 'ит направление', 'направление ит'],
  },
  universityContacts: {
    label: 'Ответственные от ВУЗа',
    required: false,
    synonyms: ['ответственные от вуза', 'ответственный от вуза', 'контактное лицо', 'контакты вуза', 'ответственные'],
  },
  comment: {
    label: 'Комментарий',
    required: false,
    synonyms: ['комментарий', 'примечание', 'заметка', 'описание'],
  },
} as const;

export type ImportFieldKey = keyof typeof IMPORT_FIELDS;

export const IMPORT_FIELD_KEYS = Object.keys(IMPORT_FIELDS) as ImportFieldKey[];

/** Сопоставление: заголовок в файле → поле сущности. */
export type ColumnMapping = Partial<Record<string, ImportFieldKey>>;

/**
 * Допустимые значения статуса передачи и их написания в файлах.
 * Ключ — значение перечисления в БД.
 */
const TRANSFER_STATUS_SYNONYMS: Record<string, string[]> = {
  NOT_STARTED: ['не начата', 'не начато', 'не начат', 'нет', 'не передано', 'не передана'],
  IN_PROGRESS: ['в работе', 'в процессе', 'передается', 'передаётся', 'выполняется'],
  TRANSFERRED: ['передано', 'передана', 'передан', 'завершено', 'выполнено', 'да'],
  REJECTED: ['отказ', 'отклонено', 'отменено'],
};

/** Приводит значение статуса передачи к значению перечисления. */
export function parseTransferStatus(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;

  const value = normalizeName(String(raw));
  if (value.length === 0) return null;

  for (const [status, synonyms] of Object.entries(TRANSFER_STATUS_SYNONYMS)) {
    if (synonyms.some((synonym) => normalizeName(synonym) === value)) {
      return status;
    }
  }

  return null;
}

/**
 * Разбирает дату из ячейки.
 *
 * Excel хранит даты числом (дней от 30.12.1899), но выгрузки часто содержат
 * и текстовые представления в разных форматах. Поддерживаются оба случая:
 * иначе значительная часть реальных файлов импортировалась бы с пустыми
 * датами без явной ошибки.
 */
export function parseCellDate(raw: unknown): Date | null {
  if (raw === null || raw === undefined || raw === '') return null;

  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw;
  }

  if (typeof raw === 'number') {
    // Серийный номер даты Excel (дней от 30.12.1899) — но только в разумных
    // пределах. Прежде числом считалось что угодно, и «3», по ошибке
    // оказавшееся в колонке даты, становилось 2 января 1900 года.
    if (!Number.isFinite(raw) || raw < EXCEL_SERIAL_MIN || raw > EXCEL_SERIAL_MAX) return null;
    const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
    return new Date(EXCEL_EPOCH_MS + Math.floor(raw) * 86_400_000);
  }

  const text = String(raw).trim();
  if (text.length === 0) return null;

  // ДД.ММ.ГГГГ, ДД/ММ/ГГГГ, ДД-ММ-ГГГГ и то же с двузначным годом.
  const ru = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})(?:\s.*)?$/);
  if (ru) {
    const [, day, month, year] = ru as unknown as [string, string, string, string];
    const fullYear = year.length === 2 ? (Number(year) < 70 ? 2000 : 1900) + Number(year) : Number(year);
    return exactDate(fullYear, Number(month), Number(day));
  }

  // ГГГГ-ММ-ДД, в том числе со временем. Прочее не угадывается: new Date()
  // принимал любую строку, и «3» в колонке даты становилось 1 марта 2001 года.
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  if (iso) {
    const [, year, month, day] = iso as unknown as [string, string, string, string];
    return exactDate(Number(year), Number(month), Number(day));
  }

  return null;
}

/** 01.01.1970 и 01.01.2100 в серийных номерах Excel. */
const EXCEL_SERIAL_MIN = 25_569;
const EXCEL_SERIAL_MAX = 73_051;

/**
 * Дата, только если такая существует. Date.UTC молча переносит лишнее:
 * «31.02.2026» становилось 3 марта, «15.13.2026» — январём 2027 года.
 */
function exactDate(year: number, month: number, day: number): Date | null {
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date
    : null;
}

/** Разбирает целое число из ячейки, допуская текстовую запись. */
export function parseCellInt(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.trunc(raw) : null;

  // «3 года», «3 г.» — распространённая запись срока лицензии.
  const digits = String(raw).match(/-?\d+/);
  if (!digits) return null;

  const value = Number(digits[0]);
  return Number.isFinite(value) ? value : null;
}

/** Приводит ячейку к строке, отбрасывая пустые значения. */
export function parseCellText(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;

  // Ячейка с формулой в ExcelJS приходит объектом с полем result.
  if (typeof raw === 'object' && raw !== null && 'result' in raw) {
    return parseCellText((raw as { result: unknown }).result);
  }

  if (typeof raw === 'object' && raw !== null && 'text' in raw) {
    return parseCellText((raw as { text: unknown }).text);
  }

  const text = String(raw).trim();
  return text.length > 0 ? text : null;
}

/**
 * Схема строки после применения маппинга.
 *
 * Проверка выполняется на уровне отдельной строки, а не всего файла:
 * одна некорректная строка не должна отменять импорт остальных — она
 * попадает в отчёт об ошибках, а корректные данные загружаются.
 */
export const importRowSchema = z.object({
  universityName: z
    .string()
    .min(2, 'Название вуза слишком короткое')
    .max(500, 'Название вуза слишком длинное'),
  vendorName: z.string().max(300).nullable(),
  productName: z.string().max(300).nullable(),
  contractNumber: z.string().max(100).nullable(),
  licenseSignedAt: z.date().nullable(),
  licenseValidYears: z
    .number()
    .int()
    .min(1, 'Срок действия лицензии должен быть положительным')
    .max(50, 'Срок действия лицензии выглядит неправдоподобным')
    .nullable(),
  transferStatus: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'TRANSFERRED', 'REJECTED']).nullable(),
  managerFullName: z.string().max(300).nullable(),
  directionName: z.string().max(300).nullable(),
  universityContacts: z.string().max(1000).nullable(),
  comment: z.string().max(4000).nullable(),
});

export type ImportRow = z.infer<typeof importRowSchema>;

/**
 * Автоматически сопоставляет заголовки файла с полями сущности.
 *
 * Сначала ищется точное совпадение с синонимом, затем — вхождение.
 * Заголовки, которые сопоставить не удалось, остаются несопоставленными
 * и показываются пользователю: молчаливое игнорирование колонки означало
 * бы потерю данных, о которой никто не узнает.
 */
export function autoDetectMapping(headers: string[]): {
  mapping: ColumnMapping;
  unmapped: string[];
} {
  const mapping: ColumnMapping = {};
  const unmapped: string[] = [];
  const used = new Set<ImportFieldKey>();

  for (const header of headers) {
    const normalized = normalizeName(header);
    if (normalized.length === 0) continue;

    let matched: ImportFieldKey | null = null;

    // Точное совпадение с синонимом — самый надёжный признак.
    for (const key of IMPORT_FIELD_KEYS) {
      if (used.has(key)) continue;
      if (IMPORT_FIELDS[key].synonyms.some((s) => normalizeName(s) === normalized)) {
        matched = key;
        break;
      }
    }

    // Вхождение синонима в заголовок: «Название ВУЗа (полное)».
    if (!matched) {
      for (const key of IMPORT_FIELD_KEYS) {
        if (used.has(key)) continue;
        if (
          IMPORT_FIELDS[key].synonyms.some((s) => {
            const syn = normalizeName(s);
            return syn.length >= 3 && (normalized.includes(syn) || syn.includes(normalized));
          })
        ) {
          matched = key;
          break;
        }
      }
    }

    if (matched) {
      mapping[header] = matched;
      used.add(matched);
    } else {
      unmapped.push(header);
    }
  }

  return { mapping, unmapped };
}

/** Поля, обязательные для импорта и не сопоставленные ни с одной колонкой. */
export function missingRequiredFields(mapping: ColumnMapping): ImportFieldKey[] {
  const mapped = new Set(Object.values(mapping));
  return IMPORT_FIELD_KEYS.filter((key) => IMPORT_FIELDS[key].required && !mapped.has(key));
}
