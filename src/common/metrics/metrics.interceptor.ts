import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service.js';

/**
 * Снимает длительность обработки каждого HTTP-запроса.
 *
 * Метка `route` берётся из шаблона маршрута (`/engagements/:id`), а не из
 * фактического URL. Иначе каждый идентификатор создавал бы отдельную
 * временную серию, и количество метрик росло бы вместе с объёмом данных —
 * классический способ «положить» Prometheus кардинальностью.
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<{ method?: string; routerPath?: string; routeOptions?: { url?: string }; url?: string }>();
    const response = http.getResponse<{ statusCode?: number }>();

    const startedAt = process.hrtime.bigint();

    const finish = () => {
      const elapsedSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;

      // Fastify предоставляет шаблон маршрута; при его отсутствии
      // используем 'unknown', но НИКОГДА — сырой URL.
      const route = request.routeOptions?.url ?? request.routerPath ?? 'unknown';

      this.metrics.httpDuration.observe(
        {
          method: request.method ?? 'UNKNOWN',
          route,
          status: String(response.statusCode ?? 0),
        },
        elapsedSeconds,
      );
    };

    return next.handle().pipe(
      tap({
        next: finish,
        // Ошибочные ответы тоже должны попадать в гистограмму: без них
        // картина задержек искажается в оптимистичную сторону.
        error: finish,
      }),
    );
  }
}
