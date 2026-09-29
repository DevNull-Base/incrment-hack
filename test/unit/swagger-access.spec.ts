import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { isDocsRequest } from '../../src/bootstrap/swagger.js';

/**
 * Пароль на документации API.
 *
 * Маршрутизатор Fastify декодирует путь, и сравнение сырого адреса
 * пропускало «/api/%64ocs-json» мимо пароля — схема API отдавалась любому.
 */
describe('защита документации API', () => {
  async function server() {
    const app = Fastify();
    app.addHook('onRequest', (request, reply, done) => {
      if (!isDocsRequest(request, '/api/docs')) {
        done();
        return;
      }
      void reply.code(401).send('auth');
    });
    app.get('/api/docs-json', async () => 'schema');
    app.get('/api/docs', async () => 'ui');
    app.get('/api/v1/engagements', async () => 'data');
    return app;
  }

  it.each(['/api/docs', '/api/docs-json', '/api/%64ocs-json', '/%61pi/docs-json', '/api/docs-json?x=1', '/api/%64ocs'])(
    '%s требует пароль',
    async (url) => {
      const response = await (await server()).inject({ method: 'GET', url });
      expect(response.statusCode).toBe(401);
    },
  );

  it('остальные маршруты не затрагиваются', async () => {
    const response = await (await server()).inject({ method: 'GET', url: '/api/v1/engagements' });
    expect(response.statusCode).toBe(200);
  });
});
