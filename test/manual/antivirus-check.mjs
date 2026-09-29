/**
 * Проверка антивирусного контроля загружаемых файлов (мера АВЗ).
 *
 * Используется стандартный тестовый образец EICAR — безвредная строка,
 * которую все антивирусы обязаны распознавать как угрозу. Это позволяет
 * проверить срабатывание защиты, не имея дела с реальным вредоносным кодом.
 *
 * Требует запущенного ClamAV и CLAMAV_ENABLED=true.
 *   docker compose --profile security up -d clamav
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
  if (!d.access_token) throw new Error('Нет токена');
  return d.access_token;
}

async function upload(engagementId, accessToken, fileName, bytes) {
  const form = new FormData();
  form.append('file', new Blob([bytes]), fileName);
  const r = await fetch(`${API}/api/v1/engagements/${engagementId}/attachments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

function makePng() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
}

/**
 * Тестовый образец EICAR внутри ZIP-контейнера.
 *
 * Голый EICAR — текстовый файл, а текст не входит в список разрешённых
 * форматов и был бы отклонён ещё проверкой типа, не дойдя до антивируса.
 * Поэтому образец упаковывается в ZIP: формат разрешён, и проверка
 * доходит до сканера, который обязан найти угрозу внутри архива.
 */
function makeInfectedZip() {
  const eicar =
    'X5O!P%@AP[4' + String.fromCharCode(92) + 'PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
  const content = Buffer.from(eicar, 'ascii');
  const name = Buffer.from('eicar.com', 'ascii');

  // Минимальный ZIP без сжатия (метод 0). CRC32 вычисляется ниже.
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of content) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  crc = (crc ^ 0xffffffff) >>> 0;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(0, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(content.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(content.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42);

  const localSize = local.length + name.length + content.length;
  const centralSize = central.length + name.length;

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(localSize, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([local, name, content, central, name, end]);
}

async function main() {
  const admin = await token('admin.sidorov', 'Adm#2026demo');

  const list = await fetch(`${API}/api/v1/engagements?limit=1`, {
    headers: { Authorization: `Bearer ${admin}` },
  }).then((r) => r.json());
  const engagementId = list.items[0].id;

  console.log('\n1. Чистый файл при включённом сканере получает статус CLEAN');
  const clean = await upload(engagementId, admin, 'чистый-файл.png', makePng());
  check('загрузка принята', clean.status === 201, `${clean.status} ${clean.body?.code ?? ''}`);
  check(
    'проверка проведена, статус CLEAN',
    clean.body?.scanStatus === 'CLEAN',
    `получен ${clean.body?.scanStatus} (SKIPPED означает, что сканер выключен)`,
  );

  console.log('\n2. Заражённый файл отклоняется');
  const infected = await upload(engagementId, admin, 'архив-с-угрозой.zip', makeInfectedZip());
  check('загрузка отклонена', infected.status === 422, `${infected.status}`);
  check('код ошибки CRM-FIL-0003', infected.body?.code === 'CRM-FIL-0003', infected.body?.code);
  console.log(`       ${infected.body?.detail ?? ''}`);

  console.log('\n3. Заражённый файл не попал в список вложений');
  const attachments = await fetch(`${API}/api/v1/engagements/${engagementId}/attachments`, {
    headers: { Authorization: `Bearer ${admin}` },
  }).then((r) => r.json());
  check(
    'файла с угрозой нет в карточке',
    !attachments.some((a) => a.fileName === 'архив-с-угрозой.zip'),
  );

  console.log(failures === 0 ? '\nВсе проверки пройдены.\n' : `\nПроверок не пройдено: ${failures}.\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error('Ошибка выполнения проверок:', e);
  process.exitCode = 1;
});
