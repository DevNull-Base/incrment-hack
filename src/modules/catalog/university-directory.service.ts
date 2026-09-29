import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { AppConfig } from '../../config/configuration.js';
import {
  joinFullName,
  normalizeEmail,
  normalizeNamePart,
  normalizePhone,
} from '../../common/utils/contact-normalization.js';
import { DataScope, DataScopeService, engagementScopeFilter } from '../access/data-scope.service.js';
import { AUDIT_ACTIONS, AuditService } from '../audit/audit.service.js';
import {
  assertEmailFree,
  mergeIntoPerson,
  personSelection,
  resolveEnteredPerson,
  sameName,
} from '../admin/person-matching.js';
import { dateFromDb, dateInZone } from '../planner/planner-dates.js';
import { assertUniversityVisible } from './university-access.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import {
  CreateUniversityContactDto,
  UniversityContactDto,
  UniversityContactResultDto,
  UniversityContractDto,
  UpdateUniversityContactDto,
} from './dto/university-contact.dto.js';

const contactSelection = {
  id: true,
  personId: true,
  role: true,
  isPrimary: true,
  createdAt: true,
  person: { select: { fullName: true, phone: true, email: true, position: true } },
} satisfies Prisma.UniversityContactSelect;

type ContactRecord = Prisma.UniversityContactGetPayload<{ select: typeof contactSelection }>;

/** Сколько договоров вуза отдаётся за раз — с запасом на любой реальный вуз. */
const CONTRACTS_LIMIT = 200;

/**
 * Карточка вуза: ответственные от вуза и договоры с лицензиями.
 *
 * Прежде эти сведения попадали в систему только загрузкой таблицы и дальше
 * не показывались нигде: ответственных, заведённых импортом, нельзя было
 * ни увидеть, ни дополнить почтой, а договоры — найти по вузу.
 *
 * Сам справочник вузов общий, но контакты — персональные данные, поэтому
 * здесь действуют явные ограничения видимости по вузу и региону: кому
 * администратор закрыл вуз, тот не видит ни его людей, ни его договоров.
 */
