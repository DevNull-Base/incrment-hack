import { z } from 'zod';

/**
 * Контракт обмена заявками между CRM, LMS и сайтом.
 *
 * Контракт внешних систем заказчиком не передан — обе системы находятся
 * в переработке. Поэтому контракт задан здесь, со стороны CRM: он описывает,
 * что CRM отдаёт наружу и что готова принять, и служит предметом стыковки,
 * когда внешняя сторона будет готова.
 *
 * Состав полей взят из технического задания (статус, ответственный, вуз,
 * программа, продукт) и дополнен ключами связи: без них внешняя система
 * не сможет сопоставить событие с записями CRM и с файлами в объектном
 * хранилище, о чём отдельно просили на сессии вопросов и ответов.
 */

/** Ключи связи: по ним внешняя система адресует записи обратно в CRM. */
export const engagementKeysSchema = z.object({
  engagementId: z.string().uuid(),
  workflowInstanceId: z.string().uuid().nullable(),
  universityId: z.string().uuid().nullable(),
  directionId: z.string().uuid(),
  productId: z.string().uuid().nullable(),
  programId: z.string().uuid().nullable(),
  ownerId: z.string().uuid(),
});

/**
 * Вложение заявки. Отдаются ключ объекта и хэш, а не ссылка на скачивание:
 * ссылка живёт минуты, а ключ и хэш позволяют забрать файл в любой момент
 * и убедиться, что он не изменился.
 */
export const engagementAttachmentSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string(),
  bucket: z.string(),
  objectKey: z.string(),
});

export const engagementPayloadSchema = z.object({
  /** Версия контракта. Меняется при несовместимых изменениях состава полей. */
  contract: z.literal('engagement.v1'),
  /** Событие, породившее сообщение. */
  event: z.enum(['engagement.created', 'engagement.state_changed', 'engagement.snapshot']),
  occurredAt: z.string(),

  segment: z.enum(['B2B', 'B2C']),
  counterparty: z.object({
    type: z.enum(['UNIVERSITY', 'PERSON', 'COMPANY']),
    name: z.string(),
  }),

  university: z
    .object({ id: z.string().uuid(), name: z.string(), region: z.string().nullable() })
    .nullable(),
  direction: z.object({ id: z.string().uuid(), name: z.string() }),
  product: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  program: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),

  status: z.object({
    key: z.string(),
    label: z.string(),
    enteredAt: z.string().nullable(),
    slaDueAt: z.string().nullable(),
    isFinal: z.boolean(),
  }),
  previousStatus: z.object({ key: z.string(), label: z.string() }).nullable(),

  owner: z.object({ id: z.string().uuid(), displayName: z.string(), email: z.string() }),

  keys: engagementKeysSchema,
  attachments: z.array(engagementAttachmentSchema),
});

export type EngagementPayload = z.infer<typeof engagementPayloadSchema>;

/**
 * Входящее событие внешней системы.
 *
 * Принимается и от LMS (запись на обучение, завершение программы), и от
 * сайта (заявка с формы). Обе системы описываются одной схемой намеренно:
 * различие между ними — в источнике, а не в составе данных.
 */
export const inboundEventSchema = z.object({
  contract: z.literal('inbound.v1'),
  event: z.enum(['request.created', 'enrollment.created', 'enrollment.completed']),
  externalId: z.string().min(1).max(200),
  occurredAt: z.string().optional(),

  /** Кто обратился: физическое лицо либо организация. */
  counterparty: z.object({
    type: z.enum(['PERSON', 'COMPANY']),
    name: z.string().min(1).max(300),
    email: z.string().email().optional(),
  }),

  /**
   * Идентификатор обращения во внешней системе.
   *
   * Отличается от externalId: тот опознаёт само событие и обеспечивает
   * идемпотентность доставки, а этот — обращение целиком. По нему запись
   * на обучение и её завершение сходятся в одну заявку CRM вместо двух.
   * Если внешняя система такого идентификатора не присылает, заявка ищется
   * по почте контрагента и направлению.
   */
  caseId: z.string().min(1).max(200).optional(),

  /** Что заинтересовало: направление и, если известна, программа. */
  directionCode: z.string().min(1).max(64),
  programExternalId: z.string().max(200).optional(),
  productExternalId: z.string().max(200).optional(),

  comment: z.string().max(2000).optional(),
});

export type InboundEvent = z.infer<typeof inboundEventSchema>;

/**
 * Пример сообщения — отдаётся вместе со схемой.
 *
 * Пример важнее схемы при стыковке: он показывает форматы дат и то, как
 * заполняются поля, которых у сегмента может не быть.
 */
export const ENGAGEMENT_PAYLOAD_EXAMPLE: EngagementPayload = {
  contract: 'engagement.v1',
  event: 'engagement.state_changed',
  occurredAt: '2026-09-16T09:15:00.000Z',
  segment: 'B2B',
  counterparty: { type: 'UNIVERSITY', name: 'МГТУ им. Н. Э. Баумана' },
  university: {
    id: '6f1c2f7a-0f5c-4a1e-9f3d-2b4c5d6e7f80',
    name: 'МГТУ им. Н. Э. Баумана',
    region: 'Москва',
  },
  direction: { id: 'c9b1a2d3-4e5f-4a6b-8c7d-9e0f1a2b3c4d', name: 'DevOps' },
  product: { id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', name: 'Базис' },
  program: { id: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e', name: 'DevOps-инженер' },
  status: {
    key: 'SIGNING',
    label: 'Подписание документов',
    enteredAt: '2026-09-16T09:15:00.000Z',
    slaDueAt: '2026-09-30T09:15:00.000Z',
    isFinal: false,
  },
  previousStatus: { key: 'DOCUMENTS_EXCHANGE', label: 'Обмен документами' },
  owner: {
    id: 'd4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f70',
    displayName: 'Иванова Мария',
    email: 'm.ivanova@example.ru',
  },
  keys: {
    engagementId: 'e5f6a7b8-c9d0-4e1f-9a2b-3c4d5e6f7081',
    workflowInstanceId: 'f6a7b8c9-d0e1-4f2a-9b3c-4d5e6f708192',
    universityId: '6f1c2f7a-0f5c-4a1e-9f3d-2b4c5d6e7f80',
    directionId: 'c9b1a2d3-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    productId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    programId: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
    ownerId: 'd4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f70',
  },
  attachments: [
    {
      id: 'a7b8c9d0-e1f2-4a3b-8c4d-5e6f70819203',
      fileName: 'Договор.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 284_133,
      sha256: '3b1f...e90a',
      bucket: 'crm-attachments',
      objectKey: 'engagement/e5f6a7b8/договор.pdf',
    },
  ],
};

export const INBOUND_EVENT_EXAMPLE: InboundEvent = {
  contract: 'inbound.v1',
  event: 'request.created',
  externalId: 'site-form-20260916-0042',
  caseId: 'site-case-4417',
  occurredAt: '2026-09-16T08:00:00.000Z',
  counterparty: { type: 'PERSON', name: 'Петров Пётр Петрович', email: 'p.petrov@example.ru' },
  directionCode: 'DEVOPS',
  comment: 'Заявка с формы обратной связи на сайте ИТ Школы',
};
