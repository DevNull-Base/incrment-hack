-- ============================================================================
--  Заметки, заинтересованность, лента действий и календарь задач
--
--  Четыре доработки по обратной связи команды фронтенда, сверенные с ТЗ:
--
--   • заметки к заявке и к этапу — ТЗ прямо называет «добавление комментария
--     в статус» отдельной операцией, а комментарий до сих пор можно было
--     оставить только в момент перехода;
--   • вложения помечаются этапом — «прикладывание файлов в статусы» из ТЗ,
--     и заодно условие «из этапа нельзя выйти без документа» начинает
--     проверяться по файлам этого этапа, а не по любому файлу заявки;
--   • заинтересованность контрагента — ручная оценка, которую заказчик
--     на сессии назвал допустимой заменой формулы ранжирования;
--   • лента действий и календарь задач — рабочие инструменты менеджера.
-- ============================================================================

-- CreateEnum
CREATE TYPE "InterestLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('ENGAGEMENT_CREATED', 'ENGAGEMENT_UPDATED', 'STATE_CHANGED', 'INTEREST_CHANGED', 'OWNER_CHANGED', 'NOTE_ADDED', 'NOTE_UPDATED', 'NOTE_DELETED', 'ATTACHMENT_ADDED', 'ATTACHMENT_DELETED', 'TASK_CREATED', 'TASK_UPDATED', 'TASK_COMPLETED', 'TASK_REOPENED', 'TASK_DELETED');

-- CreateEnum
CREATE TYPE "ActivitySource" AS ENUM ('USER', 'INTEGRATION', 'WORKFLOW');

-- AlterTable
ALTER TABLE "engagement" ADD COLUMN     "interest_comment" TEXT,
ADD COLUMN     "interest_level" "InterestLevel",
ADD COLUMN     "interest_updated_at" TIMESTAMP(3),
ADD COLUMN     "interest_updated_by_id" UUID;

-- AlterTable
ALTER TABLE "attachment" ADD COLUMN     "state_key" TEXT,
ADD COLUMN     "state_label" TEXT;

