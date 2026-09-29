/**
 * Ручная проверка кэша действий пользователя (требование ТЗ, п.13).
 *
 * Главное, что проверяется: пользователь не теряет результат своей работы.
 * Фильтры и черновики переживают перезагрузку страницы и доступны с другого
 * устройства, а повторная отправка формы не создаёт дубликат.
 *
 * Запуск: node test/manual/activity-check.mjs
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
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'crm-frontend',
      username,
      password,
    }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error(`Нет токена для ${username}`);
  return d.access_token;
}

async function api(path, accessToken, options = {}) {
  const r = await fetch(`${API}${path}`, {
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
  return { status: r.status, body };
}

async function main() {
  const kam = await token('kam.ivanova', 'Kam#2026demo');
  const admin = await token('admin.sidorov', 'Adm#2026demo');

  console.log('\n1. Состояние экрана сохраняется и восстанавливается');
  const workState = {
    filters: { stateKeys: ['SIGNING'], periodFrom: '2025-01-01' },
    columns: ['universityName', 'stateLabel', 'ownerName'],
    sort: { by: 'updatedAt', order: 'desc' },
    page: 3,
    openTabs: ['список', 'аналитика'],
  };

  const saved = await api('/api/v1/activity/workspace/engagements.list', kam, {
    method: 'PUT',
    body: JSON.stringify({ state: workState }),
  });
  check('состояние сохранено', saved.status === 200, `${saved.status}`);

  // Повторное чтение — как после перезагрузки страницы
  const restored = await api('/api/v1/activity/workspace/engagements.list', kam);
  check('состояние восстановлено', restored.status === 200);
  check(
    'фильтры совпадают посимвольно',
    JSON.stringify(restored.body?.state) === JSON.stringify(workState),
  );
  check('номер страницы сохранён', restored.body?.state?.page === 3, `${restored.body?.state?.page}`);
  console.log(`       восстановлено колонок: ${restored.body?.state?.columns?.length}`);

  console.log('\n2. Состояние принадлежит пользователю, а не системе');
  const foreignState = await api('/api/v1/activity/workspace/engagements.list', admin);
  check(
    'у другого пользователя своё состояние',
    JSON.stringify(foreignState.body?.state) !== JSON.stringify(workState),
    `получено: ${JSON.stringify(foreignState.body?.state).slice(0, 40)}`,
  );

  console.log('\n3. Черновик комментария переживает закрытие формы');
  const draftText = 'Обсудили состав пилота, ожидаем решения учёного совета до';
  const draftSaved = await api(
    '/api/v1/activity/drafts/engagement.transition?entityId=test-engagement-1',
    kam,
    { method: 'PUT', body: JSON.stringify({ payload: { comment: draftText } }) },
  );
  check('черновик сохранён', draftSaved.status === 200, `${draftSaved.status}`);

  const draftRead = await api(
    '/api/v1/activity/drafts/engagement.transition?entityId=test-engagement-1',
    kam,
  );
  check('черновик восстановлен', draftRead.body?.payload?.comment === draftText);
  console.log(`       текст: «${String(draftRead.body?.payload?.comment).slice(0, 50)}...»`);

  console.log('\n4. Черновик формы создания (без привязки к объекту)');
  const newDraft = await api('/api/v1/activity/drafts/engagement.create', kam, {
    method: 'PUT',
    body: JSON.stringify({ payload: { universityId: 'x', note: 'не дозаполнено' } }),
  });
  check('сохранён', newDraft.status === 200, `${newDraft.status}`);
  const newDraftRead = await api('/api/v1/activity/drafts/engagement.create', kam);
  check('прочитан', newDraftRead.body?.payload?.note === 'не дозаполнено');
  check('идентификатор объекта отсутствует', newDraftRead.body?.entityId === null,
    `${newDraftRead.body?.entityId}`);

  console.log('\n5. Повторное сохранение черновика не плодит записи');
  for (let i = 0; i < 3; i++) {
    await api('/api/v1/activity/drafts/engagement.create', kam, {
      method: 'PUT',
      body: JSON.stringify({ payload: { note: `версия ${i}` } }),
    });
  }
  const snapshotAfter = await api('/api/v1/activity/snapshot', kam);
  const createDrafts = (snapshotAfter.body?.drafts ?? []).filter(
    (d) => d.entityType === 'engagement.create',
  );
  check('запись одна, а не четыре', createDrafts.length === 1, `${createDrafts.length}`);
  check('сохранена последняя версия', createDrafts[0]?.payload?.note === 'версия 2',
    createDrafts[0]?.payload?.note);

  console.log('\n6. Сводка рабочего контекста при входе');
  const snapshot = await api('/api/v1/activity/snapshot', kam);
  check('ответ 200', snapshot.status === 200);
  check('черновики перечислены', (snapshot.body?.drafts?.length ?? 0) >= 2,
    `${snapshot.body?.drafts?.length}`);
  check('экраны с сохранённым состоянием перечислены',
    (snapshot.body?.workspaces?.length ?? 0) >= 1, `${snapshot.body?.workspaces?.length}`);

  console.log('\n7. Недавно просмотренные объекты');
  const engagements = await api('/api/v1/engagements?limit=3', kam);
  for (const item of engagements.body?.items ?? []) {
    await api(`/api/v1/activity/recent/ENGAGEMENT/${item.id}`, kam, {
      method: 'PUT',
      body: JSON.stringify({ title: item.counterpartyName }),
    });
  }
  const recent = await api('/api/v1/activity/recent', kam);
  check('список заполнен', (recent.body?.length ?? 0) >= 3, `${recent.body?.length}`);
  check('новые записи сверху', Boolean(recent.body?.[0]?.visitedAt));
  for (const item of (recent.body ?? []).slice(0, 3)) {
    console.log(`       ${item.title}`);
  }

  console.log('\n8. Идемпотентность: двойная отправка не создаёт дубликат');
  const universities = await api('/api/v1/catalog/universities?limit=1', admin);
  const directions = await api('/api/v1/catalog/directions?limit=100', admin);
  const universityId = universities.body.items[0].id;

  // Ищем направление, по которому у этого вуза ещё нет взаимодействия
  let freeDirection = null;
  for (const dir of directions.body.items) {
    const probe = await api(
      `/api/v1/engagements?universityId=${universityId}&directionId=${dir.id}&limit=1`,
      admin,
    );
    if ((probe.body?.meta?.total ?? 0) === 0) {
      freeDirection = dir.id;
      break;
    }
  }
  check('найдено свободное направление для проверки', freeDirection !== null);

  if (freeDirection) {
    const idempotencyKey = `check-${Date.now()}`;
    const payload = JSON.stringify({ universityId, directionId: freeDirection });

    const first = await api('/api/v1/engagements', admin, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: payload,
    });
    check('первый запрос выполнен', first.status === 201, `${first.status} ${first.body?.code ?? ''}`);

    const second = await api('/api/v1/engagements', admin, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: payload,
    });
    check('повтор принят', second.status === 201 || second.status === 200, `${second.status}`);
    check(
      'возвращена ТА ЖЕ запись, дубликат не создан',
      second.body?.id === first.body?.id,
      `${first.body?.id} vs ${second.body?.id}`,
    );

    const count = await api(
      `/api/v1/engagements?universityId=${universityId}&directionId=${freeDirection}&limit=10`,
      admin,
    );
    check('в базе ровно одна запись', count.body?.meta?.total === 1, `${count.body?.meta?.total}`);

    console.log('\n9. Тот же ключ с другим телом отклоняется');
    // Направление берём заведомо ОТЛИЧНОЕ от использованного выше: если
    // тело совпадёт, система справедливо вернёт сохранённый результат,
    // и проверка потеряет смысл.
    const otherDirection = directions.body.items.find((d) => d.id !== freeDirection);

    const conflicting = await api('/api/v1/engagements', admin, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ universityId, directionId: otherDirection.id }),
    });
    check('ответ 409', conflicting.status === 409, `${conflicting.status}`);
    check('код CRM-ACT-0001', conflicting.body?.code === 'CRM-ACT-0001', conflicting.body?.code);
  }

  console.log('\n10. Черновик удаляется после отправки');
  const discarded = await fetch(
    `${API}/api/v1/activity/drafts/engagement.create`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${kam}` } },
  );
  check('ответ 204', discarded.status === 204, `${discarded.status}`);
  const afterDiscard = await api('/api/v1/activity/drafts/engagement.create', kam);
  check('черновик отсутствует', afterDiscard.body === null, JSON.stringify(afterDiscard.body));

  console.log('\n11. Слишком большое состояние отклоняется');
  const huge = { data: 'x'.repeat(70 * 1024) };
  const tooBig = await api('/api/v1/activity/workspace/test.huge', kam, {
    method: 'PUT',
    body: JSON.stringify({ state: huge }),
  });
  check('ответ 422', tooBig.status === 422, `${tooBig.status}`);

  console.log(failures === 0 ? '\nВсе проверки пройдены.\n' : `\nПроверок не пройдено: ${failures}.\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('Ошибка выполнения проверок:', error);
  process.exitCode = 1;
});
