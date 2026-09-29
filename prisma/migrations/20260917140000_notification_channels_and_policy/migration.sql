-- ============================================================================
--  Уведомления: каналы доставки, правила и защита от повторов
--
--  Требование родилось на сессии вопросов и ответов, в техническом задании
--  его нет. Уведомления нужны как средство контроля: заявка, застрявшая
--  в одном статусе, должна сама напомнить о себе ответственному и его
--  руководителю, а срок простоя задаётся эксплуатацией, а не кодом.
--
--  Каналы добавляются к перечню, а не заменяют его: Telegram и MAX названы
--  заказчиком, почта оставлена как возможность подключения. Настройки
--  хранятся в базе — администратор задаёт их в интерфейсе, не трогая
--  развёртывание.
--
--  Строки настроек каналов здесь НЕ создаются: PostgreSQL запрещает
--  использовать только что добавленное значение перечисления в той же
--  транзакции. Их заводит приложение при первом обращении.
-- ============================================================================

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationChannel" ADD VALUE 'TELEGRAM';
ALTER TYPE "NotificationChannel" ADD VALUE 'MAX';

-- AlterTable
ALTER TABLE "notification" ADD COLUMN     "dedupe_key" TEXT,
ADD COLUMN     "delivery_error" TEXT;

-- CreateTable
CREATE TABLE "notification_channel_config" (
    "channel" "NotificationChannel" NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_channel_config_pkey" PRIMARY KEY ("channel")
);

-- CreateTable
CREATE TABLE "notification_policy" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "escalation_days" INTEGER NOT NULL DEFAULT 14,
    "notify_owner_on_transition" BOOLEAN NOT NULL DEFAULT true,
    "notify_manager_on_escalation" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_policy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_dedupe_key_key" ON "notification"("dedupe_key");

-- Правила по умолчанию. Строка одна: правила общие для системы, и её
-- наличие избавляет прикладной код от ветки «настроек ещё нет».
INSERT INTO "notification_policy" ("id", "escalation_days", "notify_owner_on_transition", "notify_manager_on_escalation", "updated_at")
VALUES (1, 14, true, true, now())
ON CONFLICT ("id") DO NOTHING;
