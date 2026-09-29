import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

/**
 * Снятие блокировки только её владельцем — одной командой на стороне Redis.
 *
 * Прежде блокировка снималась простым DEL. Если задача работала дольше срока
 * блокировки, та истекала, следующий запуск занимал её заново — и первый,
 * закончив, удалял уже чужую блокировку. Третий запуск шёл параллельно
 * второму, и одни и те же события уходили во внешние системы дважды.
 */
const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

export interface RedisLock {
  /** Снимает блокировку, если она всё ещё принадлежит этому владельцу. */
  release(): Promise<void>;
}

/**
 * Занимает блокировку на ttlSec секунд. null — блокировка у другого
 * процесса. Ошибку Redis вызывающий обрабатывает сам: одним задачам
 * лучше пропустить прогон, другим — выполнить его без блокировки.
 */
export async function acquireRedisLock(redis: Redis, key: string, ttlSec: number): Promise<RedisLock | null> {
  const token = randomUUID();
  const acquired = await redis.set(key, token, 'EX', ttlSec, 'NX');

  if (acquired !== 'OK') {
    return null;
  }

  return {
    release: async () => {
      await redis.eval(RELEASE_SCRIPT, 1, key, token).catch(() => undefined);
    },
  };
}
