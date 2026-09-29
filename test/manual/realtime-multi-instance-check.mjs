/**
 * Проверка доставки событий МЕЖДУ репликами API.
 *
 * Одного экземпляра для этой проверки недостаточно: события расходятся
 * внутри процесса и без адаптера Redis, поэтому поломка адаптера остаётся
 * незамеченной ровно до момента, когда система масштабируется.
 *
 * Сценарий: клиент подключён к экземпляру A, действие выполняется через
 * экземпляр B. Событие обязано дойти.
 *
 * Запуск: два процесса API на разных портах (см. run-multi.sh) и
 *   node test/manual/realtime-multi-instance-check.mjs
 */
import { io } from 'socket.io-client';

const INSTANCE_A = process.env.API_A ?? 'http://localhost:3000';
const INSTANCE_B = process.env.API_B ?? 'http://localhost:3100';
const KEYCLOAK = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'rtk-crm';

let failures = 0;

function check(label, condition, detail = '') {
  if (!condition) failures++;
  console.log(`  [${condition ? 'OK  ' : 'СБОЙ'}] ${label}${detail ? ` — ${detail}` : ''}`);
}

async function token(username, password) {
  const r = await fetch(`${KEYCLOAK}/realms/${REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'crm-frontend',
      username,
      password,
    }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('Нет токена');
  return d.access_token;
}

async function api(base, path, accessToken, options = {}) {
  const r = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const text = await r.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: r.status, body, etag: r.headers.get('etag') };
}

function connect(base, accessToken) {
  return new Promise((resolve, reject) => {
    const socket = io(`${base}/ws`, {
      auth: { token: accessToken },
      transports: ['websocket'],
      reconnection: false,
      timeout: 10_000,
    });
    const timer = setTimeout(() => reject(new Error('Таймаут подключения')), 12_000);
    socket.on('connected', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on('connect_error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

function waitForEvent(socket, eventName, timeoutMs = 12_000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    socket.once(eventName, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function main() {
  const admin = await token('admin.sidorov', 'Adm#2026demo');

  console.log(`\nЭкземпляр A: ${INSTANCE_A}`);
  console.log(`Экземпляр B: ${INSTANCE_B}`);

  console.log('\n1. Оба экземпляра доступны');
  const healthA = await fetch(`${INSTANCE_A}/health/live`).then((r) => r.status);
  const healthB = await fetch(`${INSTANCE_B}/health/live`).then((r) => r.status);
  check('экземпляр A отвечает', healthA === 200, `${healthA}`);
  check('экземпляр B отвечает', healthB === 200, `${healthB}`);

  console.log('\n2. Клиент подключается к экземпляру A');
  const socket = await connect(INSTANCE_A, admin);
  check('соединение с A установлено', socket.connected);

  console.log('\n3. Действие выполняется через экземпляр B');
  const list = await api(INSTANCE_B, '/api/v1/engagements?limit=50', admin);
  let targetCard = null;
  let targetTransition = null;

  for (const item of list.body.items) {
    const detail = await api(INSTANCE_B, `/api/v1/engagements/${item.id}`, admin);
    const usable = detail.body.availableTransitions?.find((t) => t.allowed && !t.requiresAttachment);
    if (usable) {
      targetCard = detail;
      targetTransition = usable;
      break;
    }
  }
  check('найдена карточка с доступным переходом', targetCard !== null);

  if (targetCard && targetTransition) {
    const eventPromise = waitForEvent(socket, 'engagement.updated');

    const transition = await api(INSTANCE_B, `/api/v1/engagements/${targetCard.body.id}/transition`, admin, {
      method: 'POST',
      headers: { 'If-Match': targetCard.etag },
      body: JSON.stringify({
        toStateKey: targetTransition.toStateKey,
        comment: 'Проверка доставки между репликами',
      }),
    });
    check('переход выполнен на экземпляре B', transition.status === 201, `${transition.status}`);

    console.log('\n4. Событие должно прийти клиенту экземпляра A');
    const event = await eventPromise;
    check(
      'событие дошло через Redis до другой реплики',
      event !== null,
      event ? '' : 'событие не получено за 12 с — адаптер Redis не работает',
    );

    if (event) {
      check('событие относится к нужной карточке', event.engagementId === targetCard.body.id);
      check('в событии новый статус', event.toStateKey === targetTransition.toStateKey, event.toStateKey);
      console.log(`       получено на A: ${event.toStateLabel}, автор: ${event.actorName}`);
    }
  }

  socket.close();

  console.log(failures === 0 ? '\nВсе проверки пройдены.\n' : `\nПроверок не пройдено: ${failures}.\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('Ошибка выполнения проверок:', error);
  process.exitCode = 1;
});
