import ExcelJS from 'exceljs';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { assertSafeZip } from '../../src/modules/files/zip-guard.js';

/** Минимальный ZIP-архив из заданных записей — без сторонних библиотек. */
function buildZip(entries: Array<{ name: string; data: Buffer; declaredSize?: number }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const compressed = deflateRawSync(entry.data);
    const size = entry.declaredSize ?? entry.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);

    locals.push(local, name, compressed);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
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

const LIMITS = { maxTotalBytes: 1024 * 1024, maxEntries: 10 };

/** Текст отказа: AppException несёт объяснение в detail, а не в message. */
function rejection(action: () => void): string {
  try {
    action();
  } catch (error: unknown) {
    return (error as { detail?: string }).detail ?? String(error);
  }
  return 'не отклонено';
}

describe('проверка архива книги перед разбором', () => {
  it('обычная книга Excel проходит', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Лист1').addRow(['Компания', 'Продукт']);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    expect(() => assertSafeZip(buffer)).not.toThrow();
  });

  it('ZIP-бомба отклоняется без распаковки целиком', () => {
    // 8 МБ нулей сжимаются в несколько килобайт.
    const bomb = buildZip([{ name: 'xl/worksheets/sheet1.xml', data: Buffer.alloc(8 * 1024 * 1024) }]);

    expect(bomb.length).toBeLessThan(64 * 1024);
    expect(rejection(() => assertSafeZip(bomb, LIMITS))).toMatch(/слишком большой объём/);
  });

  it('заниженный размер в оглавлении не помогает обойти проверку', () => {
    const lying = buildZip([{ name: 'a.xml', data: Buffer.alloc(4 * 1024 * 1024), declaredSize: 10 }]);

    expect(rejection(() => assertSafeZip(lying, LIMITS))).toMatch(/слишком большой объём/);
  });

  it('объём считается по всем записям вместе', () => {
    const many = buildZip(
      Array.from({ length: 5 }, (_, index) => ({ name: `part${index}.xml`, data: Buffer.alloc(300 * 1024) })),
    );

    expect(rejection(() => assertSafeZip(many, LIMITS))).toMatch(/слишком большой объём/);
  });

  it('слишком много записей', () => {
    const crowded = buildZip(Array.from({ length: 11 }, (_, index) => ({ name: `f${index}`, data: Buffer.from('x') })));

    expect(rejection(() => assertSafeZip(crowded, LIMITS))).toMatch(/записей/);
  });

  it('не архив — понятная ошибка, а не падение', () => {
    expect(rejection(() => assertSafeZip(Buffer.from('обычный текст'), LIMITS))).toMatch(/не является архивом/);
  });
});
