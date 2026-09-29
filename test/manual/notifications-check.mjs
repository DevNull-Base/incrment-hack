/**
 * Ручная проверка уведомлений и напоминаний о зависших заявках.
 *
 * Проверяется то, чего не видно в модульных тестах: правило простоя находит
 * реальные заявки, напоминание доходит и до ответственного, и до его
 * руководителя, повторный прогон дублей не создаёт, а неработающий внешний
 * канал не ломает доставку внутри системы.
 *
 * Запуск (API, Postgres, Redis и Keycloak должны быть подняты,
 * база наполнена `npm run db:seed`):
 *   node test/manual/notifications-check.mjs
 */

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
  if (!data.access_token) throw new Error(`Нет токена для ${username}: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function api(path, accessToken, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

async function main() {
  const admin = await token('admin.sidorov', 'Adm#2026demo');
  const kam = await token('kam.ivanova', 'Kam#2026demo');
  const manager = await token('manager.petrov', 'Mgr#2026demo');

  console.log('\n1. Правила уведомлений и состав каналов');
  const settings = await api('/api/v1/notifications/settings', admin);
  check('ответ 200', settings.status === 200, `получен ${settings.status}`);
  const channels = settings.body?.channels ?? [];
  check('заведены все четыре канала', channels.length === 4, `найдено ${channels.length}`);
  check(
    'внутрисистемный канал включён и готов',
    channels.find((item) => item.channel === 'IN_APP')?.isEnabled === true,
  );
  check(
    'внешние каналы выключены по умолчанию',
    channels.filter((item) => item.channel !== 'IN_APP').every((item) => !item.isEnabled),
  );
  console.log(`       порог простоя: ${settings.body?.escalationDays} дн.`);

  console.log('\n2. Порог простоя настраивается');
  const forbidden = await api('/api/v1/notifications/settings', kam, {
    method: 'PUT',
    body: JSON.stringify({ escalationDays: 3 }),
  });
  check('менеджеру правила менять нельзя', forbidden.status === 403, `получен ${forbidden.status}`);

  const updated = await api('/api/v1/notifications/settings', admin, {
    method: 'PUT',
    body: JSON.stringify({ escalationDays: 7 }),
  });
  check('администратор изменил порог', updated.body?.escalationDays === 7, `${updated.body?.escalationDays}`);

  const invalid = await api('/api/v1/notifications/settings', admin, {
    method: 'PUT',
    body: JSON.stringify({ escalationDays: 0 }),
  });
  // Проверка входных данных отвечает 422: запрос синтаксически верен,
  // но значение недопустимо.
  check('недопустимое значение отклонено', invalid.status === 422, `получен ${invalid.status}`);

  console.log('\n3. Напоминания о зависших заявках');
  const before = await api('/api/v1/notifications?limit=1', kam);
  const beforeTotal = before.body?.meta?.total ?? 0;

  const run = await api('/api/v1/notifications/escalation/run', admin, { method: 'POST' });
  check('прогон выполнен', run.status === 200 || run.status === 201, `статус ${run.status}`);
  check('найдены зависшие заявки', (run.body?.stale ?? 0) > 0, `заявок ${run.body?.stale}`);

  const after = await api('/api/v1/notifications?limit=5', kam);
  const afterTotal = after.body?.meta?.total ?? 0;

  // Проверка рассчитана и на повторный запуск: если напоминания уже
  // разосланы прошлым прогоном, новых не будет — важно, что они есть.
  check(
    'уведомления дошли до ответственного',
    afterTotal > 0,
    `всего ${afterTotal}, из них новых ${run.body?.notified}, было ${beforeTotal}`,
  );
  const sample = after.body?.items?.[0];
  if (sample) {
    console.log(`       «${sample.subject}»`);
    console.log(`       ${sample.body.slice(0, 120)}...`);
  }

  const managerInbox = await api('/api/v1/notifications?limit=5', manager);
  check(
    'руководитель тоже получил напоминание',
    (managerInbox.body?.meta?.total ?? 0) > 0,
    `уведомлений ${managerInbox.body?.meta?.total}`,
  );
  check(
    'текст руководителю называет ответственного',
    (managerInbox.body?.items ?? []).some((item) => item.subject.includes('подчинённого')),
  );

  console.log('\n4. Повторный прогон не создаёт дублей');
  const repeat = await api('/api/v1/notifications/escalation/run', admin, { method: 'POST' });
  check(
    'повторно ничего не отправлено',
    (repeat.body?.notified ?? -1) === 0,
    `отправлено ${repeat.body?.notified} при ${repeat.body?.stale} зависших`,
  );

  const afterRepeat = await api('/api/v1/notifications?limit=1', kam);
  check(
    'число уведомлений не изменилось',
    (afterRepeat.body?.meta?.total ?? 0) === afterTotal,
    `было ${afterTotal}, стало ${afterRepeat.body?.meta?.total}`,
  );

  console.log('\n5. Счётчик непрочитанных и отметка о прочтении');
  const unread = await api('/api/v1/notifications/unread-count', kam);
  check('счётчик больше нуля', (unread.body?.unread ?? 0) > 0, `непрочитанных ${unread.body?.unread}`);

  const first = (await api('/api/v1/notifications?limit=1&onlyUnread=true', kam)).body?.items?.[0];
  const foreign = await api(`/api/v1/notifications/${first.id}/read`, manager, { method: 'POST' });
  check('чужое уведомление отметить нельзя', foreign.status === 404, `получен ${foreign.status}`);

  const own = await api(`/api/v1/notifications/${first.id}/read`, kam, { method: 'POST' });
  check('своё отмечается прочитанным', own.status === 204, `получен ${own.status}`);

  // Повтор — обычное дело при двух открытых вкладках: операция идемпотентна.
  const again = await api(`/api/v1/notifications/${first.id}/read`, kam, { method: 'POST' });
  check('повторная отметка не считается ошибкой', again.status === 204, `получен ${again.status}`);

  const unreadAfter = await api('/api/v1/notifications/unread-count', kam);
  check(
    'счётчик уменьшился',
    (unreadAfter.body?.unread ?? 0) === (unread.body?.unread ?? 0) - 1,
    `${unread.body?.unread} → ${unreadAfter.body?.unread}`,
  );

  console.log('\n6. Внешний канал: настройка и проверка доставки');
  const configured = await api('/api/v1/notifications/settings/channels/TELEGRAM', admin, {
    method: 'PUT',
    body: JSON.stringify({
      isEnabled: true,
      settings: { botToken: '1234567:проверочный-токен', chatId: '-100500' },
    }),
  });
  check('канал настроен', configured.status === 200, `получен ${configured.status}`);
  check('канал считается готовым', configured.body?.ready === true);
  check(
    'токен наружу не отдаётся',
    configured.body?.settings?.botToken === '••••••',
    `${configured.body?.settings?.botToken}`,
  );

  const test = await api('/api/v1/notifications/settings/channels/TELEGRAM/test', admin, {
    method: 'POST',
  });
  check('проверка канала выполнена', test.status === 200 || test.status === 201, `статус ${test.status}`);
  // В закрытом контуре мессенджер недоступен, и это ожидаемый исход:
  // важно, что отказ объяснён, а не проглочен.
  check(
    'недоступность канала объяснена',
    test.body?.lastTestDelivered === false && Boolean(test.body?.lastTestDetail),
    test.body?.lastTestDetail ?? 'пояснения нет',
  );

  const outbound = await api('/api/v1/notifications?channel=TELEGRAM&limit=1', admin);
  check(
    'попытка доставки записана в журнал',
    (outbound.body?.meta?.total ?? 0) > 0,
    `записей ${outbound.body?.meta?.total}`,
  );

  console.log('\n7. Возврат настроек в исходное состояние');
  const restored = await api('/api/v1/notifications/settings/channels/TELEGRAM', admin, {
    method: 'PUT',
    body: JSON.stringify({ isEnabled: false, settings: { botToken: '' } }),
  });
  check('канал выключен', restored.body?.isEnabled === false);
  check(
    'пустое значение секрета сохранило прежний токен',
    restored.body?.settings?.botToken === '••••••',
    `${restored.body?.settings?.botToken}`,
  );

  await api('/api/v1/notifications/settings', admin, {
    method: 'PUT',
    body: JSON.stringify({ escalationDays: 14 }),
  });

  console.log(`\nИтог: ${failures === 0 ? 'все проверки пройдены' : `сбоев — ${failures}`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('Ошибка проверки:', error);
  process.exitCode = 1;
});
