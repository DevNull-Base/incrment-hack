-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'MANAGER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ScopeDimension" AS ENUM ('UNIVERSITY', 'IT_DIRECTION', 'SOFTWARE_PRODUCT', 'REGION');

-- CreateEnum
CREATE TYPE "LicenseTransferStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'TRANSFERRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AttachableEntity" AS ENUM ('ENGAGEMENT', 'WORKFLOW_TRANSITION', 'UNIVERSITY', 'CONTRACT', 'IMPORT_JOB');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'SKIPPED', 'ERROR');

-- CreateEnum
CREATE TYPE "ImportTarget" AS ENUM ('UNIVERSITY_CATALOG', 'ENGAGEMENT', 'LICENSE');

-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('PENDING', 'PARSING', 'DRY_RUN_READY', 'APPLYING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReportFormat" AS ENUM ('XLSX', 'XLS', 'PDF', 'CSV', 'JSON');

-- CreateEnum
CREATE TYPE "ReportJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IntegrationSourceType" AS ENUM ('LMS', 'WEBSITE');

-- CreateEnum
CREATE TYPE "SyncRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL');

-- CreateTable
CREATE TABLE "app_user" (
    "id" UUID NOT NULL,
    "keycloak_sub" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "manager_id" UUID,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_scope_rule" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "dimension" "ScopeDimension" NOT NULL,
    "allowed_ids" UUID[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_scope_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "university" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "short_name" TEXT,
    "normalized_name" TEXT NOT NULL,
    "inn" VARCHAR(12),
    "region" TEXT,
    "city" TEXT,
    "website" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "external_id" TEXT,
    "external_source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "university_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "software_product" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "vendor_id" UUID NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "software_product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "it_direction" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "it_direction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "it_program" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "direction_id" UUID NOT NULL,
    "product_id" UUID,
    "hours_total" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "external_id" TEXT,
    "external_source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "it_program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person" (
    "id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "position" TEXT,
    "app_user_id" UUID,
    "retention_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "university_contact" (
    "id" UUID NOT NULL,
    "university_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "role" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "university_contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "university_id" UUID NOT NULL,
    "signed_at" DATE,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "license" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "signed_at" DATE,
    "valid_years" INTEGER,
    "valid_until" DATE,
    "transfer_status" "LicenseTransferStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "license_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engagement" (
    "id" UUID NOT NULL,
    "university_id" UUID NOT NULL,
    "direction_id" UUID NOT NULL,
    "product_id" UUID,
    "program_id" UUID,
    "owner_id" UUID NOT NULL,
    "title" TEXT,
    "current_state_key" TEXT NOT NULL,
    "current_state_label" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engagement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_template" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "definition" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_instance" (
    "id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "current_state_key" TEXT NOT NULL,
    "entered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sla_due_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_instance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_transition" (
    "id" BIGSERIAL NOT NULL,
    "instance_id" UUID NOT NULL,
    "from_state_key" TEXT,
    "to_state_key" TEXT NOT NULL,
    "from_state_label" TEXT,
    "to_state_label" TEXT NOT NULL,
    "actor_id" UUID NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_transition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment" (
    "id" BIGSERIAL NOT NULL,
    "entity_type" "AttachableEntity" NOT NULL,
    "entity_id" TEXT NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachment" (
    "id" UUID NOT NULL,
    "entity_type" "AttachableEntity" NOT NULL,
    "entity_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "scan_status" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "scan_detail" TEXT,
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_mapping_profile" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "target" "ImportTarget" NOT NULL,
    "mapping" JSONB NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_mapping_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_job" (
    "id" UUID NOT NULL,
    "target" "ImportTarget" NOT NULL,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'PENDING',
    "file_name" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_sha256" TEXT NOT NULL,
    "profile_id" UUID,
    "applied_mapping" JSONB,
    "stats" JSONB,
    "error_report_key" TEXT,
    "created_by_id" UUID NOT NULL,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_row_error" (
    "id" BIGSERIAL NOT NULL,
    "job_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "column_name" TEXT,
    "error_code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "raw_row" JSONB,

    CONSTRAINT "import_row_error_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_definition" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "columns" TEXT[],
    "filters" JSONB NOT NULL,
    "owner_id" UUID NOT NULL,
    "is_shared" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_job" (
    "id" UUID NOT NULL,
    "status" "ReportJobStatus" NOT NULL DEFAULT 'QUEUED',
    "format" "ReportFormat" NOT NULL,
    "definition_id" UUID,
    "params_snapshot" JSONB NOT NULL,
    "params_hash" TEXT NOT NULL,
    "row_count" INTEGER,
    "result_key" TEXT,
    "result_size" BIGINT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "error_detail" TEXT,
    "requested_by_id" UUID NOT NULL,
    "queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "report_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_source" (
    "id" UUID NOT NULL,
    "type" "IntegrationSourceType" NOT NULL,
    "name" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sync_cursor" TEXT,
    "cron_schedule" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_sync_run" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "status" "SyncRunStatus" NOT NULL DEFAULT 'RUNNING',
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "error_detail" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "integration_sync_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_staging_record" (
    "id" BIGSERIAL NOT NULL,
    "source_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "entity_kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "validation_error" TEXT,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_staging_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_workspace_state" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "scope_key" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_workspace_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_draft" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_recent_item" (
    "id" BIGSERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "visited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_recent_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_key" (
    "key" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status_code" INTEGER,
    "response" JSONB,
    "in_flight" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_key_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_id" UUID,
    "actor_email" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "trace_id" TEXT,
    "before_state" JSONB,
    "after_state" JSONB,
    "prev_hash" TEXT,
    "hash" TEXT NOT NULL,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_event" (
    "id" BIGSERIAL NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "outbox_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" BIGSERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "read_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_user_keycloak_sub_key" ON "app_user"("keycloak_sub");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE INDEX "app_user_role_is_active_idx" ON "app_user"("role", "is_active");

-- CreateIndex
CREATE INDEX "app_user_manager_id_idx" ON "app_user"("manager_id");

-- CreateIndex
CREATE INDEX "data_scope_rule_user_id_idx" ON "data_scope_rule"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "data_scope_rule_user_id_dimension_key" ON "data_scope_rule"("user_id", "dimension");

-- CreateIndex
CREATE INDEX "university_normalized_name_idx" ON "university"("normalized_name");

-- CreateIndex
CREATE INDEX "university_is_active_idx" ON "university"("is_active");

-- CreateIndex
CREATE INDEX "university_region_idx" ON "university"("region");

-- CreateIndex
CREATE UNIQUE INDEX "university_external_source_external_id_key" ON "university"("external_source", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_name_key" ON "vendor"("name");

-- CreateIndex
CREATE INDEX "software_product_is_active_idx" ON "software_product"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "software_product_vendor_id_name_key" ON "software_product"("vendor_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "it_direction_name_key" ON "it_direction"("name");

-- CreateIndex
CREATE UNIQUE INDEX "it_direction_code_key" ON "it_direction"("code");

-- CreateIndex
CREATE INDEX "it_program_is_active_idx" ON "it_program"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "it_program_direction_id_name_key" ON "it_program"("direction_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "it_program_external_source_external_id_key" ON "it_program"("external_source", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "person_app_user_id_key" ON "person"("app_user_id");

-- CreateIndex
CREATE INDEX "person_full_name_idx" ON "person"("full_name");

-- CreateIndex
CREATE INDEX "person_retention_until_idx" ON "person"("retention_until");

-- CreateIndex
CREATE INDEX "university_contact_university_id_idx" ON "university_contact"("university_id");

-- CreateIndex
CREATE UNIQUE INDEX "university_contact_university_id_person_id_key" ON "university_contact"("university_id", "person_id");

-- CreateIndex
CREATE INDEX "contract_signed_at_idx" ON "contract"("signed_at");

-- CreateIndex
CREATE UNIQUE INDEX "contract_university_id_number_key" ON "contract"("university_id", "number");

-- CreateIndex
CREATE INDEX "license_contract_id_idx" ON "license"("contract_id");

-- CreateIndex
CREATE INDEX "license_product_id_idx" ON "license"("product_id");

-- CreateIndex
CREATE INDEX "license_valid_until_idx" ON "license"("valid_until");

-- CreateIndex
CREATE INDEX "license_transfer_status_idx" ON "license"("transfer_status");

-- CreateIndex
CREATE INDEX "engagement_owner_id_is_archived_idx" ON "engagement"("owner_id", "is_archived");

-- CreateIndex
CREATE INDEX "engagement_university_id_direction_id_idx" ON "engagement"("university_id", "direction_id");

-- CreateIndex
CREATE INDEX "engagement_current_state_key_idx" ON "engagement"("current_state_key");

-- CreateIndex
CREATE INDEX "engagement_created_at_idx" ON "engagement"("created_at");

-- CreateIndex
CREATE INDEX "engagement_updated_at_idx" ON "engagement"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "engagement_university_id_direction_id_product_id_key" ON "engagement"("university_id", "direction_id", "product_id");

-- CreateIndex
CREATE INDEX "workflow_template_is_active_is_default_idx" ON "workflow_template"("is_active", "is_default");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_template_key_version_key" ON "workflow_template"("key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_instance_engagement_id_key" ON "workflow_instance"("engagement_id");

-- CreateIndex
CREATE INDEX "workflow_instance_template_id_idx" ON "workflow_instance"("template_id");

-- CreateIndex
CREATE INDEX "workflow_instance_current_state_key_idx" ON "workflow_instance"("current_state_key");

-- CreateIndex
CREATE INDEX "workflow_instance_sla_due_at_idx" ON "workflow_instance"("sla_due_at");

-- CreateIndex
CREATE INDEX "workflow_transition_instance_id_created_at_idx" ON "workflow_transition"("instance_id", "created_at");

-- CreateIndex
CREATE INDEX "workflow_transition_created_at_idx" ON "workflow_transition"("created_at");

-- CreateIndex
CREATE INDEX "workflow_transition_actor_id_idx" ON "workflow_transition"("actor_id");

-- CreateIndex
CREATE INDEX "comment_entity_type_entity_id_created_at_idx" ON "comment"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "comment_author_id_idx" ON "comment"("author_id");

-- CreateIndex
CREATE INDEX "attachment_entity_type_entity_id_idx" ON "attachment"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "attachment_sha256_idx" ON "attachment"("sha256");

-- CreateIndex
CREATE INDEX "attachment_scan_status_idx" ON "attachment"("scan_status");

-- CreateIndex
CREATE UNIQUE INDEX "import_mapping_profile_name_key" ON "import_mapping_profile"("name");

-- CreateIndex
CREATE INDEX "import_job_status_created_at_idx" ON "import_job"("status", "created_at");

-- CreateIndex
CREATE INDEX "import_job_created_by_id_idx" ON "import_job"("created_by_id");

-- CreateIndex
CREATE INDEX "import_job_file_sha256_idx" ON "import_job"("file_sha256");

-- CreateIndex
CREATE INDEX "import_row_error_job_id_row_number_idx" ON "import_row_error"("job_id", "row_number");

-- CreateIndex
CREATE INDEX "report_definition_is_shared_idx" ON "report_definition"("is_shared");

-- CreateIndex
CREATE UNIQUE INDEX "report_definition_owner_id_name_key" ON "report_definition"("owner_id", "name");

-- CreateIndex
CREATE INDEX "report_job_requested_by_id_queued_at_idx" ON "report_job"("requested_by_id", "queued_at");

-- CreateIndex
CREATE INDEX "report_job_status_idx" ON "report_job"("status");

-- CreateIndex
CREATE INDEX "report_job_params_hash_idx" ON "report_job"("params_hash");

-- CreateIndex
CREATE INDEX "report_job_expires_at_idx" ON "report_job"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_source_name_key" ON "integration_source"("name");

-- CreateIndex
CREATE INDEX "integration_sync_run_source_id_started_at_idx" ON "integration_sync_run"("source_id", "started_at");

-- CreateIndex
CREATE INDEX "integration_staging_record_processed_at_idx" ON "integration_staging_record"("processed_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_staging_record_source_id_entity_kind_external_i_key" ON "integration_staging_record"("source_id", "entity_kind", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_workspace_state_user_id_scope_key_key" ON "user_workspace_state"("user_id", "scope_key");

-- CreateIndex
CREATE INDEX "user_draft_user_id_updated_at_idx" ON "user_draft"("user_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_draft_user_id_entity_type_entity_id_key" ON "user_draft"("user_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "user_recent_item_user_id_visited_at_idx" ON "user_recent_item"("user_id", "visited_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_recent_item_user_id_entity_type_entity_id_key" ON "user_recent_item"("user_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "idempotency_key_expires_at_idx" ON "idempotency_key"("expires_at");

-- CreateIndex
CREATE INDEX "idempotency_key_user_id_idx" ON "idempotency_key"("user_id");

-- CreateIndex
CREATE INDEX "audit_log_occurred_at_idx" ON "audit_log"("occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_actor_id_occurred_at_idx" ON "audit_log"("actor_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_action_idx" ON "audit_log"("action");

-- CreateIndex
CREATE INDEX "outbox_event_published_at_created_at_idx" ON "outbox_event"("published_at", "created_at");

-- CreateIndex
CREATE INDEX "notification_user_id_read_at_created_at_idx" ON "notification"("user_id", "read_at", "created_at");

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_scope_rule" ADD CONSTRAINT "data_scope_rule_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "software_product" ADD CONSTRAINT "software_product_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "it_program" ADD CONSTRAINT "it_program_direction_id_fkey" FOREIGN KEY ("direction_id") REFERENCES "it_direction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "it_program" ADD CONSTRAINT "it_program_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "software_product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "university_contact" ADD CONSTRAINT "university_contact_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "university"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "university_contact" ADD CONSTRAINT "university_contact_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract" ADD CONSTRAINT "contract_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "university"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license" ADD CONSTRAINT "license_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license" ADD CONSTRAINT "license_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "software_product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement" ADD CONSTRAINT "engagement_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "university"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement" ADD CONSTRAINT "engagement_direction_id_fkey" FOREIGN KEY ("direction_id") REFERENCES "it_direction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement" ADD CONSTRAINT "engagement_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "software_product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement" ADD CONSTRAINT "engagement_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "it_program"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement" ADD CONSTRAINT "engagement_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_instance" ADD CONSTRAINT "workflow_instance_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_instance" ADD CONSTRAINT "workflow_instance_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "workflow_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transition" ADD CONSTRAINT "workflow_transition_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "workflow_instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transition" ADD CONSTRAINT "workflow_transition_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment" ADD CONSTRAINT "comment_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "import_mapping_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_row_error" ADD CONSTRAINT "import_row_error_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "import_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_definition" ADD CONSTRAINT "report_definition_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_job" ADD CONSTRAINT "report_job_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "report_definition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_job" ADD CONSTRAINT "report_job_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_sync_run" ADD CONSTRAINT "integration_sync_run_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "integration_source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_staging_record" ADD CONSTRAINT "integration_staging_record_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "integration_source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_workspace_state" ADD CONSTRAINT "user_workspace_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_draft" ADD CONSTRAINT "user_draft_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_recent_item" ADD CONSTRAINT "user_recent_item_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
