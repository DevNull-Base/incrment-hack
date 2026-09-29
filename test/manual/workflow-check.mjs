/**
 * Ручная проверка взаимодействий и движка процессов.
 *
 * Проверяется то, что сложно увидеть глазами: ограничение видимости данных,
 * отклонение недопустимых переходов, обязательность комментария и защита
 * от конкурентного изменения статуса.
 *
 * Запуск (API и Keycloak должны быть подняты):
 *   node test/manual/workflow-check.mjs
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
      Authorization: `Bearer ${accessToken}`,
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
  return { status: response.status, body, etag: response.headers.get('etag') };
}

async function main() {
  const kam = await token('kam.ivanova', 'Kam#2026demo');
  const manager = await token('manager.petrov', 'Mgr#2026demo');
  const admin = await token('admin.sidorov', 'Adm#2026demo');

  console.log('\n1. Область видимости: администратор видит больше рядового менеджера');
  const asAdmin = await api('/api/v1/engagements?limit=1', admin);
  const asKam = await api('/api/v1/engagements?limit=1', kam);
  check('ответы 200', asAdmin.status === 200 && asKam.status === 200);
  check(
    'администратору доступно больше записей',
    asAdmin.body.meta.total > asKam.body.meta.total,
    `админ: ${asAdmin.body.meta.total}, КАМ: ${asKam.body.meta.total}`,
  );

  console.log('\n2. Руководитель видит записи подчинённых');
  const asManager = await api('/api/v1/engagements?limit=1', manager);
  check(
    'руководителю доступно больше, чем подчинённому',
    asManager.body.meta.total > asKam.body.meta.total,
    `руководитель: ${asManager.body.meta.total}, КАМ: ${asKam.body.meta.total}`,
  );

  console.log('\n3. Фильтрация по статусу и периоду');
  const filtered = await api('/api/v1/engagements?stateKey=SIGNING&limit=5', admin);
  check('ответ 200', filtered.status === 200);
  check(
    'все записи в запрошенном статусе',
    (filtered.body.items ?? []).every((item) => item.currentStateKey === 'SIGNING'),
    `получено ${filtered.body.items?.length ?? 0}`,
  );
  const byPeriod = await api(
    `/api/v1/engagements?periodFrom=2020-01-01&periodTo=2030-01-01&limit=1`,
    admin,
  );
  check('фильтр по периоду работает', byPeriod.status === 200 && byPeriod.body.meta.total > 0);

  console.log('\n4. Карточка взаимодействия отдаёт ETag и доступные переходы');
  const first = asAdmin.body.items[0];
  const card = await api(`/api/v1/engagements/${first.id}`, admin);
  check('ответ 200', card.status === 200);
  check('заголовок ETag присутствует', Boolean(card.etag), card.etag ?? 'отсутствует');
  check('история переходов заполнена', Array.isArray(card.body.history));
  console.log(`       вуз: ${card.body.universityName}`);
  console.log(`       статус: ${card.body.currentStateLabel} (версия ${card.body.version})`);
  console.log(`       записей в истории: ${card.body.history.length}`);
  for (const t of card.body.availableTransitions) {
    console.log(
      `       переход: ${t.label} -> ${t.toStateLabel}` +
        `${t.allowed ? '' : ` [недоступен: ${t.blockedReason}]`}`,
    );
  }

  console.log('\n5. Недопустимый переход отклоняется');
  const bogus = await api(`/api/v1/engagements/${first.id}/transition`, admin, {
    method: 'POST',
    body: JSON.stringify({ toStateKey: 'CONTACT_SEARCH' }),
  });
  const expectedCodes = ['CRM-WFL-0001', 'CRM-WFL-0002'];
  check(
    'переход отклонён с кодом из реестра',
    expectedCodes.includes(bogus.body?.code),
    `${bogus.status} ${bogus.body?.code}`,
  );
  if (bogus.body?.meta?.available) {
    console.log(`       допустимые переходы: ${bogus.body.meta.available.join(', ') || '(нет)'}`);
  }

  console.log('\n6. Поиск карточки, где переход возможен');
  const candidates = await api('/api/v1/engagements?limit=50', admin);
  let target = null;
  let targetCard = null;
  for (const item of candidates.body.items) {
    const detail = await api(`/api/v1/engagements/${item.id}`, admin);
    const usable = detail.body.availableTransitions?.find((t) => t.allowed && !t.requiresAttachment);
    if (usable) {
      target = usable;
      targetCard = detail;
      break;
    }
  }
  check('найдена карточка с доступным переходом', target !== null);

  if (target && targetCard) {
    console.log(
      `       карточка: ${targetCard.body.universityName}, ` +
        `${targetCard.body.currentStateLabel} -> ${target.toStateLabel}`,
    );

    if (target.requiresComment) {
      console.log('\n7. Переход без обязательного комментария отклоняется');
      const noComment = await api(`/api/v1/engagements/${targetCard.body.id}/transition`, admin, {
        method: 'POST',
        body: JSON.stringify({ toStateKey: target.toStateKey }),
      });
      check(
        'отклонён с кодом CRM-WFL-0002',
        noComment.body?.code === 'CRM-WFL-0002',
        `${noComment.status} ${noComment.body?.code}`,
      );
    } else {
      console.log('\n7. Переход не требует комментария — проверка пропущена');
    }

    console.log('\n8. Устаревший ETag отклоняется (защита от конкурентной перезаписи)');
    const stale = await api(`/api/v1/engagements/${targetCard.body.id}/transition`, admin, {
      method: 'POST',
      headers: { 'If-Match': 'W/"999999"' },
      body: JSON.stringify({ toStateKey: target.toStateKey, comment: 'Проверка версии' }),
    });
    check(
      'отклонён с кодом CRM-WFL-0005',
      stale.body?.code === 'CRM-WFL-0005',
      `${stale.status} ${stale.body?.code}`,
    );

    console.log('\n9. Корректный переход выполняется');
    const ok = await api(`/api/v1/engagements/${targetCard.body.id}/transition`, admin, {
      method: 'POST',
      headers: { 'If-Match': targetCard.etag },
      body: JSON.stringify({
        toStateKey: target.toStateKey,
        comment: 'Автоматическая проверка перехода',
      }),
    });
    check('ответ 200: переход — действие, а не создание ресурса', ok.status === 200, `получен ${ok.status} ${ok.body?.code ?? ''}`);
    check('статус изменён', ok.body?.currentStateKey === target.toStateKey, ok.body?.currentStateKey);
    check(
      'версия увеличена',
      ok.body?.version === targetCard.body.version + 1,
      `было ${targetCard.body.version}, стало ${ok.body?.version}`,
    );
    check(
      'запись добавлена в историю',
      ok.body?.history?.[0]?.comment === 'Автоматическая проверка перехода',
      ok.body?.history?.[0]?.comment,
    );

    console.log('\n10. Повтор с тем же ETag отклоняется (версия уже изменилась)');
    const replay = await api(`/api/v1/engagements/${targetCard.body.id}/transition`, admin, {
      method: 'POST',
      headers: { 'If-Match': targetCard.etag },
      body: JSON.stringify({ toStateKey: target.toStateKey, comment: 'Повтор' }),
    });
    check(
      'повтор отклонён',
      replay.body?.code === 'CRM-WFL-0005' || replay.body?.code === 'CRM-WFL-0001',
      replay.body?.code,
    );
  }

  console.log('\n11. Чужая карточка недоступна рядовому менеджеру');
  // Ищем именно ЧУЖУЮ запись: если взять первую попавшуюся, она может
  // принадлежать самому менеджеру, и проверка изоляции данных выродится
  // в проверку успешного чтения собственной карточки.
  const kamOwnList = await api('/api/v1/engagements?limit=200', kam);
  const kamOwnIds = new Set((kamOwnList.body.items ?? []).map((item) => item.id));
  const allList = await api('/api/v1/engagements?limit=200', admin);
  const foreignItem = (allList.body.items ?? []).find((item) => !kamOwnIds.has(item.id));

  check('найдена карточка другого ответственного', Boolean(foreignItem));

  if (foreignItem) {
    const foreign = await api(`/api/v1/engagements/${foreignItem.id}`, kam);
    check(
      'чужая карточка недоступна (404)',
      foreign.status === 404,
      `${foreign.status} ${foreign.body?.code ?? ''}`,
    );
    check(
      'ответ не раскрывает факт существования записи',
      foreign.body?.code === 'CRM-COM-0002',
      foreign.body?.code,
    );

    const foreignTransition = await api(`/api/v1/engagements/${foreignItem.id}/transition`, kam, {
      method: 'POST',
      body: JSON.stringify({ toStateKey: 'SIGNING', comment: 'Попытка чужого перехода' }),
    });
    check(
      'переход по чужой карточке невозможен',
      foreignTransition.status === 404 || foreignTransition.status === 403,
      `${foreignTransition.status} ${foreignTransition.body?.code ?? ''}`,
    );
  }


  console.log('\n12. Переназначение ответственного доступно только руководителю');
  const kamReassign = await api(`/api/v1/engagements/${first.id}/reassign`, kam, {
    method: 'POST',
    body: JSON.stringify({ ownerId: first.ownerId }),
  });
  check('КАМ получает 403', kamReassign.status === 403, `${kamReassign.status}`);

  console.log(failures === 0 ? '\nВсе проверки пройдены.\n' : `\nПроверок не пройдено: ${failures}.\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('Ошибка выполнения проверок:', error);
  process.exitCode = 1;
});
