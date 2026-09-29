import {
  type ContactChannelValue,
  headerKey,
  joinFullName,
  normalizeEmail,
  normalizeNamePart,
  normalizePhone,
  parseContactChannels,
  splitNameList,
} from '../../common/utils/contact-normalization.js';
import { parseCellText } from '../import/import-fields.js';

/** Поле файла вендоров. */
export type VendorSheetField = 'vendorName' | 'products' | 'contactName' | 'phone' | 'email' | 'channels' | 'position';

/**
 * Синонимы заголовков. Сравнение идёт по буквам и цифрам (headerKey),
 * поэтому «E-mail», «email» и «Почта:» совпадают, а потерянные скобки
 * не мешают.
 */
const FIELD_SYNONYMS: Record<VendorSheetField, string[]> = {
  vendorName: ['компания', 'вендор', 'производитель', 'организация', 'поставщик', 'правообладатель', 'наименование компании'],
  products: ['продукт', 'продукты', 'по', 'программное обеспечение', 'ит продукт', 'ит продукты'],
  contactName: ['фио', 'контактное лицо', 'контакт', 'фио контактного лица', 'ответственный', 'представитель'],
  phone: ['телефон', 'номер телефона', 'тел', 'мобильный телефон', 'контактный телефон'],
  email: ['почта', 'email', 'e-mail', 'электронная почта', 'адрес почты', 'адрес электронной почты'],
  channels: ['способ связи', 'канал связи', 'предпочтительный способ связи', 'связь', 'как связаться'],
  position: ['должность', 'позиция'],
};

export interface VendorSheetContact {
  fullName: string;
  phone: string | null;
  email: string | null;
  position: string | null;
  channels: ContactChannelValue[];
}

export interface VendorSheetRow {
  /** Номер строки, как его видит пользователь в Excel. */
  rowNumber: number;
  vendorName: string | null;
  products: string[];
  contact: VendorSheetContact | null;
  warnings: string[];
  errors: string[];
}

export interface VendorSheet {
  /** Заголовок файла → поле системы. */
  mapping: Partial<Record<VendorSheetField, string>>;
  /** Колонки, которые не удалось сопоставить, — показываются, а не отбрасываются молча. */
  unmappedHeaders: string[];
  rows: VendorSheetRow[];
}

/**
 * Разбирает таблицу вендоров: компания, продукты, контактное лицо.
 *
 * Устойчивость к записи людьми здесь важнее строгости:
 *   • продукты перечислены в одной ячейке — «RT.DataLake», «RT.Warehouse»;
 *   • способ связи — свободным текстом, «Почта, Чат в ТГ»;
 *   • телефон и почта — в любом формате;
 *   • строка может описывать только компанию с продуктами, без человека.
 *
 * Некорректный телефон или почта строку не отклоняют: контакт полезен
 * и без них, а пользователь видит предупреждение. Отклоняется строка без
 * компании либо с контактами, но без ФИО, — такого человека не опознать.
 */
export function parseVendorSheet(sheetRows: ReadonlyArray<{ number: number; values: unknown[] }>): VendorSheet {
  const headerRow = sheetRows.find((row) => row.values.some((value) => parseCellText(value) !== null));

  if (!headerRow) {
    return { mapping: {}, unmappedHeaders: [], rows: [] };
  }

  const headers = headerRow.values.map((value) => parseCellText(value) ?? '');
  const columnOf: Partial<Record<VendorSheetField, number>> = {};
  const mapping: Partial<Record<VendorSheetField, string>> = {};
  const unmappedHeaders: string[] = [];

  headers.forEach((header, index) => {
    if (header.length === 0) return;

    const key = headerKey(header);
    const field = (Object.keys(FIELD_SYNONYMS) as VendorSheetField[]).find(
      (candidate) =>
        columnOf[candidate] === undefined &&
        FIELD_SYNONYMS[candidate].some((synonym) => headerKey(synonym) === key),
    );

    if (field) {
      columnOf[field] = index;
      mapping[field] = header;
    } else {
      unmappedHeaders.push(header);
    }
  });

  const rows: VendorSheetRow[] = [];

  for (const sheetRow of sheetRows) {
    if (sheetRow.number <= headerRow.number) continue;

    const cell = (field: VendorSheetField): unknown =>
      columnOf[field] === undefined ? null : sheetRow.values[columnOf[field] as number];

    // Полностью пустые строки — оформление таблицы, а не данные.
    if (sheetRow.values.every((value) => parseCellText(value) === null)) continue;

    rows.push(parseRow(sheetRow.number, cell));
  }

  return { mapping, unmappedHeaders, rows };
}

function parseRow(rowNumber: number, cell: (field: VendorSheetField) => unknown): VendorSheetRow {
  const warnings: string[] = [];
  const errors: string[] = [];

  const vendorName = parseCellText(cell('vendorName'))?.replace(/\s+/g, ' ') ?? null;

  if (!vendorName) {
    errors.push('Не указана компания');
  }

  const products = splitNameList(parseCellText(cell('products')) ?? '');

  const rawName = parseCellText(cell('contactName'));
  const rawPhone = cell('phone');
  const rawEmail = parseCellText(cell('email'));
  const phone = normalizePhone(rawPhone);
  const email = normalizeEmail(rawEmail);
  const { channels, unknown } = parseContactChannels(parseCellText(cell('channels')) ?? '');

  if (parseCellText(rawPhone) && !phone) {
    warnings.push(`Телефон «${parseCellText(rawPhone)}» не распознан — контакт сохранён без телефона`);
  }

  if (rawEmail && !email) {
    warnings.push(`Почта «${rawEmail}» не распознана — контакт сохранён без почты`);
  }

  if (unknown.length > 0) {
    warnings.push(`Способ связи не распознан: ${unknown.join(', ')}`);
  }

  let contact: VendorSheetContact | null = null;

  if (rawName) {
    const fullName = joinFullName(rawName.split(/\s+/).map((part) => normalizeNamePart(part)));

    contact = {
      fullName,
      phone,
      email,
      position: parseCellText(cell('position')),
      channels,
    };

    if (channels.includes('EMAIL') && !email) {
      warnings.push('Предпочтительный способ связи — почта, но адреса нет');
    }
  } else if (phone || email) {
    errors.push('Указаны телефон или почта, но не указано ФИО — контакт не опознать');
  }

  return { rowNumber, vendorName, products, contact, warnings, errors };
}
