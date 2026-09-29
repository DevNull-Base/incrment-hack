-- ============================================================================
--  Объём данных для нагрузочного тестирования.
--
--  Демонстрационный сид заводит 87 заявок — на таком объёме любые запросы
--  быстры, отчёты не доходят до очереди, и замер ничего не говорит о работе
--  на годах накопленной истории. Скрипт доводит базу до масштаба, заведомо
--  большего ожидаемого: ~20 КАМов и ~700 вузов по ТЗ дают единицы тысяч
--  заявок, здесь их 50 000 — с запасом на порядок.
--
--  Запускается ПОСЛЕ миграций и сида, только на отдельной базе:
--    docker exec -i crm-postgres psql -U crm -d crm_load -v ON_ERROR_STOP=1 < load/bulk-data.sql
--
--  Данные вымышленные: «Учебное заведение №…», «КАМ 01», «Слушатель 1234».
--  История строится по маршрутам действующих процессов — с теми же
--  подписями этапов, сроками и журналом переходов, что оставляет интерфейс.
-- ============================================================================

\set b2b_per_university 80
\set b2b_total 40000
\set b2c_total 10000
\set extra_universities 465

SELECT setseed(0.2026);

BEGIN;

-- --- Подписи и сроки этапов действующих процессов --------------------------
CREATE TEMP TABLE stage AS
SELECT t.segment, t.id AS template_id, s->>'key' AS key, s->>'label' AS label,
       NULLIF(s->>'slaDays', '')::int AS sla_days
FROM workflow_template t, jsonb_array_elements(t.definition->'states') s
WHERE t.is_active AND t.is_default;

-- Маршруты — те же, что у демонстрационного сида.
CREATE TEMP TABLE route AS
SELECT 'B2B'::text AS segment, key, pos::int FROM unnest(ARRAY[
  'CONTACT_SEARCH', 'COMMUNICATION', 'MEETING', 'DOCUMENTS_EXCHANGE', 'SIGNING',
  'MATERIALS_TRANSFER', 'IMPLEMENTATION', 'TEACHER_TRAINING', 'PROGRAM_UPDATE',
  'CLASSES', 'DOCS_UPDATE', 'QUALIFICATION', 'SUPPORT'
]) WITH ORDINALITY AS r(key, pos)
UNION ALL
SELECT 'B2C', key, pos::int FROM unnest(ARRAY[
  'REQUEST', 'QUALIFICATION', 'OFFER', 'CONTRACT', 'ACCESS_GRANTED', 'LEARNING', 'COMPLETED'
]) WITH ORDINALITY AS r(key, pos);

-- --- Сотрудники: 4 руководителя и 40 КАМов ---------------------------------
INSERT INTO app_user (id, keycloak_sub, email, display_name, role, updated_at)
SELECT gen_random_uuid(), 'load-manager-' || g, 'load.manager.' || g || '@rtk-it-school.ru',
       'Руководитель ' || g, 'MANAGER', now()
FROM generate_series(1, 4) g;

INSERT INTO app_user (id, keycloak_sub, email, display_name, role, manager_id, updated_at)
SELECT gen_random_uuid(), 'load-kam-' || g, 'load.kam.' || g || '@rtk-it-school.ru',
       'КАМ ' || lpad(g::text, 2, '0'), 'USER',
       (SELECT id FROM app_user WHERE email = 'load.manager.' || (1 + (g - 1) % 4) || '@rtk-it-school.ru'),
       now()
FROM generate_series(1, 40) g;

CREATE TEMP TABLE owner_pool AS
SELECT array_agg(id ORDER BY email) AS ids FROM app_user WHERE role IN ('USER', 'MANAGER');

-- --- Вузы: до 500 ------------------------------------------------------------
CREATE TEMP TABLE region_pool AS
SELECT array_agg(DISTINCT region) AS regions FROM university WHERE region IS NOT NULL;

INSERT INTO university (id, name, short_name, normalized_name, region, city, updated_at)
SELECT gen_random_uuid(), 'Учебное заведение №' || g, 'УЗ-' || g, 'учебное заведение №' || g,
       r.regions[1 + floor(random() * array_length(r.regions, 1))::int], NULL, now()
FROM generate_series(1, :extra_universities) g, region_pool r;

