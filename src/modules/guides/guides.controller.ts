import { Controller, Get, Param, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { GuidesService } from './guides.service.js';
import { GuideDto, GuideSummaryDto } from './dto/guide.dto.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';

/**
 * Встроенная документация.
 *
 * Отдаётся самим приложением: требование ТЗ — документация встроена
 * в платформу, а не размещена отдельно. Благодаря этому она открывается
 * и в закрытом контуре, где доступа в интернет нет.
 *
 * Состав разделов зависит от роли: руководство администратора рядовому
 * менеджеру не показывается — в нём описаны действия, которых у него нет.
 */
@ApiTags('Документация')
@ApiBearerAuth('keycloak')
@Controller({ path: 'guides', version: '1' })
export class GuidesController {
  constructor(private readonly service: GuidesService) {}

  @Get()
  @ApiOperation({ summary: 'Оглавление документации' })
  @ApiOkResponse({ type: [GuideSummaryDto] })
  list(@CurrentUser() user: AuthenticatedUser): GuideSummaryDto[] {
    return this.service.list(user.role);
  }

  /**
   * Иллюстрации открыты без входа: картинку в тексте руководства
   * запрашивает браузер тегом img, а он не передаёт токен. На снимках —
   * демонстрационные данные наполнения, а не сведения из рабочей базы.
   */
  @Public()
  @Get('images/:file')
  @ApiOperation({
    summary: 'Иллюстрация к руководству',
    description: 'PNG-снимок экрана на демонстрационных данных. Доступен без авторизации.',
  })
  @ApiParam({ name: 'file', example: 'interactions-filters.png' })
  @ApiProduces('image/png')
  async image(@Param('file') file: string, @Res() reply: FastifyReply): Promise<void> {
    const content = await this.service.image(file);

    await reply
      .header('Content-Type', 'image/png')
      .header('Content-Length', String(content.length))
      .header('Cache-Control', 'public, max-age=86400')
      .header('X-Content-Type-Options', 'nosniff')
      .send(content);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Раздел документации' })
  @ApiParam({ name: 'slug', example: 'user' })
  @ApiOkResponse({ type: GuideDto })
  get(@Param('slug') slug: string, @CurrentUser() user: AuthenticatedUser): GuideDto {
    return this.service.get(slug, user.role);
  }
}
