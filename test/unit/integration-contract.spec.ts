import { describe, expect, it } from 'vitest';
import {
  ENGAGEMENT_PAYLOAD_EXAMPLE,
  INBOUND_EVENT_EXAMPLE,
  engagementPayloadSchema,
  inboundEventSchema,
} from '../../src/modules/integration/contracts/engagement-contract.js';

/**
 * Контракт обмена с LMS и сайтом.
 *
 * Контракт опубликован маршрутом /integration/contracts и является
 * обязательством перед внешней стороной. Отсюда две проверки: пример,
 * который отдаётся вместе со схемой, обязан ей соответствовать — иначе
 * стыковка начнётся с расхождения, — а входящие события должны отвергаться
 * при неполном составе полей, а не приводить к заявке без контрагента.
 */

describe('контракт engagement.v1', () => {
  it('опубликованный пример соответствует схеме', () => {
    expect(engagementPayloadSchema.safeParse(ENGAGEMENT_PAYLOAD_EXAMPLE).success).toBe(true);
  });

  it('требует ключи связи с записями CRM', () => {
    const withoutKeys: Record<string, unknown> = { ...ENGAGEMENT_PAYLOAD_EXAMPLE };
    delete withoutKeys.keys;

    // Без ключей связи внешняя система не сможет адресовать ответ обратно,
    // и обмен перестанет быть двусторонним.
    expect(engagementPayloadSchema.safeParse(withoutKeys).success).toBe(false);
  });

  it('допускает заявку без вуза — сегмент прямых продаж', () => {
    const b2c = {
      ...ENGAGEMENT_PAYLOAD_EXAMPLE,
      segment: 'B2C' as const,
      counterparty: { type: 'PERSON' as const, name: 'Петров Пётр Петрович' },
      university: null,
      keys: { ...ENGAGEMENT_PAYLOAD_EXAMPLE.keys, universityId: null },
    };

    expect(engagementPayloadSchema.safeParse(b2c).success).toBe(true);
  });

  it('отвергает сообщение чужой версии контракта', () => {
    const foreign = { ...ENGAGEMENT_PAYLOAD_EXAMPLE, contract: 'engagement.v2' };

    expect(engagementPayloadSchema.safeParse(foreign).success).toBe(false);
  });
});

describe('контракт inbound.v1', () => {
  it('опубликованный пример соответствует схеме', () => {
    expect(inboundEventSchema.safeParse(INBOUND_EVENT_EXAMPLE).success).toBe(true);
  });

  it('требует идентификатор события во внешней системе', () => {
    const withoutId: Record<string, unknown> = { ...INBOUND_EVENT_EXAMPLE };
    delete withoutId.externalId;

    // externalId обеспечивает идемпотентность: без него повторная доставка
    // того же события завела бы вторую заявку на того же человека.
    expect(inboundEventSchema.safeParse(withoutId).success).toBe(false);
  });

  it('не принимает вуз как контрагента прямой продажи', () => {
    const wrong = {
      ...INBOUND_EVENT_EXAMPLE,
      counterparty: { type: 'UNIVERSITY', name: 'МГТУ им. Н. Э. Баумана' },
    };

    expect(inboundEventSchema.safeParse(wrong).success).toBe(false);
  });

  it('требует направление обучения', () => {
    const withoutDirection: Record<string, unknown> = { ...INBOUND_EVENT_EXAMPLE };
    delete withoutDirection.directionCode;

    expect(inboundEventSchema.safeParse(withoutDirection).success).toBe(false);
  });
});
