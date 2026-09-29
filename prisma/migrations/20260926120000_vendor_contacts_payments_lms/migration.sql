-- ============================================================================
--  Контакты вендоров, оплаты с сайта и выгрузка слушателей в LMS
--
--  Заказчик передал три образца: каталог вендоров с контактными лицами,
--  оплаты прямых продаж с сайта и шаблон загрузки слушателей в LMS.
--  Здесь — место для каждого из них в модели:
--
--   • контактное лицо вендора со способами связи («Почта, Чат в ТГ»);
--   • у заявки прямой продажи — поток обучения, отметка об оплате
--     и отметка о передаче слушателя в LMS;
--   • события ленты «оплата подтверждена» и «передано в LMS».
-- ============================================================================

-- CreateEnum
CREATE TYPE "ContactChannel" AS ENUM ('EMAIL', 'PHONE', 'TELEGRAM', 'MAX');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityType" ADD VALUE 'PAYMENT_CONFIRMED';
ALTER TYPE "ActivityType" ADD VALUE 'LMS_EXPORTED';

-- AlterTable
ALTER TABLE "engagement" ADD COLUMN     "lms_exported_at" TIMESTAMP(3),
ADD COLUMN     "payment_confirmed_at" TIMESTAMP(3),
ADD COLUMN     "payment_reference" TEXT,
ADD COLUMN     "study_stream" TEXT;

-- CreateTable
CREATE TABLE "vendor_contact" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "channels" "ContactChannel"[] DEFAULT ARRAY[]::"ContactChannel"[],
    "products" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_contact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendor_contact_vendor_id_idx" ON "vendor_contact"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_contact_vendor_id_person_id_key" ON "vendor_contact"("vendor_id", "person_id");

-- CreateIndex
CREATE INDEX "person_email_idx" ON "person"("email");

-- CreateIndex
CREATE INDEX "person_phone_idx" ON "person"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "engagement_payment_reference_key" ON "engagement"("payment_reference");

-- CreateIndex
CREATE INDEX "engagement_segment_payment_confirmed_at_idx" ON "engagement"("segment", "payment_confirmed_at");

-- AddForeignKey
ALTER TABLE "vendor_contact" ADD CONSTRAINT "vendor_contact_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_contact" ADD CONSTRAINT "vendor_contact_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- --------------------------------------------------------------------------
--  Телефоны в едином виде
-- --------------------------------------------------------------------------

-- Новые записи получают телефон в виде +7XXXXXXXXXX: по нему один и тот же
-- человек опознаётся в оплатах с сайта, в списках слушателей и в каталоге
-- вендоров. Уже сохранённые номера приводятся к тому же виду, иначе
-- сопоставление с ними не сработало бы. Номер, который не удаётся
-- однозначно привести (неверная длина), остаётся как есть.
UPDATE person
SET phone = '+7' || right(digits, 10)
FROM (
  SELECT id AS person_id, regexp_replace(phone, '[^0-9]', '', 'g') AS digits
  FROM person
  WHERE phone IS NOT NULL
) AS normalized
WHERE person.id = normalized.person_id
  AND (
    (length(normalized.digits) = 11 AND left(normalized.digits, 1) IN ('7', '8'))
    OR (length(normalized.digits) = 10 AND left(normalized.digits, 1) = '9')
  );

