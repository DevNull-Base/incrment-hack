import 'reflect-metadata';
import { plainToInstance, Type } from 'class-transformer';
import { IsString, MinLength, ValidateNested, validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { AppException } from '../../src/common/errors/app-exception.js';
import { fastifyClientStatus } from '../../src/common/errors/all-exceptions.filter.js';
import { toFieldIssues } from '../../src/common/errors/validation-issues.js';
import { hashRequest } from '../../src/modules/activity/idempotency.interceptor.js';
import { readUploadedFile } from '../../src/modules/files/uploaded-file.js';
import {
  SECRET_MASK,
  isSecretSetting,
  keepsStoredSecret,
} from '../../src/modules/notification/notification.service.js';

/**
 * Защита на входе запроса.
 *
 * Всё здесь — ошибки, найденные аудитом: каждая давала неверный ответ
 * (500 вместо ошибки клиента, 201 на испорченный файл) либо тихо портила
 * данные (токен, замещённый маской, повторно выполненная операция).
 */

describe('ошибки проверки с именами полей', () => {
  class Filters {
    @IsString()
    @MinLength(1, { message: 'Укажите период' })
    period!: string;
  }

  class Body {
    @IsString()
    @MinLength(1, { message: 'Укажите название' })
    title!: string;

    @ValidateNested()
    @Type(() => Filters)
    filters!: Filters;
  }

  it('указывает поле, в том числе вложенное', () => {
    const errors = validateSync(plainToInstance(Body, { title: '', filters: { period: '' } }));
    const issues = toFieldIssues(errors);

    expect(issues).toContainEqual({ field: 'title', message: 'Укажите название' });
    expect(issues).toContainEqual({ field: 'filters.period', message: 'Укажите период' });
  });

  it('переводит сообщение о лишнем поле', () => {
    const issues = toFieldIssues([
      {
        property: 'extra',
        constraints: { whitelistValidation: 'property extra should not exist' },
        children: [],
      },
    ]);

    expect(issues).toEqual([{ field: 'extra', message: 'Поле «extra» не предусмотрено' }]);
  });
});

describe('ошибки Fastify сохраняют свой статус', () => {
  it('ошибка клиента с statusCode распознаётся', () => {
    expect(fastifyClientStatus({ statusCode: 413, code: 'FST_ERR_CTP_BODY_TOO_LARGE' })).toBe(413);
    expect(fastifyClientStatus({ statusCode: 406 })).toBe(406);
  });

  it('ошибки сервера и прочее — не ошибки клиента', () => {
    expect(fastifyClientStatus({ statusCode: 500 })).toBeNull();
    expect(fastifyClientStatus(new Error('сбой'))).toBeNull();
    expect(fastifyClientStatus(null)).toBeNull();
  });
});

describe('отпечаток запроса для идемпотентности', () => {
  it('тот же ключ на другом адресе даёт другой отпечаток', () => {
    // Прежде учитывалось только тело, и «выполнить задачу Б» с ключом
    // от «выполнить задачу А» возвращало ответ про задачу А.
    expect(hashRequest('POST', '/api/v1/calendar/tasks/a/complete', {})).not.toBe(
      hashRequest('POST', '/api/v1/calendar/tasks/b/complete', {}),
    );
  });

  it('порядок полей тела не важен, метод — важен', () => {
    expect(hashRequest('POST', '/x', { a: 1, b: 2 })).toBe(hashRequest('post', '/x', { b: 2, a: 1 }));
    expect(hashRequest('POST', '/x', {})).not.toBe(hashRequest('PUT', '/x', {}));
  });
});

describe('секреты каналов уведомлений', () => {
  it('секрет опознаётся по смыслу имени, а не по списку', () => {
    for (const key of ['botToken', 'password', 'smtpPassword', 'apiKey', 'clientSecret', 'accessToken']) {
      expect(isSecretSetting(key)).toBe(true);
    }

    for (const key of ['chatId', 'apiUrl', 'host', 'port', 'from']) {
      expect(isSecretSetting(key)).toBe(false);
    }
  });

  it('маска, присланная формой обратно, сохранённый секрет не затирает', () => {
    expect(keepsStoredSecret(SECRET_MASK)).toBe(true);
    expect(keepsStoredSecret('')).toBe(true);
    expect(keepsStoredSecret(null)).toBe(true);
    expect(keepsStoredSecret('новый-токен')).toBe(false);
  });
});

describe('чтение загруженного файла', () => {
  const request = (options: { multipart: boolean; truncated?: boolean; size?: number; filename?: string }) =>
    ({
      isMultipart: () => options.multipart,
      file: async () => ({
        filename: options.filename ?? 'договор.pdf',
        file: { truncated: options.truncated ?? false },
        toBuffer: async () => Buffer.alloc(options.size ?? 10),
      }),
    }) as unknown as Parameters<typeof readUploadedFile>[0];

  const codeOf = async (promise: Promise<unknown>): Promise<string | null> => {
    try {
      await promise;
      return null;
    } catch (error) {
      return error instanceof AppException ? error.definition.code : 'не AppException';
    }
  };

  it('обрезанный по лимиту файл отклоняется, а не сохраняется испорченным', async () => {
    expect(await codeOf(readUploadedFile(request({ multipart: true, truncated: true }), 1024))).toBe(
      'CRM-FIL-0001',
    );
  });

  it('запрос не multipart — ошибка клиента, а не 500', async () => {
    expect(await codeOf(readUploadedFile(request({ multipart: false }), 1024))).toBe('CRM-VAL-0001');
  });

  it('обычный файл читается целиком', async () => {
    const file = await readUploadedFile(request({ multipart: true, size: 100 }), 1024);

    expect(file.fileName).toBe('договор.pdf');
    expect(file.content.length).toBe(100);
  });
});
