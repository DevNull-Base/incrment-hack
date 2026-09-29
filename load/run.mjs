/**
 * Нагрузочная проверка API.
 *
 * Техническое задание требует отклика не более секунды при 50 параллельных
 * пользователях и не менее 10 параллельных отчётов разной сложности; на
 * сессии вопросов и ответов прозвучало, что стоит предусмотреть 300 и более
 * пользователей. Инструмент воспроизводит работу менеджера, а не обстрел
 * одного адреса, и печатает не только время, но и коды ответов: быстрый
 * отказ не должен выглядеть быстрым ответом.
 *
 * Сценарии:
 *   workday  — рабочий день: список, карточка, заметки, поиск, уведомления,
 *              каталог вузов, лента действий, задачи календаря;
 *   mixed    — то же плюс запись: заметка и переход по этапу с проверкой версии;
 *   reports  — отчёты разного объёма и формата до готового файла: синхронные
 *              отдаются сразу, из очереди — ожидание готовности и скачивание;
 *   login    — вход в интерфейс: всё, что фронтенд загружает при старте.
 *
 * Сессии идут без пауз, то есть каждая — это непрерывный поток запросов,
 * заметно плотнее живого человека. Нагрузку создают несколько процессов
 * (--procs), чтобы генератор сам не стал узким местом.
 *
 * Запуск:
 *   node load/run.mjs --api http://localhost:3000 --users 300 --seconds 60 --procs 4
 *   node load/run.mjs --scenario mixed --users 100
 *   node load/run.mjs --scenario reports --users 10 --seconds 120
 *   node load/run.mjs --scenario login --users 10 --seconds 60
 *   … --out result.json --label "1 экземпляр" --monitor
 */
import { fork, execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);

function arg(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : fallback;
}
const flag = (name) => args.includes(`--${name}`);

const API = process.env.API_URL ?? arg('api', 'http://localhost:3000');
const KEYCLOAK = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'rtk-crm';
const USERS = Number(arg('users', '50'));
const SECONDS = Number(arg('seconds', '60'));
const SCENARIO = arg('scenario', 'workday');
const PROCS = Math.max(1, Math.min(Number(arg('procs', '1')), USERS));
const OUT = arg('out', null);
const LABEL = arg('label', `${SCENARIO}, ${USERS} сессий`);

/** Учётные записи стенда: нагрузка идёт от всех ролей, как в жизни. */
const ACCOUNTS = [
  { username: 'kam.ivanova', password: 'Kam#2026demo' },
  { username: 'kam.orlov', password: 'Kam#2026demo' },
  { username: 'manager.petrov', password: 'Mgr#2026demo' },
  { username: 'admin.sidorov', password: 'Adm#2026demo' },
];

// ---------------------------------------------------------------- замеры

class Measurement {
  constructor(label) {
    this.label = label;
    this.samples = [];
    this.statuses = {};
  }

  add(ms, status) {
    this.samples.push(ms);
    this.statuses[status] = (this.statuses[status] ?? 0) + 1;
  }

  merge(other) {
    for (const value of other.samples) this.samples.push(value);
    for (const [status, count] of Object.entries(other.statuses)) {
      this.statuses[status] = (this.statuses[status] ?? 0) + count;
    }
  }

  get errors() {
    // 409 — отказ по версии карточки: штатная защита от одновременной правки,
    // а не сбой; считается отдельно в распределении кодов.
    return Object.entries(this.statuses)
      .filter(([status]) => Number(status) >= 400 && Number(status) !== 409)
      .reduce((sum, [, count]) => sum + count, 0);
  }

  summary() {
    const sorted = [...this.samples].sort((a, b) => a - b);
    const pct = (p) =>
      sorted.length === 0 ? 0 : sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1))];
    const avg = sorted.length === 0 ? 0 : sorted.reduce((s, v) => s + v, 0) / sorted.length;
    return {
      label: this.label,
      count: sorted.length,
      avg: Math.round(avg),
      p50: Math.round(pct(50)),
      p95: Math.round(pct(95)),
      p99: Math.round(pct(99)),
      max: Math.round(sorted.at(-1) ?? 0),
      errors: this.errors,
      statuses: this.statuses,
    };
  }
}

