/**
 * Ручная проверка заметок, этапов, заинтересованности, ленты действий
 * и календаря задач.
 *
 * Сценарий идёт от лица настоящих ролей через Keycloak: менеджер ведёт
 * заявку, руководитель вмешивается, администратор правит процесс. Так
 * проверяется то, что не видно по отдельным маршрутам: права автора
 * заметки, привязка файла к этапу в условии перехода, поручения
 * руководителя и перенос заметок при публикации процесса.
 *
 * Запуск (API и Keycloak должны быть подняты):
 *   node test/manual/notes-calendar-check.mjs
 *
 * CHECK_PUBLISH=1 дополнительно публикует изменённый процесс прямых продаж
 * и возвращает прежний — только на проверочном стенде, не на рабочем.
 */

const API = process.env.API_URL ?? 'http://localhost:3000';
const KEYCLOAK = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'rtk-crm';
const CHECK_PUBLISH = process.env.CHECK_PUBLISH === '1';

/** Картинка 1×1: проходит проверку сигнатуры как png. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

let failures = 0;

function check(label, condition, detail = '') {
  if (!condition) failures++;
  console.log(`  [${condition ? 'OK  ' : 'СБОЙ'}] ${label}${detail ? ` — ${detail}` : ''}`);
}

async function token(username, password) {
  const response = await fetch(`${KEYCLOAK}/realms/${REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'crm-frontend', username, password }),
  });
  const data = await response.json();
  if (!data.access_token) throw new Error(`Нет токена для ${username}: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function api(path, accessToken, options = {}) {
  const response = await fetch(`${API}/api/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
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

const json = (method, body, headers = {}) => ({ method, body: JSON.stringify(body), headers });

async function upload(engagementId, accessToken, fileName, stateKey) {
  const form = new FormData();
  form.append('file', new Blob([PNG], { type: 'image/png' }), fileName);
  const query = stateKey ? `?stateKey=${stateKey}` : '';
  const response = await fetch(`${API}/api/v1/engagements/${engagementId}/attachments${query}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

/**
 * Кратчайший путь по схеме процесса от начального статуса до нужного.
 * Сценарий не полагается на базовый маршрут: на проверочном стенде
 * процесс могли переделать, и проверка должна идти по действующей схеме.
 */
function pathTo(definition, isTarget) {
  const initial = definition.states.find((state) => state.isInitial).key;
  const previous = new Map([[initial, null]]);
  const queue = [initial];

  while (queue.length > 0) {
    const key = queue.shift();
    if (isTarget(definition.states.find((state) => state.key === key))) {
      const path = [];
      for (let at = key; at !== null; at = previous.get(at)) path.unshift(at);
      return path;
    }
    for (const transition of definition.transitions) {
      const usable = transition.allowedRoles.length === 0 || transition.allowedRoles.includes('USER');
      if (transition.from === key && usable && !previous.has(transition.to)) {
        previous.set(transition.to, key);
        queue.push(transition.to);
      }
    }
  }
  return null;
}

async function activeDefinition(accessToken, segment) {
  const templates = await api(`/workflow/templates?segment=${segment}`, accessToken);
  return (await api(`/workflow/templates/${templates.body[0].id}`, accessToken)).body;
}

/** Переводит заявку по пути; комментарий передаётся всегда — он нигде не лишний. */
async function walk(engagementId, accessToken, path) {
  for (const to of path) {
    const card = await api(`/engagements/${engagementId}`, accessToken);
    if (card.body.currentStateKey === to) continue;
    const moved = await api(
      `/engagements/${engagementId}/transition`,
      accessToken,
      json('POST', { toStateKey: to, comment: 'Проверка' }, { 'If-Match': card.etag }),
    );
    if (moved.status >= 300) return moved;
  }
  return { status: 200 };
}

