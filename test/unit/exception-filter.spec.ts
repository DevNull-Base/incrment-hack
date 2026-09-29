import { describe, expect, it } from 'vitest';
import { Prisma } from '../../src/generated/prisma/client.js';
import { AllExceptionsFilter } from '../../src/common/errors/all-exceptions.filter.js';

type Args = ConstructorParameters<typeof AllExceptionsFilter>;

/** Прогон исключения через фильтр: что ушло клиенту и что — в журнал. */
function run(exception: unknown, url = '/api/v1/persons?search=Петров&limit=5') {
  let replied: { body: Record<string, unknown>; status: number } | null = null;
  const logged: Array<Record<string, unknown>> = [];

  const adapterHost = {
    httpAdapter: {
      reply: (_response: unknown, body: Record<string, unknown>, status: number) => {
        replied = { body, status };
      },
    },
  };
  const logger = {
    setContext: () => undefined,
    warn: (payload: Record<string, unknown>) => logged.push(payload),
    error: (payload: Record<string, unknown>) => logged.push(payload),
  };

  const filter = new AllExceptionsFilter(adapterHost as unknown as Args[0], logger as unknown as Args[1]);
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ url, id: 'trace-1', method: 'GET' }),
      getResponse: () => ({}),
    }),
  };

  filter.catch(exception, host as never);
  return { replied: replied as unknown as { body: Record<string, unknown>; status: number }, logged };
}

function invalidUuid(code: 'P2007' | 'P2010') {
  return new Prisma.PrismaClientKnownRequestError('invalid input syntax for type uuid', {
    code,
    clientVersion: 'test',
    meta: { driverAdapterError: { name: 'DriverAdapterError', cause: { originalCode: '22P02' } } },
  });
}

describe('обработка ошибок', () => {
  it.each(['P2007', 'P2010'] as const)('неверный формат значения (%s) — 422, а не 500', (code) => {
    const { replied } = run(invalidUuid(code));

    expect(replied.status).toBe(422);
    expect(replied.body.code).toBe('CRM-VAL-0001');
  });

  it('прочие ошибки базы по-прежнему 500 без подробностей', () => {
    const error = new Prisma.PrismaClientKnownRequestError('boom', { code: 'P2034', clientVersion: 'test' });
    const { replied } = run(error);

    expect(replied.status).toBe(500);
    expect(JSON.stringify(replied.body)).not.toContain('boom');
  });

  it('ответ не возвращает клиенту параметры его запроса', () => {
    const { replied } = run(invalidUuid('P2007'), '/api/v1/audit?page=%3B+echo+%27CMDTEST123%27');

    expect(replied.body.instance).toBe('/api/v1/audit');
    expect(JSON.stringify(replied.body)).not.toContain('CMDTEST123');
  });

  it('в журнал не попадает строка поиска', () => {
    const { logged } = run(invalidUuid('P2007'));

    expect(JSON.stringify(logged)).not.toContain('Петров');
    expect(logged[0]?.url).toBe('/api/v1/persons?search=[REDACTED]&limit=5');
  });
});
