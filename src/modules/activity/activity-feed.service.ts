import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { PageDto } from '../../common/dto/pagination.dto.js';
import { DataScopeService, engagementScopeFilter } from '../access/data-scope.service.js';
import { engagementListSelection, toEngagementListItem } from '../engagement/engagement.service.js';
import { describeActivity } from './activity-describe.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import {
  ActivityFeedQueryDto,
  ActivityItemDto,
  EngagementTimelineQueryDto,
  RecentEngagementDto,
  RecentEngagementsQueryDto,
} from './dto/activity-feed.dto.js';

/** Длина фрагмента заметки в ленте. */
const EXCERPT_LENGTH = 200;

const eventSelection = {
  id: true,
  occurredAt: true,
  type: true,
  source: true,
  actorId: true,
  actor: { select: { displayName: true } },
  engagementId: true,
  engagement: {
    select: {
      id: true,
      counterpartyName: true,
      currentStateLabel: true,
      university: { select: { name: true } },
      direction: { select: { name: true } },
    },
  },
  stateKey: true,
  stateLabel: true,
  noteId: true,
  attachmentId: true,
  taskId: true,
  transitionId: true,
  details: true,
} satisfies Prisma.ActivityEventSelect;

type EventRecord = Prisma.ActivityEventGetPayload<{ select: typeof eventSelection }>;

/**
 * Лента действий.
 *
 * Три представления одной таблицы:
 *   • «мои действия» — что пользователь менял сам: вернувшись к вузу через
 *     месяц, менеджер восстанавливает по ней ход работы;
 *   • «мои заявки за последние дни» — для главного экрана: по чему
 *     пользователь работал и что открыть одним нажатием;
 *   • история заявки — всё, что с ней происходило, кто бы это ни делал.
 *
 * Лента подчиняется области видимости так же, как карточки: событие
 * по заявке, которая больше недоступна пользователю (её переназначили
 * другому отделу), в ленте не показывается — иначе лента стала бы обходным
 * путём к чужим заявкам.
 */
