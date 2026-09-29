-- ============================================================================
--  Расширения PostgreSQL и индексы, которые Prisma не выражает в схеме.
--
--  Назначение:
--    1. pg_trgm  — нечёткое сравнение названий вузов при импорте XLS.
--                  «МГТУ им. Баумана» и полное наименование должны
--                  распознаваться как один и тот же вуз.
--    2. unaccent — нормализация диакритики в поиске.
--    3. GIN/трграм-индексы — быстрый поиск по подстроке без full scan.
--    4. Частичные индексы — сокращают размер индекса и ускоряют
--       самые частые выборки (активные, неархивные записи).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- --------------------------------------------------------------------------
--  Поиск и дедупликация вузов
-- --------------------------------------------------------------------------

-- Триграммный индекс для similarity() и оператора % — основа сопоставления
-- названий вузов при импорте и при поиске в интерфейсе.
CREATE INDEX IF NOT EXISTS university_normalized_name_trgm_idx
  ON university USING gin (normalized_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS university_name_trgm_idx
  ON university USING gin (name gin_trgm_ops);

-- Полнотекстовый поиск по названию вуза (русская конфигурация).
CREATE INDEX IF NOT EXISTS university_fts_idx
  ON university USING gin (to_tsvector('russian', coalesce(name, '') || ' ' || coalesce(short_name, '')));

-- Поиск персон по ФИО — используется при назначении ответственных.
CREATE INDEX IF NOT EXISTS person_full_name_trgm_idx
  ON person USING gin (full_name gin_trgm_ops);

-- --------------------------------------------------------------------------
--  Частичные индексы под горячие выборки
-- --------------------------------------------------------------------------

-- Рабочий список КАМа: свои активные взаимодействия, отсортированные по дате.
-- Частичный индекс не хранит архивные записи и потому заметно компактнее.
CREATE INDEX IF NOT EXISTS engagement_owner_active_idx
  ON engagement (owner_id, updated_at DESC)
  WHERE is_archived = false;

-- Срез для отчётов: вуз + направление + статус в пределах периода.
CREATE INDEX IF NOT EXISTS engagement_report_idx
  ON engagement (university_id, direction_id, current_state_key, created_at)
  WHERE is_archived = false;

-- Поиск «застрявших» процессов по SLA — только незавершённые экземпляры.
CREATE INDEX IF NOT EXISTS workflow_instance_sla_pending_idx
  ON workflow_instance (sla_due_at)
  WHERE completed_at IS NULL AND sla_due_at IS NOT NULL;

-- Лицензии, истекающие в заданном периоде.
CREATE INDEX IF NOT EXISTS license_expiring_idx
  ON license (valid_until)
  WHERE valid_until IS NOT NULL;

-- Непрочитанные уведомления пользователя.
CREATE INDEX IF NOT EXISTS notification_unread_idx
  ON notification (user_id, created_at DESC)
  WHERE read_at IS NULL;

-- Очередь публикации доменных событий (Outbox): нужны только неопубликованные.
CREATE INDEX IF NOT EXISTS outbox_pending_idx
  ON outbox_event (created_at)
  WHERE published_at IS NULL;

-- Активные ключи идемпотентности — для быстрой очистки по TTL.
CREATE INDEX IF NOT EXISTS idempotency_inflight_idx
  ON idempotency_key (created_at)
  WHERE in_flight = true;

-- --------------------------------------------------------------------------
--  Защита целостности журнала аудита
-- --------------------------------------------------------------------------

-- Содержимое журналов неизменяемо (требование группы мер РСБ): запрещаем
-- UPDATE на уровне БД, чтобы даже ошибка в коде приложения не переписала
-- уже зафиксированную историю.
--
-- DELETE намеренно НЕ блокируется:
--   • у workflow_transition внешний ключ с ON DELETE CASCADE — блокировка
--     сделала бы невозможным удаление взаимодействия целиком;
--   • для audit_log удаление требуется политикой сроков хранения.
-- Удаление при этом не остаётся незамеченным: записи связаны хэш-цепочкой
-- (prev_hash → hash), и изъятие любого звена обнаруживается при проверке
-- целостности журнала.
CREATE OR REPLACE FUNCTION journal_reject_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Таблица % доступна только для добавления записей: UPDATE запрещён', TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION journal_reject_update();

DROP TRIGGER IF EXISTS workflow_transition_no_update ON workflow_transition;
CREATE TRIGGER workflow_transition_no_update
  BEFORE UPDATE ON workflow_transition
  FOR EACH ROW EXECUTE FUNCTION journal_reject_update();