@Injectable()
export class UniversityDirectoryService {
  private readonly timeZone: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly audit: AuditService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.timeZone = config.get('APP_TIMEZONE', { infer: true });
  }

  // ------------------------------------------------------------ Контакты --

  async listContacts(universityId: string, user: AuthenticatedUser): Promise<UniversityContactDto[]> {
    await this.requireUniversity(universityId, await this.dataScope.resolve(user));

    const contacts = await this.prisma.universityContact.findMany({
      where: { universityId, person: { erasedAt: null } },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      select: contactSelection,
    });

    return contacts.map(toContactDto);
  }

  /**
   * Добавить ответственного от вуза.
   *
   * Человек, которого загрузка таблицы завела одним ФИО, опознаётся по
   * имени среди людей этого же вуза: добавление его с почтой дополняет
   * существующую запись, а не заводит вторую. Уже указанный контакт без
   * новых сведений — повтор, о нём сообщается отказом.
   */
  async createContact(
    universityId: string,
    dto: CreateUniversityContactDto,
    user: AuthenticatedUser,
  ): Promise<UniversityContactResultDto> {
    const scope = await this.dataScope.resolve(user);
    await this.requireUniversity(universityId, scope);
    await this.assertMayEdit(universityId, scope, user);

    const incoming = {
      fullName: normalizeFullName(dto.fullName),
      phone: dto.phone?.trim() ? requirePhone(dto.phone) : null,
      email: dto.email?.trim() ? requireEmail(dto.email) : null,
      position: dto.position?.trim() || null,
    };

    const { contact, warnings, created } = await this.prisma.$transaction(async (tx) => {
      const colleagues = await tx.universityContact.findMany({
        where: { universityId, person: { erasedAt: null } },
        select: { id: true, person: { select: personSelection } },
      });
      const sameUniversity = colleagues.find(
        (item) =>
          sameName(item.person.fullName, incoming.fullName) &&
          (!incoming.email || !item.person.email || item.person.email === incoming.email),
      );

      let personId: string;
      let notes: string[];
      let filled: boolean;

      if (sameUniversity) {
        const before = sameUniversity.person;

        if (incoming.email && !before.email) {
          await assertEmailFree(tx, incoming.email, before.id);
        }

        notes = await mergeIntoPerson(tx, before, incoming);
        personId = before.id;
        filled =
          (incoming.phone != null && !before.phone) ||
          (incoming.email != null && !before.email) ||
          (incoming.position != null && !before.position);
      } else {
        const person = await resolveEnteredPerson(tx, { ...incoming, lawfulBasis: 'CONTRACT' });
        personId = person.id;
        notes = person.warnings;
        filled = person.filled;
      }

      const link = await tx.universityContact.findUnique({
        where: { universityId_personId: { universityId, personId } },
        select: { id: true },
      });

      if (link && !filled) {
        throw new AppException('CATALOG_DUPLICATE', {
          detail: `${incoming.fullName} уже указан ответственным от этого вуза.`,
          meta: { contactId: link.id },
        });
      }

      const isPrimary =
        dto.isPrimary ?? (link ? undefined : (await tx.universityContact.count({ where: { universityId } })) === 0);

      if (isPrimary) {
        await tx.universityContact.updateMany({ where: { universityId }, data: { isPrimary: false } });
      }

      const role = dto.role?.trim() || null;
      const saved = link
        ? await tx.universityContact.update({
            where: { id: link.id },
            data: {
              ...(role ? { role } : {}),
              ...(isPrimary !== undefined ? { isPrimary } : {}),
            },
            select: contactSelection,
          })
        : await tx.universityContact.create({
            data: { universityId, personId, role, isPrimary: isPrimary ?? false },
            select: contactSelection,
          });

      return { contact: saved, warnings: notes, created: !link };
    });

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: created ? AUDIT_ACTIONS.CATALOG_CREATE : AUDIT_ACTIONS.CATALOG_UPDATE,
      entityType: 'UniversityContact',
      entityId: contact.id,
      afterState: {
        universityId,
        personId: contact.personId,
        fullName: contact.person.fullName,
        phone: contact.person.phone,
        email: contact.person.email,
        role: contact.role,
      },
    });

    return { ...toContactDto(contact), warnings };
  }

  /**
   * Изменить ответственного.
   *
   * Руководитель и администратор правят всё. Ответственный по заявке
   * с вузом дописывает недостающие почту и телефон, меняет должность и
   * роль, но не переписывает сохранённое: исправить чужие ФИО или почту —
   * это уточнение персональных данных, и сделать его может не каждый.
   */
  async updateContact(
    universityId: string,
    contactId: string,
    dto: UpdateUniversityContactDto,
    user: AuthenticatedUser,
  ): Promise<UniversityContactDto> {
    const scope = await this.dataScope.resolve(user);
    await this.requireUniversity(universityId, scope);
    await this.assertMayEdit(universityId, scope, user);

    const contact = await this.requireContact(universityId, contactId);
    const current = contact.person;
    const mayRewrite = user.role !== 'USER';
    const personData: Prisma.PersonUpdateInput = {};

    if (dto.fullName !== undefined) {
      const fullName = normalizeFullName(dto.fullName);

      if (fullName !== current.fullName) {
        if (!mayRewrite) {
          throw rewriteForbidden('ФИО уже указано');
        }
        personData.fullName = fullName;
      }
    }

    if (dto.phone !== undefined) {
      const phone = dto.phone === null || dto.phone.trim() === '' ? null : requirePhone(dto.phone);

      if (phone !== current.phone) {
        if (current.phone && !mayRewrite) {
          throw rewriteForbidden('Телефон уже указан');
        }
        personData.phone = phone;
      }
    }

    if (dto.email !== undefined) {
      const email = dto.email === null || dto.email.trim() === '' ? null : requireEmail(dto.email);

      if (email !== current.email) {
        if (current.email && !mayRewrite) {
          throw rewriteForbidden('Почта уже указана');
        }
        personData.email = email;
      }
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

      // Новое ФИО доходит и до копии в заявках прямых продаж, где человек
      // указан контактом, — так же, как при уточнении через реестр.
      if (typeof personData.fullName === 'string') {
        await tx.engagement.updateMany({
          where: {
            counterpartyContactId: contact.personId,
            counterpartyType: 'PERSON',
            counterpartyName: current.fullName,
          },
          data: { counterpartyName: personData.fullName, version: { increment: 1 } },
        });
      }

      if (dto.isPrimary === true) {
        await tx.universityContact.updateMany({ where: { universityId }, data: { isPrimary: false } });
      }

      return tx.universityContact.update({
        where: { id: contactId },
        data: {
          ...(dto.role !== undefined ? { role: dto.role?.trim() || null } : {}),
          ...(dto.isPrimary !== undefined ? { isPrimary: dto.isPrimary } : {}),
        },
        select: contactSelection,
      });
    });

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTIONS.CATALOG_UPDATE,
      entityType: 'UniversityContact',
      entityId: contactId,
      beforeState: {
        fullName: current.fullName,
        phone: current.phone,
        email: current.email,
        position: current.position,
        role: contact.role,
        isPrimary: contact.isPrimary,
      },
      afterState: {
        fullName: updated.person.fullName,
        phone: updated.person.phone,
        email: updated.person.email,
        position: updated.person.position,
        role: updated.role,
        isPrimary: updated.isPrimary,
      },
    });

    return toContactDto(updated);
  }

  /**
   * Убрать человека из ответственных вуза. Запись о нём остаётся в реестре
   * персональных данных: её судьбу решают срок хранения и обезличивание.
   * Если убран основной контакт, основным становится следующий по давности.
   */
  async removeContact(universityId: string, contactId: string, user: AuthenticatedUser): Promise<void> {
    await this.requireUniversity(universityId, await this.dataScope.resolve(user));
    const contact = await this.requireContact(universityId, contactId);

    await this.prisma.$transaction(async (tx) => {
      await tx.universityContact.delete({ where: { id: contactId } });

      if (contact.isPrimary) {
        const next = await tx.universityContact.findFirst({
          where: { universityId, person: { erasedAt: null } },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });

        if (next) {
          await tx.universityContact.update({ where: { id: next.id }, data: { isPrimary: true } });
        }
      }
    });

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTIONS.CATALOG_DEACTIVATE,
      entityType: 'UniversityContact',
      entityId: contactId,
      beforeState: { universityId, personId: contact.personId, fullName: contact.person.fullName },
    });
  }

  // ------------------------------------------------------------ Договоры --

  /**
   * Договоры вуза с лицензиями — новые первыми.
   *
   * Лицензии показываются в пределах ограничения по продуктам, если
   * администратор его задал: ограничение только сужает видимое.
   */
  async listContracts(universityId: string, user: AuthenticatedUser): Promise<UniversityContractDto[]> {
    const scope = await this.dataScope.resolve(user);
    await this.requireUniversity(universityId, scope);

    const contracts = await this.prisma.contract.findMany({
      where: { universityId },
      orderBy: [{ signedAt: { sort: 'desc', nulls: 'last' } }, { number: 'asc' }],
      take: CONTRACTS_LIMIT,
      select: {
        id: true,
        number: true,
        signedAt: true,
        comment: true,
        licenses: {
          where: scope.productIds ? { productId: { in: scope.productIds } } : {},
          orderBy: [{ signedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }],
          select: {
            id: true,
            productId: true,
            signedAt: true,
            validYears: true,
            validUntil: true,
            transferStatus: true,
            comment: true,
            product: { select: { name: true, vendor: { select: { name: true } } } },
          },
        },
      },
    });

    const today = dateInZone(new Date(), this.timeZone);

    return contracts.map((contract) => ({
      id: contract.id,
      number: contract.number,
      signedAt: contract.signedAt ? dateFromDb(contract.signedAt) : null,
      comment: contract.comment,
      licenses: contract.licenses.map((license) => {
        const validUntil = license.validUntil ? dateFromDb(license.validUntil) : null;

        return {
          id: license.id,
          productId: license.productId,
          productName: license.product.name,
          vendorName: license.product.vendor?.name ?? null,
          signedAt: license.signedAt ? dateFromDb(license.signedAt) : null,
          validYears: license.validYears,
          validUntil,
          validity: validUntil === null ? 'UNKNOWN' : validUntil > today ? 'ACTIVE' : 'EXPIRED',
          transferStatus: license.transferStatus,
          comment: license.comment,
        };
      }),
    }));
  }

  // ----------------------------------------------------------- Служебное --

  private requireUniversity(universityId: string, scope: DataScope): Promise<void> {
    return assertUniversityVisible(this.prisma, universityId, scope);
  }

  /**
   * Дополнять ответственных вуза может руководитель, администратор и тот,
   * кто ведёт с вузом незавершённую работу: у кого есть открытая заявка.
   * Остальным пользователям каталог доступен только для чтения — иначе
   * любой сотрудник мог бы вписать в чужой вуз кого угодно.
   */
  private async assertMayEdit(universityId: string, scope: DataScope, user: AuthenticatedUser): Promise<void> {
    if (user.role !== 'USER') {
      return;
    }

    const working = await this.prisma.engagement.count({
      where: { universityId, isArchived: false, ...engagementScopeFilter(scope) },
    });

    if (working === 0) {
      throw new AppException('FORBIDDEN', {
        detail:
          'Ответственных вуза дополняет тот, кто ведёт с ним заявку, либо руководитель. ' +
          'У вас нет открытых заявок с этим вузом.',
      });
    }
  }

  private async requireContact(universityId: string, contactId: string): Promise<ContactRecord> {
    const contact = await this.prisma.universityContact.findFirst({
      where: { id: contactId, universityId, person: { erasedAt: null } },
      select: contactSelection,
    });

    if (!contact) {
      throw new AppException('NOT_FOUND', { detail: 'Ответственный от вуза не найден.' });
    }

    return contact;
  }
}

