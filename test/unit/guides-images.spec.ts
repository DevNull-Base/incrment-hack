import { describe, expect, it } from 'vitest';
import type { PinoLogger } from 'nestjs-pino';
import { GuidesService } from '../../src/modules/guides/guides.service.js';

/**
 * Иллюстрации руководств открыты без входа, поэтому имя файла из запроса
 * не должно выводить за пределы каталога иллюстраций и открывать что-то,
 * кроме PNG.
 */
describe('иллюстрации руководств', () => {
  const service = new GuidesService({ setContext: () => undefined } as unknown as PinoLogger);

  it.each(['../user-guide.md', '..%2F..%2F.env', 'images/../../.env', 'Screen.PNG', 'shot.svg', '.png', 'a/b.png'])(
    'отклоняет «%s» без обращения к диску',
    async (name) => {
      await expect(service.image(name)).rejects.toMatchObject({ status: 404 });
    },
  );

  it('несуществующий файл — «не найдено», а не ошибка сервера', async () => {
    await expect(service.image('no-such-screen.png')).rejects.toMatchObject({ status: 404 });
  });
});
