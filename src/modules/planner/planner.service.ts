import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { PageDto } from '../../common/dto/pagination.dto.js';
import { AppConfig } from '../../config/configuration.js';
import { DataScopeService, engagementScopeFilter } from '../access/data-scope.service.js';
import { recordActivity } from '../activity/activity-log.js';
import { NotificationService } from '../notification/notification.service.js';
import { MeetingsService, meetingSelection } from '../meetings/meetings.service.js';
import {
  buildTaskAssignedText,
  buildTaskCompletedText,
  type TaskSummary,
} from '../notification/notification-messages.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import {
  CalendarDto,
  CalendarItemDto,
  CalendarQueryDto,
  CreateTaskDto,
  TaskDto,
  TaskQueryDto,
  UpdateTaskDto,
} from './dto/planner.dto.js';
import {
  addDays,
  dateFromDb,
  dateInZone,
  dateToDb,
  daysInclusive,
  isCalendarDate,
  isTaskOverdue,
  startOfDayUtc,
  timeInZone,
  zonedToUtc,
} from './planner-dates.js';

/** Наибольший охват календаря: квартал с запасом. */
const MAX_CALENDAR_DAYS = 92;

/** Предел числа сроков этапов в одном ответе календаря. */
const DEADLINES_LIMIT = 1000;

const taskSelection = {
  id: true,
  title: true,
  description: true,
  dueDate: true,
  dueAt: true,
  remindAt: true,
  reminderSentAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  ownerId: true,
  createdById: true,
  engagementId: true,
  owner: { select: { displayName: true } },
  createdBy: { select: { displayName: true } },
  engagement: {
    select: {
      id: true,
      counterpartyName: true,
      currentStateLabel: true,
      university: { select: { name: true } },
    },
  },
} satisfies Prisma.PlannerTaskSelect;

type TaskRecord = Prisma.PlannerTaskGetPayload<{ select: typeof taskSelection }>;

/**
 * Календарь задач.
 *
 * Задача — дело с датой: «позвонить в МИФИ», «отправить договор». Она
 * принадлежит исполнителю; руководитель может поставить задачу подчинённому,
 * и тогда исполнитель её выполняет, но не правит и не удаляет — поручение
 * нельзя молча переписать.
 *
 * Календарь показывает рядом с задачами сроки этапов заявок по нормативу
 * процесса: это «контроль за исполнением каждого этапа» из ТЗ, и срок этапа
 * не нужно дублировать задачей вручную.
 */
