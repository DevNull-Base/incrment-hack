/**
 * Ручная проверка импорта XLS.
 *
 * Проверяется полный цикл: загрузка файла с «неудобными» заголовками,
 * автоматическое сопоставление колонок, предварительный просмотр
 * без записи данных, применение и повторный отказ.
 *
 * Требует запущенных API и worker (разбор выполняется фоновым процессом).
 *   node test/manual/import-check.mjs
 */
import { buildSampleBuffer } from './make-import-sample.mjs';

const API = process.env.API_URL ?? 'http://localhost:3000';
const KEYCLOAK = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'rtk-crm';
// Метка прогона делает проверку повторяемой: новые вузы получают
// уникальные наименования, и результат не зависит от предыдущих запусков.
const RUN_ID = String(Date.now()).slice(-6);
const NEW_UNIVERSITY = `Мурманский арктический университет ${RUN_ID}`;
const FALSE_MATCH_UNIVERSITY = `Псковский государственный университет ${RUN_ID}`;

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

/** Ждёт, пока фоновый разбор доведёт задачу до ожидаемого статуса. */
async function waitForStatus(jobId, accessToken, expected, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await api(`/api/v1/import/${jobId}`, accessToken);
    if (result.body?.status === expected) return result.body;
    if (result.body?.status === 'FAILED') return result.body;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return null;
}

