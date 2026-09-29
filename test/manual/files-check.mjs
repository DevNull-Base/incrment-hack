/**
 * Ручная проверка работы с вложениями.
 *
 * Главное, что здесь проверяется, — что тип файла определяется по
 * содержимому, а не по расширению: подменённое расширение не должно
 * пропускать в хранилище произвольный файл.
 *
 * Запуск (API и Keycloak должны быть подняты):
 *   node test/manual/files-check.mjs
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
  if (!data.access_token) throw new Error(`Нет токена для ${username}`);
  return data.access_token;
}

async function api(path, accessToken, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, ...(options.headers ?? {}) },
  });
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('json') ? await response.json().catch(() => null) : null;
  return { status: response.status, body, headers: response.headers, raw: response };
}

async function uploadFile(engagementId, accessToken, fileName, bytes, mimeType) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mimeType }), fileName);

  const response = await fetch(`${API}/api/v1/engagements/${engagementId}/attachments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });

  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

/** Минимальный корректный PNG (сигнатура + обязательные чанки). */
function makePng() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
}

/** Минимальный корректный PDF. */
function makePdf() {
  return Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
      '2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n' +
      'trailer<</Root 1 0 R>>\n%%EOF\n',
    'utf8',
  );
}

async function main() {
  const admin = await token('admin.sidorov', 'Adm#2026demo');
  const kam = await token('kam.ivanova', 'Kam#2026demo');

  const list = await api('/api/v1/engagements?limit=1', admin);
  const engagementId = list.body.items[0].id;
  console.log(`\nКарточка для проверки: ${list.body.items[0].universityName}`);

  console.log('\n1. Загрузка корректного PNG');
  const png = await uploadFile(engagementId, admin, 'схема-внедрения.png', makePng(), 'image/png');
  check('ответ 201', png.status === 201, `${png.status} ${png.body?.code ?? ''}`);
  check('тип определён как image/png', png.body?.mimeType === 'image/png', png.body?.mimeType);
  check('имя с кириллицей сохранено', png.body?.fileName === 'схема-внедрения.png', png.body?.fileName);
  check('контрольная сумма вычислена', (png.body?.sha256 ?? '').length === 64);
  check(
    'статус проверки SKIPPED (сканер отключён), а не CLEAN',
    png.body?.scanStatus === 'SKIPPED',
    png.body?.scanStatus,
  );

  console.log('\n2. Загрузка PDF');
  const pdf = await uploadFile(engagementId, admin, 'договор.pdf', makePdf(), 'application/pdf');
  check('ответ 201', pdf.status === 201, `${pdf.status} ${pdf.body?.code ?? ''}`);
  check('тип определён как application/pdf', pdf.body?.mimeType === 'application/pdf', pdf.body?.mimeType);

  console.log('\n3. Подмена расширения: исполняемый файл под видом PDF');
  // Сигнатура MZ — исполняемый файл Windows. Расширение и Content-Type лгут.
  const fakeExe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(2048, 0x41)]);
  const disguised = await uploadFile(engagementId, admin, 'важный-документ.pdf', fakeExe, 'application/pdf');
  check(
    'загрузка отклонена',
    disguised.status === 415 || disguised.status === 422,
    `${disguised.status} ${disguised.body?.code ?? ''}`,
  );
  check('код ошибки CRM-FIL-0002', disguised.body?.code === 'CRM-FIL-0002', disguised.body?.code);
  console.log(`       причина: ${disguised.body?.detail ?? ''}`);

  console.log('\n4. Неизвестный формат отклоняется');
  const textFile = Buffer.from('обычный текстовый файл, не входящий в список форматов', 'utf8');
  const text = await uploadFile(engagementId, admin, 'заметка.txt', textFile, 'text/plain');
  check('загрузка отклонена', text.body?.code === 'CRM-FIL-0002', `${text.status} ${text.body?.code}`);

  console.log('\n5. Дедупликация одинакового содержимого');
  const duplicate = await uploadFile(engagementId, admin, 'копия-схемы.png', makePng(), 'image/png');
  check('вторая загрузка принята', duplicate.status === 201, `${duplicate.status}`);
  check(
    'контрольная сумма совпадает с первой загрузкой',
    duplicate.body?.sha256 === png.body?.sha256,
  );

  console.log('\n6. Список вложений');
  const attachments = await api(`/api/v1/engagements/${engagementId}/attachments`, admin);
  check('ответ 200', attachments.status === 200);
  check('видны загруженные файлы', (attachments.body?.length ?? 0) >= 3, `${attachments.body?.length}`);
  for (const item of attachments.body ?? []) {
    console.log(`       ${item.fileName} | ${item.mimeType} | ${item.sizeBytes} Б | ${item.scanStatus}`);
  }

  console.log('\n7. Скачивание возвращает исходное содержимое');
  const downloadResponse = await fetch(
    `${API}/api/v1/engagements/${engagementId}/attachments/${png.body.id}`,
    { headers: { Authorization: `Bearer ${admin}` } },
  );
  const downloaded = Buffer.from(await downloadResponse.arrayBuffer());
  check('ответ 200', downloadResponse.status === 200, `${downloadResponse.status}`);
  check('содержимое совпадает побайтово', downloaded.equals(makePng()), `${downloaded.length} байт`);
  const disposition = downloadResponse.headers.get('content-disposition') ?? '';
  check('имя файла передано в кодировке UTF-8', disposition.includes("filename*=UTF-8''"), disposition);
  check(
    'кэширование запрещено (файл может содержать персональные данные)',
    (downloadResponse.headers.get('cache-control') ?? '').includes('no-store'),
    downloadResponse.headers.get('cache-control') ?? '',
  );

  console.log('\n8. Чужие вложения недоступны');
  const kamOwn = await api('/api/v1/engagements?limit=200', kam);
  const kamIds = new Set((kamOwn.body.items ?? []).map((i) => i.id));
  if (!kamIds.has(engagementId)) {
    const foreignList = await api(`/api/v1/engagements/${engagementId}/attachments`, kam);
    check('список вложений чужой карточки недоступен', foreignList.status === 404, `${foreignList.status}`);
    const foreignDownload = await api(
      `/api/v1/engagements/${engagementId}/attachments/${png.body.id}`,
      kam,
    );
    check('скачивание чужого файла невозможно', foreignDownload.status === 404, `${foreignDownload.status}`);
  } else {
    console.log('       карточка принадлежит менеджеру — проверка пропущена');
  }

  console.log('\n9. Удаление файла');
  const removed = await fetch(
    `${API}/api/v1/engagements/${engagementId}/attachments/${duplicate.body.id}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${admin}` } },
  );
  check('ответ 204', removed.status === 204, `${removed.status}`);

  const afterDelete = await api(`/api/v1/engagements/${engagementId}/attachments`, admin);
  check(
    'удалённый файл исчез из списка',
    !(afterDelete.body ?? []).some((i) => i.id === duplicate.body.id),
  );

  console.log('\n10. Файл, загруженный ранее, по-прежнему доступен (дедупликация не оборвана)');
  const stillThere = await fetch(
    `${API}/api/v1/engagements/${engagementId}/attachments/${png.body.id}`,
    { headers: { Authorization: `Bearer ${admin}` } },
  );
  check(
    'первый файл скачивается после удаления его дубликата',
    stillThere.status === 200,
    `${stillThere.status}`,
  );

  console.log(failures === 0 ? '\nВсе проверки пройдены.\n' : `\nПроверок не пройдено: ${failures}.\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('Ошибка выполнения проверок:', error);
  process.exitCode = 1;
});
