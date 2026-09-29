-- Удаляет данные, созданные проверками импорта.
--
-- Порядок обязателен: на вуз ссылаются договоры, лицензии и контакты,
-- поэтому прямое удаление вуза падает на внешнем ключе. Каскад в схеме
-- намеренно не задан — он позволил бы случайно снести историю вместе
-- с одной строкой каталога.
BEGIN;

CREATE TEMP TABLE tmp_target ON COMMIT DROP AS
SELECT id FROM university
WHERE name LIKE 'Мурманский арктический университет%'
   OR name LIKE 'Псковский государственный университет%'
   OR name = 'МГТУ им. Баумана'
   OR name LIKE 'Тестовый университет%'
   OR name LIKE 'Проверочный%'
   OR name LIKE 'Вуз загрузки%';

DELETE FROM license
WHERE contract_id IN (SELECT id FROM contract WHERE university_id IN (SELECT id FROM tmp_target));

DELETE FROM contract WHERE university_id IN (SELECT id FROM tmp_target);

DELETE FROM person
WHERE id IN (SELECT person_id FROM university_contact WHERE university_id IN (SELECT id FROM tmp_target));

DELETE FROM university_contact WHERE university_id IN (SELECT id FROM tmp_target);

DELETE FROM workflow_transition
WHERE instance_id IN (
  SELECT wi.id FROM workflow_instance wi
  JOIN engagement e ON e.id = wi.engagement_id
  WHERE e.university_id IN (SELECT id FROM tmp_target)
);

DELETE FROM workflow_instance
WHERE engagement_id IN (SELECT id FROM engagement WHERE university_id IN (SELECT id FROM tmp_target));

DELETE FROM engagement WHERE university_id IN (SELECT id FROM tmp_target);

DELETE FROM university WHERE id IN (SELECT id FROM tmp_target);

TRUNCATE import_row_error, import_job CASCADE;

COMMIT;