-- CreateTable
CREATE TABLE "engagement_note" (
    "id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "state_key" TEXT,
    "state_label" TEXT,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "edited_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "engagement_note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_event" (
    "id" BIGSERIAL NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "ActivityType" NOT NULL,
    "source" "ActivitySource" NOT NULL DEFAULT 'USER',
    "actor_id" UUID,
    "engagement_id" UUID,
    "state_key" TEXT,
    "state_label" TEXT,
    "note_id" UUID,
    "attachment_id" UUID,
    "task_id" UUID,
    "transition_id" BIGINT,
    "details" JSONB,

    CONSTRAINT "activity_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planner_task" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "created_by_id" UUID,
    "engagement_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "due_date" DATE NOT NULL,
    "due_at" TIMESTAMP(3),
    "remind_at" TIMESTAMP(3),
    "reminder_sent_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "planner_task_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "engagement_note_engagement_id_deleted_at_created_at_idx" ON "engagement_note"("engagement_id", "deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "engagement_note_engagement_id_state_key_idx" ON "engagement_note"("engagement_id", "state_key");

-- CreateIndex
CREATE INDEX "engagement_note_author_id_created_at_idx" ON "engagement_note"("author_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "activity_event_transition_id_key" ON "activity_event"("transition_id");

-- CreateIndex
CREATE INDEX "activity_event_actor_id_occurred_at_idx" ON "activity_event"("actor_id", "occurred_at");

-- CreateIndex
CREATE INDEX "activity_event_engagement_id_occurred_at_idx" ON "activity_event"("engagement_id", "occurred_at");

-- CreateIndex
CREATE INDEX "activity_event_task_id_idx" ON "activity_event"("task_id");

-- CreateIndex
CREATE INDEX "planner_task_owner_id_due_date_idx" ON "planner_task"("owner_id", "due_date");

-- CreateIndex
CREATE INDEX "planner_task_created_by_id_idx" ON "planner_task"("created_by_id");

-- CreateIndex
CREATE INDEX "planner_task_engagement_id_idx" ON "planner_task"("engagement_id");

-- CreateIndex
CREATE INDEX "engagement_interest_level_idx" ON "engagement"("interest_level");

-- CreateIndex
CREATE INDEX "attachment_entity_type_entity_id_state_key_idx" ON "attachment"("entity_type", "entity_id", "state_key");

-- AddForeignKey
ALTER TABLE "engagement" ADD CONSTRAINT "engagement_interest_updated_by_id_fkey" FOREIGN KEY ("interest_updated_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_note" ADD CONSTRAINT "engagement_note_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_note" ADD CONSTRAINT "engagement_note_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_event" ADD CONSTRAINT "activity_event_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_event" ADD CONSTRAINT "activity_event_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planner_task" ADD CONSTRAINT "planner_task_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planner_task" ADD CONSTRAINT "planner_task_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planner_task" ADD CONSTRAINT "planner_task_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "engagement"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- --------------------------------------------------------------------------
--  Лента действий только дополняется
-- --------------------------------------------------------------------------

-- Тот же приём, что для журнала переходов и журнала аудита: история не
-- переписывается даже ошибкой прикладного кода. DELETE разрешён — удаление
-- заявки уносит её историю каскадом.
DROP TRIGGER IF EXISTS activity_event_no_update ON activity_event;
CREATE TRIGGER activity_event_no_update
  BEFORE UPDATE ON activity_event
  FOR EACH ROW EXECUTE FUNCTION journal_reject_update();

-- --------------------------------------------------------------------------
--  Напоминания календаря
-- --------------------------------------------------------------------------

-- Планировщик раз в минуту ищет напоминания, срок которых наступил. Нужны
-- ему только неотправленные по живым задачам — их единицы, а не вся таблица.
CREATE INDEX IF NOT EXISTS planner_task_reminder_due_idx
  ON planner_task (remind_at)
  WHERE remind_at IS NOT NULL
    AND reminder_sent_at IS NULL
    AND completed_at IS NULL
    AND deleted_at IS NULL;

-- --------------------------------------------------------------------------
--  Этап у файлов, приложенных до этой миграции
-- --------------------------------------------------------------------------

-- Этап восстанавливается по журналу переходов: файл относится к статусу,
-- в котором заявка стояла в момент загрузки, — к цели последнего перехода,
-- совершённого не позже неё.
UPDATE attachment AS a
SET state_key = s.state_key,
    state_label = s.state_label
FROM (
  SELECT DISTINCT ON (a2.id)
    a2.id,
    t.to_state_key AS state_key,
    t.to_state_label AS state_label
  FROM attachment a2
  JOIN workflow_instance wi ON wi.engagement_id::text = a2.entity_id
  JOIN workflow_transition t ON t.instance_id = wi.id AND t.created_at <= a2.created_at
  WHERE a2.entity_type = 'ENGAGEMENT'
  ORDER BY a2.id, t.created_at DESC, t.id DESC
) AS s
WHERE a.id = s.id;

-- Файлы, приложенные до первого перехода, относятся к начальному статусу:
-- он записан исходным статусом первого перехода, а у заявки без переходов
-- совпадает с текущим.
UPDATE attachment AS a
SET state_key = coalesce(first_move.from_state_key, e.current_state_key),
    state_label = coalesce(first_move.from_state_label, e.current_state_label)
FROM engagement e
LEFT JOIN LATERAL (
  SELECT t.from_state_key, t.from_state_label
  FROM workflow_instance wi
  JOIN workflow_transition t ON t.instance_id = wi.id
  WHERE wi.engagement_id = e.id
  ORDER BY t.created_at ASC, t.id ASC
  LIMIT 1
) AS first_move ON true
WHERE a.entity_type = 'ENGAGEMENT'
  AND a.entity_id = e.id::text
  AND a.state_key IS NULL;

-- --------------------------------------------------------------------------
--  Перенос накопленной истории в ленту действий
-- --------------------------------------------------------------------------

-- Функция, а не разовый запрос: демонстрационное наполнение создаёт
-- переходы уже после миграций и вызывает её же, чтобы лента на стенде
-- не оказалась пустой. Повторный вызов ничего не дублирует — каждый
-- источник проверяется на уже перенесённые записи.
CREATE OR REPLACE FUNCTION backfill_activity_events()
RETURNS integer AS $$
DECLARE
  total integer := 0;
  step integer;
BEGIN
  -- Переходы по процессу. Происхождение перехода записано в комментарии:
  -- у переноса при смене схемы и у события внешней системы он свой.
  -- Для внешней системы автор не указывается — в журнале переходов на её
  -- месте стоит ответственный, но действие совершал не он.
  INSERT INTO activity_event
    (occurred_at, type, source, actor_id, engagement_id, state_key, state_label, transition_id, details)
  SELECT
    t.created_at,
    'STATE_CHANGED'::"ActivityType",
    CASE
      WHEN t.comment = 'Автоматический перенос: статус удалён при изменении схемы процесса' THEN 'WORKFLOW'
      WHEN t.comment LIKE 'Получено от внешней системы%' THEN 'INTEGRATION'
      ELSE 'USER'
    END::"ActivitySource",
    CASE WHEN t.comment LIKE 'Получено от внешней системы%' THEN NULL ELSE t.actor_id END,
    wi.engagement_id,
    t.to_state_key,
    t.to_state_label,
    t.id,
    jsonb_build_object(
      'fromStateKey', t.from_state_key,
      'fromStateLabel', t.from_state_label,
      'toStateKey', t.to_state_key,
      'toStateLabel', t.to_state_label
    )
  FROM workflow_transition t
  JOIN workflow_instance wi ON wi.id = t.instance_id
  WHERE NOT EXISTS (SELECT 1 FROM activity_event ae WHERE ae.transition_id = t.id);

  GET DIAGNOSTICS step = ROW_COUNT;
  total := total + step;

  -- Вложения заявок, включая удалённые позже: факт загрузки был.
  INSERT INTO activity_event
    (occurred_at, type, source, actor_id, engagement_id, state_key, state_label, attachment_id)
  SELECT
    a.created_at,
    'ATTACHMENT_ADDED'::"ActivityType",
    'USER'::"ActivitySource",
    a.uploaded_by_id,
    e.id,
    a.state_key,
    a.state_label,
    a.id
  FROM attachment a
  JOIN engagement e ON e.id::text = a.entity_id
  WHERE a.entity_type = 'ENGAGEMENT'
    AND NOT EXISTS (
      SELECT 1 FROM activity_event ae
      WHERE ae.attachment_id = a.id AND ae.type = 'ATTACHMENT_ADDED'
    );

  GET DIAGNOSTICS step = ROW_COUNT;
  total := total + step;

  -- Создание заявок. Автор известен только из журнала аудита: сама заявка
  -- хранит ответственного, а не того, кто её завёл.
  INSERT INTO activity_event
    (occurred_at, type, source, actor_id, engagement_id, state_key, state_label)
  SELECT DISTINCT ON (e.id)
    al.occurred_at,
    'ENGAGEMENT_CREATED'::"ActivityType",
    'USER'::"ActivitySource",
    al.actor_id,
    e.id,
    NULL::text,
    NULL::text
  FROM audit_log al
  JOIN engagement e ON e.id::text = al.entity_id
  JOIN app_user u ON u.id = al.actor_id
  WHERE al.action = 'ENGAGEMENT_CREATE'
    AND NOT EXISTS (
      SELECT 1 FROM activity_event ae
      WHERE ae.engagement_id = e.id AND ae.type = 'ENGAGEMENT_CREATED'
    )
  ORDER BY e.id, al.occurred_at;

  GET DIAGNOSTICS step = ROW_COUNT;
  total := total + step;

  RETURN total;
END;
$$ LANGUAGE plpgsql;

SELECT backfill_activity_events();
