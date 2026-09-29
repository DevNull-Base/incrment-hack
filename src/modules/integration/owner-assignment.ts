import type { Prisma } from '../../generated/prisma/client.js';

/**
 * Выбор ответственного за заявку, пришедшую извне: обращение с сайта,
 * запись из LMS, подтверждённая оплата.
 *
 * Заявка не может остаться без ответственного: без него она не попадёт
 * ни в чей список и потеряется. Берётся менеджер с наименьшим числом
 * активных заявок — простое распределение нагрузки, которое руководитель
 * затем поправит переназначением.
 *
 * Принимает и транзакцию: при загрузке пачки оплат заявки, заведённые
 * раньше в той же транзакции, учитываются в нагрузке, и пачка расходится
 * по менеджерам, а не падает целиком на одного.
 */
export async function pickLeastLoadedOwner(
  db: Pick<Prisma.TransactionClient, 'appUser'>,
): Promise<string> {
  const candidates = await db.appUser.findMany({
    where: { isActive: true, role: { in: ['USER', 'MANAGER'] } },
    select: {
      id: true,
      role: true,
      _count: { select: { ownedEngagements: { where: { isArchived: false } } } },
    },
  });

  if (candidates.length === 0) {
    throw new Error('В системе нет активных пользователей для назначения ответственным');
  }

  // Рядовые менеджеры предпочтительнее руководителя: ведение заявок —
  // их работа, руководитель берёт её только при отсутствии менеджеров.
  const managers = candidates.filter((user) => user.role === 'USER');
  const pool = managers.length > 0 ? managers : candidates;

  return pool.reduce((least, user) =>
    user._count.ownedEngagements < least._count.ownedEngagements ? user : least,
  ).id;
}