async function main() {
  const manager = await token('manager.petrov', 'Mgr#2026demo');
  const kam = await token('kam.ivanova', 'Kam#2026demo');

  console.log('\n1. Перечень полей для сопоставления');
  const fields = await api('/api/v1/import/fields', manager);
  check('ответ 200', fields.status === 200);
  check('поля описаны', (fields.body?.length ?? 0) === 11, `${fields.body?.length}`);
  const required = (fields.body ?? []).filter((f) => f.required);
  check('обязательное поле одно — название вуза', required.length === 1 && required[0].key === 'universityName');

  console.log('\n2. Рядовому менеджеру импорт недоступен');
  const forbidden = await api('/api/v1/import/fields', kam);
  check('ответ 403', forbidden.status === 403, `${forbidden.status}`);

  console.log('\n3. Загрузка файла с нестандартными заголовками');
  const content = await buildSampleBuffer(RUN_ID);
  const form = new FormData();
  form.append('file', new Blob([content]), 'выгрузка-по-вузам.xlsx');

  const uploaded = await fetch(`${API}/api/v1/import`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${manager}` },
    body: form,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

  check('файл принят', uploaded.status === 201 || uploaded.status === 200, `${uploaded.status}`);
  check('получен идентификатор задачи', Boolean(uploaded.body?.jobId));
  const jobId = uploaded.body?.jobId;

  console.log('\n4. Фоновый разбор завершается статусом DRY_RUN_READY');
  const preview = await waitForStatus(jobId, manager, 'DRY_RUN_READY');
  check('разбор завершён', preview?.status === 'DRY_RUN_READY', preview?.status ?? 'нет ответа');

  if (preview?.status !== 'DRY_RUN_READY') {
    console.log(`\nПрерывание: разбор не завершился. Статус: ${preview?.status}\n`);
    process.exitCode = 1;
    return;
  }

  console.log('\n5. Колонки сопоставлены автоматически');
  const mapping = preview.detectedMapping ?? {};
  check('«ВУЗ» распознан как название вуза', mapping['ВУЗ'] === 'universityName', mapping['ВУЗ']);
  check('«Производитель» распознан как вендор', mapping['Производитель'] === 'vendorName', mapping['Производитель']);
  check(
    '«Программное обеспечение» распознано как ПО',
    mapping['Программное обеспечение'] === 'productName',
    mapping['Программное обеспечение'],
  );
  check('«No договора» распознан', mapping['No договора'] === 'contractNumber', mapping['No договора']);
  check('«Статус передачи» распознан', mapping['Статус передачи'] === 'transferStatus', mapping['Статус передачи']);
  console.log('       сопоставлено колонок:', Object.keys(mapping).length);

  console.log('\n6. Лишняя колонка показана как несопоставленная, а не отброшена молча');
  check(
    'колонка отдела в списке несопоставленных',
    (preview.unmappedHeaders ?? []).includes('Внутренний код отдела'),
    JSON.stringify(preview.unmappedHeaders),
  );

  console.log('\n7. Ошибочные строки отделены от корректных');
  check('всего строк 8', preview.totalRows === 8, `${preview.totalRows}`);
  check('ошибочных строк 2', preview.invalidRows === 2, `${preview.invalidRows}`);
  check('корректных строк 6', preview.validRows === 6, `${preview.validRows}`);
  for (const error of preview.errors ?? []) {
    console.log(`       строка ${error.rowNumber}: ${error.message}`);
  }

  console.log('\n8. Сокращённые наименования распознаны как существующие вузы');
  const duplicates = preview.duplicateCandidates ?? [];
  check('показаны кандидаты на совпадение', duplicates.length > 0, `${duplicates.length}`);
  for (const item of duplicates) {
    console.log(`       «${item.incomingName}» → «${item.matchedName}» (${item.similarity}) решение: ${item.decision ?? 'не принято'}`);
  }
  check(
    'ни одно совпадение не применено автоматически',
    duplicates.every((d) => d.decision === null || d.decision === undefined),
  );

  // Ключевая проверка безопасности: похожие по написанию, но РАЗНЫЕ вузы
  // не должны сливаться. «Псковский» и «Санкт-Петербургский» дают высокую
  // оценку из-за общих слов «государственный университет».
  const pskov = duplicates.find((d) => d.incomingName.includes('Псковский'));
  if (pskov) {
    console.log(`       ложное совпадение обнаружено и НЕ применено: «${pskov.incomingName}» ~ «${pskov.matchedName}»`);
  }

  console.log('');
  console.log('8a. Пользователь принимает решения по совпадениям');
  const decisions = {};
  for (const item of duplicates) {
    // Подтверждаем только настоящее совпадение (опечатку в «Казанском»),
    // остальные помечаем как новые записи.
    // Подтверждаем настоящие совпадения (сокращение и опечатку),
    // отклоняем ложное — «Псковский» против «Санкт-Петербургского».
    decisions[item.incomingName] = item.incomingName.includes('Псковский')
      ? 'CREATE_NEW'
      : item.matchedId;
  }
  const resolved = await api(`/api/v1/import/${jobId}/resolutions`, manager, {
    method: 'PUT',
    body: JSON.stringify({ resolutions: decisions }),
  });
  check('решения сохранены', resolved.status === 200, `${resolved.status}`);


  console.log('\n9. Сводка показывает, что будет создано и обновлено');
  console.log(`       будет создано:  ${JSON.stringify(preview.willCreate)}`);
  console.log(`       будет обновлено: ${JSON.stringify(preview.willUpdate)}`);
  const afterDecisions = await api(`/api/v1/import/${jobId}`, manager);
  console.log(`       после решений будет создано: ${JSON.stringify(afterDecisions.body.willCreate)}`);
  console.log(`       после решений будет обновлено: ${JSON.stringify(afterDecisions.body.willUpdate)}`);
  check(
    'сводка учла решения: создаётся Мурманский и Псковский',
    afterDecisions.body.willCreate?.universities === 2,
    `${afterDecisions.body.willCreate?.universities}`,
  );
  // Ожидание выводится из данных, а не задаётся числом: в файле пять
  // различных вузов — ИТМО совпадает точно, «Баумана» и «Казанский»
  // подтверждены пользователем, значит обновлений три.
  const confirmedCount = Object.values(decisions).filter((d) => d !== 'CREATE_NEW').length;
  check(
    'подтверждённые совпадения учтены как обновление',
    afterDecisions.body.willUpdate?.universities === confirmedCount + 1,
    `${afterDecisions.body.willUpdate?.universities} (подтверждено ${confirmedCount} + 1 точное совпадение)`,
  );

  console.log('\n10. До подтверждения данные не изменены');
  const before = await api(
    `/api/v1/catalog/universities?search=${encodeURIComponent(NEW_UNIVERSITY)}`,
    manager,
  );
  check('нового вуза в каталоге ещё нет', before.body?.meta?.total === 0, `${before.body?.meta?.total}`);

  console.log('\n11. Применение импорта');
  const applied = await api(`/api/v1/import/${jobId}/apply`, manager, {
    method: 'POST',
    body: '{}',
  });
  check('ответ 200', applied.status === 200, `${applied.status} ${applied.body?.code ?? ''}`);
  console.log(`       создано: ${applied.body?.created}, обновлено: ${applied.body?.updated}`);

  console.log('\n12. Данные появились в каталоге');
  const after = await api(
    `/api/v1/catalog/universities?search=${encodeURIComponent(NEW_UNIVERSITY)}`,
    manager,
  );
  check('новый вуз создан', after.body?.meta?.total === 1, `${after.body?.meta?.total}`);

  const bauman = await api(
    `/api/v1/catalog/universities?search=${encodeURIComponent('Баумана')}`,
    manager,
  );
  check(
    'подтверждённое сокращение не создало дубликат',
    bauman.body?.meta?.total === 1,
    `найдено записей: ${bauman.body?.meta?.total}`,
  );

  const pskovAfter = await api(
    `/api/v1/catalog/universities?search=${encodeURIComponent(FALSE_MATCH_UNIVERSITY)}`,
    manager,
  );
  check(
    'Псковский университет создан отдельно, а не слит с Санкт-Петербургским',
    pskovAfter.body?.meta?.total === 1,
    `найдено записей: ${pskovAfter.body?.meta?.total}`,
  );

  const kazan = await api(
    `/api/v1/catalog/universities?search=${encodeURIComponent('Казанский федеральный')}`,
    manager,
  );
  check(
    'подтверждённая опечатка не создала дубликат',
    kazan.body?.meta?.total === 1,
    `найдено записей: ${kazan.body?.meta?.total}`,
  );

  console.log('\n13. Повторное применение отклоняется');
  const again = await api(`/api/v1/import/${jobId}/apply`, manager, { method: 'POST', body: '{}' });
  check('ответ 409', again.status === 409, `${again.status}`);
  check('код CRM-IMP-0004', again.body?.code === 'CRM-IMP-0004', again.body?.code);

  console.log('\n14. Повторная загрузка того же файла отклоняется');
  const form2 = new FormData();
  form2.append('file', new Blob([content]), 'выгрузка-по-вузам.xlsx');
  const duplicate = await fetch(`${API}/api/v1/import`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${manager}` },
    body: form2,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  check('ответ 409', duplicate.status === 409, `${duplicate.status}`);
  check('код CRM-IMP-0004', duplicate.body?.code === 'CRM-IMP-0004', duplicate.body?.code);

  console.log(failures === 0 ? '\nВсе проверки пройдены.\n' : `\nПроверок не пройдено: ${failures}.\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('Ошибка выполнения проверок:', error);
  process.exitCode = 1;
});
