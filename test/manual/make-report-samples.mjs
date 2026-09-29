/**
 * Формирует образцы отчётов для визуальной проверки.
 *
 * Размер файла и сигнатура подтверждают лишь то, что документ создан.
 * Правильность вёрстки и отображение кириллицы проверяются только
 * просмотром готового файла.
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const API = 'http://localhost:3000';
const KEYCLOAK = 'http://localhost:8080';

async function token(username, password) {
  const r = await fetch(`${KEYCLOAK}/realms/rtk-crm/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'crm-frontend', username, password }),
  });
  return (await r.json()).access_token;
}

async function requestReport(accessToken, payload) {
  const r = await fetch(`${API}/api/v1/reports`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const isFile = (r.headers.get('content-disposition') ?? '').includes('attachment');
  if (isFile) return { file: Buffer.from(await r.arrayBuffer()) };
  return { job: await r.json() };
}

async function waitAndDownload(jobId, accessToken) {
  for (let i = 0; i < 90; i++) {
    const s = await fetch(`${API}/api/v1/reports/${jobId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }).then((r) => r.json());
    if (s.status === 'COMPLETED') break;
    if (s.status === 'FAILED') throw new Error(`Задача завершилась с ошибкой: ${s.errorDetail}`);
    await new Promise((r) => setTimeout(r, 700));
  }
  const d = await fetch(`${API}/api/v1/reports/${jobId}/download`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return Buffer.from(await d.arrayBuffer());
}

const admin = await token('admin.sidorov', 'Adm#2026demo');
mkdirSync('samples', { recursive: true });

const columns = ['universityName', 'universityRegion', 'directionName', 'stateLabel', 'ownerName'];

const xlsx = await requestReport(admin, {
  title: 'Взаимодействия с вузами по ИТ-направлениям',
  columns: [...columns, 'productName', 'licenseTransferStatus', 'isOverdue'],
  format: 'XLSX',
  filters: {},
});
writeFileSync('samples/otchet.xlsx', xlsx.file);
console.log('samples/otchet.xlsx —', (xlsx.file.length / 1024).toFixed(1), 'КБ');

const pdfJob = await requestReport(admin, {
  title: 'Взаимодействия с вузами по ИТ-направлениям',
  columns,
  format: 'PDF',
  filters: { periodFrom: '2025-01-01' },
});
const pdf = await waitAndDownload(pdfJob.job.jobId, admin);
writeFileSync('samples/otchet.pdf', pdf);
console.log('samples/otchet.pdf —', (pdf.length / 1024).toFixed(1), 'КБ');

const csv = await requestReport(admin, { title: 'Взаимодействия', columns, format: 'CSV', filters: {} });
writeFileSync('samples/otchet.csv', csv.file);
console.log('samples/otchet.csv —', (csv.file.length / 1024).toFixed(1), 'КБ');
