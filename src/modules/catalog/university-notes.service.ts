import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { DataScopeService } from '../access/data-scope.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { assertUniversityVisible } from './university-access.js';
import {
  CreateUniversityNoteDto,
  UniversityNoteDto,
  UpdateUniversityNoteDto,
} from './dto/university-note.dto.js';

/** Предел выдачи — как у заметок заявки: защита отклика, а не обрезка карточки. */
const NOTES_LIMIT = 500;

const noteSelection = {
  id: true,
  universityId: true,
  body: true,
  isPinned: true,
  createdAt: true,
  editedAt: true,
  authorId: true,
  author: { select: { displayName: true } },
} satisfies Prisma.UniversityNoteSelect;

type NoteRecord = Prisma.UniversityNoteGetPayload<{ select: typeof noteSelection }>;

/**
 * Заметки по вузу целиком.
 *
 * Заметки заявок описывают ход конкретной работы, а многое из того, что
 * менеджер знает о вузе, ни к одной заявке не относится: смена руководства,
 * порядок закупок, с кем договариваться. Такие записи прежде хранились
 * в браузере менеджера — их не видели коллеги, и они терялись при смене
 * ответственного.
 *
 * Доступ — у всех, кому вуз не закрыт ограничением видимости: заметки
 * помогают любому, кто начинает работу с этим вузом.
 */
@Injectable()
export class UniversityNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
  ) {}

  async list(universityId: string, user: AuthenticatedUser): Promise<UniversityNoteDto[]> {
    await this.requireVisible(universityId, user);

    const notes = await this.prisma.universityNote.findMany({
      where: { universityId, deletedAt: null },
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
      take: NOTES_LIMIT,
      select: noteSelection,
    });

    return notes.map((note) => toDto(note, user));
  }

  async create(
    universityId: string,
    dto: CreateUniversityNoteDto,
    user: AuthenticatedUser,
  ): Promise<UniversityNoteDto> {
    await this.requireVisible(universityId, user);

    const note = await this.prisma.universityNote.create({
      data: {
        universityId,
        authorId: user.id,
        body: normalizeBody(dto.body),
        isPinned: dto.isPinned ?? false,
      },
      select: noteSelection,
    });

    return toDto(note, user);
  }

  async update(
    universityId: string,
    noteId: string,
    dto: UpdateUniversityNoteDto,
    user: AuthenticatedUser,
  ): Promise<UniversityNoteDto> {
    await this.requireVisible(universityId, user);
    const note = await this.findNote(universityId, noteId);

    const data: Prisma.UniversityNoteUpdateInput = {};

    if (dto.body !== undefined) {
      if (note.authorId !== user.id) {
        throw new AppException('FORBIDDEN', { detail: 'Текст заметки может менять только её автор.' });
      }

      const body = normalizeBody(dto.body);

      if (body !== note.body) {
        data.body = body;
        data.editedAt = new Date();
      }
    }

    if (dto.isPinned !== undefined && dto.isPinned !== note.isPinned) {
      data.isPinned = dto.isPinned;
    }

    if (Object.keys(data).length === 0) {
      return toDto(note, user);
    }

    const updated = await this.prisma.universityNote.update({
      where: { id: noteId },
      data,
      select: noteSelection,
    });

    return toDto(updated, user);
  }

  /** Мягкое удаление: автору и администратору, как у заметок заявки. */
  async remove(universityId: string, noteId: string, user: AuthenticatedUser): Promise<void> {
    await this.requireVisible(universityId, user);
    const note = await this.findNote(universityId, noteId);

    if (!canDelete(note, user)) {
      throw new AppException('FORBIDDEN', { detail: 'Удалить заметку может её автор или администратор.' });
    }

    await this.prisma.universityNote.update({ where: { id: noteId }, data: { deletedAt: new Date() } });
  }

  private async requireVisible(universityId: string, user: AuthenticatedUser): Promise<void> {
    await assertUniversityVisible(this.prisma, universityId, await this.dataScope.resolve(user));
  }

  private async findNote(universityId: string, noteId: string): Promise<NoteRecord> {
    // Условие по вузу обязательно: иначе чужую заметку можно было бы
    // править через доступный вуз, зная её идентификатор.
    const note = await this.prisma.universityNote.findFirst({
      where: { id: noteId, universityId, deletedAt: null },
      select: noteSelection,
    });

    if (!note) {
      throw new AppException('NOT_FOUND', { detail: 'Заметка не найдена.' });
    }

    return note;
  }
}

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

function toDto(note: NoteRecord, user: AuthenticatedUser): UniversityNoteDto {
  return {
    id: note.id,
    universityId: note.universityId,
    body: note.body,
    isPinned: note.isPinned,
    author: { id: note.authorId, name: note.author.displayName },
    createdAt: note.createdAt,
    editedAt: note.editedAt,
    canEdit: note.authorId === user.id,
    canDelete: canDelete(note, user),
  };
}