@Injectable()
export class PlannerService {
  private readonly timeZone: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly notifications: NotificationService,
    private readonly meetings: MeetingsService,
    config: ConfigService<AppConfig, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PlannerService.name);
    this.timeZone = config.get('APP_TIMEZONE', { infer: true });
  }

  // ------------------------------------------------------------- Задачи --

  async list(query: TaskQueryDto, user: AuthenticatedUser): Promise<PageDto<TaskDto>> {
    const now = new Date();
    const today = dateInZone(now, this.timeZone);

    const dueDate: Prisma.DateTimeFilter = {};
    if (query.from) dueDate.gte = dateToDb(this.assertDate(query.from, 'from'));
    if (query.to) dueDate.lte = dateToDb(this.assertDate(query.to, 'to'));

    const where: Prisma.PlannerTaskWhereInput = {
      deletedAt: null,
      ...(query.assignedByMe ? { createdById: user.id, ownerId: { not: user.id } } : { ownerId: user.id }),
      ...(query.engagementId ? { engagementId: query.engagementId } : {}),
      ...(Object.keys(dueDate).length > 0 ? { dueDate } : {}),
      ...statusFilter(query.status, now, today),
    };

    // Выполненные — последние выполненные сверху; остальные — по сроку,
    // и внутри дня задачи «на весь день» раньше задач на время.
    const orderBy: Prisma.PlannerTaskOrderByWithRelationInput[] =
      query.status === 'done'
        ? [{ completedAt: 'desc' }, { id: 'asc' }]
        : [{ dueDate: 'asc' }, { dueAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }];

    const skip = (query.page - 1) * query.limit;

    const [total, records] = await Promise.all([
      this.prisma.plannerTask.count({ where }),
      this.prisma.plannerTask.findMany({
        where,
        orderBy,
        skip,
        take: query.limit,
        select: taskSelection,
      }),
    ]);

    const totalPages = Math.ceil(total / query.limit);

    return {
      items: records.map((record) => this.toDto(record, user, now)),
      meta: { page: query.page, limit: query.limit, total, totalPages, hasNext: query.page < totalPages },
    };
  }

  async findOne(id: string, user: AuthenticatedUser): Promise<TaskDto> {
    return this.toDto(await this.findVisible(id, user), user, new Date());
  }

  async create(dto: CreateTaskDto, user: AuthenticatedUser): Promise<TaskDto> {
    const owner = await this.resolveOwner(dto.ownerId, user);
    const dueDate = this.assertDate(dto.dueDate, 'dueDate');
    const dueAt = dto.dueTime ? zonedToUtc(dueDate, dto.dueTime, this.timeZone) : null;
    const remindAt = dto.remindAt ? this.assertFutureReminder(dto.remindAt) : null;

    if (dto.engagementId) {
      await this.assertEngagementVisible(dto.engagementId, [user, owner]);
    }

    const task = await this.prisma.$transaction(async (tx) => {
      const created = await tx.plannerTask.create({
        data: {
          ownerId: owner.id,
          createdById: user.id,
          engagementId: dto.engagementId ?? null,
          title: dto.title.trim(),
          description: dto.description?.trim() || null,
          dueDate: dateToDb(dueDate),
          dueAt,
          remindAt,
        },
        select: taskSelection,
      });

      await recordActivity(tx, {
        type: 'TASK_CREATED',
        actorId: user.id,
        engagementId: created.engagementId,
        taskId: created.id,
        details: {
          dueDate,
          dueTime: dto.dueTime ?? null,
          ...(owner.id !== user.id ? { assignedTo: owner.id } : {}),
        },
      });

      return created;
    });

    if (owner.id !== user.id) {
      await this.notifySafely(
        task.ownerId,
        buildTaskAssignedText(this.summary(task), user.displayName),
        task.id,
      );
    }

    return this.toDto(task, user, new Date());
  }

  async update(id: string, dto: UpdateTaskDto, user: AuthenticatedUser): Promise<TaskDto> {
    const task = await this.findVisible(id, user);
    this.assertCanEdit(task, user);

    const data: Prisma.PlannerTaskUncheckedUpdateInput = {};
    const changed: string[] = [];

    if (dto.title !== undefined && dto.title.trim() !== task.title) {
      data.title = dto.title.trim();
      changed.push('title');
    }

    if (dto.description !== undefined) {
      const description = dto.description?.trim() || null;

      if (description !== task.description) {
        data.description = description;
        changed.push('description');
      }
    }

    // Срок пересчитывается целиком: смена дня при сохранённом времени
    // сдвигает и точный момент, а снятие времени делает задачу «на весь день».
    const currentDate = dateFromDb(task.dueDate);
    const currentTime = task.dueAt ? timeInZone(task.dueAt, this.timeZone) : null;
    const nextDate = dto.dueDate !== undefined ? this.assertDate(dto.dueDate, 'dueDate') : currentDate;
    const nextTime = dto.dueTime !== undefined ? dto.dueTime : currentTime;

    if (nextDate !== currentDate || nextTime !== currentTime) {
      data.dueDate = dateToDb(nextDate);
      data.dueAt = nextTime ? zonedToUtc(nextDate, nextTime, this.timeZone) : null;
      changed.push('due');
    }

    if (dto.remindAt !== undefined) {
      const remindAt = dto.remindAt === null ? null : this.assertFutureReminder(dto.remindAt);

      if ((remindAt?.getTime() ?? null) !== (task.remindAt?.getTime() ?? null)) {
        data.remindAt = remindAt;
        // Новое напоминание — новое событие: прежняя отметка об отправке
        // относилась к старому моменту и не должна его подавлять.
        data.reminderSentAt = null;
        changed.push('reminder');
      }
    }

    if (dto.engagementId !== undefined && dto.engagementId !== task.engagementId) {
      if (dto.engagementId) {
        const owner = await this.loadUser(task.ownerId);
        await this.assertEngagementVisible(dto.engagementId, [user, owner]);
      }

      data.engagementId = dto.engagementId;
      changed.push('engagement');
    }

    if (changed.length === 0) {
      return this.toDto(task, user, new Date());
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.plannerTask.update({ where: { id }, data, select: taskSelection });

      await recordActivity(tx, {
        type: 'TASK_UPDATED',
        actorId: user.id,
        engagementId: saved.engagementId,
        taskId: id,
        details: { changed, dueDate: dateFromDb(saved.dueDate) },
      });

      return saved;
    });

    return this.toDto(updated, user, new Date());
  }

  /**
   * Отметка о выполнении. Доступна исполнителю и тому, кто поставил задачу.
   * Постановщик узнаёт о выполнении уведомлением — ради этого поручения
   * и ставят через систему, а не устно.
   */
  async complete(id: string, user: AuthenticatedUser): Promise<TaskDto> {
    const task = await this.findVisible(id, user);

    if (task.completedAt) {
      return this.toDto(task, user, new Date());
    }

    const updated = await this.setCompletion(task, user, new Date());

    if (task.createdById && task.createdById !== user.id && task.createdById !== task.ownerId) {
      await this.notifySafely(
        task.createdById,
        buildTaskCompletedText(this.summary(updated), user.displayName),
        task.id,
      );
    }

    return this.toDto(updated, user, new Date());
  }

  async reopen(id: string, user: AuthenticatedUser): Promise<TaskDto> {
    const task = await this.findVisible(id, user);

    if (!task.completedAt) {
      return this.toDto(task, user, new Date());
    }

    return this.toDto(await this.setCompletion(task, user, null), user, new Date());
  }

  /** Удаление — мягкое: в ленте остаётся запись о задаче и её судьбе. */
  async remove(id: string, user: AuthenticatedUser): Promise<void> {
    const task = await this.findVisible(id, user);
    this.assertCanEdit(task, user);

    await this.prisma.$transaction(async (tx) => {
      await tx.plannerTask.update({ where: { id }, data: { deletedAt: new Date() } });

      await recordActivity(tx, {
        type: 'TASK_DELETED',
        actorId: user.id,
        engagementId: task.engagementId,
        taskId: id,
        details: { dueDate: dateFromDb(task.dueDate) },
      });
    });
  }

  // ----------------------------------------------------------- Календарь --

  /**
   * Календарь за период: свои задачи и сроки этапов заявок.
   *
   * Сроки этапов берутся из норматива процесса (slaDays), а не заводятся
   * руками: заявка, вошедшая в этап, сама появляется в календаре в день,
   * когда норматив истекает.
   */
  async calendar(query: CalendarQueryDto, user: AuthenticatedUser): Promise<CalendarDto> {
    const from = this.assertDate(query.from, 'from');
    const to = this.assertDate(query.to, 'to');
    const span = daysInclusive(from, to);

    if (span < 1 || span > MAX_CALENDAR_DAYS) {
      throw new AppException('VALIDATION_FAILED', {
        detail: `Период календаря — от одного до ${MAX_CALENDAR_DAYS} дней, начало не позже конца.`,
        issues: [{ field: 'to', message: `Не больше ${MAX_CALENDAR_DAYS} дней от начала периода` }],
      });
    }

    const kinds = new Set(query.kinds ?? ['TASK', 'STAGE_DEADLINE', 'MEETING']);
    const now = new Date();

    const [tasks, deadlines, meetings] = await Promise.all([
      kinds.has('TASK') ? this.calendarTasks(from, to, query.includeCompleted ?? true, user, now) : [],
      kinds.has('STAGE_DEADLINE') ? this.calendarDeadlines(from, to, query.team ?? false, user, now) : [],
      kinds.has('MEETING') ? this.calendarMeetings(from, to, query.team ?? false, user) : [],
    ]);

    const items = [...tasks, ...deadlines, ...meetings].sort(compareCalendarItems);

    return { from, to, timezone: this.timeZone, items };
  }

  private async calendarTasks(
    from: string,
    to: string,
    includeCompleted: boolean,
    user: AuthenticatedUser,
    now: Date,
  ): Promise<CalendarItemDto[]> {
    const records = await this.prisma.plannerTask.findMany({
      where: {
        ownerId: user.id,
        deletedAt: null,
        dueDate: { gte: dateToDb(from), lte: dateToDb(to) },
        ...(includeCompleted ? {} : { completedAt: null }),
      },
      select: taskSelection,
    });

    return records.map((record) => {
      const task = this.toDto(record, user, now);

      return {
        kind: 'TASK' as const,
        id: task.id,
        date: task.dueDate,
        time: task.dueTime,
        at: task.dueAt,
        title: task.title,
        isDone: task.isCompleted,
        isOverdue: task.isOverdue,
        engagement: task.engagement,
        task,
        deadline: null,
        meeting: null,
      };
    });
  }

  private async calendarDeadlines(
    from: string,
    to: string,
    team: boolean,
    user: AuthenticatedUser,
    now: Date,
  ): Promise<CalendarItemDto[]> {
    const scope = await this.dataScope.resolve(user);

    const engagements = await this.prisma.engagement.findMany({
      where: {
        isArchived: false,
        ...(team ? {} : { ownerId: user.id }),
        workflowInstance: {
          completedAt: null,
          slaDueAt: {
            gte: startOfDayUtc(from, this.timeZone),
            lt: startOfDayUtc(addDays(to, 1), this.timeZone),
          },
        },
        ...engagementScopeFilter(scope),
      },
      take: DEADLINES_LIMIT,
      select: {
        id: true,
        counterpartyName: true,
        currentStateKey: true,
        currentStateLabel: true,
        ownerId: true,
        owner: { select: { displayName: true } },
        university: { select: { name: true } },
        workflowInstance: { select: { slaDueAt: true } },
      },
    });

    return engagements.flatMap((row) => {
      const dueAt = row.workflowInstance?.slaDueAt;

      if (!dueAt) {
        return [];
      }

      const counterpartyName = row.university?.name ?? row.counterpartyName ?? '';

      return [
        {
          kind: 'STAGE_DEADLINE' as const,
          id: row.id,
          date: dateInZone(dueAt, this.timeZone),
          time: timeInZone(dueAt, this.timeZone),
          at: dueAt,
          title: `Срок этапа «${row.currentStateLabel}»: ${counterpartyName}`,
          isDone: false,
          isOverdue: dueAt.getTime() < now.getTime(),
          engagement: { id: row.id, counterpartyName, currentStateLabel: row.currentStateLabel },
          task: null,
          deadline: {
            stateKey: row.currentStateKey,
            stateLabel: row.currentStateLabel,
            owner: { id: row.ownerId, name: row.owner.displayName },
          },
          meeting: null,
        },
      ];
    });
  }

  /**
   * Встречи за период: свои (участник либо ответственный по заявке),
   * с team — все в области видимости. Отменённые не показываются:
   * календарь отвечает на вопрос «куда мне идти».
   */
  private async calendarMeetings(
    from: string,
    to: string,
    team: boolean,
    user: AuthenticatedUser,
  ): Promise<CalendarItemDto[]> {
    const scope = await this.dataScope.resolve(user);

    const records = await this.prisma.engagementMeeting.findMany({
      where: {
        status: { not: 'CANCELLED' },
        scheduledAt: {
          gte: startOfDayUtc(from, this.timeZone),
          lt: startOfDayUtc(addDays(to, 1), this.timeZone),
        },
        engagement: { isArchived: false, ...engagementScopeFilter(scope) },
        ...(team ? {} : { OR: [{ attendeeIds: { has: user.id } }, { engagement: { ownerId: user.id } }] }),
      },
      take: DEADLINES_LIMIT,
      select: {
        ...meetingSelection,
        engagement: {
          select: {
            ownerId: true,
            counterpartyName: true,
            currentStateLabel: true,
            university: { select: { name: true, shortName: true } },
          },
        },
      },
    });

    const meetings = await this.meetings.toDtos(records, (record) => record.engagement.ownerId, user);

    return records.map((record, index) => {
      const meeting = meetings[index];
      const university = record.engagement.university;
      const counterpartyName = university?.name ?? record.engagement.counterpartyName ?? '';

      return {
        kind: 'MEETING' as const,
        id: meeting.id,
        date: meeting.date,
        time: meeting.time,
        at: meeting.scheduledAt,
        title: `Встреча: ${university?.shortName ?? counterpartyName}`,
        isDone: meeting.status === 'COMPLETED',
        isOverdue: false,
        engagement: {
          id: record.engagementId,
          counterpartyName,
          currentStateLabel: record.engagement.currentStateLabel,
        },
        task: null,
        deadline: null,
        meeting,
      };
    });
  }

  // ----------------------------------------------------------- Служебное --

  private async setCompletion(
    task: TaskRecord,
    user: AuthenticatedUser,
    completedAt: Date | null,
  ): Promise<TaskRecord> {
    return this.prisma.$transaction(async (tx) => {
      const saved = await tx.plannerTask.update({
        where: { id: task.id },
        data: { completedAt },
        select: taskSelection,
      });

      await recordActivity(tx, {
        type: completedAt ? 'TASK_COMPLETED' : 'TASK_REOPENED',
        actorId: user.id,
        engagementId: task.engagementId,
        taskId: task.id,
        details: { dueDate: dateFromDb(task.dueDate) },
      });

      return saved;
    });
  }

  /**
   * Задача, видимая пользователю: он её исполнитель или поставил её.
   * Чужая задача и несуществующая неразличимы, как и заявки.
   */
  private async findVisible(id: string, user: AuthenticatedUser): Promise<TaskRecord> {
    const task = await this.prisma.plannerTask.findFirst({
      where: { id, deletedAt: null, OR: [{ ownerId: user.id }, { createdById: user.id }] },
      select: taskSelection,
    });

    if (!task) {
      throw new AppException('NOT_FOUND', { detail: 'Задача не найдена.' });
    }

    return task;
  }

  private assertCanEdit(task: TaskRecord, user: AuthenticatedUser): void {
    if (!canEdit(task, user)) {
      throw new AppException('FORBIDDEN', {
        detail:
          'Задачу поставил руководитель: её можно отметить выполненной, но менять ' +
          'и удалять может только тот, кто её поставил.',
      });
    }
  }

  /**
   * Исполнитель задачи.
   *
   * Рядовой менеджер ставит задачи только себе. Руководитель — себе и своим
   * подчинённым: его право распоряжаться работой не шире его отдела.
   * Администратор — любому активному пользователю.
   */
  private async resolveOwner(
    ownerId: string | undefined,
    user: AuthenticatedUser,
  ): Promise<AuthenticatedUser> {
    if (!ownerId || ownerId === user.id) {
      return user;
    }

    if (user.role === 'USER') {
      throw new AppException('FORBIDDEN', {
        detail: 'Ставить задачи другим может руководитель или администратор.',
      });
    }

    const owner = await this.loadUser(ownerId);

    if (user.role === 'MANAGER' && owner.managerId !== user.id) {
      throw new AppException('OUT_OF_DATA_SCOPE', {
        detail: 'Руководитель ставит задачи только своим подчинённым.',
        meta: { ownerId },
      });
    }

    return owner;
  }

  private async loadUser(id: string): Promise<AuthenticatedUser> {
    const record = await this.prisma.appUser.findFirst({
      where: { id, isActive: true },
      select: {
        id: true,
        keycloakSub: true,
        email: true,
        displayName: true,
        role: true,
        managerId: true,
      },
    });

    if (!record) {
      throw new AppException('NOT_FOUND', { detail: 'Пользователь не найден либо деактивирован.' });
    }

    return record;
  }

  /**
   * Заявка, к которой привязывается задача, должна быть видна и тому, кто
   * ставит задачу, и исполнителю: иначе задача вела бы в карточку, которую
   * исполнитель открыть не может, или раскрывала бы чужую заявку.
   */
  private async assertEngagementVisible(engagementId: string, users: AuthenticatedUser[]): Promise<void> {
    for (const person of users) {
      const scope = await this.dataScope.resolve(person);
      const found = await this.prisma.engagement.findFirst({
        where: { id: engagementId, ...engagementScopeFilter(scope) },
        select: { id: true, isArchived: true },
      });

      if (!found) {
        throw new AppException('NOT_FOUND', {
          detail:
            person === users[0]
              ? 'Взаимодействие не найдено либо недоступно текущему пользователю.'
              : 'Исполнителю эта заявка недоступна — задачу по ней ему поставить нельзя.',
          issues: [{ field: 'engagementId', message: 'Выберите заявку, доступную исполнителю' }],
        });
      }

      // Архивная заявка только для чтения — новых задач по ней не ставят.
      if (found.isArchived) {
        throw new AppException('ENGAGEMENT_ARCHIVED', {
          issues: [{ field: 'engagementId', message: 'Заявка в архиве' }],
        });
      }
    }
  }

  private assertDate(value: string, field: string): string {
    if (!isCalendarDate(value)) {
      throw new AppException('VALIDATION_FAILED', {
        detail: `Некорректная дата: ${value}.`,
        issues: [{ field, message: 'Такой даты не существует' }],
      });
    }

    return value;
  }

  /**
   * Напоминание в прошлом не имеет смысла: планировщик отправил бы его
   * в ту же минуту. Минута запаса — на расхождение часов клиента и сервера.
   */
  private assertFutureReminder(value: string): Date {
    const remindAt = new Date(value);

    if (remindAt.getTime() < Date.now() - 60_000) {
      throw new AppException('VALIDATION_FAILED', {
        detail: 'Момент напоминания уже прошёл.',
        issues: [{ field: 'remindAt', message: 'Укажите момент в будущем' }],
      });
    }

    return remindAt;
  }

  private summary(task: TaskRecord): TaskSummary {
    return {
      id: task.id,
      title: task.title,
      dueDate: dateFromDb(task.dueDate),
      dueTime: task.dueAt ? timeInZone(task.dueAt, this.timeZone) : null,
      counterpartyName: task.engagement
        ? (task.engagement.university?.name ?? task.engagement.counterpartyName ?? null)
        : null,
    };
  }

  /**
   * Уведомление вне транзакции и без права уронить операцию: задача уже
   * сохранена, и сбой канала доставки не должен выглядеть для пользователя
   * как неудача постановки задачи.
   */
  private async notifySafely(
    userId: string,
    text: { subject: string; body: string },
    taskId: string,
  ): Promise<void> {
    try {
      await this.notifications.notify({
        userId,
        subject: text.subject,
        body: text.body,
        entityType: 'Task',
        entityId: taskId,
      });
    } catch (error: unknown) {
      this.logger.error({ err: error, taskId }, 'Не удалось отправить уведомление о задаче');
    }
  }

  private toDto(task: TaskRecord, user: AuthenticatedUser, now: Date): TaskDto {
    const dueDate = dateFromDb(task.dueDate);

    return {
      id: task.id,
      title: task.title,
      description: task.description,
      dueDate,
      dueTime: task.dueAt ? timeInZone(task.dueAt, this.timeZone) : null,
      dueAt: task.dueAt,
      remindAt: task.remindAt,
      isReminderSent: task.reminderSentAt !== null,
      isCompleted: task.completedAt !== null,
      completedAt: task.completedAt,
      isOverdue: isTaskOverdue(
        { dueDate, dueAt: task.dueAt, completedAt: task.completedAt },
        now,
        this.timeZone,
      ),
      owner: { id: task.ownerId, name: task.owner.displayName },
      createdBy:
        task.createdById && task.createdBy
          ? { id: task.createdById, name: task.createdBy.displayName }
          : null,
      isAssigned: task.createdById !== null && task.createdById !== task.ownerId,
      engagement: task.engagement
        ? {
            id: task.engagement.id,
            counterpartyName: task.engagement.university?.name ?? task.engagement.counterpartyName ?? '',
            currentStateLabel: task.engagement.currentStateLabel,
          }
        : null,
      canEdit: canEdit(task, user),
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }
}

