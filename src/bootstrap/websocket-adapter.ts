import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { Server, ServerOptions } from 'socket.io';

/**
 * Адаптер канала обновлений с настраиваемым списком источников.
 *
 * Зачем понадобился. Параметры `@WebSocketGateway` задаются статически,
 * поэтому в шлюзе стояло `origin: true` — отражение любого источника.
 * Для HTTP при этом действовал строгий список доменов из CORS_ORIGINS,
 * и политика различалась в зависимости от протокола, хотя данные ходят
 * одни и те же. Адаптер получает список из конфигурации и приводит
 * оба канала к единому правилу.
 */
export class ConfiguredIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly allowedOrigins: string[],
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    // Приведение необходимо: тип ServerOptions объявляет все поля
    // обязательными, тогда как фактически принимается их частичный набор —
    // Nest передаёт сюда лишь то, что задано в декораторе шлюза.
    const merged = {
      ...options,
      cors: {
        origin: this.allowedOrigins,
        credentials: true,
      },
    } as ServerOptions;

    return super.createIOServer(port, merged) as Server;
  }
}
