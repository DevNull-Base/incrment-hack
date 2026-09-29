import { InboundEvent } from '../contracts/engagement-contract.js';

/**
 * Примеры входящих событий для режима заглушек.
 *
 * Набор подобран так, чтобы проверялись все ветви применения данных:
 * заявка физического лица с сайта, заявка организации, запись на обучение
 * из LMS и завершение обучения. Идентификаторы событий постоянные —
 * благодаря этому повторный запуск синхронизации не создаёт дублей,
 * и идемпотентность видна на глаз.
 */

export const WEBSITE_STUB_EVENTS: InboundEvent[] = [
  {
    contract: 'inbound.v1',
    event: 'request.created',
    externalId: 'site-2026-09-0041',
    occurredAt: '2026-09-14T07:20:00.000Z',
    counterparty: {
      type: 'PERSON',
      name: 'Петров Пётр Петрович',
      email: 'p.petrov@example.ru',
    },
    directionCode: 'DEVOPS',
    comment: 'Заявка с формы на сайте ИТ Школы',
  },
  {
    contract: 'inbound.v1',
    event: 'request.created',
    externalId: 'site-2026-09-0042',
    occurredAt: '2026-09-15T11:05:00.000Z',
    counterparty: {
      type: 'COMPANY',
      name: 'ООО «Северная логистика»',
      email: 'hr@severlog.example.ru',
    },
    directionCode: 'QA',
    comment: 'Корпоративное обучение группы из шести человек',
  },
];

export const LMS_STUB_EVENTS: InboundEvent[] = [
  {
    contract: 'inbound.v1',
    event: 'enrollment.created',
    externalId: 'lms-enroll-77120',
    occurredAt: '2026-09-15T06:00:00.000Z',
    counterparty: {
      type: 'PERSON',
      name: 'Сидорова Анна Владимировна',
      email: 'a.sidorova@example.ru',
    },
    directionCode: 'DATA',
  },
  {
    contract: 'inbound.v1',
    event: 'enrollment.completed',
    externalId: 'lms-enroll-77002',
    occurredAt: '2026-09-16T05:30:00.000Z',
    counterparty: {
      type: 'PERSON',
      name: 'Кузнецов Дмитрий Игоревич',
      email: 'd.kuznetsov@example.ru',
    },
    directionCode: 'DEVOPS',
  },
];
