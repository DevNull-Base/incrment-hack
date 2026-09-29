import { Controller, Get, Header, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../decorators/public.decorator.js';
import { SkipRateLimit } from '../../modules/access/rate-limit.decorator.js';
import { MetricsService } from './metrics.service.js';

/**
 * Эндпоинт для сбора метрик Prometheus.
 * Исключён из Swagger: это служебный интерфейс мониторинга, а не часть
 * контракта API для фронтенда.
 *
 * ВАЖНО при развёртывании: порт должен быть доступен только из внутренней
 * сети мониторинга. Метрики раскрывают структуру маршрутов и профиль нагрузки.
 */
@ApiExcludeController()
@SkipRateLimit()
@Controller({ path: 'metrics', version: VERSION_NEUTRAL })
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Public()
  @Get()
  @Header('Cache-Control', 'no-store')
  async scrape(): Promise<string> {
    return this.metrics.metrics();
  }
}