function normalizeFullName(raw: string): string {
  const fullName = joinFullName(raw.trim().split(/\s+/).map((part) => normalizeNamePart(part)));

  if (fullName.length < 2) {
    throw new AppException('VALIDATION_FAILED', {
      detail: 'ФИО не распознано.',
      issues: [{ field: 'fullName', message: 'Укажите ФИО' }],
    });
  }

  return fullName;
}

function requirePhone(raw: string): string {
  const phone = normalizePhone(raw);

  if (!phone) {
    throw new AppException('VALIDATION_FAILED', {
      detail: 'Телефон не распознан: ожидается российский номер из 10–11 цифр.',
      issues: [{ field: 'phone', message: 'Укажите номер вида +7 900 111-22-33' }],
    });
  }

  return phone;
}

function requireEmail(raw: string): string {
  const email = normalizeEmail(raw);

  if (!email) {
    throw new AppException('VALIDATION_FAILED', {
      detail: 'Адрес почты не распознан.',
      issues: [{ field: 'email', message: 'Укажите адрес вида name@example.ru' }],
    });
  }

  return email;
}

function rewriteForbidden(what: string): AppException {
  return new AppException('FORBIDDEN', {
    detail: `${what}. Изменить сохранённое может руководитель или администратор.`,
  });
}

function toContactDto(contact: ContactRecord): UniversityContactDto {
  return {
    id: contact.id,
    personId: contact.personId,
    fullName: contact.person.fullName,
    phone: contact.person.phone,
    email: contact.person.email,
    position: contact.person.position,
    role: contact.role,
    isPrimary: contact.isPrimary,
    createdAt: contact.createdAt,
  };
}
