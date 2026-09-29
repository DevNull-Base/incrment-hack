import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { Prisma } from '../../generated/prisma/client.js';
import { PdLawfulBasis } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { PageDto, toPage } from '../../common/dto/pagination.dto.js';
import { AUDIT_ACTIONS, AuditService } from '../audit/audit.service.js';
import { PersonDto, PersonQueryDto, UpdatePersonDto } from './dto/admin.dto.js';
import { ERASED_PLACEHOLDER, eraseCopiesOfPerson } from './personal-data-erasure.js';
import { normalizeEmail, normalizePhone } from '../../common/utils/contact-normalization.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';

/**
 * Отметка, замещающая ФИО после обезличивания.
 * Значение служебное и одинаковое для всех записей: по нему нельзя
 * восстановить ни личность, ни даже длину исходного значения.
 */
export { ERASED_PLACEHOLDER };

/**
 * Работа с персональными данными субъектов.
 *
 * Закрывает права субъекта персональных данных, которые оператор обязан
 * обеспечить: получение сведений об обработке (ст. 14), уточнение неполных
 * или неточных данных (ч. 1 ст. 21) и прекращение обработки с уничтожением
 * (ч. 4 ст. 21). До этого ни одного способа выполнить такое требование
 * в системе не было — запись о человеке могла появиться импортом и остаться
 * навсегда.
 *
 * Выбрано обезличивание, а не удаление строки. Причина в связях: на персону
 * ссылаются контакты вузов, а через них — история взаимодействий и уже
 * сформированные отчёты. Удаление строки либо разорвало бы историю,
 * либо каскадом снесло бы связанные записи. Обезличивание достигает той же
 * цели — персональные данные перестают существовать, — сохраняя
 * непротиворечивость остальных данных. Строка после обезличивания
 * персональных данных не содержит и под 152-ФЗ более не подпадает.
 */
@Injectable()
export class PersonService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PersonService.name);
  }

  async findAll(query: PersonQueryDto): Promise<PageDto<PersonDto>> {
    const where: Prisma.PersonWhereInput = {
      ...(query.includeErased ? {} : { erasedAt: null }),
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, records] = await Promise.all([
      this.prisma.person.count({ where }),
      this.prisma.person.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { fullName: query.sortOrder },
        select: PERSON_SELECTION,
      }),
    ]);

    return toPage(records.map(toPersonDto), total, query);
  }

  async findOne(id: string): Promise<PersonDto> {
    return toPersonDto(await this.require(id));
  }

  /**
   * Уточнение персональных данных (ч. 1 ст. 21 152-ФЗ).
   *
   * Субъект вправе требовать исправления неполных, неточных или устаревших
   * сведений. Предыдущее состояние попадает в журнал в маскированном виде:
   * зафиксировать факт и состав правки нужно, сохранять сами данные —
   * нельзя, иначе журнал станет их вторым хранилищем.
   */
  async update(id: string, dto: UpdatePersonDto, actor: AuthenticatedUser): Promise<PersonDto> {
    const person = await this.require(id);

    this.assertNotErased(person);

    const contacts = normalizeRectifiedContacts(dto);

    const data: Prisma.PersonUpdateInput = {
      ...(contacts.fullName === undefined ? {} : { fullName: contacts.fullName }),
      ...(contacts.email === undefined ? {} : { email: contacts.email }),
      ...(contacts.phone === undefined ? {} : { phone: contacts.phone }),
      ...(dto.position === undefined ? {} : { position: dto.position }),
      ...(dto.lawfulBasis === undefined ? {} : { lawfulBasis: dto.lawfulBasis }),
      ...(dto.retentionUntil === undefined
        ? {}
        : { retentionUntil: dto.retentionUntil === null ? null : new Date(dto.retentionUntil) }),
    };

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.person.update({ where: { id }, data, select: PERSON_SELECTION });

      // Уточнённое ФИО доходит и до копий — имени контрагента в заявках
      // прямых продаж, где человек указан контактом. Обезличивание эти копии
      // обновляло, а уточнение — нет, и после исправления фамилии по
      // требованию субъекта в карточках оставалась прежняя.
      if (contacts.fullName !== undefined && contacts.fullName !== person.fullName) {
        await tx.engagement.updateMany({
          where: { counterpartyContactId: id, counterpartyType: 'PERSON', counterpartyName: person.fullName },
          data: { counterpartyName: contacts.fullName, version: { increment: 1 } },
        });
      }

      return result;
    });

    const retentionChanged = dto.retentionUntil !== undefined;

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: retentionChanged
        ? AUDIT_ACTIONS.PERSONAL_DATA_RETENTION_SET
        : AUDIT_ACTIONS.PERSONAL_DATA_RECTIFY,
      entityType: 'Person',
      entityId: id,
      beforeState: {
        fullName: person.fullName,
        email: person.email,
        phone: person.phone,
        position: person.position,
        lawfulBasis: person.lawfulBasis,
        retentionUntil: person.retentionUntil?.toISOString() ?? null,
      },
      afterState: {
        fullName: updated.fullName,
        email: updated.email,
        phone: updated.phone,
        position: updated.position,
        lawfulBasis: updated.lawfulBasis,
        retentionUntil: updated.retentionUntil?.toISOString() ?? null,
        reason: dto.reason ?? null,
      },
    });

    return toPersonDto(updated);
  }

  /**
   * Обезличивание персональных данных (ч. 4 ст. 21 152-ФЗ).
   *
   * Выполняется по требованию субъекта либо при достижении цели обработки.
   * В журнале остаётся запись с основанием — она служит подтверждением
   * исполнения требования и основой для акта об уничтожении.
   */
  async erase(id: string, reason: string, actor: AuthenticatedUser): Promise<PersonDto> {
    const person = await this.require(id);

    this.assertNotErased(person);

    const erased = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.person.update({
        where: { id },
        data: {
          fullName: ERASED_PLACEHOLDER,
          email: null,
          phone: null,
          position: null,
          retentionUntil: null,
          erasedAt: new Date(),
          erasureReason: reason,
        },
        select: PERSON_SELECTION,
      });

      // Копии тех же данных — в заявках прямых продаж, уведомлениях
      // и исходных сообщениях внешних систем — обезличиваются вместе
      // с записью реестра, иначе требование было бы исполнено наполовину.
      await eraseCopiesOfPerson(tx, {
        id,
        fullName: person.fullName,
        email: person.email,
        phone: person.phone,
      });

      return updated;
    });

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: AUDIT_ACTIONS.PERSONAL_DATA_ERASE,
      entityType: 'Person',
      entityId: id,
      // Значения полей маскируются при записи; здесь фиксируется сам факт
      // того, какие категории данных были удалены.
      beforeState: {
        fullName: person.fullName,
        hadEmail: person.email !== null,
        hadPhone: person.phone !== null,
        universities: person.universityContacts.map((contact) => contact.university.name),
      },
      afterState: { erased: true, reason },
    });

    this.logger.info({ personId: id }, 'Персональные данные обезличены');

    return toPersonDto(erased);
  }

  private assertNotErased(person: { erasedAt: Date | null }): void {
    if (person.erasedAt !== null) {
      throw new AppException('PERSONAL_DATA_ERASED');
    }
  }

  private async require(id: string) {
    const record = await this.prisma.person.findUnique({
      where: { id },
      select: PERSON_SELECTION,
    });

    if (!record) {
      throw new AppException('NOT_FOUND', { detail: 'Субъект персональных данных не найден.' });
    }

    return record;
  }
}

