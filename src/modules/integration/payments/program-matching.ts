import { nameSimilarity } from '../../../common/utils/text-normalization.js';

export interface CatalogProgram {
  id: string;
  name: string;
  directionId: string;
  productId: string | null;
}

export type ProgramMatch =
  | { program: CatalogProgram; warning: string | null }
  | { program: null; reason: string };

/** С какой схожести название курса считается той же программой. */
const SIMILARITY_THRESHOLD = 0.8;

/** Насколько лучший кандидат должен опережать второго, чтобы выбор был однозначным. */
const AMBIGUITY_MARGIN = 0.1;

/**
 * Сопоставление курса из оплаты с программой каталога.
 *
 * Сайт называет курс так, как он назван на витрине, а не идентификатором
 * каталога, поэтому сопоставление идёт по названию в три шага:
 *   1. совпадение без учёта регистра, кавычек, дефисов и пробелов —
 *      «Инженер тестировщик» и «Инженер-тестировщик» одно и то же;
 *   2. схожесть с опечатками и перестановкой слов — берётся, только если
 *      лучший кандидат один и заметно опережает остальных; пользователь
 *      видит предупреждение, с какой программой курс сопоставлен;
 *   3. иначе запись отклоняется с просьбой завести программу в каталоге:
 *      отнести оплату к «похожей» чужой программе хуже, чем не принять.
 *
 * Результат запоминается по названию: в пачке оплат курсов единицы,
 * а записей — сотни.
 */
export function createProgramMatcher(programs: readonly CatalogProgram[]): (course: string) => ProgramMatch {
  const keyed = programs.map((program) => ({ program, key: looseKey(program.name) }));
  const cache = new Map<string, ProgramMatch>();

  return (course: string) => {
    const key = looseKey(course);
    const cached = cache.get(key);

    if (cached) {
      return cached;
    }

    const result = match(course, key, keyed);
    cache.set(key, result);
    return result;
  };
}

function match(
  course: string,
  key: string,
  keyed: ReadonlyArray<{ program: CatalogProgram; key: string }>,
): ProgramMatch {
  if (key.length === 0) {
    return { program: null, reason: 'Не указан курс' };
  }

  const exact = keyed.filter((item) => item.key === key);

  if (exact.length === 1) {
    return { program: exact[0]!.program, warning: null };
  }

  if (exact.length > 1) {
    return {
      program: null,
      reason:
        `Курс «${course}» совпадает с несколькими программами каталога ` +
        `(${exact.map((item) => `«${item.program.name}»`).join(', ')}) — уточните каталог`,
    };
  }

  const scored = keyed
    .map((item) => ({ ...item, score: similarity(key, item.key, course, item.program.name) }))
    .sort((left, right) => right.score - left.score);

  const [best, second] = scored;

  if (!best || best.score < SIMILARITY_THRESHOLD) {
    return {
      program: null,
      reason: `Курс «${course}» не найден в каталоге программ — заведите программу либо исправьте название`,
    };
  }

  if (second && best.score - second.score < AMBIGUITY_MARGIN) {
    return {
      program: null,
      reason:
        `Курс «${course}» похож сразу на «${best.program.name}» и «${second.program.name}» — ` +
        'уточните название',
    };
  }

  return {
    program: best.program,
    warning: `Курс «${course}» сопоставлен с программой «${best.program.name}» по сходству названия`,
  };
}

/** Ключ названия: только буквы и цифры, слова через один пробел. */
export function looseKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .trim();
}

/**
 * Схожесть названий: лучшее из посимвольной (ловит опечатки) и пословной
 * (ловит перестановку и пропуск служебных слов).
 */
function similarity(leftKey: string, rightKey: string, left: string, right: string): number {
  const longest = Math.max(leftKey.length, rightKey.length);
  const byChars = longest === 0 ? 0 : 1 - levenshtein(leftKey, rightKey) / longest;
  return Math.max(byChars, nameSimilarity(left, right));
}

function levenshtein(left: string, right: string): number {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let i = 1; i <= left.length; i++) {
    const current = [i];

    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + cost);
    }

    previous = current;
  }

  return previous[right.length]!;
}
