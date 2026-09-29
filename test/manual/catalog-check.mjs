/**
 * Ручная проверка каталогов и разграничения прав.
 *
 * Написана на Node, а не на shell + curl, сознательно: консоль Windows
 * искажает кириллицу в аргументах команд, из-за чего запросы уходят
 * с испорченными байтами и проверки «падают» на ровном месте, хотя
 * сервер отвечает правильно. Node работает с UTF-8 предсказуемо.
 *
 * Запуск (API и Keycloak должны быть подняты):
 *   node test/manual/catalog-check.mjs
 */

const API = process.env.API_URL ?? 'http://localhost:3000';
const KEYCLOAK = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'rtk-crm';

let failures = 0;

function check(label, condition, detail = '') {
  const mark = condition ? 'OK  ' : 'СБОЙ';
  if (!condition) failures++;
  console.log(`  [${mark}] ${label}${detail ? ` — ${detail}` : ''}`);
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
  if (!data.access_token) {
    throw new Error(`Не удалось получить токен для ${username}: ${JSON.stringify(data)}`);
  }
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
  let body;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  return { status: response.status, body };
}

async function main() {
  const kam = await token('kam.ivanova', 'Kam#2026demo');
  const manager = await token('manager.petrov', 'Mgr#2026demo');

  console.log('\n1. Постраничный список вузов');
  const list = await api('/api/v1/catalog/universities?limit=3', kam);
  check('ответ 200', list.status === 200, `получен ${list.status}`);
  check('выдано 3 записи', list.body?.items?.length === 3);
  check('счётчик всего заполнен', list.body?.meta?.total >= 35, `total=${list.body?.meta?.total}`);
  for (const item of list.body?.items ?? []) {
    console.log(`       ${item.shortName} | ${item.region} | взаимодействий: ${item.engagementCount}`);
  }

  console.log('\n2. Поиск по фрагменту наименования (кириллица)');
  const search = await api(`/api/v1/catalog/universities?search=${encodeURIComponent('баумана')}`, kam);
  check('ответ 200', search.status === 200);
  check('вуз найден по фрагменту в нижнем регистре', (search.body?.items?.length ?? 0) > 0);
  for (const item of search.body?.items ?? []) {
    console.log(`       найден: ${item.name}`);
  }

  console.log('\n3. Поиск дубликатов: аббревиатура вместо полного наименования');
  const similar1 = await api(
    `/api/v1/catalog/universities/similar?name=${encodeURIComponent('МГТУ им. Н.Э.Баумана')}`,
    kam,
  );
  check('ответ 200', similar1.status === 200);
  check('найден хотя бы один кандидат', (similar1.body?.length ?? 0) > 0);
  for (const item of similar1.body ?? []) {
    console.log(`       ${item.similarity} — ${item.name}`);
  }

  console.log('\n4. Поиск дубликатов: опечатка в наименовании');
  const similar2 = await api(
    `/api/v1/catalog/universities/similar?name=${encodeURIComponent('Казанский федеральный универститет')}`,
    kam,
  );
  check('найден вуз несмотря на опечатку', (similar2.body?.length ?? 0) > 0);
  for (const item of similar2.body ?? []) {
    console.log(`       ${item.similarity} — ${item.name}`);
  }

  console.log('\n5. Разграничение прав: КАМ не может изменять каталог');
  const forbidden = await api('/api/v1/catalog/universities', kam, {
    method: 'POST',
    body: JSON.stringify({ name: 'Попытка создания рядовым пользователем' }),
  });
  check('ответ 403', forbidden.status === 403, `получен ${forbidden.status}`);
  check('код ошибки CRM-ACL-0001', forbidden.body?.code === 'CRM-ACL-0001', forbidden.body?.code);

  console.log('\n6. Руководитель создаёт вуз, кириллица сохраняется без искажений');
  const uniqueName = `Тестовый университет связи ${Date.now()}`;
  const created = await api('/api/v1/catalog/universities', manager, {
    method: 'POST',
    body: JSON.stringify({ name: uniqueName, shortName: 'ТУС', region: 'Москва' }),
  });
  check('ответ 201', created.status === 201, `получен ${created.status}`);
  check('наименование сохранено посимвольно', created.body?.name === uniqueName, created.body?.name);

  console.log('\n7. Валидация: некорректный ИНН отклоняется');
  const invalid = await api('/api/v1/catalog/universities', manager, {
    method: 'POST',
    body: JSON.stringify({ name: 'Университет с некорректным ИНН', inn: '12345' }),
  });
  check('ответ 422', invalid.status === 422, `получен ${invalid.status}`);
  check('код ошибки CRM-VAL-0001', invalid.body?.code === 'CRM-VAL-0001', invalid.body?.code);
  check('указана причина', (invalid.body?.errors?.length ?? 0) > 0, invalid.body?.errors?.[0]?.message);

  console.log('\n8. Неизвестное поле в теле запроса отклоняется');
  const unknownField = await api('/api/v1/catalog/universities', manager, {
    method: 'POST',
    body: JSON.stringify({ name: 'Университет', неизвестноеПоле: 'значение' }),
  });
  check('ответ 422', unknownField.status === 422, `получен ${unknownField.status}`);

  console.log('\n9. Справочники направлений и продуктов');
  // Не меньше, чем в демо-наполнении (prisma/seed.ts): другие проверки,
  // например загрузка каталога вендоров, добавляют свои записи.
  const directions = await api('/api/v1/catalog/directions?limit=100', kam);
  check('направления получены', directions.body?.meta?.total >= 9, `total=${directions.body?.meta?.total}`);
  const products = await api('/api/v1/catalog/products?limit=100', kam);
  check('продукты получены', products.body?.meta?.total >= 9, `total=${products.body?.meta?.total}`);

  console.log('\n10. Ограничение размера страницы');
  const tooLarge = await api('/api/v1/catalog/universities?limit=99999', kam);
  check('превышение лимита отклонено', tooLarge.status === 422, `получен ${tooLarge.status}`);

  console.log(
    failures === 0
      ? '\nВсе проверки пройдены.\n'
      : `\nПроверок не пройдено: ${failures}.\n`,
  );

  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('Ошибка выполнения проверок:', error);
  process.exitCode = 1;
});
