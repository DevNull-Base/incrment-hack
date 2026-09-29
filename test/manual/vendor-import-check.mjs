/**
 * Ручная проверка загрузки каталога вендоров из таблицы.
 *
 * Таблица устроена как каталог заказчика («Компания», «Продукт», «ФИО»,
 * «Телефон», «Почта», «Способ связи»), контакты вымышленные. В ней то,
 * что встречается у живых таблиц: компания без правовой формы, несколько
 * продуктов в ячейке, телефон числом, почта в верхнем регистре, способ
 * связи свободным текстом, пустая строка, строка без компании.
 *
 *   API_URL=http://localhost:3100 node test/manual/vendor-import-check.mjs
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
  const r = await fetch(`${API}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, ...(options.headers ?? {}) },
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}

async function buildSheet() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Вендоры');
  sheet.addRow(['Компания', 'Продукт', 'ФИО', 'Телефон', 'Почта', 'Способ связи']);
  sheet.addRow(['ООО «ТДата»', '«RT.DataLake», «RT.Warehouse»', `кравченко вера ${RUN}`, Number(`7902${RUN}1`), `KRAVCHENKO.${RUN}@EXAMPLE.RU`, 'Почта, Чат в ТГ']);
  sheet.addRow(['Ростелеком', 'RT.DataVision', `Носов Лев ${RUN}`, `8 (903) ${RUN.slice(0, 3)}-${RUN.slice(3, 5)}-${RUN.slice(5)}2`, `nosov.${RUN}@example.ru`, 'телефон']);
  sheet.addRow([`ООО «Вендор ${RUN}»`, 'Продукт А; Продукт Б', null, null, null, null]);
  sheet.addRow([]);
  sheet.addRow([null, 'Сирота', 'Безкомпаниев Пётр']);
  sheet.addRow(['ООО «РТК ИТ»', 'Нейрошлюз', null, '+7 900 111-11-11', null, null]);
  sheet.addRow(['ПАО "Ростелеком"', 'RT.DataVision', `Носов Лев ${RUN}`, null, 'nosov@@broken', 'Факс']);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function form(content) {
  const data = new FormData();
  data.append(
    'file',
    new Blob([content], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    'Вендоры.xlsx',
  );
  return data;
}

async function main() {
  const manager = await token('manager.petrov', 'Mgr#2026demo');
  const kam = await token('kam.ivanova', 'Kam#2026demo');
  const file = await buildSheet();

  console.log('\n1. Права и предварительный просмотр');
  const denied = await api('/api/v1/catalog/vendors/import', kam, { method: 'POST', body: form(file) });
  check('менеджеру загрузка каталога недоступна', denied.status === 403, String(denied.status));

  const preview = await api('/api/v1/catalog/vendors/import', manager, { method: 'POST', body: form(file) });
  check('просмотр по умолчанию', preview.status === 200 && preview.body?.dryRun === true, String(preview.status));
  check('все колонки сопоставлены', preview.body?.unmappedHeaders?.length === 0, JSON.stringify(preview.body?.mapping));
  check('пустая строка пропущена', preview.body?.totals?.rows === 6, JSON.stringify(preview.body?.totals));

  const rows = new Map((preview.body?.rows ?? []).map((row) => [row.rowNumber, row]));
  check('два продукта из одной ячейки', JSON.stringify(rows.get(2)?.products) === '["RT.DataLake","RT.Warehouse"]');
  check(
    '«Ростелеком» без правовой формы — тот же вендор',
    rows.get(3)?.warnings.some((w) => w.includes('ПАО «Ростелеком»')),
    JSON.stringify(rows.get(3)?.warnings),
  );
  check('новый вендор с двумя продуктами', rows.get(4)?.outcome === 'CREATED');
  check('строка без компании отклонена', rows.get(6)?.outcome === 'REJECTED');
  check('контакты без ФИО отклонены', rows.get(7)?.outcome === 'REJECTED');
  check(
    'битая почта и неизвестный способ связи — предупреждения',
    rows.get(8)?.warnings.some((w) => w.includes('Почта')) && rows.get(8)?.warnings.some((w) => w.includes('Способ связи')),
    JSON.stringify(rows.get(8)?.warnings),
  );

  const notYet = await api(`/api/v1/catalog/vendors?search=${encodeURIComponent(`Вендор ${RUN}`)}`, manager);
  check('после просмотра вендор не заведён', notYet.body?.items?.length === 0);

  console.log('\n2. Применение');
  const applied = await api('/api/v1/catalog/vendors/import?dryRun=false', manager, { method: 'POST', body: form(file) });
  check('применено', applied.status === 200 && applied.body?.dryRun === false, JSON.stringify(applied.body?.totals));

  const created = await api(`/api/v1/catalog/vendors?search=${encodeURIComponent(`Вендор ${RUN}`)}`, manager);
  check('вендор заведён с двумя продуктами', created.body?.items?.[0]?.productCount === 2, JSON.stringify(created.body?.items));

  const tdata = await api(`/api/v1/catalog/vendors?search=${encodeURIComponent('ТДата')}`, manager);
  const tdataId = tdata.body?.items?.[0]?.id;
  const contacts = await api(`/api/v1/catalog/vendors/${tdataId}/contacts`, kam);
  const kravchenko = contacts.body?.find((item) => item.email === `kravchenko.${RUN}@example.ru`);
  check(
    'контакт: ФИО с заглавных, телефон и почта приведены, каналы распознаны',
    kravchenko &&
      kravchenko.fullName === `Кравченко Вера ${RUN}` &&
      kravchenko.phone === `+7902${RUN}1` &&
      JSON.stringify(kravchenko.channels) === '["EMAIL","TELEGRAM"]',
    JSON.stringify(kravchenko),
  );

  const rostelecom = await api(`/api/v1/catalog/vendors?search=${encodeURIComponent('Ростелеком')}`, manager);
  check('двойник «Ростелекома» не заведён', rostelecom.body?.items?.length === 1, JSON.stringify(rostelecom.body?.items?.map((v) => v.name)));

  const rtContacts = await api(`/api/v1/catalog/vendors/${rostelecom.body?.items?.[0]?.id}/contacts`, manager);
  const nosov = (rtContacts.body ?? []).filter((item) => item.fullName === `Носов Лев ${RUN}`);
  check(
    'человек из двух строк (во второй почта битая) — один контакт',
    nosov.length === 1 && nosov[0].email === `nosov.${RUN}@example.ru`,
    JSON.stringify(nosov),
  );

  const repeat = await api('/api/v1/catalog/vendors/import?dryRun=false', manager, { method: 'POST', body: form(file) });
  check(
    'повторная загрузка ничего не заводит',
    repeat.body?.totals?.vendorsCreated === 0 && repeat.body?.totals?.productsCreated === 0 && repeat.body?.totals?.contactsCreated === 0,
    JSON.stringify(repeat.body?.totals),
  );

  console.log(failures === 0 ? '\nВсе проверки пройдены.' : `\nСбоев: ${failures}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
