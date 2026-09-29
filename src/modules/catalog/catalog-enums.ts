import type { EducationProject, ProgramAudience } from '../../generated/prisma/enums.js';

/**
 * Значения перечислений каталога в API.
 *
 * В базе — перечисления Postgres в верхнем регистре, как во всей схеме.
 * Наружу отдаются значения, под которые уже собран интерфейс каталога
 * курсов (контракт описан в заметках фронтенда): «rtk-school», «sz-rt»,
 * «state-project». Сопоставление держится в одном месте, чтобы DTO, фильтры
 * и сид не расходились.
 */

export const EDUCATION_PROJECT_VALUES = ['rtk-school', 'edu-rt', 'sz-rt', 'edupro'] as const;
export type EducationProjectValue = (typeof EDUCATION_PROJECT_VALUES)[number];

export const AUDIENCE_VALUES = ['individuals', 'specialists', 'state-project'] as const;
export type AudienceValue = (typeof AUDIENCE_VALUES)[number];

const EDUCATION_PROJECT: Record<EducationProject, EducationProjectValue> = {
  RTK_SCHOOL: 'rtk-school',
  EDU_RT: 'edu-rt',
  SZ_RT: 'sz-rt',
  EDUPRO: 'edupro',
};

const AUDIENCE: Record<ProgramAudience, AudienceValue> = {
  INDIVIDUALS: 'individuals',
  SPECIALISTS: 'specialists',
  STATE_PROJECT: 'state-project',
};

function invert<K extends string, V extends string>(map: Record<K, V>): Record<V, K> {
  return Object.fromEntries(Object.entries(map).map(([key, value]) => [value, key])) as Record<V, K>;
}

const EDUCATION_PROJECT_FROM_API = invert(EDUCATION_PROJECT);
const AUDIENCE_FROM_API = invert(AUDIENCE);

export const projectToApi = (value: EducationProject): EducationProjectValue => EDUCATION_PROJECT[value];
export const projectFromApi = (value: EducationProjectValue): EducationProject => EDUCATION_PROJECT_FROM_API[value];

export const audienceToApi = (value: ProgramAudience): AudienceValue => AUDIENCE[value];
export const audienceFromApi = (value: AudienceValue): ProgramAudience => AUDIENCE_FROM_API[value];
