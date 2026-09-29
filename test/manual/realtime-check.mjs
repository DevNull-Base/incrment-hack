/**
 * Ручная проверка канала обновлений реального времени.
 *
 * Проверяется, что изменение статуса в одной сессии доходит до другой
 * без перезагрузки страницы — это и есть требование ТЗ о том, что
 * страница не должна сбрасываться при манипуляциях с данными.
 *
 * Запуск (API и Keycloak должны быть подняты):
 *   node test/manual/realtime-check.mjs
 */
import { io } from 'socket.io-client';

const API = process.env.API_URL ?? 'http://localhost:3000';
const KEYCLOAK = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'rtk-crm';

let failures = 0;

function check(label, condition, detail = '') {
  if (!condition) failures++;
  console.log(`  [${condition ? 'OK  ' : 'СБОЙ'}] ${label}${detail ? ` — ${detail}` : ''}`);
}

async function token(username, password) {
  const response = await fetch(`${KEYCLOAK}/realms/${REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'crm-frontend',
      username,
      password,
    }),
  });
  const data = await response.json();
  if (!data.access_token) throw new Error(`Нет токена для ${username}`);
  return data.access_token;
}

async function api(path, accessToken, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body, etag: response.headers.get('etag') };
}

/** Ожидает событие указанного типа либо истечение времени. */
function waitForEvent(socket, eventName, timeoutMs = 10_000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    socket.once(eventName, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function connect(accessToken) {
  return new Promise((resolve, reject) => {
    const socket = io(`${API}/ws`, {
      // Токен передаётся в рукопожатии, а не в строке запроса:
      // параметры URL оседают в журналах прокси.
      auth: { token: accessToken },
      transports: ['websocket'],
      reconnection: false,
      timeout: 10_000,
    });

    const timer = setTimeout(() => reject(new Error('Таймаут подключения')), 12_000);

    socket.on('connected', (payload) => {
      clearTimeout(timer);
      resolve({ socket, greeting: payload });
    });
    socket.on('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function main() {
  const admin = await token('admin.sidorov', 'Adm#2026demo');

  console.log('\n1. Подключение с валидным токеном');
  const { socket, greeting } = await connect(admin);
  check('соединение установлено', socket.connected);
  check('сервер сообщил профиль', greeting?.role === 'ADMIN', `роль: ${greeting?.role}`);
  console.log(`       подключён как: ${greeting?.displayName}`);

  console.log('\n2. Подключение без токена отклоняется');
  const anonymous = await new Promise((resolve) => {
    const s = io(`${API}/ws`, { transports: ['websocket'], reconnection: false, timeout: 8000 });
    const timer = setTimeout(() => resolve({ rejected: false, socket: s }), 9000);
    s.on('error', (payload) => {
      clearTimeout(timer);
      resolve({ rejected: true, payload, socket: s });
    });
    s.on('disconnect', () => {
      clearTimeout(timer);
      resolve({ rejected: true, socket: s });
    });
  });
  check('анонимное подключение отклонено', anonymous.rejected === true);
  anonymous.socket?.close();

  console.log('\n3. Изменение статуса доходит событием, без перезагрузки');
  const list = await api('/api/v1/engagements?limit=50', admin);
  let targetCard = null;
  let targetTransition = null;

  for (const item of list.body.items) {
    const detail = await api(`/api/v1/engagements/${item.id}`, admin);
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

    const transition = await api(`/api/v1/engagements/${targetCard.body.id}/transition`, admin, {
      method: 'POST',
      headers: { 'If-Match': targetCard.etag },
      body: JSON.stringify({
        toStateKey: targetTransition.toStateKey,
        comment: 'Проверка канала обновлений',
      }),
    });
    check('переход выполнен', transition.status === 200, `${transition.status}`);

    const event = await eventPromise;
    check('событие получено', event !== null, event ? '' : 'событие не пришло за 10 с');

    if (event) {
      check('событие относится к нужной карточке', event.engagementId === targetCard.body.id);
      check(
        'в событии новый статус',
        event.toStateKey === targetTransition.toStateKey,
        event.toStateKey,
      );
      check('в событии указана версия', typeof event.version === 'number', String(event.version));
      check('в событии указан автор действия', Boolean(event.actorName), event.actorName);
      console.log(
        `       получено: ${event.toStateLabel} (версия ${event.version}), автор: ${event.actorName}`,
      );
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