const measurements = new Map();
function measure(label) {
  if (!measurements.has(label)) measurements.set(label, new Measurement(label));
  return measurements.get(label);
}

async function timed(label, fn) {
  const started = performance.now();
  let status;
  try {
    status = await fn();
  } catch {
    status = 599;
  }
  measure(label).add(performance.now() - started, status);
  return status;
}

// ---------------------------------------------------------------- HTTP

async function request(path, token, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });
  return response;
}

/** Обращение с полным вычитыванием тела: иначе замер покажет время до заголовков. */
async function call(path, token, options = {}) {
  const response = await request(path, token, options);
  await response.arrayBuffer();
  return response.status;
}

async function callJson(path, token, options = {}) {
  const response = await request(path, token, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: response.status, body, headers: response.headers };
}

async function token(account) {
  const response = await fetch(`${KEYCLOAK}/realms/${REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'crm-frontend',
      username: account.username,
      password: account.password,
    }),
  });
  const data = await response.json();
  if (!data.access_token) throw new Error(`Не получен токен для ${account.username}`);
  return data.access_token;
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const between = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

// ---------------------------------------------------------------- сценарии

/**
 * Рабочий день. Карточка берётся из заявок, видимых этой учётной записи:
 * КАМ не открывает чужие, и замер не должен состоять из отказов 404.
 */
async function workdayIteration(ctx) {
  await timed('список заявок', () => call(`/api/v1/engagements?limit=25&page=${between(1, 20)}`, ctx.token));
  const id = pick(ctx.ids);
  let card = null;
  await timed('карточка заявки', async () => {
    const result = await callJson(`/api/v1/engagements/${id}`, ctx.token);
    card = result;
    return result.status;
  });
  await timed('заметки заявки', () => call(`/api/v1/engagements/${id}/notes`, ctx.token));
  await timed('поиск и отбор', () =>
    call(`/api/v1/engagements?limit=25&search=${encodeURIComponent(`УЗ-${between(1, 99)}`)}&segment=B2B`, ctx.token),
  );
  await timed('счётчик уведомлений', () => call('/api/v1/notifications/unread-count', ctx.token));
  await timed('каталог вузов', () => call(`/api/v1/catalog/universities?limit=25&page=${between(1, 20)}`, ctx.token));
  await timed('лента действий', () => call('/api/v1/activity/feed?limit=20', ctx.token));
  await timed('задачи календаря', () => call('/api/v1/calendar/tasks?limit=50', ctx.token));
  return card;
}

/**
 * С записью: к рабочему дню добавляются заметка и переход по этапу.
 * Переход выбирается из доступных карточке и отправляется с версией,
 * прочитанной вместе с ней, — как это делает интерфейс.
 */
async function mixedIteration(ctx) {
  const card = await workdayIteration(ctx);
  const id = card?.body?.id;
  if (!id) return;

  await timed('новая заметка', () =>
    call(`/api/v1/engagements/${id}/notes`, ctx.token, {
      method: 'POST',
      body: JSON.stringify({ body: 'Нагрузочная проверка: заметка по итогам звонка' }),
    }),
  );

  const options = (card.body.availableTransitions ?? []).filter((t) => t.allowed && !t.requiresAttachment);
  const next = options.length > 0 ? pick(options) : null;
  if (!next) return;

  await timed('переход по этапу', () =>
    call(`/api/v1/engagements/${id}/transition`, ctx.token, {
      method: 'POST',
      headers: { 'If-Match': card.headers.get('etag') ?? `W/"${card.body.version}"` },
      body: JSON.stringify({ toStateKey: next.toStateKey, comment: 'Нагрузочная проверка' }),
    }),
  );
}

/**
 * Отчёты разной сложности. Заголовок уникален: иначе повторный запрос
 * отдаётся из кэша готовых файлов, и замер показывал бы кэш, а не расчёт.
 */
let reportCounter = 0;
const REPORT_COLUMNS = ['universityName', 'counterparty', 'directionName', 'productName', 'stateLabel', 'ownerName', 'createdAt', 'daysInState'];

async function reportsIteration(ctx) {
  const variant = pick(ctx.reportVariants);
  const title = `Нагрузка ${process.pid}-${++reportCounter}`;
  const label = `${variant.name}, ${variant.format.toLowerCase()}`;
  const started = performance.now();

  const created = await callJson('/api/v1/reports', ctx.token, {
    method: 'POST',
    body: JSON.stringify({ columns: REPORT_COLUMNS, filters: variant.filters, format: variant.format, title }),
  });
  measure(`ответ API: ${label}`).add(performance.now() - started, created.status);

  if (created.status !== 202) return;

  // Из очереди: ждём готовности и скачиваем файл.
  const jobId = created.body?.jobId;
  let status = 'QUEUED';
  while (status === 'QUEUED' || status === 'RUNNING') {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const job = await callJson(`/api/v1/reports/${jobId}`, ctx.token);
    status = job.body?.status ?? 'FAILED';
  }
  const downloadStatus = status === 'COMPLETED' ? await call(`/api/v1/reports/${jobId}/download`, ctx.token) : 500;
  measure(`файл готов: ${label}`).add(performance.now() - started, downloadStatus);
}

/**
 * Вход в интерфейс: то, что фронтенд запрашивает сразу после входа
 * (app/store/api-data.ts), — каталоги, заявки постранично по 200,
 * уведомления, задачи, лента. Замеряется время до готового интерфейса.
 */
async function fetchAllPages(path, token, maxItems = 10_000) {
  let items = 0;
  for (let page = 1; items < maxItems; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const { status, body } = await callJson(`${path}${sep}page=${page}&limit=200`, token);
    if (status !== 200) return status;
    items += body.items.length;
    if (!body.meta?.hasNext) break;
  }
  return 200;
}

async function loginIteration(ctx) {
  await timed(`вход: ${ctx.role}`, async () => {
    const statuses = await Promise.all([
      call('/api/v1/auth/me', ctx.token),
      fetchAllPages('/api/v1/catalog/universities', ctx.token),
      fetchAllPages('/api/v1/catalog/programs', ctx.token),
      fetchAllPages('/api/v1/catalog/products', ctx.token),
      // Один список вместе с архивом: признак архива приходит в строке.
      fetchAllPages('/api/v1/engagements?includeArchived=true', ctx.token),
      fetchAllPages('/api/v1/notifications', ctx.token, 1000),
      call('/api/v1/calendar/tasks?limit=200', ctx.token),
      call('/api/v1/activity/feed?limit=200', ctx.token),
    ]);
    return statuses.find((s) => s !== 200) ?? 200;
  });
}

const ITERATIONS = { workday: workdayIteration, mixed: mixedIteration, reports: reportsIteration, login: loginIteration, 'report-each': reportsIteration };

async function runSessions(contexts, deadline) {
  const iteration = ITERATIONS[SCENARIO];
  await Promise.all(
    contexts.map(async (ctx, index) => {
      // Разнос старта на секунду: одновременный первый залп — не рабочая картина.
      await new Promise((resolve) => setTimeout(resolve, (index % 50) * 20));
      while (performance.now() < deadline) {
        try {
          await iteration(ctx);
        } catch {
          measure('сбои сети').add(0, 599);
        }
      }
    }),
  );
}

// ---------------------------------------------------------------- агент

if (process.argv.includes('--agent')) {
  process.on('message', async ({ sessions, seconds }) => {
    const deadline = performance.now() + seconds * 1000;
    await runSessions(sessions, deadline);
    const cpu = process.cpuUsage();
    process.send({
      cpuSeconds: (cpu.user + cpu.system) / 1e6,
      measurements: [...measurements.values()].map((m) => ({ label: m.label, samples: m.samples, statuses: m.statuses })),
    });
    process.exit(0);
  });
} else {
  main().catch((error) => {
    console.error('Ошибка нагрузочной проверки:', error);
    process.exitCode = 1;
  });
}

// ---------------------------------------------------------------- наблюдение за ресурсами

/**
 * Процессорное время процессов приложения (секунды) — отдельно API и worker.
 * Машина одна на всех, и без этой раскладки нельзя сказать, упёрлась ли
 * система в API, в базу или в сам генератор нагрузки.
 */
function appCpuSeconds() {
  const script =
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object { " +
    "$kind = if ($_.CommandLine -like '*cluster.mjs*') { 'api' } elseif ($_.CommandLine -like '*worker.js*') { 'worker' } else { '' }; " +
    "if ($kind) { \"$kind $(($_.KernelModeTime + $_.UserModeTime) / 1e7)\" } }";
  return new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-Command', script], { windowsHide: true }, (error, stdout) => {
      const totals = { api: 0, worker: 0 };
      for (const line of String(stdout).split(/\r?\n/)) {
        const [kind, seconds] = line.trim().split(' ');
        if (kind in totals) totals[kind] += Number(String(seconds).replace(',', '.')) || 0;
      }
      resolve(error ? null : totals);
    });
  });
}

/** Загрузка процессора машины и контейнера PostgreSQL во время прогона. */
function startMonitor() {
  const host = [];
  const appStart = appCpuSeconds();
  const startedAt = performance.now();
  const postgres = [];
  // Загрузка по счётчикам ядер: имена системных счётчиков Windows
  // локализованы, а os.cpus() одинаков в любой системе.
  const snapshot = () =>
    os.cpus().reduce(
      (acc, cpu) => {
        const t = cpu.times;
        acc.busy += t.user + t.nice + t.sys + t.irq;
        acc.total += t.user + t.nice + t.sys + t.irq + t.idle;
        return acc;
      },
      { busy: 0, total: 0 },
    );
  let previous = snapshot();
  const hostTimer = setInterval(() => {
    const current = snapshot();
    host.push((100 * (current.busy - previous.busy)) / Math.max(1, current.total - previous.total));
    previous = current;
  }, 2000);
  // PostgreSQL — по счётчику процессорного времени контейнера (cgroup):
  // разовый снимок docker stats на Windows показывает случайные значения.
  let stopped = false;
  let pgPrevious = null;
  const pollPostgres = () => {
    if (stopped) return;
    execFile('docker', ['exec', 'crm-postgres', 'cat', '/sys/fs/cgroup/cpu.stat'], (error, stdout) => {
      const usage = Number(/usage_usec (\d+)/.exec(String(stdout))?.[1]);
      const now = performance.now();
      if (!error && usage) {
        if (pgPrevious) postgres.push((100 * (usage - pgPrevious.usage)) / ((now - pgPrevious.at) * 1000));
        pgPrevious = { usage, at: now };
      }
      setTimeout(pollPostgres, 2000);
    });
  };
  pollPostgres();
  return async (generatorCpuSeconds) => {
    stopped = true;
    clearInterval(hostTimer);
    const seconds = (performance.now() - startedAt) / 1000;
    const [appBefore, appAfter] = [await appStart, await appCpuSeconds()];
    const cores = (value) => Math.round((value / seconds) * 100) / 100;
    const app =
      appBefore && appAfter
        ? { apiCores: cores(appAfter.api - appBefore.api), workerCores: cores(appAfter.worker - appBefore.worker) }
        : null;
    const stats = (values) =>
      values.length === 0
        ? null
        : { avg: Math.round(values.reduce((s, v) => s + v, 0) / values.length), max: Math.round(Math.max(...values)) };
    // Первые отсчёты приходятся на разгон, последние — на остановку.
    return {
      hostCpu: stats(host.slice(1, -1)),
      postgresCpu: stats(postgres.slice(1, -1)),
      ...app,
      generatorCores: cores(generatorCpuSeconds),
    };
  };
}

// ---------------------------------------------------------------- основной процесс

async function main() {
  console.log(`Нагрузочная проверка: ${API}`);
  console.log(`Сценарий: ${SCENARIO}, сессий: ${USERS}, процессов нагрузки: ${PROCS}, длительность: ${SECONDS} с`);

  // Токены и списки видимых заявок готовятся до замера и в него не входят.
  const tokens = await Promise.all(ACCOUNTS.map(token));
  const ids = await Promise.all(
    tokens.map(async (t) => {
      const list = [];
      for (let page = 1; page <= 5; page++) {
        const { body } = await callJson(`/api/v1/engagements?limit=200&page=${page}`, t);
        list.push(...(body?.items ?? []).map((item) => item.id));
        if (!body?.meta?.hasNext) break;
      }
      return list;
    }),
  );

  // Варианты отчётов: объём задаётся отбором (администратор видит всё).
  const reportVariants = await buildReportVariants(tokens[3]);

  const sessions = Array.from({ length: USERS }, (_, index) => {
    // Отчёты формирует администратор — ему доступен весь объём; остальные
    // сценарии идут от всех четырёх ролей по кругу.
    const account = SCENARIO === 'reports' ? 3 : index % ACCOUNTS.length;
    const role = ['КАМ', 'КАМ', 'руководитель', 'администратор'][account];
    return { token: tokens[account], ids: ids[account], reportVariants, role };
  });

  const stopMonitor = flag('monitor') ? startMonitor() : null;
  const started = Date.now();
  const cpuBefore = process.cpuUsage();
  let agentCpuSeconds = 0;

  if (SCENARIO === 'report-each') {
    // Каждый вид отчёта отдельно и по очереди: время одного отчёта без
    // соседей — то, что увидит пользователь на свободной системе.
    const repeats = Number(arg('repeats', '3'));
    for (const variant of reportVariants) {
      for (let i = 0; i < repeats; i++) {
        await reportsIteration({ token: tokens[3], reportVariants: [variant] });
      }
    }
  } else if (PROCS === 1) {
    await runSessions(sessions, performance.now() + SECONDS * 1000);
  } else {
    const self = fileURLToPath(import.meta.url);
    const results = await Promise.all(
      Array.from({ length: PROCS }, (_, p) => {
        const share = sessions.filter((_, index) => index % PROCS === p);
        return new Promise((resolve, reject) => {
          const child = fork(self, [...args, '--agent']);
          child.on('message', resolve);
          child.on('error', reject);
          child.send({ sessions: share, seconds: SECONDS });
        });
      }),
    );
    for (const result of results) {
      agentCpuSeconds += result.cpuSeconds ?? 0;
      for (const m of result.measurements) {
        const target = measure(m.label);
        const incoming = new Measurement(m.label);
        incoming.samples = m.samples;
        incoming.statuses = m.statuses;
        target.merge(incoming);
      }
    }
  }

  const elapsed = (Date.now() - started) / 1000;
  const own = process.cpuUsage(cpuBefore);
  const generatorCpuSeconds = agentCpuSeconds + (own.user + own.system) / 1e6;
  const resources = stopMonitor ? await stopMonitor(generatorCpuSeconds) : null;
  report(elapsed, resources);
}

async function buildReportVariants(adminToken) {
  const { body: users } = await callJson('/api/v1/admin/users?limit=200', adminToken);
  const kams = (users?.items ?? []).filter((u) => u.email.startsWith('load.kam.')).map((u) => u.id);
  return [
    // ~1 200 строк — синхронно, файл в ответе.
    { name: '1 КАМ', filters: { ownerIds: kams.slice(0, 1) }, format: 'XLSX' },
    { name: '1 КАМ', filters: { ownerIds: kams.slice(0, 1) }, format: 'CSV' },
    // ~5 000 строк — предел PDF, через очередь.
    { name: '4 КАМа', filters: { ownerIds: kams.slice(0, 4) }, format: 'PDF' },
    // ~10 000 строк — очередь.
    { name: 'B2C целиком', filters: { segments: ['B2C'] }, format: 'XLSX' },
    { name: 'B2C целиком', filters: { segments: ['B2C'] }, format: 'XLS' },
    // ~50 000 строк — вся база.
    { name: 'вся база', filters: {}, format: 'XLSX' },
    { name: 'вся база', filters: {}, format: 'CSV' },
  ].filter((v) => !v.filters.ownerIds || v.filters.ownerIds.length > 0);
}

function report(elapsed, resources) {
  const rows = [...measurements.values()].map((m) => m.summary());
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  const errors = rows.reduce((sum, r) => sum + r.errors, 0);
  const statuses = {};
  for (const r of rows) for (const [s, c] of Object.entries(r.statuses)) statuses[s] = (statuses[s] ?? 0) + c;

  console.log('\n' + '='.repeat(96));
  console.log(
    'Обращение'.padEnd(34) + 'Запросов'.padStart(9) + 'Среднее'.padStart(10) + 'p50'.padStart(9) +
      'p95'.padStart(9) + 'p99'.padStart(9) + 'Макс'.padStart(9) + 'Ошибок'.padStart(8),
  );
  console.log('-'.repeat(96));
  for (const r of rows) {
    console.log(
      r.label.padEnd(34) + String(r.count).padStart(9) + `${r.avg} мс`.padStart(10) + `${r.p50} мс`.padStart(9) +
        `${r.p95} мс`.padStart(9) + `${r.p99} мс`.padStart(9) + `${r.max} мс`.padStart(9) + String(r.errors).padStart(8),
    );
  }
  console.log('-'.repeat(96));
  console.log('Коды ответов: ' + Object.entries(statuses).sort((a, b) => b[1] - a[1]).map(([s, c]) => `${s} — ${c}`).join(', '));
  console.log(`Всего: ${total} за ${elapsed.toFixed(1)} с, ${(total / elapsed).toFixed(0)} запросов в секунду, ошибок ${errors}`);
  if (resources) {
    console.log(
      `Процессор машины: в среднем ${resources.hostCpu?.avg ?? '—'}%, пик ${resources.hostCpu?.max ?? '—'}%; ` +
        `PostgreSQL: в среднем ${resources.postgresCpu?.avg ?? '—'}% ядра, пик ${resources.postgresCpu?.max ?? '—'}%`,
    );
    console.log(
      `Ядер занято: API ${resources.apiCores ?? '—'}, worker ${resources.workerCores ?? '—'}, ` +
        `PostgreSQL ${((resources.postgresCpu?.avg ?? 0) / 100).toFixed(2)}, генератор нагрузки ${resources.generatorCores}`,
    );
  }
  if (statuses[429]) {
    console.log(`ВНИМАНИЕ: ${statuses[429]} отказов по ограничению частоты — поднимите THROTTLE_LIMIT на время замера.`);
  }
  const worst = Math.max(0, ...rows.filter((r) => !r.label.startsWith('файл готов') && !r.label.startsWith('вход')).map((r) => r.p95));
  console.log(`Худший p95 интерактивных обращений: ${worst} мс`);

  if (OUT) {
    writeFileSync(
      OUT,
      JSON.stringify(
        { label: LABEL, scenario: SCENARIO, users: USERS, procs: PROCS, seconds: SECONDS, elapsed, total, errors,
          rps: Math.round(total / elapsed), statuses, resources, rows },
        null,
        2,
      ),
    );
  }
}
