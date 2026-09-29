/**
 * Ручная проверка разграничения доступа на настоящих объектах.
 *
 * Сканеры проверяют доступ к чужим объектам, подставляя придуманные
 * идентификаторы (1, 999, 0000…0001), — такой запрос отвечает 404 и тогда,
 * когда проверки владения нет вовсе. Здесь идентификаторы настоящие: менеджер
 * kam.ivanova обращается к заявкам, заметкам, задачам и уведомлениям
 * менеджера kam.orlov, а затем — к функциям руководителя и администратора.
 *
 *   API_URL=http://localhost:3100 node test/manual/access-check.mjs
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
  const r = await fetch(`${KEYCLOAK}/realms/${REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'crm-frontend', username, password }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error(`Нет токена для ${username}`);
  return d.access_token;
}

async function api(path, accessToken, options = {}) {
  const r = await fetch(`${API}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  const text = await r.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: r.status, body, headers: r.headers };
}

const json = (method, body) => ({ method, body: JSON.stringify(body) });

async function main() {
  const ivanova = await token('kam.ivanova', 'Kam#2026demo');
  const orlov = await token('kam.orlov', 'Kam#2026demo');
  const admin = await token('admin.sidorov', 'Adm#2026demo');

  const orlovMe = (await api('/api/v1/auth/me', orlov)).body;
  const ivanovaMe = (await api('/api/v1/auth/me', ivanova)).body;

  // Объекты kam.orlov — получены им самим.
  const orlovEngagements = (await api('/api/v1/engagements?limit=50', orlov)).body?.items ?? [];
  const foreign = orlovEngagements.find((item) => item.ownerId === orlovMe.id);
  if (!foreign) throw new Error('У kam.orlov нет заявок — нечего проверять');

  const note = await api(`/api/v1/engagements/${foreign.id}/notes`, orlov, json('POST', { body: 'Заметка для проверки доступа' }));
  const task = await api('/api/v1/calendar/tasks', orlov, json('POST', { title: 'Задача для проверки доступа', dueDate: new Date().toISOString().slice(0, 10) }));
  const notifications = (await api('/api/v1/notifications?limit=5', orlov)).body?.items ?? [];

  console.log(`\n1. Чужая заявка ${foreign.id.slice(0, 8)}… (владелец — kam.orlov)`);
  check('карточка — 404', (await api(`/api/v1/engagements/${foreign.id}`, ivanova)).status === 404);
  check('правка — 404', (await api(`/api/v1/engagements/${foreign.id}`, ivanova, json('PATCH', { title: 'взлом' }))).status === 404);
  const transitions = (await api(`/api/v1/engagements/${foreign.id}`, orlov)).body?.availableTransitions ?? [];
  const target = transitions[0]?.toStateKey ?? 'REJECTED';
  check('переход — 404', (await api(`/api/v1/engagements/${foreign.id}/transition`, ivanova, json('POST', { toStateKey: target, comment: 'взлом' }))).status === 404);
  const reassign = await api(`/api/v1/engagements/${foreign.id}/reassign`, ivanova, json('POST', { ownerId: ivanovaMe.id }));
  check('переназначение на себя — отказ', [403, 404].includes(reassign.status), String(reassign.status));
  check('история — 404', (await api(`/api/v1/engagements/${foreign.id}/timeline`, ivanova)).status === 404);
  check('заметки — 404', (await api(`/api/v1/engagements/${foreign.id}/notes`, ivanova)).status === 404);
  check('новая заметка — 404', (await api(`/api/v1/engagements/${foreign.id}/notes`, ivanova, json('POST', { body: 'взлом' }))).status === 404);
  if (note.status === 201) {
    check('правка чужой заметки — 404', (await api(`/api/v1/engagements/${foreign.id}/notes/${note.body.id}`, ivanova, json('PATCH', { body: 'взлом' }))).status === 404);
    check('удаление чужой заметки — 404', (await api(`/api/v1/engagements/${foreign.id}/notes/${note.body.id}`, ivanova, { method: 'DELETE' })).status === 404);
  }
  check('файлы — 404', (await api(`/api/v1/engagements/${foreign.id}/attachments`, ivanova)).status === 404);
  check('контакт — 404', (await api(`/api/v1/engagements/${foreign.id}/contact`, ivanova)).status === 404);
  check(
    'дописать контакт — 404',
    (await api(`/api/v1/engagements/${foreign.id}/contact`, ivanova, json('PATCH', { email: 'x@example.ru' }))).status === 404,
  );
  const linked = await api('/api/v1/calendar/tasks', ivanova, json('POST', { title: 'x', dueDate: new Date().toISOString().slice(0, 10), engagementId: foreign.id }));
  check('задача к чужой заявке — отказ', [403, 404, 422].includes(linked.status), String(linked.status));
  const filtered = await api(`/api/v1/engagements?ownerId=${orlovMe.id}`, ivanova);
  check('отбор по чужому ответственному — пусто', filtered.body?.meta?.total === 0, `total=${filtered.body?.meta?.total}`);
  const lms = await api('/api/v1/integration/lms/export', ivanova, json('POST', { engagementIds: [foreign.id], includeExported: true }));
  check('выгрузка чужой заявки в LMS — выгружать некого', lms.status === 422, String(lms.status));
  const report = await api('/api/v1/reports', ivanova, json('POST', { columns: ['universityName', 'stateLabel'], format: 'CSV', filters: { ownerIds: [orlovMe.id] } }));
  check('отчёт по чужому ответственному — ноль строк', report.status === 200 && report.headers.get('x-report-rows') === '0', `${report.status} rows=${report.headers.get('x-report-rows')}`);

  console.log('\n2. Чужие задача и уведомление');
  if (task.status === 201) {
    check('задача — 404', (await api(`/api/v1/calendar/tasks/${task.body.id}`, ivanova)).status === 404);
    check('правка задачи — 404', (await api(`/api/v1/calendar/tasks/${task.body.id}`, ivanova, json('PATCH', { title: 'взлом' }))).status === 404);
    check('выполнение задачи — 404', (await api(`/api/v1/calendar/tasks/${task.body.id}/complete`, ivanova, { method: 'POST' })).status === 404);
    check('удаление задачи — 404', (await api(`/api/v1/calendar/tasks/${task.body.id}`, ivanova, { method: 'DELETE' })).status === 404);
  }
  if (notifications[0]) {
    check('отметка чужого уведомления — 404', (await api(`/api/v1/notifications/${notifications[0].id}/read`, ivanova, { method: 'POST' })).status === 404);
  }

  console.log('\n3. Функции руководителя и администратора — от имени менеджера');
  const privileged = [
    ['GET', '/api/v1/persons'],
    ['GET', '/api/v1/admin/users'],
    ['PATCH', `/api/v1/admin/users/${ivanovaMe.id}/role`, { role: 'ADMIN', reason: 'взлом' }],
    ['GET', '/api/v1/audit'],
    ['GET', '/api/v1/notifications/settings'],
    ['PUT', '/api/v1/notifications/settings', { escalationDays: 1 }],
    ['POST', '/api/v1/catalog/vendors', { name: 'Взлом' }],
    ['POST', '/api/v1/catalog/universities', { name: 'Взлом' }],
    ['POST', '/api/v1/workflow/templates', { name: 'x' }],
    ['POST', '/api/v1/catalog/vendors/import', {}],
    ['POST', '/api/v1/integration/payments/import', {}],
    ['POST', '/api/v1/notifications/escalation/run', {}],
  ];
  for (const [method, path, body] of privileged) {
    const r = await api(path, ivanova, body ? json(method, body) : { method });
    check(`${method} ${path.replace(/\/[0-9a-f-]{36}/, '/{id}')} — 403`, r.status === 403, String(r.status));
  }

  const me = await api('/api/v1/auth/me', ivanova);
  check('роль менеджера не изменилась', me.body?.role === 'USER', me.body?.role);

  // Уборка: объекты проверки удаляет их владелец.
  if (task.status === 201) await api(`/api/v1/calendar/tasks/${task.body.id}`, orlov, { method: 'DELETE' });
  if (note.status === 201) await api(`/api/v1/engagements/${foreign.id}/notes/${note.body.id}`, orlov, { method: 'DELETE' });
  void admin;

  console.log(failures === 0 ? '\nВсе проверки пройдены.' : `\nСбоев: ${failures}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
