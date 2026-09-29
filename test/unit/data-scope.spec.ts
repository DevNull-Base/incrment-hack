import { describe, expect, it } from 'vitest';
import {
  engagementScopeFilter,
  type DataScope,
} from '../../src/modules/access/data-scope.service.js';

const unrestricted: DataScope = {
  ownerIds: null,
  universityIds: null,
  directionIds: null,
  productIds: null,
  regions: null,
  fingerprint: 'test',
};

/**
 * Ограничение выборки по области видимости.
 *
 * Проверяется различие между «нет ограничения» (null) и «не видно ничего»
 * (пустой список). Их смешение — самый дорогой вид ошибки в этом коде:
 * пустой список, истолкованный как отсутствие ограничения, открывает
 * пользователю все данные системы, и внешне это выглядит как исправная
 * работа.
 */
describe('фильтр области видимости', () => {
  it('не накладывает условий при отсутствии ограничений', () => {
    expect(engagementScopeFilter(unrestricted)).toEqual({});
  });

  it('ограничивает по ответственным', () => {
    const filter = engagementScopeFilter({ ...unrestricted, ownerIds: ['u-1', 'u-2'] });

    expect(filter).toEqual({ AND: [{ ownerId: { in: ['u-1', 'u-2'] } }] });
  });

  it('не затирает отбор вызывающего кода по тем же полям', () => {
    // Руководитель выбирает одного подчинённого — область видимости (весь
    // отдел) должна сузить, а не заменить этот отбор.
    const where = { ownerId: 'u-2', ...engagementScopeFilter({ ...unrestricted, ownerIds: ['u-1', 'u-2', 'u-3'] }) };

    expect(where.ownerId).toBe('u-2');
    expect(where.AND).toEqual([{ ownerId: { in: ['u-1', 'u-2', 'u-3'] } }]);
  });

  it('пустой список ответственных не даёт доступа ко всем записям', () => {
    const filter = engagementScopeFilter({ ...unrestricted, ownerIds: [] });

    expect(filter).toEqual({ AND: [{ ownerId: { in: [] } }] });
  });

  it('совмещает ограничения по нескольким измерениям', () => {
    const filter = engagementScopeFilter({
      ...unrestricted,
      ownerIds: ['u-1'],
      universityIds: ['univ-1'],
      regions: ['Москва'],
    });

    expect(filter).toEqual({
      AND: [
        { ownerId: { in: ['u-1'] } },
        {
          OR: [
            { segment: 'B2C' },
            {
              AND: [
                { universityId: { in: ['univ-1'] } },
                { university: { region: { in: ['Москва'] } } },
              ],
            },
          ],
        },
      ],
    });
  });

  it('регионы фильтруются через связанный вуз, а не напрямую', () => {
    // У регионов нет собственной таблицы: значение хранится строкой
    // в карточке вуза, поэтому условие строится через связь.
    const filter = engagementScopeFilter({ ...unrestricted, regions: ['Татарстан'] });

    expect(filter.AND).toEqual([
      {
        OR: [{ segment: 'B2C' }, { AND: [{ university: { region: { in: ['Татарстан'] } } }] }],
      },
    ]);
  });

  /**
   * Ограничение по вузам не должно распространяться на прямые продажи.
   *
   * У заявки B2C вуза нет, и безусловное условие по university_id скрыло бы
   * её от пользователя целиком — включая заявки, за которые он отвечает сам.
   * Ошибка такого рода не выглядит ошибкой: список просто короче, чем должен
   * быть, и заметить это можно только зная, что записи существуют.
   */
  it('ограничение по вузам не скрывает заявки прямых продаж', () => {
    const filter = engagementScopeFilter({ ...unrestricted, universityIds: ['univ-1'] });

    expect(filter.AND).toEqual([
      { OR: [{ segment: 'B2C' }, { AND: [{ universityId: { in: ['univ-1'] } }] }] },
    ]);
  });

  it('направление и продукт ограничивают оба сегмента одинаково', () => {
    // В отличие от вуза, направление и продукт есть у заявки любого
    // сегмента, поэтому исключения для B2C здесь быть не должно.
    const filter = engagementScopeFilter({
      ...unrestricted,
      directionIds: ['dir-1'],
      productIds: ['prod-1'],
    });

    expect(filter).toEqual({
      AND: [{ directionId: { in: ['dir-1'] } }, { productId: { in: ['prod-1'] } }],
    });
  });

  it('пустой список вузов не открывает заявки B2B', () => {
    const filter = engagementScopeFilter({ ...unrestricted, universityIds: [] });

    expect(filter.AND).toEqual([
      { OR: [{ segment: 'B2C' }, { AND: [{ universityId: { in: [] } }] }] },
    ]);
  });
});