/**
 * Править и удалять задачу может тот, кто её поставил. Исполнитель своей
 * собственной задачи — тоже он же; поручение руководителя исполнитель
 * только выполняет. Задача, постановщик которой удалён из системы,
 * переходит в полное распоряжение исполнителя.
 */
function canEdit(task: { ownerId: string; createdById: string | null }, user: AuthenticatedUser): boolean {
  if (task.createdById === user.id) {
    return true;
  }

  return task.ownerId === user.id && (task.createdById === null || task.createdById === task.ownerId);
}

function statusFilter(
  status: TaskQueryDto['status'],
  now: Date,
  today: string,
): Prisma.PlannerTaskWhereInput {
  switch (status) {
    case 'done':
      return { completedAt: { not: null } };
    case 'overdue':
      return {
        completedAt: null,
        OR: [{ dueAt: { lt: now } }, { dueAt: null, dueDate: { lt: dateToDb(today) } }],
      };
    case 'all':
      return {};
    default:
      return { completedAt: null };
  }
}

/** Порядок в календаре: по дню, внутри дня — «на весь день», затем по времени. */
function compareCalendarItems(left: CalendarItemDto, right: CalendarItemDto): number {
  if (left.date !== right.date) {
    return left.date < right.date ? -1 : 1;
  }

  // Пустая строка меньше любого времени — задачи на весь день идут первыми.
  const leftTime = left.time ?? '';
  const rightTime = right.time ?? '';

  if (leftTime !== rightTime) {
    return leftTime < rightTime ? -1 : 1;
  }

  if (left.kind !== right.kind) {
    return left.kind === 'TASK' ? -1 : 1;
  }

  return left.title.localeCompare(right.title, 'ru');
}
