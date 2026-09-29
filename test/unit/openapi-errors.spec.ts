import { describe, expect, it } from 'vitest';
import type { OpenAPIObject } from '@nestjs/swagger';
import { withStandardErrorResponses } from '../../src/bootstrap/openapi-errors.js';

/** Стандартные ответы с ошибкой добавляются в описание API по признакам операции. */
describe('ответы с ошибкой в описании API', () => {
  function document(): OpenAPIObject {
    return {
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
      paths: {
        '/api/v1/engagements/{id}': {
          patch: {
            parameters: [{ name: 'id', in: 'path', required: true }],
            requestBody: { content: {} },
            responses: { '200': { description: 'ok' }, '404': { description: 'своё описание' } },
            security: [{ keycloak: [] }],
          },
        },
        '/api/v1/integration/website/payments': {
          post: {
            parameters: [{ name: 'x-signature', in: 'header' }],
            requestBody: { content: {} },
            responses: { '200': { description: 'ok' } },
            security: [{ keycloak: [] }],
          },
        },
        '/health/live': { get: { responses: { '200': { description: 'ok' } } } },
      },
    } as unknown as OpenAPIObject;
  }

  it('защищённая операция получает 400/401/403/404/422/429/500, своё описание не затирается', () => {
    const result = withStandardErrorResponses(document());
    const responses = (result.paths['/api/v1/engagements/{id}'] as Record<string, { responses: Record<string, { description: string }> }>).patch.responses;

    expect(Object.keys(responses).sort()).toEqual(['200', '400', '401', '403', '404', '422', '429', '500']);
    expect(responses['404']?.description).toBe('своё описание');
  });

  it('приём вызовов с подписью — без токена и без 401', () => {
    const result = withStandardErrorResponses(document());
    const operation = (result.paths['/api/v1/integration/website/payments'] as Record<string, { security: unknown[]; responses: Record<string, unknown> }>).post;

    expect(operation.security).toEqual([]);
    expect(operation.responses['401']).toBeUndefined();
    expect(operation.responses['403']).toBeDefined();
  });

  it('служебные пробы не трогаются', () => {
    const result = withStandardErrorResponses(document());
    expect(Object.keys((result.paths['/health/live'] as Record<string, { responses: object }>).get.responses)).toEqual(['200']);
  });
});
