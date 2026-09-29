-- Поиск по заявкам — подстрокой без учёта регистра (ILIKE '%…%') по вузу,
-- наименованию контрагента и заголовку. Обычный индекс такой поиск не
-- ускоряет, и на 50 000 заявок каждый запрос перебирал таблицу целиком.
-- Триграммные индексы (pg_trgm подключён в 20260915165959) дают базе
-- собрать ответ из индексов: вуз ищется по university.name и short_name,
-- заявки — по university_id, counterparty_name и title.
CREATE INDEX "engagement_counterparty_name_trgm_idx"
  ON "engagement" USING gin ("counterparty_name" gin_trgm_ops);

CREATE INDEX "engagement_title_trgm_idx"
  ON "engagement" USING gin ("title" gin_trgm_ops);

CREATE INDEX "university_short_name_trgm_idx"
  ON "university" USING gin ("short_name" gin_trgm_ops);