/** Дата в Москве со сдвигом на число дней: YYYY-MM-DD. */
function moscowDate(shiftDays = 0) {
  const date = new Date(Date.now() + shiftDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(date);
}

async function main() {
  const kam = await token('kam.ivanova', 'Kam#2026demo');
  const manager = await token('manager.petrov', 'Mgr#2026demo');
  const admin = await token('admin.sidorov', 'Adm#2026demo');

  const me = (await api('/auth/me', kam)).body;
  const managerMe = (await api('/auth/me', manager)).body;
  const adminMe = (await api('/auth/me', admin)).body;

  // -------------------------------------------------------------------------
  console.log('\n1. Карточка отдаёт этапы и заинтересованность');
  const list = await api(`/engagements?segment=B2B&ownerId=${me.id}&limit=50`, kam);
  const target = list.body.items.find(
    (item) => item.currentStateKey !== 'REJECTED' && item.currentStateKey !== 'SUPPORT',
  );
  check('у менеджера есть незавершённая заявка с вузом', Boolean(target));
  if (!target) return;

  const card = await api(`/engagements/${target.id}`, kam);
  check('карточка 200', card.status === 200);
  check('в строке списка есть interestLevel', 'interestLevel' in target);
  check(
    'этапы идут списком',
    Array.isArray(card.body.stages) && card.body.stages.length > 5,
    `этапов: ${card.body.stages?.length}`,
  );
  check(
    'ровно один этап текущий и он совпадает со статусом',
    card.body.stages.filter((stage) => stage.isCurrent).length === 1 &&
      card.body.stages.find((stage) => stage.isCurrent)?.key === card.body.currentStateKey,
  );

  // -------------------------------------------------------------------------
  console.log('\n2. Заметки к этапу и к заявке');
  const stageNote = await api(
    `/engagements/${target.id}/notes`,
    kam,
    json('POST', { body: 'Проверка: заметка к текущему этапу' }),
  );
  check('заметка создана', stageNote.status === 201, `код ${stageNote.status}`);
  check(
    'без stateKey заметка ложится на текущий этап',
    stageNote.body?.stateKey === card.body.currentStateKey,
  );

  const generalNote = await api(
    `/engagements/${target.id}/notes`,
    kam,
    json('POST', { body: 'Проверка: заметка ко всей заявке', stateKey: null }),
  );
  check(
    'stateKey = null — заметка ко всей заявке',
    generalNote.status === 201 && generalNote.body?.stateKey === null,
  );

  const pastStage = card.body.stages.find((stage) => !stage.isCurrent && !stage.isRemoved);
  const pastNote = await api(
    `/engagements/${target.id}/notes`,
    kam,
    json('POST', { body: 'Проверка: заметка к другому этапу', stateKey: pastStage.key }),
  );
  check(
    'заметку можно положить на другой этап процесса',
    pastNote.status === 201 && pastNote.body?.stateLabel === pastStage.label,
  );

  const badStage = await api(
    `/engagements/${target.id}/notes`,
    kam,
    json('POST', { body: 'x', stateKey: 'NO_SUCH_STAGE' }),
  );
  check(
    'несуществующий этап отклоняется',
    badStage.status === 422 && badStage.body?.code === 'CRM-ENG-0001',
    `${badStage.status} ${badStage.body?.code}`,
  );

  const empty = await api(`/engagements/${target.id}/notes`, kam, json('POST', { body: '   ' }));
  check('пустая заметка отклоняется', empty.status === 422 || empty.status === 400, `код ${empty.status}`);

  const foreignEdit = await api(
    `/engagements/${target.id}/notes/${stageNote.body.id}`,
    manager,
    json('PATCH', { body: 'чужая правка' }),
  );
  check(
    'руководитель не правит текст чужой заметки',
    foreignEdit.status === 403,
    `код ${foreignEdit.status}`,
  );

  const pin = await api(
    `/engagements/${target.id}/notes/${generalNote.body.id}`,
    manager,
    json('PATCH', { isPinned: true }),
  );
  check('закрепить может любой, кто видит карточку', pin.status === 200 && pin.body?.isPinned === true);

  const edit = await api(
    `/engagements/${target.id}/notes/${stageNote.body.id}`,
    kam,
    json('PATCH', { body: 'Проверка: текст исправлен' }),
  );
  check(
    'автор правит свою заметку, отметка правки ставится',
    edit.status === 200 && edit.body?.editedAt !== null,
  );

  const foreignDelete = await api(`/engagements/${target.id}/notes/${pastNote.body.id}`, manager, {
    method: 'DELETE',
  });
  check('руководитель не удаляет чужую заметку', foreignDelete.status === 403);

  const del = await api(`/engagements/${target.id}/notes/${pastNote.body.id}`, kam, { method: 'DELETE' });
  check('автор удаляет свою заметку', del.status === 204);

  const notes = await api(`/engagements/${target.id}/notes`, kam);
  check('удалённая заметка из списка пропала', !notes.body.some((note) => note.id === pastNote.body.id));
  check('закреплённая заметка первая', notes.body[0]?.id === generalNote.body.id);

  const onlyGeneral = await api(`/engagements/${target.id}/notes?general=true`, kam);
  check(
    'отбор general=true — только заметки ко всей заявке',
    onlyGeneral.body.every((note) => note.stateKey === null),
  );
  const falseGeneral = await api(`/engagements/${target.id}/notes?general=false`, kam);
  check('general=false не превращается в true', falseGeneral.body.length >= notes.body.length);

  const cardAfter = await api(`/engagements/${target.id}`, kam);
  const current = cardAfter.body.stages.find((stage) => stage.isCurrent);
  check('счётчик заметок текущего этапа вырос', current.noteCount >= 1, `заметок: ${current.noteCount}`);
  check('общий счётчик учитывает заметки ко всей заявке', cardAfter.body.noteCount >= 2);

  // -------------------------------------------------------------------------
  console.log('\n3. Заинтересованность');
  const rate = await api(
    `/engagements/${target.id}`,
    kam,
    json(
      'PATCH',
      { interestLevel: 'HIGH', interestComment: 'Кафедра готова к пилоту' },
      { 'If-Match': cardAfter.etag },
    ),
  );
  check(
    'оценка поставлена',
    rate.status === 200 && rate.body?.interestLevel === 'HIGH',
    `код ${rate.status}`,
  );
  check('версия выросла', rate.body?.version === cardAfter.body.version + 1);
  check('автор оценки записан', rate.body?.interestUpdatedByName === me.displayName);

  const stale = await api(
    `/engagements/${target.id}`,
    kam,
    json('PATCH', { interestLevel: 'LOW' }, { 'If-Match': cardAfter.etag }),
  );
  check(
    'правка по устаревшей версии отклоняется',
    stale.status === 409 && stale.body?.code === 'CRM-COM-0005',
    `${stale.status} ${stale.body?.code}`,
  );

  const reasonOnly = await api(
    `/engagements/${target.id}`,
    kam,
    json('PATCH', { interestLevel: null, interestComment: 'без оценки' }),
  );
  check('обоснование без оценки отклоняется', reasonOnly.status === 422, `код ${reasonOnly.status}`);

  const high = await api(`/engagements?interestLevels=HIGH&limit=200`, kam);
  check(
    'отбор HIGH находит заявку',
    high.body.items.some((item) => item.id === target.id),
  );
  const unset = await api(`/engagements?interestLevels=UNSET&limit=200`, kam);
  check('отбор UNSET её не содержит', !unset.body.items.some((item) => item.id === target.id));
  const both = await api(`/engagements?interestLevels=HIGH,UNSET&limit=1`, kam);
  check(
    'HIGH,UNSET — объединение',
    both.body.meta.total === high.body.meta.total + unset.body.meta.total,
    `${both.body.meta.total} = ${high.body.meta.total} + ${unset.body.meta.total}`,
  );

  const sorted = await api(`/engagements?sortBy=interestLevel&sortOrder=desc&limit=3`, kam);
  check('сортировка по оценке ставит HIGH первым', sorted.body.items[0]?.interestLevel === 'HIGH');

  const ranking = await api('/engagements/interest-summary?groupBy=direction', kam);
  const row = ranking.body?.rows?.find((item) => item.id === target.directionId);
  check(
    'рейтинг по направлениям считается',
    ranking.status === 200 && row && row.high >= 1 && row.score !== null,
    `индекс ${row?.score}`,
  );
  const byUniversity = await api('/engagements/interest-summary?groupBy=university', admin);
  check('рейтинг по вузам доступен', byUniversity.status === 200 && byUniversity.body.rows.length > 0);

  // -------------------------------------------------------------------------
  console.log('\n4. Файл относится к этапу: чужой этап не открывает переход');
  const directions = await api('/catalog/directions', kam);
  const directionId = (directions.body.items ?? directions.body)[0].id;
  const b2cProcess = await activeDefinition(kam, 'B2C');
  const guarded = pathTo(b2cProcess.definition, (state) => state.requiresAttachment && !state.isInitial);
  check(
    'в процессе прямых продаж есть этап с обязательным документом',
    Boolean(guarded),
    guarded?.join(' → '),
  );

  const created = await api(
    '/engagements',
    kam,
    json('POST', {
      segment: 'B2C',
      counterpartyType: 'COMPANY',
      counterpartyName: 'ООО «Проверка этапов»',
      directionId,
    }),
  );
  check('заявка прямой продажи создана', created.status === 201, `код ${created.status}`);
  const b2c = created.body.id;
  const [initialKey] = guarded;
  const guardedKey = guarded[guarded.length - 1];

  const early = await upload(b2c, kam, 'скан-начального-этапа.png');
  check(
    'без stateKey файл ложится на текущий этап',
    early.status === 201 && early.body?.stateKey === initialKey,
    `${early.status} ${early.body?.stateKey}`,
  );

  const reached = await walk(b2c, kam, guarded.slice(1));
  check(
    `заявка дошла до этапа ${guardedKey}`,
    reached.status < 300,
    `код ${reached.status} ${reached.body?.detail ?? ''}`,
  );

  const blockedCard = await api(`/engagements/${b2c}`, kam);
  const exit = blockedCard.body.availableTransitions.find((item) => item.toStateKey !== 'REJECTED');
  check(
    'в карточке выход с этапа недоступен с пояснением',
    exit?.allowed === false && /документ/.test(exit?.blockedReason ?? ''),
    exit?.blockedReason,
  );
  const blocked = await api(
    `/engagements/${b2c}/transition`,
    kam,
    json('POST', { toStateKey: exit.toStateKey, comment: 'Проверка' }, { 'If-Match': blockedCard.etag }),
  );
  check(
    'файл другого этапа не открывает выход',
    blocked.status === 422 && blocked.body?.code === 'CRM-WFL-0002',
    `${blocked.status} ${blocked.body?.code}`,
  );

  const wrongStage = await upload(b2c, kam, 'x.png', 'NO_SUCH_STAGE');
  check('загрузка на несуществующий этап отклоняется', wrongStage.status === 422);

  const proof = await upload(b2c, kam, 'подтверждение.png');
  check('документ приложен к текущему этапу', proof.status === 201 && proof.body?.stateKey === guardedKey);
  const exitCard = await api(`/engagements/${b2c}`, kam);
  const passed = await api(
    `/engagements/${b2c}/transition`,
    kam,
    json('POST', { toStateKey: exit.toStateKey, comment: 'Проверка' }, { 'If-Match': exitCard.etag }),
  );
  check('теперь переход проходит', passed.status < 300, `код ${passed.status} ${passed.body?.detail ?? ''}`);

  const stageFiles = await api(`/engagements/${b2c}/attachments?stateKey=${initialKey}`, kam);
  check(
    'отбор файлов по этапу',
    stageFiles.status === 200 &&
      stageFiles.body.length === 1 &&
      stageFiles.body[0].fileName === 'скан-начального-этапа.png',
  );

  // -------------------------------------------------------------------------
  console.log('\n5. Лента действий');
  const feed = await api('/activity/feed?limit=50', kam);
  const types = new Set(feed.body.items.map((item) => item.type));
  check('лента 200', feed.status === 200);
  for (const type of [
    'NOTE_ADDED',
    'NOTE_UPDATED',
    'NOTE_DELETED',
    'INTEREST_CHANGED',
    'ATTACHMENT_ADDED',
    'STATE_CHANGED',
    'ENGAGEMENT_CREATED',
  ]) {
    check(`в ленте есть ${type}`, types.has(type));
  }
  check(
    'в «моих действиях» нет чужих действий',
    feed.body.items.every((item) => item.actor?.id === me.id),
  );
  const interestItem = feed.body.items.find((item) => item.type === 'INTEREST_CHANGED');
  check(
    'у оценки есть подпись и обоснование',
    /высокая/.test(interestItem?.summary ?? '') && interestItem?.comment === 'Кафедра готова к пилоту',
    interestItem?.summary,
  );
  const deletedItem = feed.body.items.find((item) => item.type === 'NOTE_DELETED');
  check(
    'текст удалённой заметки в ленту не попадает',
    deletedItem?.note?.isDeleted === true && deletedItem?.note?.excerpt === null,
  );

  const onlyStates = await api('/activity/feed?types=STATE_CHANGED&limit=50', kam);
  check(
    'отбор по типу',
    onlyStates.body.items.every((item) => item.type === 'STATE_CHANGED'),
  );

  const recent = await api('/activity/engagements?days=14', kam);
  check(
    '«мои заявки за 14 дней» — последняя сверху',
    recent.status === 200 && recent.body[0]?.engagement.id === b2c,
    recent.body[0]?.engagement.counterpartyName,
  );
  check(
    'рядом с карточкой — последнее действие',
    typeof recent.body[0]?.lastActivity?.summary === 'string' && recent.body[0]?.actionCount > 1,
  );

  const timeline = await api(`/engagements/${target.id}/timeline?limit=50`, kam);
  check(
    'история заявки содержит действие руководителя',
    timeline.body.items.some((item) => item.actor?.id === managerMe.id && item.type === 'NOTE_UPDATED'),
  );
  const foreignTimeline = await api(
    `/engagements/${target.id}/timeline`,
    await token('kam.orlov', 'Kam#2026demo'),
  );
  check('чужая история недоступна', foreignTimeline.status === 404, `код ${foreignTimeline.status}`);

  // -------------------------------------------------------------------------
  console.log('\n6. Календарь задач');
  const tomorrow = moscowDate(1);
  const own = await api(
    '/calendar/tasks',
    kam,
    json('POST', { title: 'Позвонить на кафедру', dueDate: tomorrow, engagementId: target.id }),
  );
  check(
    'своя задача на день',
    own.status === 201 && own.body?.dueTime === null && own.body?.canEdit === true,
    `код ${own.status}`,
  );

  const timed = await api(
    '/calendar/tasks',
    kam,
    json('POST', {
      title: 'Встреча в МИФИ',
      dueDate: tomorrow,
      dueTime: '15:00',
      remindAt: new Date(Date.now() + 3_600_000).toISOString(),
    }),
  );
  check(
    'задача на время: момент считается в Москве',
    timed.status === 201 &&
      timed.body?.dueTime === '15:00' &&
      new Date(timed.body.dueAt).getUTCHours() === 12,
    timed.body?.dueAt,
  );

  const overdue = await api(
    '/calendar/tasks',
    kam,
    json('POST', { title: 'Просроченная', dueDate: moscowDate(-2) }),
  );
  check('задача в прошлом просрочена', overdue.status === 201 && overdue.body?.isOverdue === true);

  const badDate = await api('/calendar/tasks', kam, json('POST', { title: 'x', dueDate: '2026-02-30' }));
  check('несуществующая дата отклоняется', badDate.status === 422, `код ${badDate.status}`);
  const pastReminder = await api(
    '/calendar/tasks',
    kam,
    json('POST', { title: 'x', dueDate: tomorrow, remindAt: '2020-01-01T00:00:00Z' }),
  );
  check('напоминание в прошлом отклоняется', pastReminder.status === 422);

  const calendar = await api(`/calendar?from=${moscowDate(-3)}&to=${moscowDate(10)}`, kam);
  const calendarIds = new Set(calendar.body.items.map((item) => item.id));
  check('календарь содержит задачи', calendarIds.has(own.body.id) && calendarIds.has(timed.body.id));
  check('календарь отдаёт часовой пояс', calendar.body.timezone === 'Europe/Moscow');
  const sameDay = calendar.body.items.filter((item) => item.date === tomorrow && item.kind === 'TASK');
  check(
    'в пределах дня «на весь день» идёт раньше задач на время',
    sameDay.findIndex((item) => item.id === own.body.id) <
      sameDay.findIndex((item) => item.id === timed.body.id),
  );
  check(
    'в календаре есть сроки этапов',
    calendar.body.items.some((item) => item.kind === 'STAGE_DEADLINE'),
  );

  const wide = await api(`/calendar?from=2026-01-01&to=2026-12-31`, kam);
  check('год целиком — слишком широкий период', wide.status === 422);

  const overdueList = await api('/calendar/tasks?status=overdue', kam);
  check(
    'отбор просроченных',
    overdueList.body.items.some((item) => item.id === overdue.body.id) &&
      !overdueList.body.items.some((item) => item.id === own.body.id),
  );

  const reschedule = await api(`/calendar/tasks/${own.body.id}`, kam, json('PATCH', { dueTime: '10:30' }));
  check(
    'перенос на время',
    reschedule.status === 200 &&
      reschedule.body?.dueTime === '10:30' &&
      reschedule.body?.dueDate === tomorrow,
  );

  console.log('\n7. Поручения руководителя');
  const assigned = await api(
    '/calendar/tasks',
    manager,
    json('POST', { title: 'Подготовить отчёт по пилоту', dueDate: tomorrow, ownerId: me.id }),
  );
  check(
    'руководитель ставит задачу подчинённому',
    assigned.status === 201 && assigned.body?.isAssigned === true,
    `код ${assigned.status}`,
  );

  const notifications = await api('/notifications?limit=10', kam);
  check(
    'подчинённый получил уведомление',
    notifications.body.items.some((item) => item.entityId === assigned.body.id),
  );

  const kamEdit = await api(
    `/calendar/tasks/${assigned.body.id}`,
    kam,
    json('PATCH', { title: 'переписал' }),
  );
  check('исполнитель не правит поручение', kamEdit.status === 403);
  const kamDelete = await api(`/calendar/tasks/${assigned.body.id}`, kam, { method: 'DELETE' });
  check('и не удаляет его', kamDelete.status === 403);
  const done = await api(`/calendar/tasks/${assigned.body.id}/complete`, kam, { method: 'POST' });
  check('но отмечает выполненным', done.status === 200 && done.body?.isCompleted === true);
  const managerNotes = await api('/notifications?limit=10', manager);
  check(
    'руководитель узнал о выполнении',
    managerNotes.body.items.some(
      (item) => item.entityId === assigned.body.id && /выполнен/.test(item.subject),
    ),
  );

  const byMe = await api('/calendar/tasks?assignedByMe=true&status=all', manager);
  check(
    'руководитель видит поставленные им задачи',
    byMe.body.items.some((item) => item.id === assigned.body.id),
  );

  const toAdmin = await api(
    '/calendar/tasks',
    manager,
    json('POST', { title: 'x', dueDate: tomorrow, ownerId: adminMe.id }),
  );
  check(
    'руководитель не ставит задачи вне своего отдела',
    toAdmin.status === 403 && toAdmin.body?.code === 'CRM-ACL-0002',
    `${toAdmin.status} ${toAdmin.body?.code}`,
  );
  const kamAssign = await api(
    '/calendar/tasks',
    kam,
    json('POST', { title: 'x', dueDate: tomorrow, ownerId: managerMe.id }),
  );
  check('менеджер не ставит задачи другим', kamAssign.status === 403);

  const foreignTask = await api(`/calendar/tasks/${own.body.id}`, manager);
  check('чужая личная задача не видна', foreignTask.status === 404);

  const reopen = await api(`/calendar/tasks/${assigned.body.id}/reopen`, kam, { method: 'POST' });
  check('задачу можно вернуть в работу', reopen.status === 200 && reopen.body?.isCompleted === false);
  const removeOwn = await api(`/calendar/tasks/${overdue.body.id}`, kam, { method: 'DELETE' });
  check('свою задачу можно удалить', removeOwn.status === 204);

  const taskFeed = await api('/activity/feed?types=TASK_CREATED,TASK_COMPLETED,TASK_DELETED&limit=20', kam);
  check(
    'задачи попадают в ленту',
    taskFeed.body.items.some((item) => item.type === 'TASK_DELETED' && item.task?.isDeleted === true),
  );

  // -------------------------------------------------------------------------
  if (CHECK_PUBLISH) {
    console.log('\n8. Публикация процесса переносит заметки и файлы вместе с заявками');
    await publishCheck(kam, admin, directionId);
  }

  console.log(failures === 0 ? '\nВсе проверки пройдены.' : `\nСбоев: ${failures}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

/**
 * Удаляет из процесса прямых продаж этап «Предложение», проверяет, что
 * заметки и файлы стоящих в нём заявок переехали на соседний этап, и
 * возвращает прежнюю схему.
 */
async function publishCheck(kam, admin, directionId) {
  const active = await activeDefinition(admin, 'B2C');
  const original = active.definition;

  // Удаляется ближайший к началу промежуточный этап: у него есть и откуда
  // прийти, и куда уйти, поэтому схему без него можно сшить мостами.
  const path = pathTo(original, (state) => !state.isInitial && !state.isFinal);
  const removed = path[path.length - 1];
  const removedLabel = original.states.find((state) => state.key === removed).label;

  const created = await api(
    '/engagements',
    kam,
    json('POST', {
      segment: 'B2C',
      counterpartyType: 'PERSON',
      counterpartyName: 'Проверка Публикации',
      directionId,
    }),
  );
  const id = created.body.id;
  await walk(id, kam, path.slice(1));
  const note = await api(
    `/engagements/${id}/notes`,
    kam,
    json('POST', { body: 'Заметка на этапе, который удалят' }),
  );
  await upload(id, kam, 'удаляемый-этап.png');

  const predecessors = original.transitions.filter((t) => t.to === removed).map((t) => t.from);
  const successors = original.transitions.filter((t) => t.from === removed).map((t) => t.to);
  const transitions = original.transitions.filter((t) => t.from !== removed && t.to !== removed);
  for (const from of predecessors) {
    for (const to of successors) {
      if (from !== to && !transitions.some((t) => t.from === from && t.to === to)) {
        transitions.push({ from, to, label: 'Далее', requiresComment: false, allowedRoles: [] });
      }
    }
  }
  const trimmed = { states: original.states.filter((s) => s.key !== removed), transitions };

  const draft = await api(
    '/workflow/templates',
    admin,
    json('POST', { key: active.key, segment: 'B2C', name: `${active.name} (проверка)`, definition: trimmed }),
  );
  check(
    `черновик без этапа «${removedLabel}» создан`,
    draft.status === 201,
    `код ${draft.status} ${JSON.stringify(draft.body?.issues ?? '')}`,
  );

  const preview = await api(`/workflow/templates/${draft.body.id}/publish/preview`, admin);
  const gone = preview.body.removedStates.find((state) => state.key === removed);
  check(
    'просмотр считает заметки и файлы, которые переедут',
    gone?.noteCount >= 1 && gone?.attachmentCount >= 1,
    JSON.stringify(gone),
  );
  check(
    'итоговые числа переезда',
    preview.body.relocatedNotes >= 1 && preview.body.relocatedAttachments >= 1,
  );

  const target = preview.body.suggestedMapping[removed];
  const published = await api(
    `/workflow/templates/${draft.body.id}/publish`,
    admin,
    json('POST', { confirm: true }),
  );
  check(
    'публикация выполнена',
    published.status === 200 || published.status === 201,
    `код ${published.status}`,
  );

  const card = await api(`/engagements/${id}`, kam);
  check(
    'заявка перенесена на соседний этап',
    card.body.currentStateKey === target,
    card.body.currentStateKey,
  );
  const moved = await api(`/engagements/${id}/notes`, kam);
  const movedNote = moved.body.find((item) => item.id === note.body.id);
  check(
    'заметка переехала вместе с заявкой, подпись этапа прежняя',
    movedNote?.stateKey === target && movedNote?.stateLabel === removedLabel,
    `${movedNote?.stateKey} / ${movedNote?.stateLabel}`,
  );
  const files = await api(`/engagements/${id}/attachments?stateKey=${target}`, kam);
  check(
    'файл переехал вместе с заявкой',
    files.body.some((file) => file.fileName === 'удаляемый-этап.png'),
  );
  const history = await api(`/engagements/${id}/timeline?types=STATE_CHANGED`, kam);
  check(
    'перенос виден в истории как перенос при изменении процесса',
    history.body.items[0]?.source === 'WORKFLOW',
    history.body.items[0]?.title,
  );

  // Возврат прежней схемы: удалённый этап снова появляется.
  const restore = await api(
    '/workflow/templates',
    admin,
    json('POST', { key: active.key, segment: 'B2C', name: active.name, definition: original }),
  );
  const restored = await api(
    `/workflow/templates/${restore.body.id}/publish`,
    admin,
    json('POST', { confirm: true }),
  );
  check(
    'прежняя схема возвращена',
    restored.status === 200 || restored.status === 201,
    `код ${restored.status}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
