import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration.js';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationController } from './notification.controller.js';
import { NotificationListener } from './notification.listener.js';
import { NotificationService } from './notification.service.js';
import { EscalationService } from './escalation.service.js';
import { NotificationChannelTransport } from './channels/notification-channel.js';
import {
  EmailNotificationChannel,
  InAppNotificationChannel,
} from './channels/basic-channels.js';
import { BotNotificationChannel } from './channels/bot-channels.js';

/** Маркер набора каналов доставки. */
export const NOTIFICATION_TRANSPORTS = Symbol('NOTIFICATION_TRANSPORTS');

/**
 * Уведомления.
 *
 * Планировщик напоминаний здесь не регистрируется: он подключается только
 * в процессе worker (см. worker.module.ts), иначе каждая реплика API
 * рассылала бы одни и те же напоминания.
 */
@Module({
  controllers: [NotificationController],
  providers: [
    {
      // Набор каналов собирается фабрикой, а не отдельными провайдерами:
      // служба отправки работает с ними единообразно и о составе не знает,
      // поэтому добавление канала не требует правок в ней.
      provide: NOTIFICATION_TRANSPORTS,
      inject: [PinoLogger, ConfigService],
      useFactory: (
        logger: PinoLogger,
        config: ConfigService<AppConfig, true>,
      ): NotificationChannelTransport[] => [
        new InAppNotificationChannel(),
        new EmailNotificationChannel(logger),
        new BotNotificationChannel('TELEGRAM', config.get('NOTIFY_TELEGRAM_API_URL', { infer: true }), logger),
        // Бот-интерфейс MAX повторяет телеграмный, поэтому используется тот же
        // транспорт с другим адресом. Адрес задаётся развёртыванием.
        new BotNotificationChannel('MAX', config.get('NOTIFY_MAX_API_URL', { infer: true }), logger),
      ],
    },
    {
      provide: NotificationService,
      inject: [PrismaService, AuditService, EventEmitter2, PinoLogger, NOTIFICATION_TRANSPORTS],
      useFactory: (
        prisma: PrismaService,
        audit: AuditService,
        events: EventEmitter2,
        logger: PinoLogger,
        transports: NotificationChannelTransport[],
      ) => new NotificationService(prisma, audit, events, logger, transports),
    },
    NotificationListener,
    EscalationService,
  ],
  exports: [NotificationService, EscalationService],
})
export class NotificationModule {}
