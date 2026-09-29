-- ============================================================================
--  Архив заявок
--
--  Признак is_archived существовал, но отправить заявку в архив было нечем:
--  фильтры по архиву работали впустую. Появляется операция архивации,
--  и у заявки фиксируется, когда, кем и почему она отправлена в архив.
--  События ленты: «отправлена в архив» и «возвращена из архива».
-- ============================================================================

-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'ENGAGEMENT_ARCHIVED';
ALTER TYPE "ActivityType" ADD VALUE 'ENGAGEMENT_RESTORED';

-- AlterTable
ALTER TABLE "engagement" ADD COLUMN     "archive_reason" TEXT,
ADD COLUMN     "archived_at" TIMESTAMP(3),
ADD COLUMN     "archived_by_id" UUID;

-- AddForeignKey
ALTER TABLE "engagement" ADD CONSTRAINT "engagement_archived_by_id_fkey" FOREIGN KEY ("archived_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Заявки, помеченные архивными до появления операции (прямой правкой базы),
-- получают дату архивации по последнему изменению — иначе карточка
-- показывала бы архивную заявку без даты.
UPDATE engagement SET archived_at = updated_at WHERE is_archived = true AND archived_at IS NULL;
