import { Controller, Get, Inject, VERSION_NEUTRAL } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorResult,
  HealthIndicatorService,
  MemoryHealthIndicator,
} from '@nestjs/terminus';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Redis } from 'ioredis';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { SkipRateLimit } from '../access/rate-limit.decorator.js';

/**
 * VERSION_NEUTRAL обязателен: иначе к маршрутам применится URI-версионирование
 * и пробы окажутся по адресу /v1/health/live. Оркестратор и балансировщик
 * ожидают стабильный путь, не зависящий от версии прикладного API.
 */
@ApiTags('Служебные')
@SkipRateLimit()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    private readonly memory: MemoryHealthIndicator,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Liveness-проба: процесс жив и способен отвечать.
   *
   * Намеренно не проверяет внешние зависимости — иначе кратковременная
   * недоступность БД привела бы к перезапуску исправных контейнеров
   * и превратила частичный сбой в полный.
   */
  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Liveness-проба (процесс жив)' })
  live(): { status: string; uptime: number } {
    return { status: 'ok', uptime: Math.round(process.uptime()) };
  }

  /**
   * Readiness-проба: готовность принимать трафик.
   *
   * Разделение на down и degraded принципиально:
   *   • PostgreSQL недоступен → down: без БД отвечать нечем, инстанс
   *     выводится из балансировки;
   *   • Redis недоступен → degraded: кэш и очереди не работают, но чтение
   *     данных продолжается. Помечать это как down нельзя — иначе при
   *     падении единственного Redis из ротации разом выйдут ВСЕ инстансы,
   *     и частичная деградация превратится в полный отказ сервиса.
   */
  @Public()
  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness-проба (готовность обслуживать запросы)' })
  ready() {
    return this.health.check([
      () =>
        this.indicator
          .check('postgres')
          .attempt(async () => {
            await this.prisma.ping();
          })
          .withTimeout(2_000),

      () => this.checkRedis(),
    ]);
  }

  /** Полная диагностика — используется администратором и мониторингом. */
  @Public()
  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Полная диагностика подсистем' })
  full() {
    return this.health.check([
      () =>
        this.indicator
          .check('postgres')
          .attempt(async () => {
            const startedAt = Date.now();
            await this.prisma.ping();
            return { latencyMs: Date.now() - startedAt };
          })
          .withTimeout(3_000),

      () => this.checkRedis(),

      // Утечка памяти в воркере проявляется ростом heap — фиксируем порог.
      () => this.memory.checkHeap('memory_heap', 512 * 1024 * 1024),
    ]);
  }

  /** Redis при недоступности помечается degraded, а не down (см. комментарий к ready). */
  private async checkRedis(): Promise<HealthIndicatorResult> {
    const session = this.indicator.check('redis');
    try {
      const startedAt = Date.now();
      await this.redis.ping();
      return session.up({ latencyMs: Date.now() - startedAt });
    } catch (error) {
      return session.degraded({
        message: 'Redis недоступен: кэш и очереди отключены, чтение данных работает',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
