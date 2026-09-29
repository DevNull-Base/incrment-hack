import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway.js';

/**
 * Канал обновлений реального времени.
 *
 * Шлюз подписывается на внутренние доменные события через EventEmitter
 * и транслирует их подключённым клиентам. Прикладные модули при этом
 * не знают о существовании WebSocket — они лишь публикуют события,
 * что оставляет их пригодными для работы в процессе worker, где
 * никакого канала нет.
 */
@Module({
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
