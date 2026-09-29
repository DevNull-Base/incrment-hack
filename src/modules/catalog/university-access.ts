import { AppException } from '../../common/errors/app-exception.js';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { DataScope } from '../access/data-scope.service.js';

/**
 * Вуз существует и не закрыт явным ограничением видимости. Закрытый
 * и несуществующий вуз дают одинаковый ответ — как и заявки.
 *
 * Справочник вузов общий, но то, что к вузу приложено, — люди, договоры,
 * заметки — видит только тот, кому администратор вуз не закрыл.
 */
export async function assertUniversityVisible(
  prisma: PrismaService,
  universityId: string,
  scope: DataScope,
): Promise<void> {
  const university = await prisma.university.findUnique({
    where: { id: universityId },
    select: { id: true, region: true },
  });

  const hidden =
    !university ||
    (scope.universityIds !== null && !scope.universityIds.includes(university.id)) ||
    (scope.regions !== null && (university.region === null || !scope.regions.includes(university.region)));

  if (hidden) {
    throw new AppException('NOT_FOUND', { detail: 'Вуз не найден либо недоступен текущему пользователю.' });
  }
}
