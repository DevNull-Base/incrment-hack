-- ============================================================================
--  Каталог курсов, учебные потоки, встречи и заметки по вузу
--
--  Интерфейс держал эти данные на своей стороне, потому что в API их не было:
--  карточка программы в каталоге курсов, учебные потоки (по ним ТЗ
--  ранжирует программы — число обучающихся и параллельных потоков),
--  встречи с представителями вуза и заметки по вузу целиком.
--  Процесс получает сайт-источник: процессы sz-rt и edu-rt отличаются
--  внутри своего сегмента.
-- ============================================================================
-- CreateEnum
CREATE TYPE "EducationProject" AS ENUM ('RTK_SCHOOL', 'EDU_RT', 'SZ_RT', 'EDUPRO');

-- CreateEnum
CREATE TYPE "ProgramAudience" AS ENUM ('INDIVIDUALS', 'SPECIALISTS', 'STATE_PROJECT');

-- CreateEnum
CREATE TYPE "StreamStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED', 'PAUSED');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'MEETING_SCHEDULED';
ALTER TYPE "ActivityType" ADD VALUE 'MEETING_UPDATED';

-- AlterTable
ALTER TABLE "it_program" ADD COLUMN     "audience" TEXT,
ADD COLUMN     "audience_category" "ProgramAudience" NOT NULL DEFAULT 'SPECIALISTS',
ADD COLUMN     "description" TEXT,
ADD COLUMN     "requirements" TEXT,
ADD COLUMN     "source" "EducationProject" NOT NULL DEFAULT 'RTK_SCHOOL';

-- AlterTable
ALTER TABLE "workflow_template" ADD COLUMN     "site_source" "EducationProject";

-- CreateTable
CREATE TABLE "university_note" (
    "id" UUID NOT NULL,
    "university_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "edited_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "university_note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_stream" (
    "id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "university_id" UUID,
    "name" TEXT,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "students_count" INTEGER NOT NULL DEFAULT 0,
    "status" "StreamStatus" NOT NULL DEFAULT 'PLANNED',
    "external_id" TEXT,
    "external_source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learning_stream_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engagement_meeting" (
    "id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "duration_minutes" INTEGER,
    "location" TEXT,
    "agenda" TEXT,
    "protocol" TEXT,
    "status" "MeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "attendee_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "contact_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engagement_meeting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "university_note_university_id_deleted_at_created_at_idx" ON "university_note"("university_id", "deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "learning_stream_program_id_status_idx" ON "learning_stream"("program_id", "status");

-- CreateIndex
CREATE INDEX "learning_stream_university_id_idx" ON "learning_stream"("university_id");

-- CreateIndex
CREATE INDEX "learning_stream_start_date_idx" ON "learning_stream"("start_date");

-- CreateIndex
CREATE UNIQUE INDEX "learning_stream_external_source_external_id_key" ON "learning_stream"("external_source", "external_id");

-- CreateIndex
CREATE INDEX "engagement_meeting_engagement_id_scheduled_at_idx" ON "engagement_meeting"("engagement_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "engagement_meeting_scheduled_at_idx" ON "engagement_meeting"("scheduled_at");

-- CreateIndex
CREATE INDEX "it_program_source_idx" ON "it_program"("source");

-- AddForeignKey
ALTER TABLE "university_note" ADD CONSTRAINT "university_note_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "university"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "university_note" ADD CONSTRAINT "university_note_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_stream" ADD CONSTRAINT "learning_stream_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "it_program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_stream" ADD CONSTRAINT "learning_stream_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "university"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_meeting" ADD CONSTRAINT "engagement_meeting_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_meeting" ADD CONSTRAINT "engagement_meeting_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Инварианты, которые не выражаются схемой Prisma.
ALTER TABLE "learning_stream" ADD CONSTRAINT "learning_stream_students_non_negative"
  CHECK (students_count >= 0);

ALTER TABLE "learning_stream" ADD CONSTRAINT "learning_stream_period_ordered"
  CHECK (end_date IS NULL OR end_date >= start_date);

ALTER TABLE "engagement_meeting" ADD CONSTRAINT "engagement_meeting_duration_positive"
  CHECK (duration_minutes IS NULL OR duration_minutes > 0);