-- --- Заявки B2B ----------------------------------------------------------------
-- Сочетание «вуз + направление + продукт» уникально, поэтому берутся
-- свободные сочетания в случайном порядке, не больше заданного на вуз.
CREATE TEMP TABLE gen AS
SELECT gen_random_uuid() AS id, 'B2B'::text AS segment, uni, dir, prod,
       NULL::text AS counterparty,
       o.ids[1 + floor(random() * array_length(o.ids, 1))::int] AS owner,
       (random() < 0.12) AS rejected, random() AS r_depth,
       30 + floor(random() * 700)::int AS age_days
FROM (
  SELECT u.id AS uni, d.id AS dir, p.id AS prod,
         row_number() OVER (PARTITION BY u.id ORDER BY random()) AS rn
  FROM university u
  CROSS JOIN it_direction d
  CROSS JOIN (SELECT id FROM software_product UNION ALL SELECT NULL::uuid) p
  WHERE NOT EXISTS (
    SELECT 1 FROM engagement e
    WHERE e.university_id = u.id AND e.direction_id = d.id AND e.product_id IS NOT DISTINCT FROM p.id
  )
) x, owner_pool o
WHERE rn <= :b2b_per_university
LIMIT :b2b_total;

-- --- Заявки B2C: слушатели и компании --------------------------------------
CREATE TEMP TABLE direction_pool AS SELECT array_agg(id) AS ids FROM it_direction;
INSERT INTO gen
SELECT gen_random_uuid(), 'B2C', NULL,
       dp.ids[1 + floor(random() * array_length(dp.ids, 1))::int],
       NULL,
       CASE WHEN random() < 0.2 THEN 'ООО «Компания ' || g || '»' ELSE 'Слушатель ' || g END,
       o.ids[1 + floor(random() * array_length(o.ids, 1))::int],
       (random() < 0.15), random(), 7 + floor(random() * 500)::int
FROM generate_series(1, :b2c_total) g, owner_pool o, direction_pool dp;

-- Глубина продвижения по маршруту: отказ — на первых шагах.
ALTER TABLE gen ADD COLUMN depth int, ADD COLUMN final_key text;
UPDATE gen SET depth = CASE
  WHEN rejected THEN 1 + floor(r_depth * (CASE segment WHEN 'B2B' THEN 4 ELSE 3 END))::int
  ELSE 1 + floor(r_depth * (CASE segment WHEN 'B2B' THEN 13 ELSE 7 END))::int
END;
UPDATE gen g SET final_key = CASE WHEN rejected THEN 'REJECTED'
  ELSE (SELECT key FROM route r WHERE r.segment = g.segment AND r.pos = g.depth) END;

-- Шаги истории: путь до глубины плюс отказ, если он был.
CREATE TEMP TABLE step AS
SELECT g.id AS engagement_id, g.segment, r.pos AS n, r.key
FROM gen g JOIN route r ON r.segment = g.segment AND r.pos <= g.depth
UNION ALL
SELECT g.id, g.segment, g.depth + 1, 'REJECTED' FROM gen g WHERE g.rejected;

CREATE TEMP TABLE hist AS
SELECT s.engagement_id, s.n, s.key AS to_key,
       lag(s.key) OVER (PARTITION BY s.engagement_id ORDER BY s.n) AS from_key,
       count(*) OVER (PARTITION BY s.engagement_id) AS total
FROM step s;

-- Моменты переходов равномерно распределены по жизни заявки.
ALTER TABLE hist ADD COLUMN at timestamp(3);
CREATE INDEX ON gen (id);
UPDATE hist h SET at = now() - (g.age_days || ' days')::interval
  + ((h.n - 1)::float / h.total) * ((g.age_days - 1) || ' days')::interval
  + random() * interval '8 hours'
FROM gen g WHERE g.id = h.engagement_id;

-- Итоги истории по заявке — одной агрегацией, а не подзапросом на каждую
-- из 50 000 строк (так запрос шёл бы часами).
CREATE INDEX ON hist (engagement_id);
CREATE TEMP TABLE summary AS
SELECT engagement_id, count(*)::int AS steps, max(at) AS last_at FROM hist GROUP BY engagement_id;
CREATE UNIQUE INDEX ON summary (engagement_id);
CREATE TEMP TABLE program_pool AS SELECT array_agg(id) AS ids FROM it_program;

