import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { IsBoolean, IsOptional, validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { ToBoolean } from '../../src/common/dto/query-transforms.js';
import { EngagementQueryDto } from '../../src/modules/engagement/dto/engagement.dto.js';

/**
 * Булевы параметры строки запроса.
 *
 * Прежде такие поля приводились конструктором Boolean, и ?includeArchived=false
 * возвращал архивные записи, а ?onlyUnread=false — только непрочитанные.
 * Проверка идёт с теми же настройками, что у глобального ValidationPipe:
 * именно неявное преобразование и делало ошибку незаметной.
 */

class Probe {
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  flag?: boolean;
}

const parse = (plain: Record<string, unknown>) =>
  plainToInstance(Probe, plain, { enableImplicitConversion: true });

describe('ToBoolean', () => {
  it('строка «false» — это false, а не true', () => {
    expect(parse({ flag: 'false' }).flag).toBe(false);
    expect(parse({ flag: '0' }).flag).toBe(false);
  });

  it('строка «true» — это true', () => {
    expect(parse({ flag: 'true' }).flag).toBe(true);
    expect(parse({ flag: '1' }).flag).toBe(true);
  });

  it('настоящие булевы значения из тела запроса не меняются', () => {
    expect(parse({ flag: false }).flag).toBe(false);
    expect(parse({ flag: true }).flag).toBe(true);
  });

  it('отсутствие параметра остаётся отсутствием', () => {
    expect(parse({}).flag).toBeUndefined();
  });

  it('непонятное значение отклоняется проверкой, а не превращается в true', () => {
    const probe = parse({ flag: 'maybe' });

    expect(validateSync(probe)).toHaveLength(1);
  });
});

describe('отбор заявок по заинтересованности', () => {
  const query = (plain: Record<string, unknown>) =>
    plainToInstance(EngagementQueryDto, plain, { enableImplicitConversion: true });

  it('принимает значения через запятую', () => {
    expect(query({ interestLevels: 'HIGH,UNSET' }).interestLevels).toEqual(['HIGH', 'UNSET']);
  });

  it('принимает повтор параметра', () => {
    expect(query({ interestLevels: ['HIGH', 'LOW'] }).interestLevels).toEqual(['HIGH', 'LOW']);
  });

  it('отклоняет неизвестное значение', () => {
    const errors = validateSync(query({ interestLevels: 'VERY_HIGH' }));

    expect(errors.some((error) => error.property === 'interestLevels')).toBe(true);
  });

  it('includeArchived=false действительно исключает архив', () => {
    expect(query({ includeArchived: 'false' }).includeArchived).toBe(false);
  });
});
