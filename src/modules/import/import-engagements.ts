import { normalizeName } from '../../common/utils/text-normalization.js';
import type { UserRole } from '../../generated/prisma/enums.js';

/**
 * Заявки из таблицы: колонка «ФИО менеджера».
 *
 * Таблица заказчика говорит не только о договорах и лицензиях, но и о том,
 * кто из КАМ ведёт вуз по продукту. Прежде колонка разбиралась и
 * отбрасывалась: после загрузки у вуза были договоры, но не было ни одной
 * заявки, и работа по нему не попадала ни в списки КАМ, ни в отчёты.
 *
 * Здесь — чистые правила, общие для предварительного просмотра и
 * применения: кого считать названным сотрудником, на кого завести заявку
 * и в каком направлении. Одни и те же правила в обоих местах — условие
 * того, что сводка просмотра совпадёт с тем, что произойдёт на деле.
 */

export interface Employee {
  id: string;
  displayName: string;
  isActive: boolean;
  managerId: string | null;
}

export interface Importer {
  id: string;
  role: UserRole;
}

export type EmployeeMatch =
  | { kind: 'found'; employee: Employee }
  | { kind: 'blocked'; employee: Employee }
  | { kind: 'ambiguous'; names: string[] }
  | { kind: 'missing' };

/** Слова ФИО без регистра, точек и различия е/ё: «Иванова А.С.» → иванова, а, с. */
function nameTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[\s.,]+/)
    .filter((token) => token.length > 0);
}

/** Имя или отчество совпадают полностью либо по инициалу. */
function sameGivenPart(left: string, right: string): boolean {
  return left.length === 1 || right.length === 1 ? left[0] === right[0] : left === right;
}

/**
 * Подходит ли записанное в таблице ФИО сотруднику.
 *
 * Фамилия — обязательно. Имя и отчество сравниваются, если указаны
 * с обеих сторон, причём инициал сравнивается с первой буквой: в
 * таблицах пишут и «Иванова Анна Сергеевна», и «Иванова А.С.», а в
 * учётной записи — «Иванова Анна».
 */
function fits(written: string[], account: string[]): boolean {
  if (written.length === 0 || account.length === 0 || written[0] !== account[0]) {
    return false;
  }

  const shared = Math.min(written.length, account.length);

  for (let index = 1; index < shared; index++) {
    if (!sameGivenPart(written[index]!, account[index]!)) {
      return false;
    }
  }

  return true;
}

/**
 * Сотрудник, названный в таблице.
 *
 * Учётная запись приходит из Keycloak как «Фамилия Имя», но при неполном
 * профиле — как «Имя Фамилия»; проверяются оба порядка. Совпадение должно
 * быть единственным: заявка, молча отданная однофамильцу, хуже заявки,
 * о которой загрузка честно предупредила.
 */
export function matchEmployee(written: string, employees: readonly Employee[]): EmployeeMatch {
  const tokens = nameTokens(written);

  if (tokens.length === 0) {
    return { kind: 'missing' };
  }

  const candidates = (pool: readonly Employee[]) =>
    pool.filter((employee) => {
      const account = nameTokens(employee.displayName);
      const reversed = account.length >= 2 ? [account[1]!, account[0]!, ...account.slice(2)] : account;
      return fits(tokens, account) || fits(tokens, reversed);
    });

  const active = candidates(employees.filter((employee) => employee.isActive));

  if (active.length === 1) {
    return { kind: 'found', employee: active[0]! };
  }

  if (active.length > 1) {
    // Из нескольких подходящих выбирается записанный буква в букву —
    // «Иванова Анна» при сотрудниках «Иванова Анна» и «Иванова Алла».
    const exact = active.filter((employee) => normalizeName(employee.displayName) === normalizeName(written));
    return exact.length === 1
      ? { kind: 'found', employee: exact[0]! }
      : { kind: 'ambiguous', names: active.map((employee) => employee.displayName) };
  }

  const blocked = candidates(employees.filter((employee) => !employee.isActive));
  return blocked.length === 1 ? { kind: 'blocked', employee: blocked[0]! } : { kind: 'missing' };
}

/**
 * На кого завести заявку.
 *
 * Названный сотрудник — если загружающий вправе поручать ему работу:
 * руководитель — себе и своим подчинённым, администратор — любому.
 * Иначе заявка заводится на загружающего с предупреждением: данные строки
 * не теряются, а передать заявку руководитель может обычным переназначением.
 */
export function decideOwner(
  written: string,
  match: EmployeeMatch,
  importer: Importer,
): { ownerId: string; warning: string | null } {
  const fallback = (reason: string) => ({
    ownerId: importer.id,
    warning: `${reason} — ответственным за заявку назначен загрузивший таблицу`,
  });

  switch (match.kind) {
    case 'found': {
      const { employee } = match;
      const allowed =
        importer.role === 'ADMIN' || employee.id === importer.id || employee.managerId === importer.id;

      return allowed
        ? { ownerId: employee.id, warning: null }
        : fallback(`${employee.displayName} не в вашем подчинении`);
    }
    case 'blocked':
      return fallback(`Сотрудник ${match.employee.displayName} заблокирован`);
    case 'ambiguous':
      return fallback(`«${written}» подходит нескольким сотрудникам (${match.names.join(', ')})`);
    case 'missing':
      return fallback(`Сотрудник «${written}» не найден`);
  }
}

export interface Direction {
  id: string;
  name: string;
  code: string | null;
}

/**
 * Направление заявки.
 *
 * Без направления заявку не завести: по нему строятся процесс, отчёты и
 * ограничения видимости. Порядок: колонка «Направление», если она есть;
 * иначе — направление программ продукта, если оно одно; иначе — единственное
 * направление каталога. Угадывать между несколькими нельзя: заявка
 * в чужом направлении пропала бы из отчётов своего.
 */
export function pickDirection(
  written: string | null,
  productDirectionIds: readonly string[],
  directions: readonly Direction[],
): { directionId: string } | { warning: string } {
  if (written) {
    const key = normalizeName(written);
    const found = directions.find(
      (direction) =>
        normalizeName(direction.name) === key || (direction.code !== null && normalizeName(direction.code) === key),
    );

    return found
      ? { directionId: found.id }
      : { warning: `Направления «${written}» нет в каталоге — заявка не заведена` };
  }

  const distinct = [...new Set(productDirectionIds)].filter((id) => directions.some((direction) => direction.id === id));

  if (distinct.length === 1) {
    return { directionId: distinct[0]! };
  }

  if (distinct.length === 0 && directions.length === 1) {
    return { directionId: directions[0]!.id };
  }

  return {
    warning:
      distinct.length > 1
        ? 'Программы продукта относятся к нескольким направлениям — укажите колонку «Направление»; заявка не заведена'
        : 'Не удалось определить направление — добавьте колонку «Направление»; заявка не заведена',
  };
}
