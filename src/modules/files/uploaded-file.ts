import type { FastifyRequest } from 'fastify';
import { AppException } from '../../common/errors/app-exception.js';

export interface UploadedFile {
  fileName: string;
  content: Buffer;
}

/**
 * Читает файл из запроса multipart/form-data целиком.
 *
 * Два случая, которые прежде обрабатывались неверно.
 *
 * Файл больше лимита. Модуль multipart при превышении лимита обрезает поток
 * и не всегда сообщает об этом исключением: обрезанный до лимита файл
 * сохранялся как обычный, с ответом 201, — испорченный договор выглядел
 * успешно загруженным. Признак обрезки проверяется здесь явно.
 *
 * Запрос не multipart. Модуль бросал исключение, которое не было
 * исключением Nest, и клиент получал 500 — «сломан сервер» вместо
 * «неверно составлен запрос».
 */
export async function readUploadedFile(request: FastifyRequest, maxBytes: number): Promise<UploadedFile> {
  if (!request.isMultipart()) {
    throw new AppException('VALIDATION_FAILED', {
      detail: 'Файл передаётся в формате multipart/form-data, в поле «file».',
      issues: [{ field: 'file', message: 'Ожидается multipart/form-data' }],
    });
  }

  const file = await request.file().catch((error: unknown) => {
    throw toUploadException(error, maxBytes);
  });

  if (!file) {
    throw new AppException('VALIDATION_FAILED', {
      detail: 'В запросе отсутствует файл. Ожидается поле «file» в multipart/form-data.',
      issues: [{ field: 'file', message: 'Приложите файл' }],
    });
  }

  const content = await file.toBuffer().catch((error: unknown) => {
    throw toUploadException(error, maxBytes);
  });

  if (file.file.truncated || content.length > maxBytes) {
    throw tooLarge(maxBytes);
  }

  return { fileName: file.filename, content };
}

function toUploadException(error: unknown, maxBytes: number): AppException {
  const code = (error as { code?: unknown } | null)?.code;

  if (code === 'FST_REQ_FILE_TOO_LARGE' || code === 'FST_FILES_LIMIT' || code === 'FST_PARTS_LIMIT') {
    return tooLarge(maxBytes);
  }

  return new AppException('VALIDATION_FAILED', {
    detail: 'Не удалось прочитать файл из запроса: тело multipart/form-data повреждено.',
    cause: error,
  });
}

function tooLarge(maxBytes: number): AppException {
  return new AppException('FILE_TOO_LARGE', {
    detail: `Файл больше допустимых ${Math.round(maxBytes / (1024 * 1024))} МБ.`,
    meta: { maxBytes },
  });
}
