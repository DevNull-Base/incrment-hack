import { Body, Controller, Get, HttpStatus, Post, Query, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { PersonalData } from '../../../common/decorators/personal-data.decorator.js';
import { RateLimit } from '../../access/rate-limit.decorator.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../../auth/authenticated-user.js';
import { LmsCandidateListDto, LmsExportFilterDto, LmsExportRequestDto } from './dto/lms-export.dto.js';
import { LmsExportService } from './lms-export.service.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@ApiTags('Интеграции')
@ApiBearerAuth('keycloak')
@Controller({ path: 'integration/lms/export', version: '1' })
export class LmsExportController {
  constructor(private readonly service: LmsExportService) {}

  @Get('candidates')
  @PersonalData('LmsExport')
  @ApiOperation({
    summary: 'Кто ждёт выгрузки в LMS',
    description:
      'Оплатившие слушатели на этапе «Договор и оплата», ещё не переданные в LMS. ' +
      'По каждому — готов ли он к выгрузке и чего не хватает.',
  })
  @ApiOkResponse({ type: LmsCandidateListDto })
  candidates(
    @Query() filter: LmsExportFilterDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LmsCandidateListDto> {
    return this.service.candidates(filter, user);
  }

  /**
   * Файл загрузки в LMS по шаблону заказчика.
   *
   * Выгруженные помечаются, и следующая выгрузка их не включает: иначе
   * LMS получила бы дубли учётных записей. Сколько выгружено и сколько
   * пропущено — в заголовках ответа.
   */
  @Post()
  @RateLimit({ export: true, bucket: 'reports' })
  @PersonalData('LmsExport')
  @ApiOperation({
    summary: 'Выгрузить слушателей для загрузки в LMS',
    description:
      'XLSX по шаблону «Загрузка пользователей»: заполняются фамилия, имя, отчество, телефон ' +
      'и почта. Заголовки X-Exported-Count, X-Skipped-Count (не готовы — нет почты или ФИО), ' +
      'X-Remaining-Count (не вошли в предел одной выгрузки).',
  })
  @ApiBody({ type: LmsExportRequestDto })
  @ApiProduces(XLSX_MIME)
  @ApiResponse({ status: 200, description: 'Файл загрузки в LMS' })
  async export(
    @Body() request: LmsExportRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const file = await this.service.export(request, user);

    await reply
      .status(HttpStatus.OK)
      .header('Content-Type', XLSX_MIME)
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`)
      .header('X-Exported-Count', String(file.exported))
      .header('X-Skipped-Count', String(file.skipped))
      .header('X-Remaining-Count', String(file.remaining))
      // В файле персональные данные — промежуточное кэширование запрещено.
      .header('Cache-Control', 'private, no-store')
      .send(file.content);
  }
}
