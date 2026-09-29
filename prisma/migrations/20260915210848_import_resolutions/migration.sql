-- DropIndex
DROP INDEX "person_full_name_trgm_idx";

-- DropIndex
DROP INDEX "university_name_trgm_idx";

-- DropIndex
DROP INDEX "university_normalized_name_trgm_idx";

-- AlterTable
ALTER TABLE "import_job" ADD COLUMN     "resolutions" JSONB;
