import { Injectable } from '@nestjs/common';
import { assertNotArchived } from '../engagement/archive-guard.js';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { DataScopeService, engagementScopeFilter } from '../access/data-scope.service.js';
import { WorkflowService, type EngagementStage } from '../workflow/workflow.service.js';
import { recordActivity } from '../activity/activity-log.js';
import { INTERNAL_EVENTS, type EngagementActivityEvent } from '../realtime/realtime.gateway.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CreateNoteDto, NoteDto, NoteQueryDto, UpdateNoteDto } from './dto/note.dto.js';

/**
 * Сколько заметок отдаётся за раз. Заметки ведутся по одной заявке, и даже
 * у многолетней работы с вузом их десятки; предел защищает отклик от
 * патологического случая, а не режет обычную карточку.
 */
const NOTES_LIMIT = 500;

/** Заявка, к которой относится заметка, — в объёме, нужном заметкам. */
interface EngagementContext {
  id: string;
  ownerId: string;
  isArchived: boolean;
  currentStateKey: string;
  currentStateLabel: string;
  definition: unknown;
}

const noteSelection = {
  id: true,
  engagementId: true,
  body: true,
  stateKey: true,
  stateLabel: true,
  isPinned: true,
  createdAt: true,
  editedAt: true,
  authorId: true,
  author: { select: { displayName: true } },
} satisfies Prisma.EngagementNoteSelect;

type NoteRecord = Prisma.EngagementNoteGetPayload<{ select: typeof noteSelection }>;

/**
 * Заметки к заявке и к её этапам.
 *
 * Требование ТЗ — «добавление комментария в статус» — отдельно от перехода:
 * комментарий при переходе фиксирует решение, а заметка — ход работы, пока
 * заявка стоит на этапе. Заметка без этапа относится к заявке целиком:
 * «ректор в отпуске до марта» не принадлежит ни одному шагу процесса.
 */
