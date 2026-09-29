import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from '@prometheus-io/client';
import { AppConfig } from '../../config/configuration.js';

/**
 * Метрики Prometheus.
 *
 * Набор подобран под проверку нефункциональных требований ТЗ:
 *   • http_request_duration_seconds → p95 времени отклика (НФТ «≤ 1 с»);
 *   • nodejs_eventloop_lag_seconds  → главный индикатор того, что тяжёлая
 *     работа выполняется в API-процессе и блокирует обслуживание запросов;
 *   • report_jobs_*                 → пропускная способность отчётов (НФТ 7);
 *   • queue_depth                   → накопление невыполненных задач.
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  readonly registry = new Registry();

  /** Длительность HTTP-запросов. Бакеты сгущены вокруг границы в 1 секунду. */
  readonly httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Длительность обработки HTTP-запроса',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 5, 10],
    registers: [this.registry],
  });

  /** Счётчик запросов с разбивкой по кодам ошибок системы. */
  readonly errorsTotal = new Counter({
    name: 'app_errors_total',
    help: 'Количество ошибок по кодам реестра',
    labelNames: ['code', 'status'] as const,
    registers: [this.registry],
  });

  /** Длительность формирования отчётов по формату и способу исполнения. */
  readonly reportDuration = new Histogram({
    name: 'report_generation_seconds',
    help: 'Время формирования отчёта',
    labelNames: ['format', 'mode'] as const,
    buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
    registers: [this.registry],
  });

  readonly reportRows = new Histogram({
    name: 'report_rows',
    help: 'Количество строк в сформированном отчёте',
    buckets: [10, 100, 500, 1000, 5000, 10_000, 50_000, 100_000, 500_000],
    registers: [this.registry],
  });

  /** Отчёты, обслуженные из кэша благодаря дедупликации одинаковых запросов. */
  readonly reportCacheHits = new Counter({
    name: 'report_cache_hits_total',
    help: 'Число отчётов, отданных из кэша без повторного расчёта',
    registers: [this.registry],
  });

  /** Глубина очередей BullMQ — заполняется периодическим опросом. */
  readonly queueDepth = new Gauge({
    name: 'queue_depth',
    help: 'Количество задач в очереди по состояниям',
    labelNames: ['queue', 'state'] as const,
    registers: [this.registry],
  });

  /** Длительность обращений к внешним системам (LMS, сайт, LLM). */
  readonly externalCallDuration = new Histogram({
    name: 'external_call_duration_seconds',
    help: 'Время обращения к внешней системе',
    labelNames: ['target', 'outcome'] as const,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
    registers: [this.registry],
  });

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  onModuleInit(): void {
    // Стандартные метрики Node.js, включая nodejs_eventloop_lag_seconds.
    collectDefaultMetrics({
      register: this.registry,
      labels: { role: this.config.get('APP_ROLE', { infer: true }) },
    });
  }

  metrics(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
