-- ============================================================================
--  Сегменты взаимодействия: работа с вузами (B2B) и прямые продажи (B2C)
--
--  До сих пор модель была вузоцентричной: заявка без вуза существовать
--  не могла. Прямая работа с обучающимися и сторонними организациями идёт
--  по другому маршруту и с другим контрагентом, поэтому:
--   • заявка получает сегмент, по которому выбирается шаблон процесса;
--   • вуз становится необязательным, а для B2C заполняются реквизиты
--     контрагента — физического либо юридического лица;
--   • шаблон процесса тоже получает сегмент: маршрут для вузов и маршрут
--     для прямых продаж не пересекаются.
--
--  Существующие заявки остаются B2B: умолчание сегмента и тип контрагента
--  UNIVERSITY подобраны так, чтобы данные не требовали доработки вручную.
-- ============================================================================

-- CreateEnum
CREATE TYPE "EngagementSegment" AS ENUM ('B2B', 'B2C');

-- CreateEnum
CREATE TYPE "CounterpartyType" AS ENUM ('UNIVERSITY', 'PERSON', 'COMPANY');

-- AlterTable
ALTER TABLE "engagement" ADD COLUMN     "counterparty_contact_id" UUID,
ADD COLUMN     "counterparty_name" TEXT,
ADD COLUMN     "counterparty_type" "CounterpartyType" NOT NULL DEFAULT 'UNIVERSITY',
ADD COLUMN     "segment" "EngagementSegment" NOT NULL DEFAULT 'B2B';

-- AlterTable
ALTER TABLE "workflow_template" ADD COLUMN     "segment" "EngagementSegment" NOT NULL DEFAULT 'B2B';

-- CreateIndex
CREATE INDEX "engagement_segment_is_archived_idx" ON "engagement"("segment", "is_archived");

-- AddForeignKey
ALTER TABLE "engagement" ADD CONSTRAINT "engagement_counterparty_contact_id_fkey" FOREIGN KEY ("counterparty_contact_id") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
--  Ограничения, не выразимые схемой Prisma
-- ============================================================================

-- Порядок важен: сначала колонка становится необязательной, и только затем
-- добавляется ограничение, описывающее, когда пустое значение допустимо.
ALTER TABLE "engagement" ALTER COLUMN "university_id" DROP NOT NULL;

-- Заявка без контрагента не имеет смысла, и проверять это только в сервисе
-- недостаточно: строки приходят ещё из импорта и синхронизации с внешними
-- системами. B2B требует вуза, B2C — наименования контрагента.
ALTER TABLE "engagement" ADD CONSTRAINT "engagement_counterparty_present" CHECK (
  ("segment" = 'B2B' AND "university_id" IS NOT NULL)
  OR ("segment" = 'B2C' AND "counterparty_name" IS NOT NULL)
);

-- Процесс в сегменте един для всех: активный шаблон по умолчанию может быть
-- только один. Частичный уникальный индекс закрывает гонку, при которой две
-- одновременные публикации оставили бы систему с двумя «основными» схемами
-- и заявками, разошедшимися по разным маршрутам.
CREATE UNIQUE INDEX "workflow_template_default_per_segment"
  ON "workflow_template" ("segment")
  WHERE "is_active" AND "is_default";
