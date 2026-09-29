import { AppException } from '../../common/errors/app-exception.js';

/**
 * Проверка типа загружаемого файла.
 *
 * Тип определяется по СИГНАТУРЕ содержимого, а не по расширению имени
 * и не по заголовку Content-Type: и то, и другое задаёт клиент, и оба
 * тривиально подделываются. Исполняемый файл, переименованный в «отчёт.pdf»,
 * прошёл бы проверку по расширению и попал бы в хранилище, откуда его
 * скачал бы другой пользователь.
 */

/** Форматы, разрешённые техническим заданием. */
export const ALLOWED_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'pdf',
  'zip',
  'gz',
  'rar',
  'doc',
  'docx',
  'xls',
  'xlsx',
] as const;

export type AllowedExtension = (typeof ALLOWED_EXTENSIONS)[number];

/**
 * Соответствие обнаруженного типа разрешённым форматам.
 *
 * Отдельного внимания требует `cfb` (Compound File Binary) — контейнер
 * старых форматов Microsoft Office. По сигнатуре .doc и .xls неразличимы:
 * оба являются OLE2-контейнерами. Поэтому для них тип уточняется по
 * расширению, но только в пределах уже разрешённого набора — подменить
 * расширением произвольный файл всё равно нельзя, сигнатура контейнера
 * обязана совпасть.
 */
const MIME_BY_DETECTED: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  pdf: 'application/pdf',
  zip: 'application/zip',
  gz: 'application/gzip',
  rar: 'application/vnd.rar',
  cfb: 'application/x-cfb',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** Расширения, допустимые для контейнера OLE2. */
const CFB_EXTENSIONS = new Set(['doc', 'xls']);

export interface DetectedFile {
  /** Фактическое расширение, подтверждённое сигнатурой. */
  extension: AllowedExtension;
  /** MIME-тип для выдачи при скачивании. */
  mimeType: string;
}

/** Извлекает расширение из имени файла в нижнем регистре. */
export function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  return index >= 0 ? fileName.slice(index + 1).toLowerCase() : '';
}

/**
 * Сопоставляет обнаруженный по сигнатуре тип с разрешённым форматом.
 *
 * @param detected результат определения по содержимому (`undefined`, если тип не распознан)
 * @param fileName имя файла — используется только для уточнения внутри
 *                 уже подтверждённого контейнера
 */
export function resolveFileType(
  detected: { ext: string; mime: string } | undefined,
  fileName: string,
): DetectedFile {
  const declaredExtension = extensionOf(fileName);

  if (!detected) {
    throw new AppException('FILE_TYPE_NOT_ALLOWED', {
      detail:
        'Не удалось определить тип файла по его содержимому. ' +
        `Допустимые форматы: ${ALLOWED_EXTENSIONS.join(', ')}.`,
      meta: { declaredExtension },
    });
  }

  const mimeType = MIME_BY_DETECTED[detected.ext];

  if (!mimeType) {
    throw new AppException('FILE_TYPE_NOT_ALLOWED', {
      detail:
        `Формат файла (${detected.ext}) не входит в список разрешённых: ` +
        `${ALLOWED_EXTENSIONS.join(', ')}.`,
      meta: { detectedType: detected.ext, declaredExtension },
    });
  }

  // Контейнер OLE2: уточняем формат по расширению.
  if (detected.ext === 'cfb') {
    if (!CFB_EXTENSIONS.has(declaredExtension)) {
      throw new AppException('FILE_TYPE_NOT_ALLOWED', {
        detail:
          'Файл распознан как документ Microsoft Office старого формата, ' +
          'но расширение не соответствует: ожидается .doc или .xls.',
        meta: { detectedType: detected.ext, declaredExtension },
      });
    }

    return {
      extension: declaredExtension as AllowedExtension,
      mimeType:
        declaredExtension === 'doc' ? 'application/msword' : 'application/vnd.ms-excel',
    };
  }

  // JPEG определяется как `jpg`; расширение .jpeg равнозначно.
  const extension = (detected.ext === 'jpg' && declaredExtension === 'jpeg'
    ? 'jpeg'
    : detected.ext) as AllowedExtension;

  return { extension, mimeType };
}

/** Форматы, допустимые для импорта данных. */
export type SpreadsheetExtension = 'xls' | 'xlsx';

/**
 * Проверяет, что файл — действительно таблица Excel.
 *
 * Отдельная функция нужна потому, что канал импорта уже́е канала вложений:
 * разбор рассчитан на XLS и XLSX, и принимать здесь весь список разрешённых
 * форматов незачем. Раньше импорт не проверял тип вовсе — любой файл
 * попадал в хранилище под расширением .xlsx и MIME-типом таблицы,
 * то есть путь, доступный руководителю и администратору, был защищён
 * слабее, чем путь рядового пользователя.
 */
export function resolveSpreadsheetType(
  detected: { ext: string; mime: string } | undefined,
  fileName: string,
): { extension: SpreadsheetExtension; mimeType: string } {
  const resolved = resolveFileType(detected, fileName);

  if (resolved.extension !== 'xls' && resolved.extension !== 'xlsx') {
    throw new AppException('FILE_TYPE_NOT_ALLOWED', {
      detail:
        `Для импорта принимаются только таблицы XLS и XLSX, получен файл типа «${resolved.extension}».`,
      meta: { detectedType: resolved.extension },
    });
  }

  return { extension: resolved.extension, mimeType: resolved.mimeType };
}

/**
 * Обеззараживает имя файла перед сохранением и выдачей.
 *
 * Убирает управляющие символы и элементы пути: имя вида «../../etc/passwd»
 * или содержащее перевод строки способно испортить заголовок
 * Content-Disposition при скачивании.
 */
export function sanitizeFileName(fileName: string): string {
  const withoutPath = fileName.split(/[/\\]/).pop() ?? 'file';

  const cleaned = Array.from(withoutPath)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      // Отбрасываем управляющие символы и кавычки, ломающие заголовок ответа.
      return code >= 32 && code !== 127 && char !== '"';
    })
    .join('')
    .trim();

  return cleaned.length > 0 ? cleaned.slice(0, 255) : 'file';
}
