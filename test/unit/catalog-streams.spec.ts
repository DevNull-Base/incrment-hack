import { describe, expect, it } from 'vitest';
import type { DataScope } from '../../src/modules/access/data-scope.service.js';
import { streamScopeFilter } from '../../src/modules/catalog/learning-stream.service.js';
import { programWhere } from '../../src/modules/catalog/reference.service.js';
import { ItProgramQueryDto } from '../../src/modules/catalog/dto/catalog.dto.js';
import {
  AUDIENCE_VALUES,
  EDUCATION_PROJECT_VALUES,
  audienceFromApi,
  audienceToApi,
  projectFromApi,
  projectToApi,
} from '../../src/modules/catalog/catalog-enums.js';

const unrestricted: DataScope = {
  ownerIds: null,
  universityIds: null,
  directionIds: null,
  productIds: null,
  regions: null,
  fingerprint: 'test',
};

/**
 * Учебные потоки при вузе — такие же сведения о вузе, как договоры:
 * кому вуз закрыт, тот не должен видеть и сколько там учится людей.
 * Пустой список в области видимости означает «не видно ни одного вуза»,
 * а не «ограничения нет».
 */
describe('видимость учебных потоков', () => {
  it('без ограничений условий не добавляет', () => {
    expect(streamScopeFilter(unrestricted)).toEqual({});
  });

  it('при ограничении по вузам показывает наборы сайта и потоки разрешённых вузов', () => {
    expect(streamScopeFilter({ ...unrestricted, universityIds: ['u-1'] })).toEqual({
      OR: [{ universityId: null }, { university: { id: { in: ['u-1'] } } }],
    });
  });

  it('пустой список вузов закрывает все потоки при вузах', () => {
    expect(streamScopeFilter({ ...unrestricted, universityIds: [] })).toEqual({
      OR: [{ universityId: null }, { university: { id: { in: [] } } }],
    });
  });

  it('учитывает ограничение по региону', () => {
    expect(streamScopeFilter({ ...unrestricted, regions: ['Москва'] })).toEqual({
      OR: [{ universityId: null }, { university: { region: { in: ['Москва'] } } }],
    });
  });
});

/** Значения в API — те, под которые собран интерфейс каталога курсов. */
describe('значения перечислений каталога', () => {
  it('переводятся в обе стороны без потерь', () => {
    for (const value of EDUCATION_PROJECT_VALUES) expect(projectToApi(projectFromApi(value))).toBe(value);
    for (const value of AUDIENCE_VALUES) expect(audienceToApi(audienceFromApi(value))).toBe(value);
  });

  it('совпадают с контрактом фронтенда', () => {
    expect(projectToApi('SZ_RT')).toBe('sz-rt');
    expect(projectToApi('RTK_SCHOOL')).toBe('rtk-school');
    expect(audienceToApi('STATE_PROJECT')).toBe('state-project');
  });
});

function query(patch: Partial<ItProgramQueryDto>): ItProgramQueryDto {
  return Object.assign(new ItProgramQueryDto(), { activeOnly: false }, patch);
}

describe('отбор программ каталога курсов', () => {
  it('без параметров не ограничивает выборку', () => {
    expect(programWhere(query({}))).toEqual({});
  });

  it('переводит значения фильтров в перечисления базы', () => {
    expect(programWhere(query({ source: 'sz-rt', audienceCategory: 'state-project' }))).toEqual({
      AND: [{ source: 'SZ_RT' }, { audienceCategory: 'STATE_PROJECT' }],
    });
  });

  it('«без потоков» — отсутствие идущих и запланированных, а не любых', () => {
    // Программа, чьи потоки все завершены, сейчас набора не ведёт.
    expect(programWhere(query({ hasStreams: false }))).toEqual({
      AND: [{ NOT: { streams: { some: { status: { in: ['PLANNED', 'ACTIVE'] } } } } }],
    });
  });

  it('диапазон часов задаётся двумя независимыми границами', () => {
    expect(programWhere(query({ hoursMin: 72, hoursMax: 144 }))).toEqual({
      AND: [{ hoursTotal: { gte: 72 } }, { hoursTotal: { lte: 144 } }],
    });
  });
});
