import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { Prisma } from '../../generated/prisma/client.js';
import type { ContactChannel } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import {
  joinFullName,
  normalizeEmail,
  normalizeNamePart,
  normalizePhone,
  organizationKey,
  titleKey,
} from '../../common/utils/contact-normalization.js';
import { AUDIT_ACTIONS, AuditService } from '../audit/audit.service.js';
import {
  assertEmailFree,
  findKnownPerson,
  findOrCreatePerson,
  mergeIntoPerson,
  personSelection,
  resolveEnteredPerson,
  sameName,
} from '../admin/person-matching.js';
import { AntivirusService } from '../files/antivirus.service.js';
import { resolveSpreadsheetType } from '../files/file-validation.js';
import { assertCleanUpload } from '../files/upload-scan.js';
import { readSheetRows } from '../import/xls-parser.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { parseVendorSheet, type VendorSheetRow } from './vendor-sheet.js';
import {
  CreateVendorContactDto,
  UpdateVendorContactDto,
  VendorContactDto,
  VendorImportResultDto,
  VendorImportRowDto,
} from './dto/vendor-contact.dto.js';

/** Сигнал отката предварительного просмотра: транзакция отменяется целиком. */
class DryRunRollback extends Error {}

/**
 * Блокировка загрузки каталога вендоров: две одновременные загрузки
 * заводили бы одного вендора и одного человека дважды.
 */
const VENDOR_IMPORT_LOCK_ID = 774_203;

const contactSelection = {
  id: true,
  personId: true,
  channels: true,
  products: true,
  isPrimary: true,
  person: { select: { fullName: true, phone: true, email: true, position: true } },
} satisfies Prisma.VendorContactSelect;

type ContactRecord = Prisma.VendorContactGetPayload<{ select: typeof contactSelection }>;

/**
 * Каталог вендоров: контактные лица и загрузка каталога из таблицы.
 *
 * Заказчик ведёт каталог вендоров таблицей «компания — продукты — кто
 * отвечает и как с ним связаться». ТЗ требует, чтобы каталоги обновлялись
 * загрузкой XLS/XLSX через интерфейс, — здесь это сделано для вендоров
 * с учётом того, как такие таблицы заполняют люди.
 */
