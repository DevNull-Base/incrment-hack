import { describe, expect, it } from 'vitest';
import {
  decideOwner,
  matchEmployee,
  pickDirection,
  type Employee,
} from '../../src/modules/import/import-engagements.js';

/**
 * Заявки из колонки «ФИО менеджера».
 *
 * В таблице менеджера пишут как придётся: полностью, с инициалами,
 * с «ё» и без. Заявка должна достаться названному сотруднику — и никому
 * другому: отданная однофамильцу работа хуже честного предупреждения.
 */

const HEAD = 'head';
const ivanova: Employee = { id: 'ivanova', displayName: 'Иванова Анна', isActive: true, managerId: HEAD };
const orlov: Employee = { id: 'orlov', displayName: 'Орлов Дмитрий', isActive: true, managerId: HEAD };
const semenov: Employee = { id: 'semenov', displayName: 'Семёнов Пётр', isActive: true, managerId: 'other-head' };
const gone: Employee = { id: 'gone', displayName: 'Лебедев Олег', isActive: false, managerId: HEAD };
const staff = [ivanova, orlov, semenov, gone];

describe('сотрудник по ФИО из таблицы', () => {
  it('узнаёт полное ФИО с отчеством', () => {
    expect(matchEmployee('Иванова Анна Сергеевна', staff)).toEqual({ kind: 'found', employee: ivanova });
  });

  it('узнаёт инициалы с точками и без пробела', () => {
    expect(matchEmployee('Иванова А.С.', staff)).toEqual({ kind: 'found', employee: ivanova });
    expect(matchEmployee('иванова а', staff)).toEqual({ kind: 'found', employee: ivanova });
  });

  it('не различает е и ё и порядок «Имя Фамилия»', () => {
    expect(matchEmployee('Семенов Петр', staff)).toEqual({ kind: 'found', employee: semenov });
    expect(matchEmployee('Дмитрий Орлов', staff)).toEqual({ kind: 'found', employee: orlov });
  });

  it('не принимает другое имя при той же фамилии', () => {
    expect(matchEmployee('Иванова Мария', staff)).toEqual({ kind: 'missing' });
    expect(matchEmployee('Иванова М.', staff)).toEqual({ kind: 'missing' });
  });

  it('при однофамильцах требует однозначности', () => {
    const alla: Employee = { id: 'alla', displayName: 'Иванова Алла', isActive: true, managerId: HEAD };

    expect(matchEmployee('Иванова А.', [...staff, alla])).toEqual({
      kind: 'ambiguous',
      names: ['Иванова Анна', 'Иванова Алла'],
    });
    // Записанный буква в букву выбирается из подходящих.
    expect(matchEmployee('Иванова Анна', [...staff, alla])).toEqual({ kind: 'found', employee: ivanova });
  });

  it('отличает заблокированного сотрудника от ненайденного', () => {
    expect(matchEmployee('Лебедев О.', staff)).toEqual({ kind: 'blocked', employee: gone });
    expect(matchEmployee('Петров Сергей', staff)).toEqual({ kind: 'missing' });
    expect(matchEmployee('  ', staff)).toEqual({ kind: 'missing' });
  });
});

describe('ответственный за заявку', () => {
  it('руководитель поручает заявку своему подчинённому', () => {
    expect(decideOwner('Иванова А.', { kind: 'found', employee: ivanova }, { id: HEAD, role: 'MANAGER' })).toEqual({
      ownerId: 'ivanova',
      warning: null,
    });
  });

  it('чужого подчинённого руководитель не назначает — заявка остаётся за ним', () => {
    const decision = decideOwner('Семёнов П.', { kind: 'found', employee: semenov }, { id: HEAD, role: 'MANAGER' });

    expect(decision.ownerId).toBe(HEAD);
    expect(decision.warning).toContain('не в вашем подчинении');
  });

  it('администратор назначает любого', () => {
    expect(decideOwner('Семёнов П.', { kind: 'found', employee: semenov }, { id: 'admin', role: 'ADMIN' }).ownerId).toBe(
      'semenov',
    );
  });

  it('объясняет, почему заявка досталась загрузившему', () => {
    const importer = { id: 'admin', role: 'ADMIN' as const };

    expect(decideOwner('Петров С.', { kind: 'missing' }, importer).warning).toBe(
      'Сотрудник «Петров С.» не найден — ответственным за заявку назначен загрузивший таблицу',
    );
    expect(decideOwner('Лебедев О.', { kind: 'blocked', employee: gone }, importer).warning).toContain('заблокирован');
    expect(
      decideOwner('Иванова А.', { kind: 'ambiguous', names: ['Иванова Анна', 'Иванова Алла'] }, importer).warning,
    ).toContain('Иванова Анна, Иванова Алла');
  });
});

describe('направление заявки', () => {
  const directions = [
    { id: 'data', name: 'Данные и аналитика', code: 'DATA' },
    { id: 'sec', name: 'Информационная безопасность', code: 'SEC' },
  ];

  it('берёт колонку «Направление» по названию или коду', () => {
    expect(pickDirection('данные и аналитика', [], directions)).toEqual({ directionId: 'data' });
    expect(pickDirection('sec', [], directions)).toEqual({ directionId: 'sec' });
  });

  it('неизвестное направление из колонки не подменяет догадкой', () => {
    const result = pickDirection('Робототехника', ['data'], directions);
    expect(result).toEqual({ warning: 'Направления «Робототехника» нет в каталоге — заявка не заведена' });
  });

  it('без колонки берёт единственное направление программ продукта', () => {
    expect(pickDirection(null, ['data', 'data'], directions)).toEqual({ directionId: 'data' });
  });

  it('между несколькими направлениями не выбирает', () => {
    expect('warning' in pickDirection(null, ['data', 'sec'], directions)).toBe(true);
    expect('warning' in pickDirection(null, [], directions)).toBe(true);
  });

  it('при одном направлении в каталоге берёт его', () => {
    expect(pickDirection(null, [], [directions[0]!])).toEqual({ directionId: 'data' });
  });
});
