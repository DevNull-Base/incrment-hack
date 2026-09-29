import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { AppConfig } from '../../config/configuration.js';
import { DataScopeService, engagementScopeFilter } from '../access/data-scope.service.js';
import { assertNotArchived } from '../engagement/archive-guard.js';
import { recordActivity } from '../activity/activity-log.js';
import { dateInZone, timeInZone } from '../planner/planner-dates.js';
import { INTERNAL_EVENTS, type EngagementActivityEvent } from '../realtime/realtime.gateway.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import {
  CreateMeetingDto,
  MeetingDto,
  MeetingParticipantDto,
  UpdateMeetingDto,
} from './dto/meeting.dto.js';

/** Встреч по одной заявке — единицы; предел защищает от патологии. */
const MEETINGS_LIMIT = 200;

export const meetingSelection = {
  id: true,
  engagementId: true,
  scheduledAt: true,
  durationMinutes: true,
  location: true,
  agenda: true,
  protocol: true,
  status: true,
  attendeeIds: true,
  contactIds: true,
  createdAt: true,
  createdById: true,
  createdBy: { select: { displayName: true } },
} satisfies Prisma.EngagementMeetingSelect;

export type MeetingRecord = Prisma.EngagementMeetingGetPayload<{ select: typeof meetingSelection }>;

/** Заявка в объёме, нужном встречам. */
interface EngagementContext {
  id: string;
  ownerId: string;
  universityId: string | null;
  isArchived: boolean;
  currentStateKey: string;
  currentStateLabel: string;
}

/**
 * Встречи с представителями вуза.
 *
 * «Организация встречи» — третий шаг процесса из ТЗ, а итог встречи
 * определяет, пойдёт ли работа к документам. Встреча — отдельная запись,
 * а не заметка: у неё есть время, участники и протокол, её видно
 * в календаре участников.
 *
 * Доступ — как к карточке заявки. Изменить встречу могут её автор,
 * ответственный по заявке, руководитель и администратор.
 */