-- --- Запись -----------------------------------------------------------------
INSERT INTO engagement (id, segment, university_id, counterparty_type, counterparty_name,
  direction_id, product_id, program_id, owner_id, current_state_key, current_state_label,
  version, interest_level, created_at, updated_at)
SELECT g.id, g.segment::"EngagementSegment", g.uni,
       CASE WHEN g.segment = 'B2B' THEN 'UNIVERSITY'
            WHEN g.counterparty LIKE 'ООО%' THEN 'COMPANY' ELSE 'PERSON' END::"CounterpartyType",
       g.counterparty, g.dir, g.prod,
       CASE WHEN g.segment = 'B2C' AND random() < 0.7
            THEN pp.ids[1 + floor(random() * array_length(pp.ids, 1))::int] END,
       g.owner, g.final_key, st.label,
       sm.steps,
       CASE WHEN random() < 0.4 THEN (ARRAY['LOW', 'MEDIUM', 'HIGH'])[1 + floor(random() * 3)::int] END::"InterestLevel",
       now() - (g.age_days || ' days')::interval,
       sm.last_at
FROM gen g
JOIN stage st ON st.segment::text = g.segment AND st.key = g.final_key
JOIN summary sm ON sm.engagement_id = g.id
CROSS JOIN program_pool pp;

INSERT INTO workflow_instance (id, engagement_id, template_id, current_state_key, entered_at,
  sla_due_at, completed_at, created_at, updated_at)
SELECT gen_random_uuid(), g.id, st.template_id, g.final_key, sm.last_at,
       CASE WHEN st.sla_days IS NOT NULL AND g.final_key NOT IN ('SUPPORT', 'COMPLETED', 'REJECTED')
            THEN sm.last_at + (st.sla_days || ' days')::interval END,
       CASE WHEN g.final_key IN ('SUPPORT', 'COMPLETED', 'REJECTED') THEN sm.last_at END,
       now() - (g.age_days || ' days')::interval, sm.last_at
FROM gen g
JOIN stage st ON st.segment::text = g.segment AND st.key = g.final_key
JOIN summary sm ON sm.engagement_id = g.id;

INSERT INTO workflow_transition (instance_id, from_state_key, from_state_label, to_state_key,
  to_state_label, actor_id, comment, created_at)
SELECT wi.id, h.from_key, sf.label, h.to_key, stt.label, g.owner,
       CASE WHEN random() < 0.3 THEN 'Этап закрыт по итогам созвона с вузом' END, h.at
FROM hist h
JOIN gen g ON g.id = h.engagement_id
JOIN workflow_instance wi ON wi.engagement_id = g.id
JOIN stage stt ON stt.segment::text = g.segment AND stt.key = h.to_key
LEFT JOIN stage sf ON sf.segment::text = g.segment AND sf.key = h.from_key
WHERE h.from_key IS NOT NULL;

-- Заметки: у половины заявок одна-две.
INSERT INTO engagement_note (id, engagement_id, author_id, body, state_key, state_label, created_at, updated_at)
SELECT gen_random_uuid(), g.id, g.owner,
       (ARRAY['Созвонились, ждём ответа кафедры', 'Нужен повторный пакет документов',
              'Интересуются практикой на реальных стендах', 'Перенесли встречу на следующую неделю'])[1 + floor(random() * 4)::int],
       g.final_key, st.label, now() - (floor(random() * 60) || ' days')::interval, now()
FROM gen g
JOIN stage st ON st.segment::text = g.segment AND st.key = g.final_key
CROSS JOIN generate_series(1, 2) k
WHERE random() < CASE k WHEN 1 THEN 0.5 ELSE 0.15 END;

COMMIT;

-- Лента действий строится из журнала переходов той же функцией, что в миграции.
SELECT backfill_activity_events() AS activity_backfilled;

ANALYZE;

SELECT segment, count(*) AS engagements FROM engagement GROUP BY segment ORDER BY segment;
SELECT count(*) AS transitions FROM workflow_transition;
SELECT count(*) AS universities FROM university;
SELECT count(*) AS notes FROM engagement_note;
SELECT count(*) AS activity_events FROM activity_event;
