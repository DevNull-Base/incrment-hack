/**
 * Ручная проверка: архив заявок, карточка вуза (ответственные и договоры)
 * и заявки из колонки «ФИО менеджера» при загрузке таблицы.
 *
 * Нужны API, worker (разбор импорта) и учётные записи из наполнения:
 * kam.ivanova и kam.orlov — подчинённые manager.petrov, admin.sidorov.
 * Данные синтетические, вузы заводятся с меткой прогона.
 *
 *   API_URL=http://localhost:3100 node test/manual/archive-university-check.mjs
 */
import ExcelJS from 'exceljs';

const API = process.env.API_URL ?? 'http://localhost:3000';
const KEYCLOAK = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'rtk-crm';
const RUN = String(Date.now()).slice(-6);

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
  const r = await fetch(`${API}/api/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body && typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
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
  return { status: r.status, body };
}

const json = (method, body) => ({ method, body: JSON.stringify(body ?? {}) });
const code = (response) => response.body?.code ?? response.body?.errors?.[0]?.code ?? '';

async function main() {
  const ivanova = await token('kam.ivanova', 'Kam#2026demo');
  const orlov = await token('kam.orlov', 'Kam#2026demo');
  const petrov = await token('manager.petrov', 'Mgr#2026demo');
  const admin = await token('admin.sidorov', 'Adm#2026demo');

  const me = async (t) => (await api('/auth/me', t)).body;
  const [ivanovaMe, orlovMe, petrovMe] = [await me(ivanova), await me(orlov), await me(petrov)];

  const directions = (await api('/catalog/directions?limit=100', admin)).body;
  const direction = (directions.items ?? directions)[0];

  const newUniversity = async (suffix) =>
    (await api('/catalog/universities', admin, json('POST', { name: `Проверочный вуз ${suffix} ${RUN}` }))).body;

  // ------------------------------------------------------------------ Архив --
  console.log('\nАрхив заявок');
  const uni = await newUniversity('архива');
  const created = await api(
    '/engagements',
    ivanova,
    json('POST', { segment: 'B2B', universityId: uni.id, directionId: direction.id }),
  );
  check('КАМ заводит заявку', created.status === 201, String(created.status));
  const eng = created.body;

  let r = await api(`/engagements/${eng.id}/archive`, ivanova, json('POST', {}));
  check('КАМ не отправляет в архив незавершённую заявку — 403', r.status === 403, `${r.status} ${code(r)}`);

  r = await api(`/engagements/${eng.id}/archive`, petrov, json('POST', {}));
  check('без причины незавершённую не архивирует и руководитель', r.status === 400 || r.status === 422, `${r.status}`);

  r = await api(`/engagements/${eng.id}/archive`, petrov, json('POST', { reason: 'Вуз свернул направление' }));
  check(
    'руководитель архивирует с причиной',
    r.status === 200 && r.body.isArchived && r.body.archiveReason === 'Вуз свернул направление' && r.body.archivedByName,
    `${r.status} ${r.body?.archivedByName}`,
  );

  r = await api(`/engagements/${eng.id}/archive`, petrov, json('POST', { reason: 'ещё раз' }));
  check('повторный вызов ничего не меняет', r.status === 200 && r.body.archiveReason === 'Вуз свернул направление');

  const target = r.body.availableTransitions?.find((item) => item.allowed)?.toStateKey ?? 'MEETING';
  r = await api(`/engagements/${eng.id}/transition`, ivanova, json('POST', { toStateKey: target, comment: 'проверка' }));
  check('переход по архивной — 409 ENGAGEMENT_ARCHIVED', r.status === 409 && /ENG-0002/.test(code(r)), `${r.status} ${code(r)}`);

  r = await api(`/engagements/${eng.id}`, ivanova, json('PATCH', { title: 'Новое название' }));
  check('правка архивной — 409', r.status === 409, String(r.status));

  r = await api(`/engagements/${eng.id}/notes`, ivanova, json('POST', { body: 'заметка в архиве' }));
  check('заметка к архивной — 409', r.status === 409, String(r.status));

  r = await api('/calendar/tasks', ivanova, json('POST', { title: 'Позвонить', dueDate: '2026-12-01', engagementId: eng.id }));
  check('задача по архивной — 409', r.status === 409, String(r.status));

  r = await api(`/engagements/${eng.id}/reassign`, petrov, json('POST', { ownerId: orlovMe.id }));
  check('переназначение архивной — 409', r.status === 409, String(r.status));

  r = await api(`/engagements?universityId=${uni.id}`, ivanova);
  check('в списке по умолчанию архивной нет', r.status === 200 && r.body.items.length === 0);
  r = await api(`/engagements?universityId=${uni.id}&includeArchived=true`, ivanova);
  check('с includeArchived — есть', r.status === 200 && r.body.items.length === 1);

  r = await api(`/engagements/${eng.id}/restore`, orlov, json('POST', {}));
  check('чужой КАМ вернуть не может — 404', r.status === 404, String(r.status));

  r = await api(`/engagements/${eng.id}/restore`, ivanova, json('POST', {}));
  check('ответственный возвращает из архива', r.status === 200 && !r.body.isArchived && r.body.archiveReason === null);

  r = await api(`/engagements/${eng.id}/notes`, ivanova, json('POST', { body: 'после возврата' }));
  check('после возврата заметка добавляется', r.status === 201, String(r.status));

  r = await api(`/engagements/${eng.id}/timeline?limit=50`, ivanova);
  const types = (r.body?.items ?? []).map((item) => item.type);
  check('в ленте — отправка в архив и возврат', types.includes('ENGAGEMENT_ARCHIVED') && types.includes('ENGAGEMENT_RESTORED'), types.join(','));

  // Завершённую заявку КАМ убирает в архив сам. Довести заявку до
  // конца быстрее всего отказом — его оформляет руководитель.
  const done = (
    await api('/engagements', ivanova, json('POST', { segment: 'B2B', universityId: uni.id, directionId: direction.id }))
  ).body;
  let detail = (await api(`/engagements/${done.id}`, petrov)).body;
  const finals = new Set(detail.stages.filter((stage) => stage.isFinal).map((stage) => stage.key));
  const visited = new Set([detail.currentStateKey]);

  for (let step = 0; step < 12 && !finals.has(detail.currentStateKey); step++) {
    const options = detail.availableTransitions.filter((item) => item.allowed && !item.requiresAttachment);
    const next = options.find((item) => finals.has(item.toStateKey)) ?? options.find((item) => !visited.has(item.toStateKey));
    if (!next) break;
    await api(`/engagements/${done.id}/transition`, petrov, json('POST', { toStateKey: next.toStateKey, comment: 'проверка архива' }));
    detail = (await api(`/engagements/${done.id}`, petrov)).body;
    visited.add(detail.currentStateKey);
  }

  if (finals.has(detail.currentStateKey)) {
    r = await api(`/engagements/${done.id}/archive`, ivanova, json('POST', {}));
    check('завершённую КАМ архивирует сам, без причины', r.status === 200 && r.body.isArchived, `${r.status} ${detail.currentStateLabel}`);
  } else {
    check('заявку удалось довести до завершения', false, detail.currentStateLabel);
  }

  // --------------------------------------------------- Ответственные вуза --
  console.log('\nОтветственные от вуза');
  const uni2 = await newUniversity('контактов');
  await api('/engagements', ivanova, json('POST', { segment: 'B2B', universityId: uni2.id, directionId: direction.id }));
  const email = `koshkina.${RUN}@example.ru`;

  r = await api(`/catalog/universities/${uni2.id}/contacts`, ivanova, json('POST', { fullName: 'кошкина  мария', phone: '8 (900) 111-22-33', role: 'Практика' }));
  check(
    'КАМ с открытой заявкой добавляет контакт; ФИО и телефон приведены',
    r.status === 201 && r.body.fullName === 'Кошкина Мария' && r.body.phone === '+79001112233' && r.body.isPrimary,
    `${r.status} ${r.body?.fullName} ${r.body?.phone}`,
  );
  const contactId = r.body.id;

  r = await api(`/catalog/universities/${uni2.id}/contacts`, orlov, json('POST', { fullName: 'Дроздов Павел' }));
  check('КАМ без заявки с вузом добавить не может — 403', r.status === 403, String(r.status));

  r = await api(`/catalog/universities/${uni2.id}/contacts`, orlov);
  check('читать ответственных может любой КАМ', r.status === 200 && r.body.length === 1);

  r = await api(`/catalog/universities/${uni2.id}/contacts`, ivanova, json('POST', { fullName: 'Кошкина Мария', email }));
  check('тот же человек с почтой дополняется, а не дублируется', r.status === 201 && r.body.id === contactId && r.body.email === email, `${r.status} ${r.body?.id === contactId}`);

  r = await api(`/catalog/universities/${uni2.id}/contacts`, ivanova, json('POST', { fullName: 'Кошкина Мария', email }));
  check('повтор без новых сведений — 409', r.status === 409, String(r.status));

  r = await api(`/catalog/universities/${uni2.id}/contacts`, ivanova, json('POST', { fullName: 'Другой Человек', email }));
  check('чужая почта — отказ без раскрытия владельца', (r.status === 400 || r.status === 422) && !JSON.stringify(r.body).includes('Кошкина'), String(r.status));

  r = await api(`/catalog/universities/${uni2.id}/contacts/${contactId}`, ivanova, json('PATCH', { phone: '+7 900 999-88-77' }));
  check('сохранённый телефон КАМ не переписывает — 403', r.status === 403, String(r.status));

  r = await api(`/catalog/universities/${uni2.id}/contacts/${contactId}`, ivanova, json('PATCH', { position: 'Проректор', role: 'Договоры' }));
  check('должность и роль КАМ меняет', r.status === 200 && r.body.position === 'Проректор' && r.body.role === 'Договоры');

  r = await api(`/catalog/universities/${uni2.id}/contacts/${contactId}`, petrov, json('PATCH', { phone: '+7 900 999-88-77' }));
  check('руководитель телефон исправляет', r.status === 200 && r.body.phone === '+79009998877');

  // Ограничение видимости по вузу закрывает и людей вуза.
  await api(`/admin/users/${orlovMe.id}/scope/UNIVERSITY`, admin, json('PUT', { allowedIds: [uni.id] }));
  r = await api(`/catalog/universities/${uni2.id}/contacts`, orlov);
  check('вуз вне ограничения видимости — 404', r.status === 404, String(r.status));
  await api(`/admin/users/${orlovMe.id}/scope/UNIVERSITY`, admin, { method: 'DELETE' });

  r = await api(`/catalog/universities/${uni2.id}/contacts/${contactId}`, ivanova, { method: 'DELETE' });
  check('убрать контакт КАМ не может — 403', r.status === 403, String(r.status));
  r = await api(`/catalog/universities/${uni2.id}/contacts/${contactId}`, petrov, { method: 'DELETE' });
  check('руководитель убирает контакт', r.status === 204, String(r.status));

  // ------------------------------------------- Заявки из «ФИО менеджера» --
  console.log('\nЗаявки из таблицы');
  const name = (n) => `Вуз загрузки ${n} ${RUN}`;
  const rows = [
    [name(1), 'ООО «ТДата»', `Продукт А ${RUN}`, `Д-${RUN}-1`, '01.09.2025', 2, 'Иванова А.С.', direction.name],
    [name(1), 'ООО «ТДата»', `Продукт А ${RUN}`, `Д-${RUN}-1`, '01.09.2025', 2, 'Орлов Дмитрий', direction.name],
    [name(2), 'ООО «ТДата»', `Продукт Б ${RUN}`, `Д-${RUN}-2`, '01.09.2024', 1, 'Петров Сергей', direction.name],
    [name(3), 'ООО «ТДата»', `Продукт Б ${RUN}`, `Д-${RUN}-3`, '', '', 'Неизвестный Человек', direction.name],
    [name(4), 'ООО «ТДата»', `Продукт Б ${RUN}`, `Д-${RUN}-4`, '', '', 'Сидоров Игорь', direction.name],
    [name(5), 'ООО «ТДата»', `Продукт Б ${RUN}`, `Д-${RUN}-5`, '', '', 'Иванова Анна', 'Несуществующее направление'],
  ];

  async function runImport(extra) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Лист1');
    sheet.addRow(['ВУЗ', 'Вендор', 'Продукт', 'Номер договора', 'Подписание лицензии', 'Срок действия лицензии', 'ФИО менеджера', 'Направление', 'Комментарий']);
    rows.forEach((row) => sheet.addRow([...row, extra]));
    const form = new FormData();
    form.append('file', new Blob([Buffer.from(await workbook.xlsx.writeBuffer())]), `менеджеры-${RUN}-${extra}.xlsx`);

    const job = (await api('/import', petrov, { method: 'POST', body: form })).body;
    let preview;
    for (let i = 0; i < 60; i++) {
      preview = (await api(`/import/${job.jobId}`, petrov)).body;
      if (preview.status === 'DRY_RUN_READY' || preview.status === 'FAILED') break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const applied = await api(`/import/${job.jobId}/apply`, petrov, { method: 'POST' });
    return { preview, applied: applied.body };
  }

  const first = await runImport('первая');
  const warned = (n) => first.preview.warnings.find((item) => item.rowNumber === n)?.message ?? '';
  check('сводка: заявок будет 4', first.preview.willCreate?.engagements === 4, JSON.stringify(first.preview.willCreate));
  check('сводка: вторая строка той же пары — «уже ведёт»', /уже ведёт Иванова Анна/.test(warned(3)), warned(3));
  check('сводка: неизвестный менеджер', /не найден/.test(warned(5)), warned(5));
  check('сводка: не подчинённый руководителя', /не в вашем подчинении/.test(warned(6)), warned(6));
  check('сводка: неизвестное направление', /Направления .* нет в каталоге/.test(warned(7)), warned(7));
  check('применение совпало со сводкой', first.applied.engagementsCreated === 4, JSON.stringify(first.applied));

  const owners = {};
  for (const n of [1, 2, 3, 4, 5]) {
    const found = (await api(`/catalog/universities?search=${encodeURIComponent(name(n))}`, admin)).body.items[0];
    const list = (await api(`/engagements?universityId=${found.id}`, admin)).body.items;
    owners[n] = { universityId: found.id, owners: list.map((item) => item.ownerId) };
  }
  check('вуз 1 — одна заявка у Ивановой', owners[1].owners.length === 1 && owners[1].owners[0] === ivanovaMe.id);
  check('вуз 2 — заявка у самого руководителя', owners[2].owners[0] === petrovMe.id);
  check('вуз 3 и 4 — заявка на загрузившего', owners[3].owners[0] === petrovMe.id && owners[4].owners[0] === petrovMe.id);
  check('вуз 5 — заявки нет', owners[5].owners.length === 0);

  r = await api(`/engagements?universityId=${owners[1].universityId}`, ivanova);
  check('Иванова видит свою заявку из таблицы', r.body.items.length === 1);
  const feed = (await api(`/engagements/${r.body.items[0].id}/timeline?limit=10`, ivanova)).body.items ?? [];
  check('в ленте — «загрузкой таблицы»', feed.some((item) => /Загрузкой таблицы/.test(item.summary ?? '')), feed.map((item) => item.summary).join(' | '));

  const second = await runImport('повтор');
  check('повторная загрузка заявок не дублирует', second.applied.engagementsCreated === 0 && second.preview.willCreate.engagements === 0, JSON.stringify(second.applied));

  // Договоры вуза с лицензиями.
  r = await api(`/catalog/universities/${owners[1].universityId}/contracts`, ivanova);
  const license = r.body?.[0]?.licenses?.[0];
  check(
    'договор вуза с лицензией: срок и действие',
    r.status === 200 && r.body[0].number === `Д-${RUN}-1` && license?.validUntil === '2027-09-01' && license.validity === 'ACTIVE' && license.vendorName,
    JSON.stringify(license),
  );
  r = await api(`/catalog/universities/${owners[2].universityId}/contracts`, ivanova);
  check('истёкшая лицензия помечена', r.body?.[0]?.licenses?.[0]?.validity === 'EXPIRED', JSON.stringify(r.body?.[0]?.licenses?.[0]));

  console.log(failures === 0 ? '\nВсе проверки пройдены.' : `\nСбоев: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
