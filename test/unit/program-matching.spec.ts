import { describe, expect, it } from 'vitest';
import { createProgramMatcher, type CatalogProgram } from '../../src/modules/integration/payments/program-matching.js';

/** Курсы из образца оплат заказчика и их программы в каталоге. */
const PROGRAMS: CatalogProgram[] = [
  'Анализ данных без программирования',
  'Инженер-тестировщик',
  'Управление ИТ-проектами на базе программного продукта ПАО «Ростелеком»',
  'Промпт-инжиниринг',
  'Python-разработчик с использованием инструментов ИИ',
].map((name, index) => ({ id: `p${index}`, name, directionId: 'd', productId: null }));

describe('сопоставление курса с программой', () => {
  const match = createProgramMatcher(PROGRAMS);

  it('точное название, в том числе с вложенными кавычками', () => {
    expect(match('Управление ИТ-проектами на базе программного продукта ПАО «Ростелеком»')).toMatchObject({
      program: { id: 'p2' },
      warning: null,
    });
  });

  it('регистр, дефисы, кавычки и пробелы не мешают', () => {
    expect(match('  инженер тестировщик ')).toMatchObject({ program: { id: 'p1' }, warning: null });
    expect(match('Управление ИТ проектами на базе программного продукта ПАО "Ростелеком"')).toMatchObject({
      program: { id: 'p2' },
      warning: null,
    });
  });

  it('опечатка — сопоставляется с предупреждением', () => {
    const result = match('Инженер-тестировшик');
    expect(result.program?.id).toBe('p1');
    expect(result.program && result.warning).toContain('по сходству');
  });

  it('неизвестный курс — отказ с подсказкой', () => {
    const result = match('Кулинария для начинающих');
    expect(result.program).toBeNull();
    expect(result.program === null && result.reason).toContain('не найден в каталоге');
  });

  it('два одинаково похожих кандидата — отказ, а не угадывание', () => {
    const ambiguous = createProgramMatcher([
      { id: 'a', name: 'Основы Python, поток 1', directionId: 'd', productId: null },
      { id: 'b', name: 'Основы Python, поток 2', directionId: 'd', productId: null },
    ]);

    const result = ambiguous('Основы Python поток');
    expect(result.program).toBeNull();
  });

  it('одноимённые программы в разных направлениях — отказ', () => {
    const duplicated = createProgramMatcher([
      { id: 'a', name: 'Промпт-инжиниринг', directionId: 'd1', productId: null },
      { id: 'b', name: 'Промпт-инжиниринг', directionId: 'd2', productId: null },
    ]);

    const result = duplicated('Промпт-инжиниринг');
    expect(result.program === null && result.reason).toContain('несколькими программами');
  });
});