const PERSON_SELECTION = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  position: true,
  lawfulBasis: true,
  retentionUntil: true,
  erasedAt: true,
  universityContacts: { select: { university: { select: { name: true } } } },
} as const;

type PersonRecord = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  position: string | null;
  lawfulBasis: PdLawfulBasis;
  retentionUntil: Date | null;
  erasedAt: Date | null;
  universityContacts: Array<{ university: { name: string } }>;
};

function toPersonDto(record: PersonRecord): PersonDto {
  return {
    id: record.id,
    fullName: record.fullName,
    email: record.email,
    phone: record.phone,
    position: record.position,
    lawfulBasis: record.lawfulBasis,
    retentionUntil: record.retentionUntil,
    erasedAt: record.erasedAt,
    universities: record.universityContacts.map((contact) => contact.university.name),
  };
}

/**
 * Контакты при уточнении — в том же виде, что и у записей из загрузок:
 * телефон +7XXXXXXXXXX, почта строчными. Прежде они сохранялись как
 * введены, и человек с телефоном «8 (900) 111-22-33» переставал находиться
 * по оплатам и таблицам, а в поле почты можно было записать что угодно.
 */
function normalizeRectifiedContacts(dto: UpdatePersonDto): {
  fullName?: string;
  email?: string | null;
  phone?: string | null;
} {
  const issues: Array<{ field: string; message: string }> = [];
  const result: { fullName?: string; email?: string | null; phone?: string | null } = {};

  if (dto.fullName !== undefined) {
    const fullName = dto.fullName.replace(/\s+/g, ' ').trim();
    if (fullName.length < 2) issues.push({ field: 'fullName', message: 'Укажите ФИО' });
    result.fullName = fullName;
  }

  if (dto.email !== undefined) {
    const email = dto.email === null || dto.email.trim() === '' ? null : normalizeEmail(dto.email);
    if (dto.email !== null && dto.email.trim() !== '' && !email) {
      issues.push({ field: 'email', message: 'Адрес почты не распознан' });
    }
    result.email = email;
  }

  if (dto.phone !== undefined) {
    const phone = dto.phone === null || dto.phone.trim() === '' ? null : normalizePhone(dto.phone);
    if (dto.phone !== null && dto.phone.trim() !== '' && !phone) {
      issues.push({ field: 'phone', message: 'Ожидается российский номер: +7 900 111-22-33' });
    }
    result.phone = phone;
  }

  if (issues.length > 0) {
    throw new AppException('VALIDATION_FAILED', { detail: 'Контактные данные заполнены неверно.', issues });
  }

  return result;
}
