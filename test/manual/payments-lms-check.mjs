/**
 * Ручная проверка пути «оплата с сайта → выгрузка в LMS».
 *
 * Оплаты синтетические, но устроены как образец заказчика: русские ключи,
 * пустой элемент, телефон строкой со скобками, номер заказа с 17-м месяцем
 * и с лишней цифрой, ФИО заглавными, курс с опечаткой. Проверяется:
 *   • подпись вызова сайта и отказ без неё;
 *   • итог по каждой записи и идемпотентность повторной доставки;
 *   • оплата по уже открытой заявке (обращение с сайта) — без второй заявки;
 *   • предварительный просмотр загрузки файла ничего не записывает;
 *   • загрузка оплат таблицей;
 *   • кандидаты и файл загрузки в LMS, отметка о выгрузке и повтор;
 *   • переход «Оплата подтверждена» без приложенного документа.
 *
 *   API_URL=http://localhost:3100 INTEGRATION_WEBHOOK_SECRET=… node test/manual/payments-lms-check.mjs
 */
import { createHmac } from 'node:crypto';
import ExcelJS from 'exceljs';

const API = process.env.API_URL ?? 'http://localhost:3000';
const KEYCLOAK = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'rtk-crm';
const SECRET = process.env.INTEGRATION_WEBHOOK_SECRET ?? '';
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
  const r = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers ?? {}),
    },
  });
  const buffer = Buffer.from(await r.arrayBuffer());
  let body = null;
  const type = r.headers.get('content-type') ?? '';
  if (type.includes('json')) body = JSON.parse(buffer.toString('utf8'));
  else body = buffer;
  return { status: r.status, body, headers: r.headers };
}

function signed(payload) {
  const raw = JSON.stringify(payload);
  const signature = createHmac('sha256', SECRET).update(raw).digest('hex');
  return { raw, headers: SECRET ? { 'x-signature': signature } : {} };
}

async function postWebhook(path, payload) {
  const { raw, headers } = signed(payload);
  return api(path, null, { method: 'POST', body: raw, headers });
}

function upload(fileName, content, type) {
  const form = new FormData();
  form.append('file', new Blob([content], { type }), fileName);
  return form;
}

/** Телефон, уникальный для прогона: 7 (9XX) … */
function phone(prefix, tail) {
  return `7 (${prefix}) ${RUN.slice(0, 3)}-${RUN.slice(3, 5)}-${RUN.slice(5, 6)}${tail}`;
}

