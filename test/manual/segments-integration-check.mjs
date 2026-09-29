/**
 * Ручная проверка сегментов, редактора процессов и обмена с внешними системами.
 *
 * Проверяется то, что нельзя увидеть в интерфейсе и невозможно покрыть
 * модульным тестом без базы: публикация редакции процесса переводит все
 * текущие заявки, заявка из удалённого статуса переезжает на соседний
 * и получает запись в журнале переходов, обмен работает в обе стороны.
 *
 * Запуск (API, worker, Postgres, Redis и Keycloak должны быть подняты,
 * база наполнена `npm run db:seed`):
 *   node test/manual/segments-integration-check.mjs
 *
 * Аутентификация выполняется через Keycloak, поэтому проверка ролей имеет
 * смысл: при AUTH_DEV_BYPASS=true все запросы идут от администратора,
 * и отказ менеджеру проверить не получится.
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
      // Заголовок проставляется всем запросам намеренно: именно так ведут
      // себя клиентские библиотеки, и методы без тела обязаны это переживать.
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

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const admin = await token('admin.sidorov', 'Adm#2026demo');
  const kam = await token('kam.ivanova', 'Kam#2026demo');

  console.log('\n1. Сегменты заявок');
  const b2b = await api('/api/v1/engagements?segment=B2B&limit=1', admin);
  const b2c = await api('/api/v1/engagements?segment=B2C&limit=5', admin);
  check('оба сегмента отвечают 200', b2b.status === 200 && b2c.status === 200);
  check(
    'заявки прямых продаж существуют',
    (b2c.body.meta?.total ?? 0) > 0,
    `найдено ${b2c.body.meta?.total ?? 0}`,
  );
  check(
    'у заявки B2C нет вуза, но есть контрагент',
    (b2c.body.items ?? []).every((item) => item.universityId === null && item.counterpartyName),
  );
  check(
    'у заявки B2B контрагент — вуз',
    (b2b.body.items ?? []).every((item) => item.counterpartyType === 'UNIVERSITY'),
  );

  console.log('\n2. Действующие редакции процессов — по одной на сегмент');
  const templates = await api('/api/v1/workflow/templates', admin);
  check('ответ 200', templates.status === 200);
  const active = (templates.body ?? []).filter((item) => item.isActive && item.isDefault);
  check('действующих редакций ровно две', active.length === 2, `найдено ${active.length}`);
  for (const item of active) {
    console.log(
      `       ${item.segment}: ${item.name} (редакция ${item.version}, ` +
        `состояний ${item.stateCount}, заявок ${item.engagementCount})`,
    );
  }

  console.log('\n3. Правка действующей редакции запрещена');
  const b2cTemplate = active.find((item) => item.segment === 'B2C');
  const forbidden = await api(`/api/v1/workflow/templates/${b2cTemplate.id}`, admin, {
    method: 'PUT',
    body: JSON.stringify({ name: 'Попытка правки на ходу' }),
  });
  check('ответ 409', forbidden.status === 409, `получен ${forbidden.status}`);

  console.log('\n4. Черновик редакции без занятого промежуточного статуса');
  const full = await api(`/api/v1/workflow/templates/${b2cTemplate.id}`, admin);
  const definition = full.body.definition;

  // Статус для удаления подбирается по факту: важно, чтобы в нём стояли
  // заявки — иначе проверка переноса ничего бы не проверила.
  let victim = null;
  for (const state of definition.states) {
    if (state.isInitial || state.isFinal) continue;
    const occupied = await api(
      `/api/v1/engagements?segment=B2C&stateKey=${state.key}&limit=1`,
      admin,
    );
    if ((occupied.body.meta?.total ?? 0) > 0) {
      victim = { ...state, count: occupied.body.meta.total };
      break;
    }
  }
  check(
    'найден занятый промежуточный статус',
    Boolean(victim),
    victim ? `${victim.key}: заявок ${victim.count}` : 'нет',
  );
  if (!victim) {
    console.log('  Перенос проверить не на чем: промежуточные статусы пусты.');
    process.exitCode = 1;
    return;
  }

  // Переходы перестраиваются в обход удаляемого статуса: каждый входящий
  // связывается с каждым исходящим, иначе часть состояний станет
  // недостижимой и схема не пройдёт проверку.
  const incoming = definition.transitions.filter((item) => item.to === victim.key);
  const outgoing = definition.transitions.filter((item) => item.from === victim.key);
  const bridges = [];
  for (const from of incoming) {
    for (const to of outgoing) {
      if (from.from === to.to) continue;
      if (bridges.some((item) => item.from === from.from && item.to === to.to)) continue;
      bridges.push({
        from: from.from,
        to: to.to,
        label: `${from.label} (в обход)`,
        requiresComment: false,
        allowedRoles: [],
      });
    }
  }

  const withoutVictim = {
    states: definition.states.filter((state) => state.key !== victim.key),
    transitions: [
      ...definition.transitions.filter(
        (item) => item.from !== victim.key && item.to !== victim.key,
      ),
      ...bridges,
    ],
  };

  const draft = await api('/api/v1/workflow/templates', admin, {
    method: 'POST',
    body: JSON.stringify({
      key: b2cTemplate.key,
      segment: 'B2C',
      name: `Прямая работа с обучающимся (без статуса «${victim.label}»)`,
      description: 'Проверка переноса заявок при удалении занятого статуса',
      definition: withoutVictim,
    }),
  });
  check('черновик создан', draft.status === 201, `статус ${draft.status}`);
  check('черновик не действует', draft.body?.isActive === false);

  console.log('\n5. Предварительный просмотр публикации');
  const preview = await api(`/api/v1/workflow/templates/${draft.body.id}/publish/preview`, admin);
  check('ответ 200', preview.status === 200, `получен ${preview.status}`);
  const removed = (preview.body.removedStates ?? []).find((item) => item.key === victim.key);
  check('удаляемый статус показан', Boolean(removed));
  check(
    'посчитаны заявки в удаляемом статусе',
    removed?.engagementCount === victim.count,
    `${removed?.engagementCount} против ${victim.count}`,
  );
  check(
    'предложен соседний статус',
    Boolean(removed?.suggestedTarget),
    `предложено: ${removed?.suggestedTarget}`,
  );
  check('нерешённых вопросов нет', (preview.body.blockingIssues ?? []).length === 0);
  console.log(`       будет переведено на новую редакцию: ${preview.body.affectedEngagements}`);
  console.log(`       сменят статус: ${preview.body.relocatedEngagements}`);

  console.log('\n6. Публикация без подтверждения отклоняется');
  const unconfirmed = await api(`/api/v1/workflow/templates/${draft.body.id}/publish`, admin, {
    method: 'POST',
    body: JSON.stringify({ confirm: false }),
  });
  check('ответ 428', unconfirmed.status === 428, `получен ${unconfirmed.status}`);

  console.log('\n7. Публикация менеджером запрещена');
  const byKam = await api(`/api/v1/workflow/templates/${draft.body.id}/publish`, kam, {
    method: 'POST',
    body: JSON.stringify({ confirm: true }),
  });
  check('ответ 403', byKam.status === 403, `получен ${byKam.status}`);

  console.log('\n8. Публикация администратором');
  const published = await api(`/api/v1/workflow/templates/${draft.body.id}/publish`, admin, {
    method: 'POST',
    body: JSON.stringify({ confirm: true }),
  });
  check(
    'ответ 200 либо 201',
    published.status === 200 || published.status === 201,
    `статус ${published.status}`,
  );
  check(
    'заявки переведены на новую редакцию',
    published.body?.movedEngagements > 0,
    `переведено ${published.body?.movedEngagements}`,
  );
  check(
    'заявки из удалённого статуса перенесены',
    published.body?.relocatedEngagements === victim.count,
    `${published.body?.relocatedEngagements} против ${victim.count}`,
  );

  const afterPublish = await api(
    `/api/v1/engagements?segment=B2C&stateKey=${victim.key}&limit=1`,
    admin,
  );
  check(
    'в удалённом статусе не осталось заявок',
    (afterPublish.body.meta?.total ?? 0) === 0,
    `осталось ${afterPublish.body.meta?.total ?? 0}`,
  );

  const activeAfter = await api('/api/v1/workflow/templates?segment=B2C', admin);
  check(
    'действующая редакция в сегменте одна',
    (activeAfter.body ?? []).filter((item) => item.isActive).length === 1,
  );

  console.log('\n9. Перенос попал в журнал переходов заявки');
  const moved = await api(
    `/api/v1/engagements?segment=B2C&stateKey=${removed?.suggestedTarget}&limit=10`,
    admin,
  );
  let relocationFound = false;
  for (const item of moved.body.items ?? []) {
    const card = await api(`/api/v1/engagements/${item.id}`, admin);
    if ((card.body.history ?? []).some((entry) => entry.comment?.includes('статус удалён'))) {
      relocationFound = true;
      console.log(
        `       «${card.body.counterpartyName}» переехала в «${card.body.currentStateLabel}»`,
      );
      break;
    }
  }
  check('в истории есть запись о переносе при изменении схемы', relocationFound);

  console.log('\n10. Контракт обмена опубликован');
  const contract = await api('/api/v1/integration/contracts/engagement.v1', admin);
  check('ответ 200', contract.status === 200);
  check('схема отдана', Boolean(contract.body?.schema));
  check(
    'в примере есть ключи связи и вложения',
    Boolean(contract.body?.example?.keys) && Array.isArray(contract.body?.example?.attachments),
  );

  console.log('\n11. Входящее направление: синхронизация с внешними системами');
  const sources = await api('/api/v1/integration/sources', admin);
  check(
    'источники настроены',
    (sources.body ?? []).length >= 2,
    `найдено ${sources.body?.length ?? 0}`,
  );
  console.log(`       режим обмена: ${sources.body?.[0]?.mode}`);

  const before = await api('/api/v1/engagements?segment=B2C&limit=1', admin);
  const website = (sources.body ?? []).find((item) => item.type === 'WEBSITE');

  // Курсор сдвигается прошлыми прогонами, поэтому он сбрасывается: иначе
  // заглушка отдала бы пустой список и проверять было бы нечего.
  const reset = await api(`/api/v1/integration/sources/${website.id}/cursor`, admin, {
    method: 'DELETE',
  });
  check('курсор выборки сброшен', reset.status === 200, `статус ${reset.status}`);

  const run = await api(`/api/v1/integration/sources/${website.id}/sync`, admin, {
    method: 'POST',
  });
  check(
    'синхронизация принята при пустом теле запроса',
    run.status === 200 || run.status === 201,
    `статус ${run.status}`,
  );

  // Разбор выполняет обработчик очереди, поэтому результат появляется не сразу.
  await pause(4000);

  const runs = await api(`/api/v1/integration/runs?sourceId=${website.id}`, admin);
  const last = (runs.body ?? [])[0];
  check('прогон завершён без ошибок', last?.status === 'SUCCESS', `статус ${last?.status}`);
  check('события получены от внешней системы', (last?.fetched ?? 0) > 0, `получено ${last?.fetched}`);
  console.log(
    `       получено ${last?.fetched}, создано ${last?.created}, ` +
      `пропущено ${last?.skipped}, ошибок ${last?.failed}`,
  );

  const after = await api('/api/v1/engagements?segment=B2C&limit=1', admin);
  const beforeTotal = before.body.meta?.total ?? 0;
  const afterTotal = after.body.meta?.total ?? 0;

  // На чистой базе события применяются и заводят заявки; если они уже
  // применялись прежде, повторное чтение обязано их пропустить. Оба исхода
  // допустимы, недопустим третий — дубли.
  if ((last?.created ?? 0) > 0) {
    check(
      'новые события завели заявки',
      afterTotal === beforeTotal + last.created,
      `было ${beforeTotal}, стало ${afterTotal}, создано ${last.created}`,
    );
  } else {
    check(
      'уже применённые события пропущены, дублей нет',
      (last?.skipped ?? 0) > 0 && afterTotal === beforeTotal,
      `пропущено ${last?.skipped}, заявок было ${beforeTotal}, стало ${afterTotal}`,
    );
  }

  console.log('\n12. Повторное чтение тех же событий не создаёт дублей');
  await api(`/api/v1/integration/sources/${website.id}/cursor`, admin, { method: 'DELETE' });
  const repeat = await api(`/api/v1/integration/sources/${website.id}/sync`, admin, {
    method: 'POST',
  });
  check('повторный прогон принят', repeat.status === 200 || repeat.status === 201);
  await pause(4000);

  const repeatRuns = await api(`/api/v1/integration/runs?sourceId=${website.id}`, admin);
  const repeatRun = (repeatRuns.body ?? [])[0];
  check(
    'все события распознаны как уже применённые',
    (repeatRun?.skipped ?? 0) > 0 && (repeatRun?.created ?? 0) === 0,
    `пропущено ${repeatRun?.skipped}, создано ${repeatRun?.created}`,
  );

  const afterRepeat = await api('/api/v1/engagements?segment=B2C&limit=1', admin);
  check(
    'число заявок не изменилось',
    (afterRepeat.body.meta?.total ?? 0) === afterTotal,
    `было ${afterTotal}, стало ${afterRepeat.body.meta?.total}`,
  );

  console.log('\n13. Исходящее направление: переход порождает событие для внешних систем');
  const forTransition = (await api('/api/v1/engagements?segment=B2C&limit=1', admin)).body
    .items?.[0];
  const card = await api(`/api/v1/engagements/${forTransition.id}`, admin);
  const allowed = (card.body.availableTransitions ?? []).find((item) => item.allowed);

  if (allowed) {
    const transition = await api(`/api/v1/engagements/${forTransition.id}/transition`, admin, {
      method: 'POST',
      body: JSON.stringify({ toStateKey: allowed.toStateKey, comment: 'Проверка обмена' }),
    });
    check(
      'переход выполнен',
      transition.status === 200 || transition.status === 201,
      `статус ${transition.status}`,
    );
    console.log(
      `       «${card.body.counterpartyName}»: ${card.body.currentStateLabel} -> ${allowed.toStateLabel}`,
    );
    // Отправку выполняет фоновый процесс по расписанию; факт отправки виден
    // в журнале worker и по полю published_at в таблице outbox_event.
    await pause(6000);
    console.log('       событие ушло в очередь отправки, доставка — на стороне worker');
  } else {
    console.log('       доступных переходов нет, проверка пропущена');
  }

  console.log('\n14. Приём события внешней системы');
  const unsigned = await api('/api/v1/integration/website/events', null, {
    method: 'POST',
    body: JSON.stringify({
      contract: 'inbound.v1',
      event: 'request.created',
      externalId: `manual-${Date.now()}`,
      counterparty: { type: 'PERSON', name: 'Проверочный Пользователь' },
      directionCode: 'DEVOPS',
    }),
  });
  // При пустом INTEGRATION_WEBHOOK_SECRET подпись не проверяется — это
  // допустимо только вне боевого режима, поэтому ожидается либо приём
  // события, либо отказ по подписи.
  check(
    'событие принято либо отклонено по подписи',
    unsigned.status === 200 || unsigned.status === 201 || unsigned.status === 403,
    `статус ${unsigned.status}`,
  );

  console.log(`\nИтог: ${failures === 0 ? 'все проверки пройдены' : `сбоев — ${failures}`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('Ошибка проверки:', error);
  process.exitCode = 1;
});