@Injectable()
export class VendorDirectoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly antivirus: AntivirusService,
    private readonly audit: AuditService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(VendorDirectoryService.name);
  }

  // ------------------------------------------------------------ Контакты --

  async listContacts(vendorId: string): Promise<VendorContactDto[]> {
    await this.requireVendor(vendorId);

    const contacts = await this.prisma.vendorContact.findMany({
      where: { vendorId, person: { erasedAt: null } },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      select: contactSelection,
    });

    return contacts.map(toContactDto);
  }

  async createContact(
    vendorId: string,
    dto: CreateVendorContactDto,
    user: AuthenticatedUser,
  ): Promise<VendorContactDto> {
    await this.requireVendor(vendorId);
    const incoming = this.normalizeContact(dto);

    const contact = await this.prisma.$transaction(async (tx) => {
      const person = await resolveEnteredPerson(tx, { ...incoming, lawfulBasis: 'CONTRACT' });

      const existing = await tx.vendorContact.findUnique({
        where: { vendorId_personId: { vendorId, personId: person.id } },
        select: { id: true },
      });

      if (existing) {
        throw new AppException('CATALOG_DUPLICATE', {
          detail: `${person.fullName} уже указан контактом этого вендора.`,
          meta: { contactId: existing.id },
        });
      }

      const isPrimary = dto.isPrimary ?? (await tx.vendorContact.count({ where: { vendorId } })) === 0;

      if (isPrimary) {
        await tx.vendorContact.updateMany({ where: { vendorId }, data: { isPrimary: false } });
      }

      return tx.vendorContact.create({
        data: {
          vendorId,
          personId: person.id,
          channels: (dto.channels ?? []) as ContactChannel[],
          products: dto.products ?? [],
          isPrimary,
        },
        select: contactSelection,
      });
    });

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTIONS.CATALOG_CREATE,
      entityType: 'VendorContact',
      entityId: contact.id,
      afterState: { vendorId, personId: contact.personId, fullName: contact.person.fullName },
    });

    return toContactDto(contact);
  }

  async updateContact(
    vendorId: string,
    contactId: string,
    dto: UpdateVendorContactDto,
    user: AuthenticatedUser,
  ): Promise<VendorContactDto> {
    const contact = await this.requireContact(vendorId, contactId);

    const personData: Prisma.PersonUpdateInput = {};

    if (dto.fullName !== undefined) {
      personData.fullName = normalizeFullName(dto.fullName);
    }

    if (dto.phone !== undefined) {
      personData.phone = dto.phone === null ? null : this.requirePhone(dto.phone);
    }

    if (dto.email !== undefined) {
      personData.email = dto.email === null ? null : this.requireEmail(dto.email);
    }

    if (dto.position !== undefined) {
      personData.position = dto.position?.trim() || null;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (typeof personData.email === 'string') {
        await assertEmailFree(tx, personData.email, contact.personId);
      }

      if (Object.keys(personData).length > 0) {
        await tx.person.update({ where: { id: contact.personId }, data: personData });
      }

      if (dto.isPrimary === true) {
        await tx.vendorContact.updateMany({ where: { vendorId }, data: { isPrimary: false } });
      }

      return tx.vendorContact.update({
        where: { id: contactId },
        data: {
          ...(dto.channels !== undefined ? { channels: dto.channels as ContactChannel[] } : {}),
          ...(dto.products !== undefined ? { products: dto.products } : {}),
          ...(dto.isPrimary !== undefined ? { isPrimary: dto.isPrimary } : {}),
        },
        select: contactSelection,
      });
    });

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTIONS.CATALOG_UPDATE,
      entityType: 'VendorContact',
      entityId: contactId,
      beforeState: {
        fullName: contact.person.fullName,
        phone: contact.person.phone,
        email: contact.person.email,
      },
      afterState: {
        fullName: updated.person.fullName,
        phone: updated.person.phone,
        email: updated.person.email,
      },
    });

    return toContactDto(updated);
  }

  /**
   * Контакт отвязывается от вендора, запись о человеке остаётся в реестре
   * персональных данных: её судьбу решают срок хранения и обезличивание,
   * а не удаление строки каталога.
   */
  async removeContact(vendorId: string, contactId: string, user: AuthenticatedUser): Promise<void> {
    const contact = await this.requireContact(vendorId, contactId);

    await this.prisma.vendorContact.delete({ where: { id: contactId } });

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTIONS.CATALOG_DEACTIVATE,
      entityType: 'VendorContact',
      entityId: contactId,
      beforeState: { vendorId, personId: contact.personId, fullName: contact.person.fullName },
    });
  }

  // ------------------------------------------------------ Загрузка файла --

  /**
   * Загрузка каталога вендоров из таблицы.
   *
   * Предварительный просмотр и применение выполняют одну и ту же логику
   * в транзакции; просмотр её откатывает. Так сводка «что будет создано»
   * не может разойтись с тем, что создастся на самом деле.
   */
  async importSheet(
    fileName: string,
    content: Buffer,
    dryRun: boolean,
    user: AuthenticatedUser,
  ): Promise<VendorImportResultDto> {
    const { fileTypeFromBuffer } = await import('file-type');
    resolveSpreadsheetType(await fileTypeFromBuffer(content), fileName);

    await assertCleanUpload(
      { antivirus: this.antivirus, audit: this.audit, logger: this.logger },
      { content, fileName, user, entityType: 'Vendor' },
    );

    const sheet = parseVendorSheet(await readSheetRows(content));

    if (!sheet.mapping.vendorName) {
      throw new AppException('IMPORT_MAPPING_INCOMPLETE', {
        detail:
          'В файле не найдена колонка с названием компании. Ожидается заголовок ' +
          '«Компания», «Вендор» или «Производитель».',
        meta: { headers: sheet.unmappedHeaders },
      });
    }

    const result: VendorImportResultDto = {
      dryRun,
      mapping: sheet.mapping as Record<string, string>,
      unmappedHeaders: sheet.unmappedHeaders,
      totals: {
        rows: sheet.rows.length,
        rejected: 0,
        vendorsCreated: 0,
        productsCreated: 0,
        contactsCreated: 0,
        contactsUpdated: 0,
      },
      rows: [],
    };

    try {
      await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${VENDOR_IMPORT_LOCK_ID})`;

          const vendors = await tx.vendor.findMany({ select: { id: true, name: true, isActive: true } });
          const vendorByKey = new Map(vendors.map((vendor) => [organizationKey(vendor.name), vendor]));

          for (const row of sheet.rows) {
            result.rows.push(await this.applyRow(tx, row, vendorByKey, result.totals));
          }

          if (dryRun) {
            throw new DryRunRollback();
          }
        },
        { timeout: 60_000 },
      );
    } catch (error: unknown) {
      if (!(error instanceof DryRunRollback)) {
        throw error;
      }
    }

    result.totals.rejected = result.rows.filter((row) => row.outcome === 'REJECTED').length;

    if (!dryRun) {
      await this.audit.record({
        actorId: user.id,
        actorEmail: user.email,
        action: AUDIT_ACTIONS.IMPORT_APPLY,
        entityType: 'Vendor',
        afterState: { fileName, ...result.totals },
      });
    }

    return result;
  }

  private async applyRow(
    tx: Prisma.TransactionClient,
    row: VendorSheetRow,
    vendorByKey: Map<string, { id: string; name: string; isActive: boolean }>,
    totals: VendorImportResultDto['totals'],
  ): Promise<VendorImportRowDto> {
    const summary: VendorImportRowDto = {
      rowNumber: row.rowNumber,
      vendorName: row.vendorName,
      products: row.products,
      contactName: row.contact?.fullName ?? null,
      outcome: 'UNCHANGED',
      warnings: [...row.warnings],
      errors: [...row.errors],
    };

    if (summary.errors.length > 0 || !row.vendorName) {
      summary.outcome = 'REJECTED';
      return summary;
    }

    let created = false;
    let updated = false;

    // Вендор опознаётся без организационно-правовой формы и кавычек:
    // «ПАО «Ростелеком»» и «Ростелеком» — одна компания.
    let vendor = vendorByKey.get(organizationKey(row.vendorName));

    if (!vendor) {
      vendor = await tx.vendor.create({
        data: { name: row.vendorName },
        select: { id: true, name: true, isActive: true },
      });
      vendorByKey.set(organizationKey(row.vendorName), vendor);
      totals.vendorsCreated += 1;
      created = true;
    } else if (vendor.name !== row.vendorName) {
      summary.warnings.push(`Компания сопоставлена с «${vendor.name}» из каталога`);
    }

    // Выведенного из действия вендора загрузка не возвращает молча: его
    // выключили намеренно, и решение принимает администратор каталога.
    if (!vendor.isActive) {
      summary.warnings.push(`Компания «${vendor.name}» выведена из действия — в выборе она не показывается`);
    }

    const products = await tx.softwareProduct.findMany({
      where: { vendorId: vendor.id },
      select: { id: true, name: true },
    });

    for (const name of row.products) {
      if (!products.some((product) => titleKey(product.name) === titleKey(name))) {
        const product = await tx.softwareProduct.create({
          data: { name, vendorId: vendor.id },
          select: { id: true, name: true },
        });
        products.push(product);
        totals.productsCreated += 1;
        created = true;
      }
    }

    if (row.contact) {
      const person = await this.resolveSheetContact(tx, vendor.id, row.contact);
      summary.warnings.push(...person.warnings);

      const link = await tx.vendorContact.findUnique({
        where: { vendorId_personId: { vendorId: vendor.id, personId: person.id } },
        select: { id: true, channels: true, products: true },
      });

      if (!link) {
        const isFirst = (await tx.vendorContact.count({ where: { vendorId: vendor.id } })) === 0;

        await tx.vendorContact.create({
          data: {
            vendorId: vendor.id,
            personId: person.id,
            channels: row.contact.channels as ContactChannel[],
            products: row.products,
            isPrimary: isFirst,
          },
        });
        totals.contactsCreated += 1;
        created = true;
      } else {
        // Повторная загрузка дополняет, а не заменяет: способ связи или
        // продукт, добавленные вручную, таблица не стирает.
        const channels = union(link.channels, row.contact.channels as ContactChannel[]);
        const productList = union(link.products, row.products);

        if (channels.length !== link.channels.length || productList.length !== link.products.length) {
          await tx.vendorContact.update({
            where: { id: link.id },
            data: { channels, products: productList },
          });
          totals.contactsUpdated += 1;
          updated = true;
        }
      }
    }

    summary.outcome = created ? 'CREATED' : updated ? 'UPDATED' : 'UNCHANGED';
    return summary;
  }

  /**
   * Человек из строки таблицы.
   *
   * Сначала — по почте и телефону во всём реестре. Не нашёлся — среди
   * контактов этого же вендора по ФИО: в таблице одного человека нередко
   * пишут в двух строках (по разным продуктам), и во второй строке почта
   * с опечаткой либо её нет вовсе. Без этого шага у вендора оказались бы
   * два одноимённых контакта.
   */
  private async resolveSheetContact(
    tx: Prisma.TransactionClient,
    vendorId: string,
    contact: NonNullable<VendorSheetRow['contact']>,
  ): Promise<{ id: string; warnings: string[] }> {
    const known = await findKnownPerson(tx, contact);

    if (known) {
      return { id: known.id, warnings: await mergeIntoPerson(tx, known, contact) };
    }

    const colleagues = await tx.vendorContact.findMany({
      where: { vendorId, person: { erasedAt: null } },
      select: { person: { select: personSelection } },
    });
    const sameVendor = colleagues.find((item) => sameName(item.person.fullName, contact.fullName));

    if (sameVendor) {
      return { id: sameVendor.person.id, warnings: await mergeIntoPerson(tx, sameVendor.person, contact) };
    }

    const created = await findOrCreatePerson(tx, { ...contact, lawfulBasis: 'CONTRACT' });
    return { id: created.id, warnings: created.warnings };
  }

  // ----------------------------------------------------------- Служебное --

  private normalizeContact(dto: CreateVendorContactDto) {
    return {
      fullName: normalizeFullName(dto.fullName),
      phone: dto.phone ? this.requirePhone(dto.phone) : null,
      email: dto.email ? this.requireEmail(dto.email) : null,
      position: dto.position?.trim() || null,
    };
  }

  /** В форме, в отличие от таблицы, неверный телефон — ошибка ввода. */
  private requirePhone(raw: string): string {
    const phone = normalizePhone(raw);

    if (!phone) {
      throw new AppException('VALIDATION_FAILED', {
        detail: 'Телефон не распознан: ожидается российский номер из 10–11 цифр.',
        issues: [{ field: 'phone', message: 'Укажите номер вида +7 900 111-22-33' }],
      });
    }

    return phone;
  }

  private requireEmail(raw: string): string {
    const email = normalizeEmail(raw);

    if (!email) {
      throw new AppException('VALIDATION_FAILED', {
        detail: 'Адрес почты не распознан.',
        issues: [{ field: 'email', message: 'Укажите адрес вида name@example.ru' }],
      });
    }

    return email;
  }

  private async requireVendor(vendorId: string): Promise<void> {
    const count = await this.prisma.vendor.count({ where: { id: vendorId } });

    if (count === 0) {
      throw new AppException('NOT_FOUND', { detail: 'Вендор не найден.' });
    }
  }

  private async requireContact(vendorId: string, contactId: string): Promise<ContactRecord> {
    const contact = await this.prisma.vendorContact.findFirst({
      where: { id: contactId, vendorId },
      select: contactSelection,
    });

    if (!contact) {
      throw new AppException('NOT_FOUND', { detail: 'Контакт вендора не найден.' });
    }

    return contact;
  }
}

function normalizeFullName(raw: string): string {
  return joinFullName(raw.trim().split(/\s+/).map((part) => normalizeNamePart(part)));
}

function union<T>(left: readonly T[], right: readonly T[]): T[] {
  return [...left, ...right.filter((item) => !left.includes(item))];
}

function toContactDto(contact: ContactRecord): VendorContactDto {
  return {
    id: contact.id,
    personId: contact.personId,
    fullName: contact.person.fullName,
    phone: contact.person.phone,
    email: contact.person.email,
    position: contact.person.position,
    channels: contact.channels,
    products: contact.products,
    isPrimary: contact.isPrimary,
  };
}
