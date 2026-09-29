import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { ToBoolean } from '../../../common/dto/query-transforms.js';

/** Ключ этапа — в том же формате, что и в схеме процесса. */
const STATE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const STATE_KEY_MESSAGE = 'Ключ этапа: заглавные латинские буквы, цифры и подчёркивание';

/** Предел длины заметки: страница текста с запасом, но не выгрузка документа. */
export const NOTE_MAX_LENGTH = 10_000;

export class NoteQueryDto {
  @ApiPropertyOptional({
    description: 'Только заметки этого этапа процесса',
    example: 'SIGNING',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(STATE_KEY_PATTERN, { message: STATE_KEY_MESSAGE })
  stateKey?: string;

  @ApiPropertyOptional({
    description: 'Только заметки ко всей заявке, без привязки к этапу',
    default: false,
  })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  general?: boolean;
}

export class CreateNoteDto {
  @ApiProperty({
    description: 'Текст заметки',
    example: 'Проректор просит прислать программу курса до пятницы',
    maxLength: NOTE_MAX_LENGTH,
  })
  @IsString()
  @MinLength(1, { message: 'Заметка не может быть пустой' })
  @MaxLength(NOTE_MAX_LENGTH, { message: `Заметка длиннее ${NOTE_MAX_LENGTH} символов` })
  body!: string;

  @ApiPropertyOptional({
    description:
      'Этап процесса, к которому относится заметка. Не указан — текущий этап заявки; ' +
      'null — заметка ко всей заявке, без этапа.',
    nullable: true,
    example: 'MEETING',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(64)
  @Matches(STATE_KEY_PATTERN, { message: STATE_KEY_MESSAGE })
  stateKey?: string | null;

  @ApiPropertyOptional({
    description: 'Закрепить заметку: закреплённые идут в списке первыми',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;
}

/**
 * Правка заметки. Текст и этап меняет только автор, закрепить или открепить
 * может любой, кто видит карточку: закрепление — это порядок в общей
 * карточке, а не правка чужих слов.
 */
export class UpdateNoteDto {
  @ApiPropertyOptional({ description: 'Новый текст заметки', maxLength: NOTE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Заметка не может быть пустой' })
  @MaxLength(NOTE_MAX_LENGTH, { message: `Заметка длиннее ${NOTE_MAX_LENGTH} символов` })
  body?: string;

  @ApiPropertyOptional({
    description: 'Перенести заметку на другой этап; null — сделать заметкой ко всей заявке',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(64)
  @Matches(STATE_KEY_PATTERN, { message: STATE_KEY_MESSAGE })
  stateKey?: string | null;

  @ApiPropertyOptional({ description: 'Закрепить либо открепить' })
  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;
}

export class NoteAuthorDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Иванова Анна' })
  name!: string;
}

export class NoteDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  engagementId!: string;

  @ApiProperty()
  body!: string;

  @ApiProperty({
    description: 'Этап, к которому относится заметка; null — заметка ко всей заявке',
    nullable: true,
    example: 'MEETING',
  })
  stateKey!: string | null;

  @ApiProperty({
    description:
      'Подпись этапа на момент записи. Не меняется при переименовании статуса ' +
      'и сохраняется, если статус удалят из процесса.',
    nullable: true,
    example: 'Организация встречи',
  })
  stateLabel!: string | null;

  @ApiProperty()
  isPinned!: boolean;

  @ApiProperty({ type: NoteAuthorDto })
  author!: NoteAuthorDto;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ description: 'Когда автор правил текст; null — не правил', nullable: true })
  editedAt!: Date | null;

  @ApiProperty({ description: 'Может ли текущий пользователь править текст и этап' })
  canEdit!: boolean;

  @ApiProperty({ description: 'Может ли текущий пользователь удалить заметку' })
  canDelete!: boolean;
}
