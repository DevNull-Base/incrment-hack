import { Transform } from 'class-transformer';

/**
 * Разбор булева значения из строки запроса.
 *
 * Прежде такие поля помечались @Type(() => Boolean), и это было ошибкой:
 * class-transformer приводит строку конструктором Boolean, а Boolean('false')
 * истинно. Запрос ?includeArchived=false возвращал архивные записи,
 * ?onlyUnread=false — только непрочитанные. Значение читается из исходного
 * объекта, а не из уже приведённого неявным преобразованием.
 *
 * Нераспознанное значение возвращается как есть — его отклонит @IsBoolean
 * с понятным сообщением, а не превратит молча в true.
 */
export function ToBoolean(): PropertyDecorator {
  return Transform(({ obj, key }) => parseBoolean((obj as Record<string, unknown>)[key]));
}

export function parseBoolean(raw: unknown): unknown {
  if (typeof raw === 'boolean' || raw === undefined || raw === null) {
    return raw;
  }

  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();

    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }

  return raw;
}