@Injectable()
export class MeetingsService {
  private readonly timeZone: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly events: EventEmitter2,
    config: ConfigService<AppConfig, true>,
  ) {
    this.timeZone = config.get('APP_TIMEZONE', { infer: true });
  }

  /** Встречи заявки по времени: ближайшие и прошедшие в одном списке. */
  async list(engagementId: string, user: AuthenticatedUser): Promise<MeetingDto[]> {
    const engagement = await this.loadEngagement(engagementId, user);

    const records = await this.prisma.engagementMeeting.findMany({
      where: { engagementId },
      orderBy: { scheduledAt: 'asc' },
      take: MEETINGS_LIMIT,
      select: meetingSelection,
    });

    return this.toDtos(records, () => engagement.ownerId, user);
  }

  async create(engagementId: string, dto: CreateMeetingDto, user: AuthenticatedUser): Promise<MeetingDto> {
    const engagement = await this.loadEngagement(engagementId, user);
    assertNotArchived(engagement);

    const scheduledAt = new Date(dto.scheduledAt);
    const attendeeIds = unique(dto.attendeeIds ?? [user.id]);
    const contactIds = unique(dto.contactIds ?? []);
    await this.assertParticipants(engagement, attendeeIds, contactIds);

    const record = await this.prisma.$transaction(async (tx) => {
      const created = await tx.engagementMeeting.create({
        data: {
          engagementId,
          scheduledAt,
          durationMinutes: dto.durationMinutes ?? null,
          location: dto.location?.trim() || null,
          agenda: dto.agenda?.trim() || null,
          attendeeIds,
          contactIds,
          createdById: user.id,
        },
        select: meetingSelection,
      });

      await recordActivity(tx, {
        type: 'MEETING_SCHEDULED',
        actorId: user.id,
        engagementId,
        stage: { key: engagement.currentStateKey, label: engagement.currentStateLabel },
        details: this.activityDetails(created),
      });

      return created;
    });

    this.emitActivity(engagement, user, 'MEETING_SCHEDULED');

    const [meeting] = await this.toDtos([record], () => engagement.ownerId, user);
    return meeting;
  }

  async update(
    engagementId: string,
    meetingId: string,
    dto: UpdateMeetingDto,
    user: AuthenticatedUser,
  ): Promise<MeetingDto> {
    const engagement = await this.loadEngagement(engagementId, user);
    assertNotArchived(engagement);
    const meeting = await this.findMeeting(engagementId, meetingId);

    if (!canEdit(meeting, engagement, user)) {
      throw new AppException('FORBIDDEN', {
        detail: 'Изменить встречу могут её автор, ответственный по заявке и руководитель.',
      });
    }

    const data: Prisma.EngagementMeetingUpdateInput = {};
    const changed: string[] = [];

    if (dto.scheduledAt !== undefined) {
      const scheduledAt = new Date(dto.scheduledAt);

      if (scheduledAt.getTime() !== meeting.scheduledAt.getTime()) {
        data.scheduledAt = scheduledAt;
        changed.push('scheduledAt');
      }
    }

    const texts = [
      ['location', dto.location],
      ['agenda', dto.agenda],
      ['protocol', dto.protocol],
    ] as const;

    for (const [field, value] of texts) {
      if (value === undefined) continue;
      const next = value?.trim() || null;

      if (next !== meeting[field]) {
        data[field] = next;
        changed.push(field);
      }
    }

    if (dto.durationMinutes !== undefined && dto.durationMinutes !== meeting.durationMinutes) {
      data.durationMinutes = dto.durationMinutes;
      changed.push('durationMinutes');
    }

    if (dto.status !== undefined && dto.status !== meeting.status) {
      data.status = dto.status;
      changed.push('status');
    }

    if (dto.attendeeIds !== undefined || dto.contactIds !== undefined) {
      const attendeeIds = unique(dto.attendeeIds ?? meeting.attendeeIds);
      const contactIds = unique(dto.contactIds ?? meeting.contactIds);
      await this.assertParticipants(engagement, attendeeIds, contactIds);

      if (!sameSet(attendeeIds, meeting.attendeeIds) || !sameSet(contactIds, meeting.contactIds)) {
        data.attendeeIds = attendeeIds;
        data.contactIds = contactIds;
        changed.push('participants');
      }
    }

    if (changed.length === 0) {
      const [unchanged] = await this.toDtos([meeting], () => engagement.ownerId, user);
      return unchanged;
    }

    const record = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.engagementMeeting.update({
        where: { id: meetingId },
        data,
        select: meetingSelection,
      });

      await recordActivity(tx, {
        type: 'MEETING_UPDATED',
        actorId: user.id,
        engagementId,
        stage: { key: engagement.currentStateKey, label: engagement.currentStateLabel },
        details: { ...this.activityDetails(saved), changed },
      });

      return saved;
    });

    this.emitActivity(engagement, user, 'MEETING_UPDATED');

    const [updated] = await this.toDtos([record], () => engagement.ownerId, user);
    return updated;
  }

  /**
   * Подписи участников. Представитель вуза, обезличенный в реестре
   * персональных данных, из встречи пропадает: его имя не должно
   * всплывать через протоколы после обезличивания.
   */
  async toDtos<T extends MeetingRecord>(
    records: T[],
    ownerIdOf: (record: T) => string,
    user: AuthenticatedUser,
  ): Promise<MeetingDto[]> {
    const userIds = unique(records.flatMap((record) => record.attendeeIds));
    const contactIds = unique(records.flatMap((record) => record.contactIds));

    const [users, contacts] = await Promise.all([
      userIds.length > 0
        ? this.prisma.appUser.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true } })
        : [],
      contactIds.length > 0
        ? this.prisma.universityContact.findMany({
            where: { id: { in: contactIds }, person: { erasedAt: null } },
            select: { id: true, person: { select: { fullName: true, position: true } } },
          })
        : [],
    ]);

    const userById = new Map(users.map((item) => [item.id, item]));
    const contactById = new Map(contacts.map((item) => [item.id, item]));

    return records.map((record) => {
      const participants: MeetingParticipantDto[] = [
        ...record.attendeeIds.flatMap((id) => {
          const found = userById.get(id);
          return found ? [{ kind: 'EMPLOYEE' as const, id, name: found.displayName, position: null }] : [];
        }),
        ...record.contactIds.flatMap((id) => {
          const found = contactById.get(id);
          return found
            ? [{ kind: 'CONTACT' as const, id, name: found.person.fullName, position: found.person.position }]
            : [];
        }),
      ];

      return {
        id: record.id,
        engagementId: record.engagementId,
        scheduledAt: record.scheduledAt,
        date: dateInZone(record.scheduledAt, this.timeZone),
        time: timeInZone(record.scheduledAt, this.timeZone),
        durationMinutes: record.durationMinutes,
        location: record.location,
        agenda: record.agenda,
        protocol: record.protocol,
        status: record.status,
        participants,
        createdBy: { id: record.createdById, name: record.createdBy.displayName },
        createdAt: record.createdAt,
        canEdit: canEdit(record, { ownerId: ownerIdOf(record) }, user),
      };
    });
  }

  private async loadEngagement(engagementId: string, user: AuthenticatedUser): Promise<EngagementContext> {
    const scope = await this.dataScope.resolve(user);

    const found = await this.prisma.engagement.findFirst({
      where: { id: engagementId, ...engagementScopeFilter(scope) },
      select: {
        id: true,
        ownerId: true,
        universityId: true,
        isArchived: true,
        currentStateKey: true,
        currentStateLabel: true,
      },
    });

    if (!found) {
      throw new AppException('NOT_FOUND', {
        detail: 'Взаимодействие не найдено либо недоступно текущему пользователю.',
      });
    }

    return found;
  }

  private async findMeeting(engagementId: string, meetingId: string): Promise<MeetingRecord> {
    const meeting = await this.prisma.engagementMeeting.findFirst({
      where: { id: meetingId, engagementId },
      select: meetingSelection,
    });

    if (!meeting) {
      throw new AppException('NOT_FOUND', { detail: 'Встреча не найдена.' });
    }

    return meeting;
  }

  /**
   * Участники существуют: сотрудники — действующие учётные записи,
   * представители — ответственные того вуза, с которым ведётся заявка.
   * Иначе во встречу можно было бы вписать человека чужого вуза.
   */
  private async assertParticipants(
    engagement: EngagementContext,
    attendeeIds: string[],
    contactIds: string[],
  ): Promise<void> {
    if (attendeeIds.length > 0) {
      const found = await this.prisma.appUser.count({ where: { id: { in: attendeeIds }, isActive: true } });

      if (found !== attendeeIds.length) {
        throw new AppException('VALIDATION_FAILED', {
          detail: 'Среди сотрудников встречи есть неизвестные или заблокированные учётные записи.',
          issues: [{ field: 'attendeeIds', message: 'Неизвестный сотрудник' }],
        });
      }
    }

    if (contactIds.length > 0) {
      const found = engagement.universityId
        ? await this.prisma.universityContact.count({
            where: { id: { in: contactIds }, universityId: engagement.universityId, person: { erasedAt: null } },
          })
        : 0;

      if (found !== contactIds.length) {
        throw new AppException('VALIDATION_FAILED', {
          detail: 'Представители вуза выбираются из ответственных того вуза, с которым ведётся заявка.',
          issues: [{ field: 'contactIds', message: 'Контакт не относится к вузу заявки' }],
        });
      }
    }
  }

  /** Подробности для ленты: время — в поясе организации, без текстов встречи. */
  private activityDetails(record: MeetingRecord): Record<string, unknown> {
    return {
      meetingId: record.id,
      date: dateInZone(record.scheduledAt, this.timeZone),
      time: timeInZone(record.scheduledAt, this.timeZone),
      status: record.status,
    };
  }

  private emitActivity(engagement: EngagementContext, user: AuthenticatedUser, type: string): void {
    const event: EngagementActivityEvent = {
      engagementId: engagement.id,
      recipientIds: [engagement.ownerId, user.id],
      type,
      actorName: user.displayName,
    };

    this.events.emit(INTERNAL_EVENTS.ENGAGEMENT_ACTIVITY, event);
  }
}

function canEdit(
  meeting: { createdById: string },
  engagement: { ownerId: string },
  user: AuthenticatedUser,
): boolean {
  return user.role !== 'USER' || meeting.createdById === user.id || engagement.ownerId === user.id;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}
