/**
 * Проверка обмена с внешними системами по сети.
 *
 * В отличие от режима заглушек здесь проверяется именно обмен: CRM ходит
 * к имитатору по HTTP, имитатор вызывает CRM подписанным запросом, а
 * исходящие события доходят до обеих систем. Встроенные заглушки такого
 * не доказывают — они работают внутри процесса.
 *
 * Требуется: поднятый имитатор (docker compose --profile app up -d
 * mock-external), CRM с INTEGRATION_MODE=live и адресами источников,
 * указывающими на имитатор.
 *
 *   node test/manual/integration-live-check.mjs
 */

const API = process.env.API_URL ?? 'http://localhost:3000';
const LMS_MOCK = process.env.MOCK_LMS_URL ?? 'http://localhost:4010';
const SITE_MOCK = process.env.MOCK_SITE_URL ?? 'http://localhost:4011';
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

async function call(url, accessToken, options = {}) {
  const response = await fetch(url, {
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

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const admin = await token('admin.sidorov', 'Adm#2026demo');

  console.log('\n1. Имитатор отвечает и знает свои ручки');
  const lms = await call(`${LMS_MOCK}/`);
  const site = await call(`${SITE_MOCK}/`);
  check('имитатор LMS отвечает', lms.status === 200, lms.body?.system);
  check('имитатор сайта отвечает', site.status === 200, site.body?.system);

  console.log('\n2. Режим обмена и адреса источников');
  const sources = await call(`${API}/api/v1/integration/sources`, admin);
  const mode = sources.body?.[0]?.mode;
  check('включён боевой режим обмена', mode === 'live', `режим ${mode}`);
  const lmsSource = (sources.body ?? []).find((item) => item.type === 'LMS');
  check(
    'источник LMS указывает на имитатор',
    Boolean(lmsSource) && /4010/.test(lmsSource.baseUrl),
    lmsSource?.baseUrl,
  );

  console.log('\n3. CRM забирает события у имитатора по сети');
  await call(`${API}/api/v1/integration/sources/${lmsSource.id}/cursor`, admin, {
    method: 'DELETE',
  });
  const run = await call(`${API}/api/v1/integration/sources/${lmsSource.id}/sync`, admin, {
    method: 'POST',
  });
  check('синхронизация принята', run.status === 200 || run.status === 201, `статус ${run.status}`);

  await pause(6000);
  const runs = await call(`${API}/api/v1/integration/runs?sourceId=${lmsSource.id}`, admin);
  const last = (runs.body ?? [])[0];
  check('прогон завершён без ошибок', last?.status === 'SUCCESS', `статус ${last?.status}`);
  check('события получены', (last?.fetched ?? 0) > 0, `получено ${last?.fetched}`);
  console.log(
    `       получено ${last?.fetched}, создано ${last?.created}, ` +
      `обновлено ${last?.updated}, пропущено ${last?.skipped}`,
  );

  console.log('\n4. Два события одного обращения — одна заявка');
  // В наборе имитатора запись на обучение и её завершение имеют общий
  // идентификатор обращения. Заявка должна быть одна, а не две.
  const found = await call(
    `${API}/api/v1/engagements?segment=B2C&search=${encodeURIComponent('Сидорова')}&limit=10`,
    admin,
  );
  const matched = (found.body?.items ?? []).filter((item) =>
    item.counterpartyName.includes('Сидорова'),
  );
  check('заявка одна', matched.length === 1, `найдено ${matched.length}`);
  check(
    'состояние отражает завершение обучения',
    matched[0]?.currentStateKey === 'COMPLETED',
    matched[0]?.currentStateLabel,
  );

  if (matched[0]) {
    const card = await call(`${API}/api/v1/engagements/${matched[0].id}`, admin);
    const fromOutside = (card.body?.history ?? []).some((item) =>
      item.comment?.includes('внешней системы'),
    );
    check('в истории видно, что статус сменила внешняя система', fromOutside);
  }

  console.log('\n5. Имитатор сам вызывает CRM подписанным запросом');
  const emitted = await call(`${SITE_MOCK}/api/crm/emit`, null, { method: 'POST' });
  check('имитатор создал обращение', emitted.status === 200, `статус ${emitted.status}`);
  check(
    'CRM приняла вызов',
    emitted.body?.delivery?.status === 200 || emitted.body?.delivery?.status === 201,
    `ответ CRM ${emitted.body?.delivery?.status}: ${String(emitted.body?.delivery?.body).slice(0, 80)}`,
  );

  console.log('\n6. Исходящее направление: переход доходит до внешних систем');
  const beforeLms = await call(`${LMS_MOCK}/api/crm/received`);
  const beforeCount = beforeLms.body?.count ?? 0;

  const page = await call(`${API}/api/v1/engagements?segment=B2C&limit=20`, admin);
  let moved = false;

  for (const item of page.body?.items ?? []) {
    const card = await call(`${API}/api/v1/engagements/${item.id}`, admin);
    const allowed = (card.body?.availableTransitions ?? []).find((t) => t.allowed);

    if (allowed) {
      const result = await call(`${API}/api/v1/engagements/${item.id}/transition`, admin, {
        method: 'POST',
        body: JSON.stringify({
          toStateKey: allowed.toStateKey,
          comment: 'Проверка исходящего обмена',
        }),
      });
      moved = result.status === 200 || result.status === 201;
      console.log(`       ${card.body.counterpartyName}: ${card.body.currentStateLabel} -> ${allowed.toStateLabel}`);
      break;
    }
  }

  check('переход выполнен', moved);

  // Отправку выполняет фоновый процесс по расписанию.
  let delivered = false;
  for (let attempt = 0; attempt < 9 && !delivered; attempt++) {
    await pause(5000);
    const afterLms = await call(`${LMS_MOCK}/api/crm/received`);
    delivered = (afterLms.body?.count ?? 0) > beforeCount;

    if (delivered) {
      const message = afterLms.body.messages[afterLms.body.messages.length - 1].payload;
      check('имитатор LMS получил состояние заявки', true, `контракт ${message.contract}`);
      check('в сообщении есть ключи связи', Boolean(message.keys?.engagementId));
      check('в сообщении есть перечень вложений', Array.isArray(message.attachments));
    }
  }

  if (!delivered) {
    check('имитатор LMS получил состояние заявки', false, 'сообщение не дошло за 45 с');
  }

  console.log(`\nИтог: ${failures === 0 ? 'все проверки пройдены' : `сбоев — ${failures}`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('Ошибка проверки:', error);
  process.exitCode = 1;
});
