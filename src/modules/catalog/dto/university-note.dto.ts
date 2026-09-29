import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { NOTE_MAX_LENGTH, NoteAuthorDto } from '../../notes/dto/note.dto.js';

export class CreateUniversityNoteDto {
  @ApiProperty({
    description: 'Текст заметки',
    example: 'С октября проректор по цифровизации — новый, прежние договорённости подтвердить заново',
    maxLength: NOTE_MAX_LENGTH,
  })
  @IsString()
  @MinLength(1, { message: 'Заметка не может быть пустой' })
  @MaxLength(NOTE_MAX_LENGTH, { message: `Заметка длиннее ${NOTE_MAX_LENGTH} символов` })
  body!: string;

  @ApiPropertyOptional({ description: 'Закрепить заметку: закреплённые идут первыми', default: false })
  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;
}

/** Текст меняет только автор; закрепить или открепить может любой, кто видит вуз. */
export class UpdateUniversityNoteDto {
  @ApiPropertyOptional({ description: 'Новый текст заметки', maxLength: NOTE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Заметка не может быть пустой' })
  @MaxLength(NOTE_MAX_LENGTH, { message: `Заметка длиннее ${NOTE_MAX_LENGTH} символов` })
  body?: string;

  @ApiPropertyOptional({ description: 'Закрепить либо открепить' })
  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;
}

export class UniversityNoteDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  universityId!: string;

  @ApiProperty()
  body!: string;

  @ApiProperty()
  isPinned!: boolean;

  @ApiProperty({ type: NoteAuthorDto })
  author!: NoteAuthorDto;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ description: 'Когда автор последний раз правил текст; null — не правили', nullable: true })
  editedAt!: Date | null;

  @ApiProperty({ description: 'Текущий пользователь может править текст' })
  canEdit!: boolean;

  @ApiProperty({ description: 'Текущий пользователь может удалить заметку' })
  canDelete!: boolean;
}
