/**
 * Ручная проверка мер безопасности на поднятом стенде.
 *
 * Каждая проверка — воспроизведение дыры, найденной при аудите, и
 * подтверждение, что она закрыта:
 *   • пароль документации не обходится кодированием адреса;
 *   • строка поиска не попадает в журнал аудита открытым текстом;
 *   • адрес бота мессенджера не меняется из интерфейса;
 *   • запрос без токена с огромным JSON не разбирается целиком;
 *   • ZIP-бомба под видом таблицы не роняет процесс;
 *   • две одновременные выгрузки в LMS не делят слушателей.
 *
 *   API_URL=http://localhost:3100 SWAGGER_PASSWORD=… INTEGRATION_WEBHOOK_SECRET=… \
 *     node test/manual/security-check.mjs
 */
import { createHmac } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';

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
  const type = r.headers.get('content-type') ?? '';
  const buffer = Buffer.from(await r.arrayBuffer());
  return { status: r.status, headers: r.headers, body: type.includes('json') ? JSON.parse(buffer.toString('utf8')) : buffer };
}

/**
 * ZIP-бомба, похожая на книгу Excel: служебные записи на месте, поэтому
 * проверка типа файла её пропускает — как пропустила бы у злоумышленника.
 */
function zipBomb(size) {
  const entries = [
    {
      name: '[Content_Types].xml',
      data: Buffer.from(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Override PartName="/xl/workbook.xml" ' +
          'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
      ),
    },
    { name: 'xl/workbook.xml', data: Buffer.from('<?xml version="1.0"?><workbook/>') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.alloc(size, 0x20) },
  ];
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = deflateRawSync(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

async function main() {
  const manager = await token('manager.petrov', 'Mgr#2026demo');
  const admin = await token('admin.sidorov', 'Adm#2026demo');

  console.log('\n1. Документация API');
  for (const path of ['/api/docs-json', '/api/%64ocs-json', '/%61pi/docs-json', '/api/%64ocs']) {
    const r = await fetch(`${API}${path}`);
    check(`${path} без пароля — 401`, r.status === 401, String(r.status));
  }
  if (process.env.SWAGGER_PASSWORD) {
    const r = await fetch(`${API}/api/docs-json`, {
      headers: { Authorization: `Basic ${Buffer.from(`docs:${process.env.SWAGGER_PASSWORD}`).toString('base64')}` },
    });
    check('с паролем — открывается', r.status === 200, String(r.status));
  }

  console.log('\n2. Строка поиска в журнале аудита');
  const surname = `Поискова${RUN}`;
  await api(`/api/v1/persons?search=${encodeURIComponent(surname)}`, manager);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const audit = await api('/api/v1/audit?action=VIEW_PERSONAL_DATA&limit=20', admin);
  const serialized = JSON.stringify(audit.body);
  check('журнал доступен администратору', audit.status === 200, String(audit.status));
  check('фамилии из поиска в журнале нет', !serialized.includes(surname));
  check('поиск в журнале зафиксирован отпечатком', /"search":"\[скрыто:[0-9a-f]{8}\]"/.test(serialized));

  console.log('\n3. Адрес бота мессенджера');
  const evil = await api('/api/v1/notifications/settings/channels/TELEGRAM', admin, {
    method: 'PUT',
    body: JSON.stringify({ settings: { apiUrl: 'http://attacker.example', botToken: '' } }),
  });
  check(
    'apiUrl в настройках канала отклонён',
    evil.status === 422 && evil.body?.errors?.some((e) => e.field === 'settings.apiUrl'),
    `${evil.status} ${JSON.stringify(evil.body?.errors)}`,
  );
  const nested = await api('/api/v1/notifications/settings/channels/TELEGRAM', admin, {
    method: 'PUT',
    body: JSON.stringify({ settings: { chatId: { $gt: '' } } }),
  });
  check('вложенный объект в значении отклонён', nested.status === 422, String(nested.status));
  const fine = await api('/api/v1/notifications/settings/channels/TELEGRAM', admin, {
    method: 'PUT',
    body: JSON.stringify({ isEnabled: false, settings: { chatId: '-100500' } }),
  });
  check('допустимые ключи принимаются', fine.status === 200, String(fine.status));

  console.log('\n4. Огромное тело без токена');
  const huge = '{"x":"' + 'a'.repeat(3 * 1024 * 1024) + '"}';
  const tooBig = await api('/api/v1/engagements', null, { method: 'POST', body: huge });
  check('JSON больше 2 МБ отклоняется до разбора — 413', tooBig.status === 413, String(tooBig.status));

  console.log('\n5. ZIP-бомба вместо таблицы');
  const bomb = zipBomb(300 * 1024 * 1024);
  const form = new FormData();
  form.append('file', new Blob([bomb], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'Вендоры.xlsx');
  const started = Date.now();
  const rejected = await api('/api/v1/catalog/vendors/import', manager, { method: 'POST', body: form });
  check(
    `файл ${Math.round(bomb.length / 1024)} КБ, раскрывающийся в 300 МБ, отклонён`,
    rejected.status === 422 && /слишком большой объём/.test(rejected.body?.detail ?? ''),
    `${rejected.status} ${rejected.body?.detail ?? ''}`,
  );
  check('отказ быстрый, без распаковки целиком', Date.now() - started < 10_000, `${Date.now() - started} мс`);
  const alive = await api('/api/v1/auth/me', manager);
  check('API жив после попытки', alive.status === 200, String(alive.status));

  console.log('\n6. Одновременная выгрузка в LMS');
  const payments = Array.from({ length: 6 }, (_, index) => ({
    'Номер заявки': `ORD-20260920100000-R${RUN}${index}`,
    Курс: 'Промпт-инжиниринг',
    Фамилия: `Гонкин${index}`,
    Имя: 'Тест',
    Телефон: `7 (909) ${RUN.slice(0, 3)}-${RUN.slice(3, 5)}-${RUN.slice(5)}${index}`,
    Email: `race.${RUN}.${index}@example.ru`,
    'Номер потока': 9,
  }));
  const raw = JSON.stringify(payments);
  const paid = await api('/api/v1/integration/website/payments', null, {
    method: 'POST',
    body: raw,
    headers: SECRET ? { 'x-signature': createHmac('sha256', SECRET).update(raw).digest('hex') } : {},
  });
  check('шесть оплат приняты', paid.body?.totals?.created === 6, JSON.stringify(paid.body?.totals));

  const body = JSON.stringify({ stream: '9' });
  const [first, second] = await Promise.all([
    api('/api/v1/integration/lms/export', manager, { method: 'POST', body }),
    api('/api/v1/integration/lms/export', admin, { method: 'POST', body }),
  ]);
  const count = (r) => (r.status === 200 ? Number(r.headers.get('x-exported-count')) : 0);
  check(
    'каждый слушатель попал ровно в один файл',
    count(first) + count(second) === 6,
    `${first.status}:${count(first)} + ${second.status}:${count(second)}`,
  );

  console.log(failures === 0 ? '\nВсе проверки пройдены.' : `\nСбоев: ${failures}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