async function main() {
  const manager = await token('manager.petrov', 'Mgr#2026demo');
  const kam = await token('kam.ivanova', 'Kam#2026demo');

  // ------------------------------------------------ Обращение до оплаты --
  console.log('\n1. Обращение с сайта до оплаты');
  const leadEmail = `lead.${RUN}@example.ru`;
  const lead = await postWebhook('/api/v1/integration/website/events', {
    contract: 'inbound.v1',
    event: 'request.created',
    externalId: `site-form-${RUN}`,
    caseId: `site-case-${RUN}`,
    occurredAt: new Date().toISOString(),
    counterparty: { type: 'PERSON', name: `Лидова Мария Павловна`, email: leadEmail },
    directionCode: 'QA',
  });
  check('обращение принято', lead.status === 200 && lead.body?.outcome === 'created', JSON.stringify(lead.body));

  // --------------------------------------------------- Оплаты с сайта --
  console.log('\n2. Оплаты с сайта');
  const orders = {
    plain: `ORD-20260912101500-A${RUN}`,
    badDate: `ORD-20261721184559-B${RUN}`,
    extraDigit: `ORD-202605130654453-C${RUN}`,
    second: `ORD-20260914120000-D${RUN}`,
    lead: `ORD-20260915090000-L${RUN}`,
  };
  const email = `payer.${RUN}@example.ru`;

  const batch = [
    null,
    { 'Номер заявки': orders.plain, Курс: 'Инженер-тестировщик', Фамилия: 'Кравец', Имя: 'Павел', Отчество: 'Юрьевич', Телефон: phone('901', '1'), Email: email, 'Номер потока': 3 },
    { 'Номер заявки': orders.badDate, Курс: 'инженер тестировшик', Фамилия: 'ЛОПАТИНА', Имя: 'ЕЛЕНА', Отчество: 'ИГОРЕВНА', Телефон: phone('902', '2'), Email: `lopatina.${RUN}@example.ru`, 'Номер потока': 3 },
    { 'Номер заявки': orders.extraDigit, Курс: 'Промпт-инжиниринг', Фамилия: 'Рябов', Имя: 'Остап', Отчество: 'Ильич', Телефон: phone('903', '3'), Email: null, 'Номер потока': 1 },
    { 'Номер заявки': `ORD-20260912101500-X${RUN}`, Курс: 'Кулинария для начинающих', Фамилия: 'Неизвестный', Имя: 'Курс', Телефон: phone('904', '4') },
    { 'Номер заявки': orders.plain, Курс: 'Инженер-тестировщик', Фамилия: 'Кравец', Имя: 'Павел', Телефон: phone('901', '1') },
    { 'Номер заявки': `ORD-20260912101500-Y${RUN}`, Курс: 'Промпт-инжиниринг', Фамилия: 'Безконтактов', Имя: 'Игорь' },
    { 'Номер заявки': orders.second, Курс: 'Промпт-инжиниринг', Фамилия: 'Кравец', Имя: 'Павел', Отчество: 'Юрьевич', Телефон: phone('901', '1'), Email: email.toUpperCase(), 'Номер потока': '2 поток' },
    { 'Номер заявки': orders.lead, Курс: 'Инженер-тестировщик', Фамилия: 'Лидова', Имя: 'Мария', Отчество: 'Павловна', Email: leadEmail, 'Номер потока': 3 },
  ];

  const unsigned = await api('/api/v1/integration/website/payments', null, {
    method: 'POST',
    body: JSON.stringify(batch),
    headers: { 'x-signature': 'deadbeef' },
  });
  check('вызов с неверной подписью отклонён', unsigned.status === 403, String(unsigned.status));

  const first = await postWebhook('/api/v1/integration/website/payments', batch);
  check('оплаты приняты', first.status === 200, String(first.status));
  const byPos = new Map((first.body?.items ?? []).map((item) => [item.position, item]));
  const outcome = (position) => byPos.get(position)?.outcome;

  check('пустой элемент отклонён', outcome(1) === 'REJECTED' && byPos.get(1)?.errors[0] === 'Пустая запись');
  check('обычная оплата — новая заявка', outcome(2) === 'CREATED', JSON.stringify(byPos.get(2)));
  check(
    '17-й месяц и опечатка в курсе — приняты с предупреждениями',
    outcome(3) === 'CREATED' &&
      byPos.get(3)?.warnings.some((w) => w.includes('некорректная дата')) &&
      byPos.get(3)?.warnings.some((w) => w.includes('по сходству')),
    JSON.stringify(byPos.get(3)?.warnings),
  );
  check('ФИО заглавными приведено', byPos.get(3)?.fullName === 'Лопатина Елена Игоревна', byPos.get(3)?.fullName);
  check(
    'лишняя цифра и нет почты — принято с предупреждениями',
    outcome(4) === 'CREATED' && byPos.get(4)?.warnings.some((w) => w.includes('Нет почты')),
    JSON.stringify(byPos.get(4)?.warnings),
  );
  check('неизвестный курс отклонён', outcome(5) === 'REJECTED' && byPos.get(5)?.errors[0]?.includes('не найден'));
  check('повтор заказа в пачке отклонён', outcome(6) === 'REJECTED' && byPos.get(6)?.errors[0]?.includes('записи №2'));
  check('без телефона и почты отклонено', outcome(7) === 'REJECTED');
  check('второй курс того же человека — отдельная заявка', outcome(8) === 'CREATED' && byPos.get(8)?.stream === '2');
  check('оплата по открытому обращению — без второй заявки', outcome(9) === 'UPDATED', JSON.stringify(byPos.get(9)));
  check(
    'людей заведено трое (второй курс — тот же человек, обращение — тот же)',
    first.body?.totals?.personsCreated === 3,
    JSON.stringify(first.body?.totals),
  );

  const leadCard = await api(`/api/v1/engagements/${byPos.get(9)?.engagementId}`, manager);
  check(
    'обращение переведено на «Договор и оплата», программа проставлена',
    leadCard.body?.currentStateKey === 'CONTRACT' && leadCard.body?.programName === 'Инженер-тестировщик',
    `${leadCard.body?.currentStateKey} / ${leadCard.body?.programName}`,
  );
  check('в карточке номер заказа и поток', leadCard.body?.paymentReference === orders.lead && leadCard.body?.studyStream === '3');

  const plainCard = await api(`/api/v1/engagements/${byPos.get(2)?.engagementId}`, manager);
  const toAccess = plainCard.body?.availableTransitions?.find((t) => t.toStateKey === 'ACCESS_GRANTED');
  check('переход «Оплата подтверждена» доступен без документа', toAccess?.allowed === true, JSON.stringify(toAccess));

  const again = await postWebhook('/api/v1/integration/website/payments', batch);
  const againOutcomes = (again.body?.items ?? []).map((item) => item.outcome);
  check(
    'повторная доставка ничего не меняет',
    again.status === 200 && again.body?.totals?.created === 0 && again.body?.totals?.updated === 0,
    JSON.stringify(again.body?.totals),
  );
  check('принятые при повторе — UNCHANGED', againOutcomes.filter((o) => o === 'UNCHANGED').length === 5, againOutcomes.join(','));

  const broken = '{"broken": ';
  const badJson = await api('/api/v1/integration/website/payments', null, {
    method: 'POST',
    body: broken,
    headers: SECRET ? { 'x-signature': createHmac('sha256', SECRET).update(broken).digest('hex') } : {},
  });
  check('битый JSON — 400', badJson.status === 400, String(badJson.status));

  // ------------------------------------------------ Загрузка файлом --
  console.log('\n3. Загрузка оплат файлом');
  const fileOrder = `ORD-20260916110000-E${RUN}`;
  const fileBatch = [{ 'Номер заявки': fileOrder, Курс: 'Анализ данных без программирования', Фамилия: 'Файлова', Имя: 'Инна', Телефон: phone('905', '5'), Email: `failova.${RUN}@example.ru`, 'Номер потока': 1 }];
  const jsonFile = () => upload('payments.json', '\uFEFF' + JSON.stringify(fileBatch), 'application/json');

  const kamUpload = await api('/api/v1/integration/payments/import', kam, { method: 'POST', body: jsonFile() });
  check('менеджеру загрузка оплат недоступна', kamUpload.status === 403, String(kamUpload.status));

  const dry1 = await api('/api/v1/integration/payments/import', manager, { method: 'POST', body: jsonFile() });
  const dry2 = await api('/api/v1/integration/payments/import?dryRun=true', manager, { method: 'POST', body: jsonFile() });
  check(
    'предварительный просмотр по умолчанию и ничего не записывает',
    dry1.body?.dryRun === true && dry1.body?.items?.[0]?.outcome === 'CREATED' && dry2.body?.items?.[0]?.outcome === 'CREATED',
    `${dry1.status} ${JSON.stringify(dry2.body?.items?.[0])}`,
  );

  const applied = await api('/api/v1/integration/payments/import?dryRun=false', manager, { method: 'POST', body: jsonFile() });
  const reapplied = await api('/api/v1/integration/payments/import?dryRun=false', manager, { method: 'POST', body: jsonFile() });
  check(
    'применение и повтор',
    applied.body?.items?.[0]?.outcome === 'CREATED' && reapplied.body?.items?.[0]?.outcome === 'UNCHANGED',
    `${applied.body?.items?.[0]?.outcome} → ${reapplied.body?.items?.[0]?.outcome}`,
  );

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Оплаты');
  sheet.addRow([]);
  sheet.addRow(['Номер заказа', 'Курс обучения', 'ФИО', 'Номер телефона', 'E-mail', 'Поток']);
  sheet.addRow([`ORD-20260917100000-T${RUN}`, 'Промпт-инжиниринг', `таблицына ольга`, Number(`7906${RUN}6`), `tablitsyna.${RUN}@example.ru`, '2 поток']);
  const xlsx = Buffer.from(await workbook.xlsx.writeBuffer());
  const fromSheet = await api('/api/v1/integration/payments/import?dryRun=false', manager, {
    method: 'POST',
    body: upload('оплаты.xlsx', xlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  });
  const sheetItem = fromSheet.body?.items?.[0];
  check(
    'таблица: заголовок не в первой строке, ФИО одной строкой, телефон числом',
    sheetItem?.outcome === 'CREATED' && sheetItem?.position === 3 && sheetItem?.fullName === 'Таблицына Ольга' && sheetItem?.stream === '2',
    JSON.stringify(sheetItem),
  );

  // ------------------------------------------------------ Выгрузка в LMS --
  console.log('\n4. Выгрузка в LMS');
  const programs = await api('/api/v1/catalog/programs?limit=100&search=' + encodeURIComponent('Промпт'), manager);
  const prompt = programs.body?.items?.find((item) => item.name === 'Промпт-инжиниринг');
  check('программа «Промпт-инжиниринг» в каталоге', Boolean(prompt));

  const candidates = await api(`/api/v1/integration/lms/export/candidates?programId=${prompt?.id}`, manager);
  const ours = (candidates.body?.items ?? []).filter((item) => [byPos.get(4)?.engagementId, byPos.get(8)?.engagementId].includes(item.engagementId));
  check('кандидаты: оба наших слушателя по программе', ours.length === 2, JSON.stringify(candidates.body?.total));
  const noEmail = ours.find((item) => item.engagementId === byPos.get(4)?.engagementId);
  check('без почты — не готов, с причиной', noEmail?.ready === false && noEmail?.issues.some((i) => i.includes('почты')));

  const kamCandidates = await api('/api/v1/integration/lms/export/candidates', kam);
  const kamOwners = new Set((kamCandidates.body?.items ?? []).map((item) => item.ownerName));
  check('менеджер видит только своих слушателей', kamOwners.size <= 1, [...kamOwners].join(', '));

  const exported = await api('/api/v1/integration/lms/export', manager, {
    method: 'POST',
    body: JSON.stringify({ programId: prompt?.id }),
  });
  check(
    'файл выгружен, пропущенные посчитаны',
    exported.status === 200 && Number(exported.headers.get('x-exported-count')) >= 1 && Number(exported.headers.get('x-skipped-count')) >= 1,
    `${exported.status} exported=${exported.headers.get('x-exported-count')} skipped=${exported.headers.get('x-skipped-count')}`,
  );

  if (exported.status === 200) {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(exported.body);
    const lms = book.getWorksheet('Лист1');
    const rows = [];
    lms.eachRow((row, number) => {
      if (number > 1) rows.push(row.values.slice(1, 6));
    });
    const kravets = rows.find((row) => row[0] === 'Кравец');
    check('заголовки как в шаблоне LMS', lms.getRow(1).getCell(3).value === 'Отчествопри наличии)' && lms.columnCount === 30);
    check(
      'строка слушателя: ФИО по частям, телефон числом, почта',
      kravets && kravets[1] === 'Павел' && kravets[2] === 'Юрьевич' && typeof kravets[3] === 'number' && kravets[4] === email,
      JSON.stringify(kravets),
    );
    check('слушатель без почты в файл не попал', !rows.some((row) => row[0] === 'Рябов'));
  }

  const repeat = await api('/api/v1/integration/lms/export', manager, {
    method: 'POST',
    body: JSON.stringify({ programId: prompt?.id }),
  });
  check('повторная выгрузка — выгружать некого', repeat.status === 422 && repeat.body?.code === 'CRM-INT-0005', `${repeat.status} ${repeat.body?.code}`);

  const again2 = await api('/api/v1/integration/lms/export', manager, {
    method: 'POST',
    body: JSON.stringify({ programId: prompt?.id, includeExported: true, markExported: false }),
  });
  check('повторная выгрузка по запросу — без новых отметок', again2.status === 200);

  const timeline = await api(`/api/v1/engagements/${byPos.get(8)?.engagementId}/timeline?limit=20`, manager);
  const types = (timeline.body?.items ?? []).map((item) => item.type);
  check('в истории заявки — оплата и выгрузка', types.includes('PAYMENT_CONFIRMED') && types.includes('LMS_EXPORTED'), types.join(','));

  const enrolled = await postWebhook('/api/v1/integration/lms/events', {
    contract: 'inbound.v1',
    event: 'enrollment.created',
    externalId: `lms-enroll-${RUN}`,
    caseId: `lms-${RUN}`,
    occurredAt: new Date().toISOString(),
    counterparty: { type: 'PERSON', name: 'Кравец Павел Юрьевич', email },
    directionCode: 'AI',
  });
  const afterLms = await api(`/api/v1/engagements/${byPos.get(8)?.engagementId}`, manager);
  check(
    'событие LMS о записи переводит заявку в «Доступ выдан»',
    enrolled.body?.outcome === 'updated' && afterLms.body?.currentStateKey === 'ACCESS_GRANTED',
    `${enrolled.body?.outcome} / ${afterLms.body?.currentStateKey}`,
  );

  console.log(failures === 0 ? '\nВсе проверки пройдены.' : `\nСбоев: ${failures}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
