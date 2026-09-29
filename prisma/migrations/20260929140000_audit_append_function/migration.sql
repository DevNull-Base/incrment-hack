-- Запись в журнал аудита одним обращением к базе.
--
-- Журнал — хэш-цепочка: каждая запись содержит хэш предыдущей, поэтому
-- вставки идут строго по очереди под единой консультативной блокировкой.
-- Прежде блокировка удерживалась на время нескольких обращений приложения
-- к базе (взять блокировку, прочитать предыдущий хэш, вставить, завершить
-- транзакцию), и под нагрузкой каждое из них ждало очереди событий Node:
-- журнал пропускал около 40 записей в секунду на всю систему, а переход
-- по этапу при 300 сессиях занимал 2,2 с (docs/load-testing.md).
--
-- Функция выполняет всё то же внутри базы: блокировка держится время одной
-- вставки. Хэш считается так же, как в приложении (AuditService):
--   sha256(prev_hash || '|' || канонический JSON), в шестнадцатеричном виде.
-- Канонический JSON собирает приложение и передаёт готовой строкой, поэтому
-- проверка целостности (verifyChain) остаётся прежней и сверяет хэши,
-- посчитанные здесь.
--
-- Функция VOLATILE: в режиме READ COMMITTED каждый оператор внутри неё
-- берёт свежий снимок данных, и чтение предыдущей записи после получения
-- блокировки видит всё, что успели зафиксировать предыдущие вставки.
CREATE OR REPLACE FUNCTION audit_append(
  p_occurred_at   timestamptz,
  p_actor_id      uuid,
  p_actor_email   text,
  p_action        text,
  p_entity_type   text,
  p_entity_id     text,
  p_ip_address    text,
  p_user_agent    text,
  p_trace_id      text,
  p_before_state  jsonb,
  p_after_state   jsonb,
  p_canonical     text
) RETURNS bigint
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  v_prev text;
  v_id   bigint;
BEGIN
  -- Тот же идентификатор, что у прежней блокировки (AUDIT_CHAIN_LOCK_ID):
  -- на время выкладки старые и новые экземпляры пишут в одну цепочку.
  PERFORM pg_advisory_xact_lock(774101);

  SELECT hash INTO v_prev FROM audit_log ORDER BY id DESC LIMIT 1;

  INSERT INTO audit_log (
    occurred_at, actor_id, actor_email, action, entity_type, entity_id,
    ip_address, user_agent, trace_id, before_state, after_state, prev_hash, hash
  ) VALUES (
    p_occurred_at AT TIME ZONE 'UTC', p_actor_id, p_actor_email, p_action, p_entity_type, p_entity_id,
    p_ip_address, p_user_agent, p_trace_id, p_before_state, p_after_state, v_prev,
    encode(sha256(convert_to(coalesce(v_prev, '') || '|' || p_canonical, 'UTF8')), 'hex')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