@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly workflow: WorkflowService,
    private readonly events: EventEmitter2,
  ) {}

  /** Заметки заявки: закреплённые первыми, затем новые сверху. */
  async list(engagementId: string, query: NoteQueryDto, user: AuthenticatedUser): Promise<NoteDto[]> {
    await this.loadEngagement(engagementId, user);

    const notes = await this.prisma.engagementNote.findMany({
      where: {
        engagementId,
        deletedAt: null,
        ...(query.general ? { stateKey: null } : query.stateKey ? { stateKey: query.stateKey } : {}),
      },
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
      take: NOTES_LIMIT,
      select: noteSelection,
    });

    return notes.map((note) => toDto(note, user));
  }

  async create(engagementId: string, dto: CreateNoteDto, user: AuthenticatedUser): Promise<NoteDto> {
    const engagement = await this.loadEngagement(engagementId, user);
    assertNotArchived(engagement);
    const stage = dto.stateKey === null ? null : this.resolveStage(engagement, dto.stateKey);
    const body = normalizeBody(dto.body);

    const note = await this.prisma.$transaction(async (tx) => {
      const created = await tx.engagementNote.create({
        data: {
          engagementId,
          authorId: user.id,
          body,
          stateKey: stage?.key ?? null,
          stateLabel: stage?.label ?? null,
          isPinned: dto.isPinned ?? false,
        },
        select: noteSelection,
      });

      await recordActivity(tx, {
        type: 'NOTE_ADDED',
        actorId: user.id,
        engagementId,
        stage,
        noteId: created.id,
        details: { pinned: created.isPinned },
      });

      return created;
    });

    this.emitActivity(engagement, user, 'NOTE_ADDED');

    return toDto(note, user);
  }

  async update(
    engagementId: string,
    noteId: string,
    dto: UpdateNoteDto,
    user: AuthenticatedUser,
  ): Promise<NoteDto> {
    const engagement = await this.loadEngagement(engagementId, user);
    assertNotArchived(engagement);
    const note = await this.findNote(engagementId, noteId);

    const editsContent = dto.body !== undefined || dto.stateKey !== undefined;

    if (editsContent && note.authorId !== user.id) {
      throw new AppException('FORBIDDEN', {
        detail: 'Текст и этап заметки может менять только её автор.',
      });
    }

    const data: Prisma.EngagementNoteUpdateInput = {};
    const changed: string[] = [];
    let stage: EngagementStage | null = note.stateKey
      ? { key: note.stateKey, label: note.stateLabel ?? note.stateKey }
      : null;

    if (dto.body !== undefined) {
      const body = normalizeBody(dto.body);

      if (body !== note.body) {
        data.body = body;
        data.editedAt = new Date();
        changed.push('body');
      }
    }

    if (dto.stateKey !== undefined && dto.stateKey !== note.stateKey) {
      stage = dto.stateKey === null ? null : this.resolveStage(engagement, dto.stateKey);
      data.stateKey = stage?.key ?? null;
      data.stateLabel = stage?.label ?? null;
      changed.push('stage');
    }

    if (dto.isPinned !== undefined && dto.isPinned !== note.isPinned) {
      data.isPinned = dto.isPinned;
      changed.push('pinned');
    }

    if (changed.length === 0) {
      return toDto(note, user);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.engagementNote.update({
        where: { id: noteId },
        data,
        select: noteSelection,
      });

      await recordActivity(tx, {
        type: 'NOTE_UPDATED',
        actorId: user.id,
        engagementId,
        stage,
        noteId,
        details: {
          changed,
          pinned: saved.isPinned,
          ...(changed.includes('stage')
            ? { fromStateLabel: note.stateLabel, toStateLabel: saved.stateLabel }
            : {}),
        },
      });

      return saved;
    });

    this.emitActivity(engagement, user, 'NOTE_UPDATED');

    return toDto(updated, user);
  }

  /**
   * Удаление заметки — мягкое: запись помечается удалённой и пропадает из
   * карточки, а в ленте остаётся факт «заметка удалена». Удалить может автор
   * либо администратор — последнему это нужно, чтобы убрать из карточки
   * персональные данные, внесённые по ошибке.
   */
  async remove(engagementId: string, noteId: string, user: AuthenticatedUser): Promise<void> {
    const engagement = await this.loadEngagement(engagementId, user);
    assertNotArchived(engagement);
    const note = await this.findNote(engagementId, noteId);

    if (!canDelete(note, user)) {
      throw new AppException('FORBIDDEN', {
        detail: 'Удалить заметку может её автор или администратор.',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.engagementNote.update({
        where: { id: noteId },
        data: { deletedAt: new Date() },
      });

      await recordActivity(tx, {
        type: 'NOTE_DELETED',
        actorId: user.id,
        engagementId,
        stage: note.stateKey ? { key: note.stateKey, label: note.stateLabel ?? note.stateKey } : null,
        noteId,
      });
    });

    this.emitActivity(engagement, user, 'NOTE_DELETED');
  }

  /**
   * Загружает заявку, проверяя её доступность. Недоступная и несуществующая
   * заявка неразличимы — как и во всех остальных маршрутах карточки.
   */
  private async loadEngagement(engagementId: string, user: AuthenticatedUser): Promise<EngagementContext> {
    const scope = await this.dataScope.resolve(user);

    const found = await this.prisma.engagement.findFirst({
      where: { id: engagementId, ...engagementScopeFilter(scope) },
      select: {
        id: true,
        ownerId: true,
        isArchived: true,
        currentStateKey: true,
        currentStateLabel: true,
        workflowInstance: { select: { template: { select: { definition: true } } } },
      },
    });

    if (!found) {
      throw new AppException('NOT_FOUND', {
        detail: 'Взаимодействие не найдено либо недоступно текущему пользователю.',
      });
    }

    return {
      id: found.id,
      ownerId: found.ownerId,
      isArchived: found.isArchived,
      currentStateKey: found.currentStateKey,
      currentStateLabel: found.currentStateLabel,
      definition: found.workflowInstance?.template.definition ?? null,
    };
  }

  private async findNote(engagementId: string, noteId: string): Promise<NoteRecord> {
    // Условие по заявке обязательно: иначе, зная идентификатор чужой
    // заметки, её можно было бы править через доступную карточку.
    const note = await this.prisma.engagementNote.findFirst({
      where: { id: noteId, engagementId, deletedAt: null },
      select: noteSelection,
    });

    if (!note) {
      throw new AppException('NOT_FOUND', { detail: 'Заметка не найдена.' });
    }

    return note;
  }

  private resolveStage(engagement: EngagementContext, requestedKey: string | undefined): EngagementStage {
    if (!engagement.definition) {
      return { key: engagement.currentStateKey, label: engagement.currentStateLabel };
    }

    return this.workflow.resolveStage(
      this.workflow.parseDefinition(engagement.definition),
      engagement.currentStateKey,
      requestedKey,
    );
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

/** Пробелы по краям отбрасываются; заметка из одних пробелов — пустая. */
function normalizeBody(raw: string): string {
  const body = raw.trim();

  if (body.length === 0) {
    throw new AppException('VALIDATION_FAILED', {
      detail: 'Заметка не может быть пустой.',
      issues: [{ field: 'body', message: 'Введите текст заметки' }],
    });
  }

  return body;
}

function canDelete(note: { authorId: string }, user: AuthenticatedUser): boolean {
  return note.authorId === user.id || user.role === 'ADMIN';
}

function toDto(note: NoteRecord, user: AuthenticatedUser): NoteDto {
  return {
    id: note.id,
    engagementId: note.engagementId,
    body: note.body,
    stateKey: note.stateKey,
    stateLabel: note.stateLabel,
    isPinned: note.isPinned,
    author: { id: note.authorId, name: note.author.displayName },
    createdAt: note.createdAt,
    editedAt: note.editedAt,
    canEdit: note.authorId === user.id,
    canDelete: canDelete(note, user),
  };
}
