import { describe, expect, it } from 'vitest';
import { isServiceProbeRequest, maskQueryString } from '../../src/common/logging/logging.module.js';

/**
 * Отсев служебных обращений из журнала запросов.
 *
 * Проверка неочевидная, потому что ломалась она молча: фильтр был написан
 * по `req.url`, а `@fastify/middie` перед вызовом middleware срезает с этого
 * поля путь, по которому middleware смонтировано. Пробы вынесены из общего
 * префикса API и монтируются отдельным маршрутом, поэтому фильтр получал «/»
 * и пропускал их в журнал — при интервале проверки в десять секунд журнал api
 * состоял из них почти целиком.
 */
describe('isServiceProbeRequest', () => {
  it('отсеивает пробы и метрики по обычному адресу', () => {
    expect(isServiceProbeRequest({ url: '/health/live' })).toBe(true);
    expect(isServiceProbeRequest({ url: '/health/ready' })).toBe(true);
    expect(isServiceProbeRequest({ url: '/metrics' })).toBe(true);
  });

  it('отсеивает пробы, когда middie уже срезал смонтированный путь', () => {
    expect(isServiceProbeRequest({ url: '/', originalUrl: '/health/live' })).toBe(true);
    expect(isServiceProbeRequest({ url: '', originalUrl: '/metrics' })).toBe(true);
  });

  it('пропускает в журнал обычные запросы к API', () => {
    expect(isServiceProbeRequest({ url: '/api/v1/engagements' })).toBe(false);
    expect(isServiceProbeRequest({ url: '/', originalUrl: '/api/v1/engagements' })).toBe(false);
    // Путь лишь начинается похоже: отсекать его нельзя.
    expect(isServiceProbeRequest({ url: '/api/v1/health-checks' })).toBe(false);
  });

  it('не падает на запросе без адреса', () => {
    expect(isServiceProbeRequest({})).toBe(false);
  });
});

describe('адрес запроса в журнале', () => {
  it('скрывает строку поиска, оставляя остальные параметры', () => {
    expect(maskQueryString('/api/v1/persons?search=%D0%98%D0%B2%D0%B0%D0%BD%D0%BE%D0%B2&limit=20')).toBe(
      '/api/v1/persons?search=[REDACTED]&limit=20',
    );
    expect(maskQueryString('/api/v1/engagements?Search=Petrov&page=2')).toBe(
      '/api/v1/engagements?Search=[REDACTED]&page=2',
    );
  });

  it('адрес без параметров не меняется', () => {
    expect(maskQueryString('/api/v1/engagements')).toBe('/api/v1/engagements');
    expect(maskQueryString(undefined)).toBeUndefined();
  });
});

describe('длинный адрес в журнале', () => {
  it('обрезается, чтобы не раздувать журнал', () => {
    const logged = maskQueryString(`/api/v1/calendar?X-Request-Id=${'A'.repeat(10_000)}`) ?? '';

    expect(logged.length).toBeLessThan(600);
    expect(logged).toContain('обрезано, всего');
  });
});
