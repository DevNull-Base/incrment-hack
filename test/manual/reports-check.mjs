/**
 * Ручная проверка отчётов.
 *
 * Проверяются три группы свойств:
 *   • корректность — данные в файле соответствуют выборке;
 *   • безопасность — произвольная колонка не проходит, область видимости
 *     ограничивает содержимое отчёта;
 *   • производительность — выбор синхронного или фонового пути, кэш
 *     одинаковых запросов.
 *
 * Требует запущенных API и worker.
 *   node test/manual/reports-check.mjs
 */
import ExcelJS from 'exceljs';

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
  const type = r.headers.get('content-type') ?? '';
  const body = type.includes('json') ? await r.json().catch(() => null) : null;
  return { status: r.status, body, headers: r.headers, response: r };
}

async function requestReport(accessToken, payload) {
  const r = await fetch(`${API}/api/v1/reports`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  // Различаем ФАЙЛ отчёта и ответ API по Content-Disposition: у формата
  // JSON тип содержимого совпадает с обычным ответом, и по нему одно
  // от другого не отличить.
  const isFile = (r.headers.get('content-disposition') ?? '').includes('attachment');

  if (isFile) {
    return { status: r.status, buffer: Buffer.from(await r.arrayBuffer()), headers: r.headers };
  }

  return { status: r.status, json: await r.json().catch(() => null), headers: r.headers };
}

async function waitForJob(jobId, accessToken, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await api(`/api/v1/reports/${jobId}`, accessToken);
    const status = result.body?.status;
    if (status === 'COMPLETED' || status === 'FAILED') return result.body;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return null;
}

async function main() {
  const admin = await token('admin.sidorov', 'Adm#2026demo');
  const kam = await token('kam.ivanova', 'Kam#2026demo');

  console.log('\n1. Перечень доступных колонок');
  const columns = await api('/api/v1/reports/columns', admin);
  check('ответ 200', columns.status === 200);
  check('колонки описаны', (columns.body?.length ?? 0) >= 20, `${columns.body?.length}`);
  const defaults = (columns.body ?? []).filter((c) => c.isDefault).map((c) => c.key);
  check('набор по умолчанию соответствует ТЗ', defaults.length === 5, defaults.join(', '));

  console.log('\n2. Безопасность: произвольная колонка отклоняется');
  const injection = await requestReport(admin, {
    columns: ['universityName', '(SELECT current_setting(\'is_superuser\'))'],
    format: 'JSON',
  });
  check('запрос отклонён', injection.status === 422, `${injection.status}`);
  check('код CRM-REP-0001', injection.json?.code === 'CRM-REP-0001', injection.json?.code);

  console.log('\n3. Синхронный отчёт в формате JSON');
  const json = await requestReport(admin, {
    title: 'Проверочный отчёт',
    columns: defaults,
    format: 'JSON',
    filters: {},
  });
  check('ответ 200 (сформирован сразу)', json.status === 200, `${json.status}`);
  const parsed = JSON.parse(json.buffer.toString('utf8'));
  check('заголовок сохранён', parsed.title === 'Проверочный отчёт', parsed.title);
  check('есть строки', (parsed.rows?.length ?? 0) > 0, `${parsed.rows?.length}`);
  check('колонки описаны в файле', parsed.columns?.length === defaults.length);
  check(
    'в шапке указан автор',
    typeof parsed.generatedBy === 'string' && parsed.generatedBy.length > 0,
    parsed.generatedBy,
  );
  console.log(`       строк в отчёте: ${parsed.rows.length}`);
  console.log(`       первая строка: ${JSON.stringify(parsed.rows[0]).slice(0, 140)}`);

  console.log('\n4. Область видимости ограничивает содержимое отчёта');
  const kamJson = await requestReport(kam, { columns: defaults, format: 'JSON', filters: {} });
  const kamParsed = JSON.parse(kamJson.buffer.toString('utf8'));
  check(
    'рядовой менеджер получает меньше строк, чем администратор',
    kamParsed.rows.length < parsed.rows.length,
    `КАМ: ${kamParsed.rows.length}, админ: ${parsed.rows.length}`,
  );
  const kamOwners = new Set(kamParsed.rows.map((r) => r.ownerName));
  check('в отчёте только собственные записи', kamOwners.size === 1, [...kamOwners].join(', '));

  console.log('\n5. Формат CSV');
  const csv = await requestReport(admin, { columns: defaults, format: 'CSV', filters: {} });
  check('ответ 200', csv.status === 200);
  const csvText = csv.buffer.toString('utf8');
  check('файл начинается с BOM (Excel откроет кириллицу верно)', csvText.charCodeAt(0) === 0xfeff);
  check('разделитель — точка с запятой', csvText.split('\r\n')[0].includes(';'));
  check('кириллица не искажена', csvText.includes('Наименование вуза'), csvText.slice(1, 60));

  console.log('\n6. Формат XLSX и содержимое файла');
  const xlsx = await requestReport(admin, {
    title: 'Отчёт XLSX',
    columns: ['universityName', 'directionName', 'stateLabel', 'ownerName'],
    format: 'XLSX',
    filters: {},
  });
  check('ответ 200', xlsx.status === 200, `${xlsx.status}`);
  check(
    'имя файла передано в кодировке UTF-8',
    (xlsx.headers.get('content-disposition') ?? '').includes("filename*=UTF-8''"),
  );

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(xlsx.buffer);
  const sheet = workbook.worksheets[0];
  check('лист прочитан', Boolean(sheet), sheet?.name);
  const allRows = [];
  sheet.eachRow((row) => allRows.push(row.values));
  check('шапка содержит заголовок отчёта', String(allRows[0]?.[1] ?? '').includes('Отчёт XLSX'));
  const headerRowIndex = allRows.findIndex((r) => String(r?.[1] ?? '') === 'Наименование вуза');
  check('строка заголовков колонок найдена', headerRowIndex > 0, `индекс ${headerRowIndex}`);
  check(
    'данные присутствуют',
    allRows.length > headerRowIndex + 1,
    `строк в листе: ${allRows.length}`,
  );
  console.log(`       заголовки: ${JSON.stringify(allRows[headerRowIndex]?.slice(1))}`);
  console.log(`       первая строка данных: ${JSON.stringify(allRows[headerRowIndex + 1]?.slice(1))}`);

  console.log('\n7. Формат PDF формируется фоновой задачей');
  const pdf = await requestReport(admin, {
    title: 'Отчёт PDF',
    columns: ['universityName', 'directionName', 'stateLabel'],
    format: 'PDF',
    filters: {},
  });
  check('ответ 202 (поставлен в очередь)', pdf.status === 202, `${pdf.status}`);
  check('получен идентификатор задачи', Boolean(pdf.json?.jobId));

  const pdfJob = await waitForJob(pdf.json.jobId, admin);
  check('задача завершена', pdfJob?.status === 'COMPLETED', `${pdfJob?.status} ${pdfJob?.errorDetail ?? ''}`);
  check('размер файла ненулевой', (pdfJob?.sizeBytes ?? 0) > 1000, `${pdfJob?.sizeBytes} байт`);

  const pdfDownload = await fetch(`${API}/api/v1/reports/${pdf.json.jobId}/download`, {
    headers: { Authorization: `Bearer ${admin}` },
  });
  const pdfBuffer = Buffer.from(await pdfDownload.arrayBuffer());
  check('файл скачан', pdfDownload.status === 200, `${pdfDownload.status}`);
  check(
    'это действительно PDF',
    pdfBuffer.subarray(0, 5).toString('ascii') === '%PDF-',
    pdfBuffer.subarray(0, 5).toString('ascii'),
  );
  // Кириллица в PDF кодируется внутри потоков, поэтому проверяем косвенно:
  // документ со встроенным шрифтом заметно больше пустого.
  check('шрифт встроен (кириллица отобразится)', pdfBuffer.length > 20_000, `${pdfBuffer.length} байт`);
  console.log(`       размер PDF: ${(pdfBuffer.length / 1024).toFixed(1)} КБ`);

  console.log('\n8. Одинаковые запросы объединяются кэшем');
  const repeat = await requestReport(admin, {
    title: 'Отчёт PDF',
    columns: ['universityName', 'directionName', 'stateLabel'],
    format: 'PDF',
    filters: {},
  });
  check('повтор принят', repeat.status === 202, `${repeat.status}`);
  check('отчёт взят из кэша, а не пересчитан', repeat.json?.fromCache === true, `${repeat.json?.fromCache}`);
  check('идентификатор тот же', repeat.json?.jobId === pdf.json.jobId);

  console.log('\n9. Чужой отчёт недоступен');
  const foreign = await api(`/api/v1/reports/${pdf.json.jobId}`, kam);
  check('ответ 404', foreign.status === 404, `${foreign.status}`);
  check('код CRM-REP-0003', foreign.body?.code === 'CRM-REP-0003', foreign.body?.code);

  console.log('\n10. Фильтр по статусу применяется');
  const filtered = await requestReport(admin, {
    columns: ['universityName', 'stateLabel'],
    format: 'JSON',
    filters: { stateKeys: ['SIGNING'] },
  });
  const filteredParsed = JSON.parse(filtered.buffer.toString('utf8'));
  const states = new Set(filteredParsed.rows.map((r) => r.stateLabel));
  check(
    'все строки в запрошенном статусе',
    states.size <= 1,
    `статусов в выдаче: ${[...states].join(', ')}`,
  );
  check('фильтр описан в шапке файла', filteredParsed.filters.some((f) => f.includes('статусов')));

  console.log('\n11. Неизвестный формат отклоняется');
  const badFormat = await requestReport(admin, {
    columns: defaults,
    format: 'DOCX',
  });
  check('ответ 422', badFormat.status === 422, `${badFormat.status}`);

  console.log(failures === 0 ? '\nВсе проверки пройдены.\n' : `\nПроверок не пройдено: ${failures}.\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('Ошибка выполнения проверок:', error);
  process.exitCode = 1;
});
