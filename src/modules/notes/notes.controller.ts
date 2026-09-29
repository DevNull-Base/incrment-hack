import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { NotesService } from './notes.service.js';
import { CreateNoteDto, NoteDto, NoteQueryDto, UpdateNoteDto } from './dto/note.dto.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';

/**
 * Заметки к заявке и к её этапам.
 *
 * Требование ТЗ — «добавление комментария в статус» — как отдельная операция:
 * комментарий при переходе фиксирует решение, а заметка — ход работы, пока
 * заявка стоит на этапе. Доступ к заметкам тот же, что к карточке.
 */
@ApiTags('Заметки')
@ApiBearerAuth('keycloak')
@Controller({ path: 'engagements/:engagementId/notes', version: '1' })
export class NotesController {
  constructor(private readonly service: NotesService) {}

  @Get()
  @ApiOperation({
    summary: 'Заметки заявки',
    description:
      'Закреплённые идут первыми, затем новые сверху. Отбор по этапу — stateKey; ' +
      'только заметки ко всей заявке — general=true.',
  })
  @ApiParam({ name: 'engagementId', format: 'uuid' })
  @ApiOkResponse({ type: NoteDto, isArray: true })
  list(
    @Param('engagementId', ParseUUIDPipe) engagementId: string,
    @Query() query: NoteQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NoteDto[]> {
    return this.service.list(engagementId, query, user);
  }

  @Post()
  @ApiOperation({
    summary: 'Оставить заметку',
    description:
      'По умолчанию заметка ложится на текущий этап заявки; stateKey указывает другой ' +
      'этап процесса, null — заметку ко всей заявке. Подпись этапа фиксируется на момент записи.',
  })
  @ApiParam({ name: 'engagementId', format: 'uuid' })
  @ApiCreatedResponse({ type: NoteDto })
  create(
    @Param('engagementId', ParseUUIDPipe) engagementId: string,
    @Body() dto: CreateNoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NoteDto> {
    return this.service.create(engagementId, dto, user);
  }

  @Patch(':noteId')
  @ApiOperation({
    summary: 'Изменить заметку',
    description:
      'Текст и этап меняет только автор. Закрепить или открепить может любой, ' + 'кто видит карточку.',
  })
  @ApiParam({ name: 'engagementId', format: 'uuid' })
  @ApiParam({ name: 'noteId', format: 'uuid' })
  @ApiOkResponse({ type: NoteDto })
  update(
    @Param('engagementId', ParseUUIDPipe) engagementId: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body() dto: UpdateNoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NoteDto> {
    return this.service.update(engagementId, noteId, dto, user);
  }

  @Delete(':noteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Удалить заметку',
    description:
      'Доступно автору и администратору. Заметка пропадает из карточки, ' +
      'а в ленте действий остаётся запись об удалении.',
  })
  @ApiParam({ name: 'engagementId', format: 'uuid' })
  @ApiParam({ name: 'noteId', format: 'uuid' })
  @ApiNoContentResponse()
  remove(
    @Param('engagementId', ParseUUIDPipe) engagementId: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.service.remove(engagementId, noteId, user);
  }
}
