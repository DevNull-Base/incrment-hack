import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpIntegrationAdapter } from '../../src/modules/integration/adapters/integration-adapter.js';

type LoggerArg = ConstructorParameters<typeof HttpIntegrationAdapter>[4];

type Handler = (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => void;

const HANDLERS: Record<string, Handler> = {
  ok: (_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"events":[{"id":1}],"cursor":"c-2"}');
  },
  slow: (request, response) => {
    // Заголовки сразу, тело — по байту раз в секунду.
    response.writeHead(200, { 'content-type': 'application/json' });
    response.write('{"events":[');
    const timer = setInterval(() => response.write(' '), 1000);
    request.on('close', () => clearInterval(timer));
  },
  huge: (_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    const chunk = 'x'.repeat(1024 * 1024);
    let sent = 0;
    const pump = () => {
      while (sent < 20 && response.write(chunk)) sent++;
      if (sent < 20) response.once('drain', pump);
      else response.end();
    };
    pump();
  },
  redirect: (_request, response) => {
    response.writeHead(302, { location: 'http://example.invalid/steal' });
    response.end();
  },
  object: (_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"events":{"a":1}}');
  },
};

/**
 * HTTP-обмен с внешними системами: внешняя система может вести себя как
 * угодно, и обработчик синхронизации не должен от этого зависать или
 * забирать память без предела.
 */
describe('HTTP-адаптер внешних систем', () => {
  const servers: Server[] = [];
  const bases: Record<string, string> = {};

  beforeAll(async () => {
    for (const [name, handler] of Object.entries(HANDLERS)) {
      const server = createServer(handler);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      servers.push(server);
      bases[name] = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    }
  });

  afterAll(async () => {
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  const logger = { warn: () => undefined } as unknown as LoggerArg;
  const adapter = (name: string, timeoutMs = 2000) =>
    new HttpIntegrationAdapter('LMS', bases[name] as string, 'token', timeoutMs, logger);

  it('обычный ответ разбирается', async () => {
    await expect(adapter('ok').fetchEvents(null)).resolves.toEqual({ events: [{ id: 1 }], cursor: 'c-2' });
  });

  it('медленное тело прерывается по тайм-ауту, а не висит', async () => {
    const started = Date.now();
    await expect(adapter('slow', 1500).fetchEvents(null)).rejects.toMatchObject({
      definition: { code: 'CRM-INT-0001' },
    });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('ответ больше предела отклоняется', async () => {
    await expect(adapter('huge', 10_000).fetchEvents(null)).rejects.toMatchObject({
      definition: { code: 'CRM-INT-0002' },
    });
  });

  it('перенаправление не выполняется', async () => {
    await expect(adapter('redirect').fetchEvents(null)).rejects.toMatchObject({
      definition: { code: 'CRM-INT-0001' },
    });
  });

  it('events не массив — понятная ошибка контракта', async () => {
    await expect(adapter('object').fetchEvents(null)).rejects.toMatchObject({
      definition: { code: 'CRM-INT-0002' },
    });
  });
});