@Injectable()
export class ActivityFeedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
  ) {}

  /** Действия, совершённые самим пользователем, — новые сверху. */
  async myFeed(query: ActivityFeedQueryDto, user: AuthenticatedUser): Promise<PageDto<ActivityItemDto>> {
    const scope = await this.dataScope.resolve(user);

    const where: Prisma.ActivityEventWhereInput = {
      actorId: user.id,
      ...periodAndTypes(query),
      ...(query.engagementId ? { engagementId: query.engagementId } : {}),
      OR: [{ engagementId: null }, { engagement: engagementScopeFilter(scope) }],
    };

    return this.page(where, query.page, query.limit);
  }

  /** Всё, что происходило с заявкой, — кто бы это ни делал. */
  async engagementTimeline(
    engagementId: string,
    query: EngagementTimelineQueryDto,
    user: AuthenticatedUser,
  ): Promise<PageDto<ActivityItemDto>> {
    const scope = await this.dataScope.resolve(user);

    const engagement = await this.prisma.engagement.findFirst({
      where: { id: engagementId, ...engagementScopeFilter(scope) },
      select: { id: true },
    });

    if (!engagement) {
      throw new AppException('NOT_FOUND', {
        detail: 'Взаимодействие не найдено либо недоступно текущему пользователю.',
      });
    }

    return this.page({ engagementId, ...periodAndTypes(query) }, query.page, query.limit);
  }

  /**
   * Заявки, по которым пользователь работал за последние дни, — с последним
   * действием по каждой. Для главного экрана: «с чем я работал на этой
   * неделе» и переход в карточку одним нажатием.
   */
  async recentEngagements(
    query: RecentEngagementsQueryDto,
    user: AuthenticatedUser,
  ): Promise<RecentEngagementDto[]> {
    const scope = await this.dataScope.resolve(user);
    const since = new Date(Date.now() - query.days * 24 * 60 * 60 * 1000);

    const where: Prisma.ActivityEventWhereInput = {
      actorId: user.id,
      occurredAt: { gte: since },
      engagementId: { not: null },
      engagement: engagementScopeFilter(scope),
    };

    const groups = await this.prisma.activityEvent.groupBy({
      by: ['engagementId'],
      where,
      _max: { occurredAt: true },
      _count: { _all: true },
      orderBy: { _max: { occurredAt: 'desc' } },
      take: query.limit,
    });

    const ids = groups.map((group) => group.engagementId).filter((id): id is string => id !== null);

    if (ids.length === 0) {
      return [];
    }

    const [engagements, lastEvents] = await Promise.all([
      this.prisma.engagement.findMany({
        where: { id: { in: ids } },
        select: engagementListSelection,
      }),
      // Последнее действие по каждой заявке. Выборка ограничена периодом
      // и заявками первой страницы, поэтому отбор первого события в памяти
      // обходится дешевле отдельного запроса на каждую заявку.
      this.prisma.activityEvent.findMany({
        where: { ...where, engagementId: { in: ids } },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        distinct: ['engagementId'],
        select: eventSelection,
      }),
    ]);

    const engagementById = new Map(engagements.map((row) => [row.id, row]));
    const described = new Map(
      (await this.describe(lastEvents)).map((item, index) => [lastEvents[index]?.engagementId, item]),
    );

    const result: RecentEngagementDto[] = [];

    for (const group of groups) {
      const engagement = group.engagementId ? engagementById.get(group.engagementId) : undefined;
      const lastActivity = group.engagementId ? described.get(group.engagementId) : undefined;

      if (!engagement || !lastActivity || !group._max.occurredAt) {
        continue;
      }

      result.push({
        engagement: toEngagementListItem(engagement),
        lastActivityAt: group._max.occurredAt,
        lastActivity,
        actionCount: group._count._all,
      });
    }

    return result;
  }

  private async page(
    where: Prisma.ActivityEventWhereInput,
    page: number,
    limit: number,
  ): Promise<PageDto<ActivityItemDto>> {
    const [total, records] = await Promise.all([
      this.prisma.activityEvent.count({ where }),
      this.prisma.activityEvent.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: eventSelection,
      }),
    ]);

    const items = await this.describe(records);
    const totalPages = Math.ceil(total / limit);

    return {
      items,
      meta: { page, limit, total, totalPages, hasNext: page < totalPages },
    };
  }

  /**
   * Дополняет события тем, что лента не хранит сама: текстом заметки, именем
   * файла, названием задачи, комментарием к переходу, именами ответственных.
   * По одному запросу на вид связанных записей, а не на каждое событие.
   */
  private async describe(records: EventRecord[]): Promise<ActivityItemDto[]> {
    const noteIds = unique(records.map((row) => row.noteId));
    const attachmentIds = unique(records.map((row) => row.attachmentId));
    const taskIds = unique(records.map((row) => row.taskId));
    const transitionIds = unique(records.map((row) => row.transitionId));
    const ownerIds = unique(
      records.flatMap((row) => {
        const details = asObject(row.details);
        return [asString(details?.fromOwnerId), asString(details?.toOwnerId)];
      }),
    );

    const [notes, attachments, tasks, transitions, owners] = await Promise.all([
      noteIds.length
        ? this.prisma.engagementNote.findMany({
            where: { id: { in: noteIds } },
            select: { id: true, body: true, deletedAt: true },
          })
        : [],
      attachmentIds.length
        ? this.prisma.attachment.findMany({
            where: { id: { in: attachmentIds } },
            select: { id: true, fileName: true, deletedAt: true },
          })
        : [],
      taskIds.length
        ? this.prisma.plannerTask.findMany({
            where: { id: { in: taskIds } },
            select: { id: true, title: true, dueDate: true, completedAt: true, deletedAt: true },
          })
        : [],
      transitionIds.length
        ? this.prisma.workflowTransition.findMany({
            where: { id: { in: transitionIds } },
            select: { id: true, comment: true },
          })
        : [],
      ownerIds.length
        ? this.prisma.appUser.findMany({
            where: { id: { in: ownerIds } },
            select: { id: true, displayName: true },
          })
        : [],
    ]);

    const noteById = new Map(notes.map((row) => [row.id, row]));
    const attachmentById = new Map(attachments.map((row) => [row.id, row]));
    const taskById = new Map(tasks.map((row) => [row.id, row]));
    const commentByTransition = new Map(transitions.map((row) => [row.id.toString(), row.comment]));
    const ownerName = new Map(owners.map((row) => [row.id, row.displayName]));

    return records.map((row) => {
      const details = asObject(row.details);
      const note = row.noteId ? noteById.get(row.noteId) : undefined;
      const attachment = row.attachmentId ? attachmentById.get(row.attachmentId) : undefined;
      const task = row.taskId ? taskById.get(row.taskId) : undefined;

      // Текст удалённой заметки в ленту не выводится: удаление — это
      // решение убрать текст из карточки, и лента не должна его сохранять.
      const excerpt = note && !note.deletedAt ? excerptOf(note.body) : null;
      const taskDueDate = task ? task.dueDate.toISOString().slice(0, 10) : null;

      const description = describeActivity({
        type: row.type,
        source: row.source,
        stageLabel: row.stateLabel,
        details,
        noteExcerpt: excerpt,
        fileName: attachment?.fileName ?? null,
        taskTitle: task?.title ?? null,
        taskDueDate,
        fromOwnerName: ownerName.get(asString(details?.fromOwnerId) ?? '') ?? null,
        toOwnerName: ownerName.get(asString(details?.toOwnerId) ?? '') ?? null,
      });

      const comment =
        row.transitionId !== null
          ? (commentByTransition.get(row.transitionId.toString()) ?? null)
          : row.type === 'INTEREST_CHANGED'
            ? asString(details?.comment)
            : null;

      return {
        id: row.id.toString(),
        occurredAt: row.occurredAt,
        type: row.type,
        source: row.source,
        title: description.title,
        summary: description.summary,
        actor: row.actorId && row.actor ? { id: row.actorId, name: row.actor.displayName } : null,
        engagement: row.engagement
          ? {
              id: row.engagement.id,
              counterpartyName: row.engagement.university?.name ?? row.engagement.counterpartyName ?? '',
              directionName: row.engagement.direction.name,
              currentStateLabel: row.engagement.currentStateLabel,
            }
          : null,
        stage: row.stateKey ? { key: row.stateKey, label: row.stateLabel ?? row.stateKey } : null,
        note: row.noteId ? { id: row.noteId, excerpt, isDeleted: !note || note.deletedAt !== null } : null,
        attachment: row.attachmentId
          ? {
              id: row.attachmentId,
              fileName: attachment?.fileName ?? null,
              isDeleted: !attachment || attachment.deletedAt !== null,
            }
          : null,
        task: row.taskId
          ? {
              id: row.taskId,
              title: task?.title ?? null,
              dueDate: taskDueDate,
              isCompleted: task?.completedAt != null,
              isDeleted: !task || task.deletedAt !== null,
            }
          : null,
        comment,
        details,
      };
    });
  }
}

function periodAndTypes(query: {
  from?: string;
  to?: string;
  types?: string[];
}): Prisma.ActivityEventWhereInput {
  const period: Prisma.DateTimeFilter = {};
  if (query.from) period.gte = new Date(query.from);
  if (query.to) period.lte = new Date(query.to);

  return {
    ...(Object.keys(period).length > 0 ? { occurredAt: period } : {}),
    ...(query.types && query.types.length > 0
      ? { type: { in: query.types as Prisma.EnumActivityTypeFilter['in'] } }
      : {}),
  };
}

function excerptOf(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH - 1)}…` : flat;
}

function unique<T>(values: Array<T | null | undefined>): T[] {
  return [...new Set(values.filter((value): value is T => value !== null && value !== undefined))];
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
