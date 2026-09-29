import type { OpenAPIObject } from '@nestjs/swagger';

type Operation = {
  parameters?: Array<{ name?: string; in?: string }>;
  requestBody?: unknown;
  responses?: Record<string, unknown>;
  security?: Array<Record<string, string[]>>;
};

const METHODS = ['get', 'put', 'post', 'patch', 'delete'] as const;

const PROBLEM = { $ref: '#/components/schemas/ProblemDetailsDto' };

/**
 * Стандартные ответы с ошибкой в описании API.
 *
 * Коды 4xx и 500 возвращает общий обработчик исключений для любого маршрута,
 * но в спецификации они не значились — фронтенд-команда и генераторы
 * клиентов видели у 110 операций только успешный ответ, а сканер контракта
 * считал каждый 401 и 404 расхождением. Описания добавляются здесь, одним
 * проходом по документу, по признакам самой операции: расставлять одни и те
 * же декораторы на каждом маршруте значило бы гарантировать, что где-то
 * их забудут.
 *
 * Уже описанные ответы не перезаписываются: у маршрута может быть свой,
 * более точный текст.
 *
 * Маршруты приёма вызовов внешних систем (с заголовком x-signature) —
 * открытые: у них подпись вместо токена. Прежде в спецификации они
 * значились требующими Bearer-токен, что вводило в заблуждение.
 */
export function withStandardErrorResponses(document: OpenAPIObject): OpenAPIObject {
  for (const [path, item] of Object.entries(document.paths)) {
    if (!path.startsWith('/api/')) {
      continue;
    }

    for (const method of METHODS) {
      const operation = (item as Record<string, Operation | undefined>)[method];

      if (!operation) {
        continue;
      }

      const signed = (operation.parameters ?? []).some((parameter) => parameter.name?.toLowerCase() === 'x-signature');
      const hasInput =
        operation.requestBody !== undefined ||
        (operation.parameters ?? []).some((parameter) => parameter.in === 'query' || parameter.in === 'path');
      const hasPathParams = path.includes('{');

      if (signed) {
        operation.security = [];
      }

      const add = (status: string, description: string) => {
        operation.responses ??= {};
        if (!(status in operation.responses)) {
          operation.responses[status] = { description, content: { 'application/json': { schema: PROBLEM } } };
        }
      };

      if (operation.requestBody !== undefined) {
        add('400', 'Тело запроса не является корректным JSON (CRM-VAL-0002)');
      }

      if (signed) {
        add('403', 'Подпись вызова не совпадает (CRM-ACL-0001) либо приём не настроен');
      } else {
        add('401', 'Нет токена, токен истёк или не прошёл проверку (CRM-AUT-0001…0003)');
        add('403', 'Роль или область видимости не позволяют действие');
      }

      if (hasPathParams) {
        add('404', 'Запись не найдена либо недоступна текущему пользователю');
      }

      if (hasInput) {
        add('422', 'Параметры не прошли проверку; поля — в errors[].field (CRM-VAL-0001)');
      }

      add('429', 'Превышена частота обращений (CRM-COM-0004); повторите после Retry-After');
      add('500', 'Внутренняя ошибка; подробности только в журнале по traceId');
    }
  }

  return document;
}
