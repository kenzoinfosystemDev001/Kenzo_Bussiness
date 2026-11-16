-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "PermissionScope" AS ENUM ('OWN', 'DEPARTMENT', 'COMPANY');

-- CreateEnum
CREATE TYPE "AuthTokenType" AS ENUM ('INVITATION', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "ApprovalPolicyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "ApprovalStageMode" AS ENUM ('ANY', 'ALL');

-- CreateEnum
CREATE TYPE "ApproverType" AS ENUM ('ROLE', 'USER', 'DEPARTMENT_HEAD', 'REQUESTER_MANAGER');

-- CreateEnum
CREATE TYPE "ApprovalInstanceStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalTaskStatus" AS ENUM ('WAITING', 'PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DocumentScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "NumberResetPolicy" AS ENUM ('NEVER', 'FISCAL_YEAR');

-- CreateTable
CREATE TABLE "company" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(32) NOT NULL,
    "legal_name" VARCHAR(200) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "gstin" VARCHAR(15),
    "pan" VARCHAR(10),
    "country" CHAR(2) NOT NULL DEFAULT 'IN',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    "base_currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "fiscal_year_start_month" SMALLINT NOT NULL DEFAULT 4,
    "address_line1" VARCHAR(200),
    "address_line2" VARCHAR(200),
    "city" VARCHAR(100),
    "state" VARCHAR(100),
    "postal_code" VARCHAR(20),
    "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE',
    "enforce_mfa_for_privileged" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "parent_id" UUID,
    "head_user_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_centre" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "department_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "cost_centre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_user" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "full_name" VARCHAR(120) NOT NULL,
    "job_title" VARCHAR(120),
    "password_hash" VARCHAR(255),
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "department_id" UUID,
    "manager_id" UUID,
    "identity_provider" VARCHAR(64),
    "identity_subject" VARCHAR(255),
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mfa_secret_enc" VARCHAR(512),
    "mfa_pending_secret_enc" VARCHAR(512),
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "password_changed_at" TIMESTAMPTZ(6),
    "activated_at" TIMESTAMPTZ(6),
    "deactivated_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "active_company_id" UUID NOT NULL,
    "mfa_pending" BOOLEAN NOT NULL DEFAULT false,
    "mfa_verified_at" TIMESTAMPTZ(6),
    "ip_address" VARCHAR(64),
    "user_agent" VARCHAR(512),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" VARCHAR(100),

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_token" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" "AuthTokenType" NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "auth_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission" (
    "key" VARCHAR(64) NOT NULL,
    "module" VARCHAR(40) NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "requires_mfa" BOOLEAN NOT NULL DEFAULT false,
    "scopable" BOOLEAN NOT NULL DEFAULT false,
    "phase" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permission_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "role" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "key" VARCHAR(32) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(500),
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "role_id" UUID NOT NULL,
    "permission_key" VARCHAR(64) NOT NULL,
    "scope" "PermissionScope" NOT NULL DEFAULT 'COMPANY',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("role_id","permission_key")
);

-- CreateTable
CREATE TABLE "user_role_assignment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "department_id" UUID,
    "valid_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_until" TIMESTAMPTZ(6),
    "granted_by" UUID,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_role_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_policy" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "entity_type" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000),
    "policy_version" INTEGER NOT NULL,
    "status" "ApprovalPolicyStatus" NOT NULL DEFAULT 'DRAFT',
    "require_independent_approval" BOOLEAN NOT NULL DEFAULT true,
    "distinct_approvers_across_stages" BOOLEAN NOT NULL DEFAULT true,
    "allow_delegation" BOOLEAN NOT NULL DEFAULT true,
    "exclude_initiator_from_all_stages" BOOLEAN NOT NULL DEFAULT true,
    "published_at" TIMESTAMPTZ(6),
    "published_by" UUID,
    "retired_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "approval_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_policy_stage" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "policy_id" UUID NOT NULL,
    "sequence" SMALLINT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "mode" "ApprovalStageMode" NOT NULL DEFAULT 'ANY',
    "min_approvals" SMALLINT NOT NULL DEFAULT 1,
    "min_amount" DECIMAL(18,2),
    "max_amount" DECIMAL(18,2),
    "department_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "category_keys" VARCHAR(64)[] DEFAULT ARRAY[]::VARCHAR(64)[],
    "approver_type" "ApproverType" NOT NULL,
    "approver_role_key" VARCHAR(32),
    "approver_user_id" UUID,
    "sla_hours" INTEGER,
    "escalation_role_key" VARCHAR(32),

    CONSTRAINT "approval_policy_stage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_instance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "entity_type" VARCHAR(40) NOT NULL,
    "entity_id" UUID NOT NULL,
    "entity_reference" VARCHAR(64),
    "entity_summary" VARCHAR(300),
    "amount" DECIMAL(18,2),
    "currency_code" CHAR(3),
    "department_id" UUID,
    "category_key" VARCHAR(64),
    "requester_id" UUID NOT NULL,
    "excluded_user_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "status" "ApprovalInstanceStatus" NOT NULL DEFAULT 'PENDING',
    "current_sequence" SMALLINT,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "outcome_reason" VARCHAR(2000),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "approval_instance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_task" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "instance_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "sequence" SMALLINT NOT NULL,
    "assignee_id" UUID NOT NULL,
    "delegated_from_id" UUID,
    "is_escalation" BOOLEAN NOT NULL DEFAULT false,
    "status" "ApprovalTaskStatus" NOT NULL DEFAULT 'WAITING',
    "decided_by" UUID,
    "reason" VARCHAR(2000),
    "activated_at" TIMESTAMPTZ(6),
    "due_at" TIMESTAMPTZ(6),
    "escalated_at" TIMESTAMPTZ(6),
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "approval_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_event" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "instance_id" UUID NOT NULL,
    "task_id" UUID,
    "actor_id" UUID,
    "type" VARCHAR(40) NOT NULL,
    "sequence" SMALLINT,
    "reason" VARCHAR(2000),
    "metadata" JSONB,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_delegation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "delegator_id" UUID NOT NULL,
    "delegate_id" UUID NOT NULL,
    "entity_types" VARCHAR(40)[] DEFAULT ARRAY[]::VARCHAR(40)[],
    "valid_from" TIMESTAMPTZ(6) NOT NULL,
    "valid_until" TIMESTAMPTZ(6) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "approval_delegation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_event" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID,
    "actor_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "entity_id" VARCHAR(64),
    "before_data" JSONB,
    "after_data" JSONB,
    "before_hash" CHAR(64),
    "after_hash" CHAR(64),
    "reason" VARCHAR(2000),
    "outcome" VARCHAR(16) NOT NULL DEFAULT 'SUCCESS',
    "ip_address" VARCHAR(64),
    "user_agent" VARCHAR(512),
    "correlation_id" VARCHAR(64),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "storage_provider" VARCHAR(20) NOT NULL DEFAULT 'local',
    "object_key" VARCHAR(255) NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "scan_status" "DocumentScanStatus" NOT NULL DEFAULT 'PENDING',
    "classification" VARCHAR(20) NOT NULL DEFAULT 'INTERNAL',
    "uploaded_by" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_link" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_id" UUID NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "entity_id" UUID NOT NULL,
    "link_type" VARCHAR(40) NOT NULL DEFAULT 'ATTACHMENT',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "document_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" VARCHAR(2000),
    "entity_type" VARCHAR(64),
    "entity_id" UUID,
    "link" VARCHAR(300),
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_config" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "secret_ref" VARCHAR(200),
    "last_sync_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "integration_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "numbering_series" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "document_type" VARCHAR(40) NOT NULL,
    "period_key" VARCHAR(16) NOT NULL DEFAULT 'ALL',
    "prefix" VARCHAR(10) NOT NULL,
    "pattern" VARCHAR(64) NOT NULL,
    "padding" SMALLINT NOT NULL DEFAULT 6,
    "reset_policy" "NumberResetPolicy" NOT NULL DEFAULT 'FISCAL_YEAR',
    "next_value" BIGINT NOT NULL DEFAULT 1,
    "is_template" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "numbering_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_number" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "document_type" VARCHAR(40) NOT NULL,
    "number" VARCHAR(64) NOT NULL,
    "entity_id" UUID,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_by" UUID,

    CONSTRAINT "generated_number_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_event" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID,
    "event_type" VARCHAR(100) NOT NULL,
    "aggregate_type" VARCHAR(64) NOT NULL,
    "aggregate_id" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" VARCHAR(2000),
    "correlation_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),

    CONSTRAINT "outbox_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_code_key" ON "company"("code");

-- CreateIndex
CREATE INDEX "department_company_id_is_active_idx" ON "department"("company_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "department_company_id_code_key" ON "department"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "department_company_id_id_key" ON "department"("company_id", "id");

-- CreateIndex
CREATE INDEX "cost_centre_company_id_department_id_idx" ON "cost_centre"("company_id", "department_id");

-- CreateIndex
CREATE UNIQUE INDEX "cost_centre_company_id_code_key" ON "cost_centre"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE INDEX "app_user_company_id_status_idx" ON "app_user"("company_id", "status");

-- CreateIndex
CREATE INDEX "app_user_department_id_idx" ON "app_user"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_identity_provider_identity_subject_key" ON "app_user"("identity_provider", "identity_subject");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_hash_key" ON "session"("token_hash");

-- CreateIndex
CREATE INDEX "session_user_id_revoked_at_idx" ON "session"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "session_expires_at_idx" ON "session"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "auth_token_token_hash_key" ON "auth_token"("token_hash");

-- CreateIndex
CREATE INDEX "auth_token_user_id_type_idx" ON "auth_token"("user_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "role_company_id_key_key" ON "role"("company_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "role_company_id_id_key" ON "role"("company_id", "id");

-- CreateIndex
CREATE INDEX "role_permission_permission_key_idx" ON "role_permission"("permission_key");

-- CreateIndex
CREATE INDEX "user_role_assignment_user_id_company_id_revoked_at_idx" ON "user_role_assignment"("user_id", "company_id", "revoked_at");

-- CreateIndex
CREATE INDEX "user_role_assignment_company_id_role_id_idx" ON "user_role_assignment"("company_id", "role_id");

-- CreateIndex
CREATE INDEX "approval_policy_company_id_entity_type_status_idx" ON "approval_policy"("company_id", "entity_type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "approval_policy_company_id_entity_type_policy_version_key" ON "approval_policy"("company_id", "entity_type", "policy_version");

-- CreateIndex
CREATE INDEX "approval_policy_stage_policy_id_sequence_idx" ON "approval_policy_stage"("policy_id", "sequence");

-- CreateIndex
CREATE INDEX "approval_instance_company_id_entity_type_entity_id_idx" ON "approval_instance"("company_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "approval_instance_company_id_status_submitted_at_idx" ON "approval_instance"("company_id", "status", "submitted_at");

-- CreateIndex
CREATE INDEX "approval_instance_requester_id_status_idx" ON "approval_instance"("requester_id", "status");

-- CreateIndex
CREATE INDEX "approval_task_assignee_id_status_idx" ON "approval_task"("assignee_id", "status");

-- CreateIndex
CREATE INDEX "approval_task_instance_id_sequence_idx" ON "approval_task"("instance_id", "sequence");

-- CreateIndex
CREATE INDEX "approval_task_status_due_at_idx" ON "approval_task"("status", "due_at");

-- CreateIndex
CREATE INDEX "approval_event_instance_id_occurred_at_idx" ON "approval_event"("instance_id", "occurred_at");

-- CreateIndex
CREATE INDEX "approval_delegation_company_id_delegator_id_valid_until_idx" ON "approval_delegation"("company_id", "delegator_id", "valid_until");

-- CreateIndex
CREATE INDEX "audit_event_company_id_occurred_at_idx" ON "audit_event"("company_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_event_company_id_entity_type_entity_id_idx" ON "audit_event"("company_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_event_actor_id_occurred_at_idx" ON "audit_event"("actor_id", "occurred_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "document_object_key_key" ON "document"("object_key");

-- CreateIndex
CREATE INDEX "document_company_id_created_at_idx" ON "document"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "document_company_id_sha256_idx" ON "document"("company_id", "sha256");

-- CreateIndex
CREATE INDEX "document_link_entity_type_entity_id_idx" ON "document_link"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_link_document_id_entity_type_entity_id_link_type_key" ON "document_link"("document_id", "entity_type", "entity_id", "link_type");

-- CreateIndex
CREATE INDEX "notification_user_id_read_at_created_at_idx" ON "notification"("user_id", "read_at", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "integration_config_company_id_kind_provider_key" ON "integration_config"("company_id", "kind", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "numbering_series_company_id_document_type_period_key_key" ON "numbering_series"("company_id", "document_type", "period_key");

-- CreateIndex
CREATE UNIQUE INDEX "generated_number_company_id_number_document_type_key" ON "generated_number"("company_id", "number", "document_type");

-- CreateIndex
CREATE INDEX "outbox_event_status_available_at_idx" ON "outbox_event"("status", "available_at");

-- AddForeignKey
ALTER TABLE "department" ADD CONSTRAINT "department_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department" ADD CONSTRAINT "department_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department" ADD CONSTRAINT "department_head_user_id_fkey" FOREIGN KEY ("head_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centre" ADD CONSTRAINT "cost_centre_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centre" ADD CONSTRAINT "cost_centre_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_active_company_id_fkey" FOREIGN KEY ("active_company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_token" ADD CONSTRAINT "auth_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role" ADD CONSTRAINT "role_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_key_fkey" FOREIGN KEY ("permission_key") REFERENCES "permission"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_assignment" ADD CONSTRAINT "user_role_assignment_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_assignment" ADD CONSTRAINT "user_role_assignment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_assignment" ADD CONSTRAINT "user_role_assignment_company_id_role_id_fkey" FOREIGN KEY ("company_id", "role_id") REFERENCES "role"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_assignment" ADD CONSTRAINT "user_role_assignment_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_assignment" ADD CONSTRAINT "user_role_assignment_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_policy" ADD CONSTRAINT "approval_policy_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_policy_stage" ADD CONSTRAINT "approval_policy_stage_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "approval_policy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_instance" ADD CONSTRAINT "approval_instance_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_instance" ADD CONSTRAINT "approval_instance_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "approval_policy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_instance" ADD CONSTRAINT "approval_instance_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_task" ADD CONSTRAINT "approval_task_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "approval_instance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_task" ADD CONSTRAINT "approval_task_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "approval_policy_stage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_task" ADD CONSTRAINT "approval_task_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_task" ADD CONSTRAINT "approval_task_delegated_from_id_fkey" FOREIGN KEY ("delegated_from_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_task" ADD CONSTRAINT "approval_task_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_event" ADD CONSTRAINT "approval_event_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "approval_instance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_delegation" ADD CONSTRAINT "approval_delegation_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_delegation" ADD CONSTRAINT "approval_delegation_delegator_id_fkey" FOREIGN KEY ("delegator_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_delegation" ADD CONSTRAINT "approval_delegation_delegate_id_fkey" FOREIGN KEY ("delegate_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_config" ADD CONSTRAINT "integration_config_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "numbering_series" ADD CONSTRAINT "numbering_series_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_number" ADD CONSTRAINT "generated_number_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_event" ADD CONSTRAINT "outbox_event_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═══════════════════════════════════════════════════════════════════════════
-- Database-level guarantees not expressible in schema.prisma (hand-written).
-- ═══════════════════════════════════════════════════════════════════════════

-- Append-only enforcement ---------------------------------------------------
CREATE OR REPLACE FUNCTION kk_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_event_append_only BEFORE UPDATE OR DELETE ON "audit_event"
  FOR EACH ROW EXECUTE FUNCTION kk_reject_mutation();
CREATE TRIGGER audit_event_no_truncate BEFORE TRUNCATE ON "audit_event"
  FOR EACH STATEMENT EXECUTE FUNCTION kk_reject_mutation();

CREATE TRIGGER approval_event_append_only BEFORE UPDATE OR DELETE ON "approval_event"
  FOR EACH ROW EXECUTE FUNCTION kk_reject_mutation();
CREATE TRIGGER approval_event_no_truncate BEFORE TRUNCATE ON "approval_event"
  FOR EACH STATEMENT EXECUTE FUNCTION kk_reject_mutation();

CREATE TRIGGER generated_number_append_only BEFORE UPDATE OR DELETE ON "generated_number"
  FOR EACH ROW EXECUTE FUNCTION kk_reject_mutation();
CREATE TRIGGER generated_number_no_truncate BEFORE TRUNCATE ON "generated_number"
  FOR EACH STATEMENT EXECUTE FUNCTION kk_reject_mutation();

-- Partial / expression unique indexes ----------------------------------------
CREATE UNIQUE INDEX "app_user_email_lower_key" ON "app_user" (lower("email"));
CREATE UNIQUE INDEX "approval_policy_one_active_key" ON "approval_policy" ("company_id", "entity_type") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "approval_policy_one_draft_key" ON "approval_policy" ("company_id", "entity_type") WHERE "status" = 'DRAFT';
CREATE UNIQUE INDEX "approval_instance_one_pending_key" ON "approval_instance" ("company_id", "entity_type", "entity_id") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "company_gstin_key" ON "company" ("gstin") WHERE "gstin" IS NOT NULL;

-- Check constraints -----------------------------------------------------------
ALTER TABLE "company"
  ADD CONSTRAINT "company_fy_month_chk" CHECK ("fiscal_year_start_month" BETWEEN 1 AND 12),
  ADD CONSTRAINT "company_currency_chk" CHECK ("base_currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "company_code_chk" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$');

ALTER TABLE "app_user"
  ADD CONSTRAINT "app_user_email_lower_chk" CHECK ("email" = lower("email")),
  ADD CONSTRAINT "app_user_not_own_manager_chk" CHECK ("manager_id" IS NULL OR "manager_id" <> "id"),
  ADD CONSTRAINT "app_user_failed_logins_chk" CHECK ("failed_login_count" >= 0),
  ADD CONSTRAINT "app_user_active_has_password_chk" CHECK ("status" <> 'ACTIVE' OR "password_hash" IS NOT NULL OR "identity_subject" IS NOT NULL);

ALTER TABLE "department"
  ADD CONSTRAINT "department_not_own_parent_chk" CHECK ("parent_id" IS NULL OR "parent_id" <> "id");

ALTER TABLE "session"
  ADD CONSTRAINT "session_expiry_chk" CHECK ("expires_at" > "created_at");

ALTER TABLE "user_role_assignment"
  ADD CONSTRAINT "user_role_assignment_window_chk" CHECK ("valid_until" IS NULL OR "valid_until" > "valid_from");

ALTER TABLE "approval_policy"
  ADD CONSTRAINT "approval_policy_version_chk" CHECK ("policy_version" >= 1);

ALTER TABLE "approval_policy_stage"
  ADD CONSTRAINT "approval_stage_sequence_chk" CHECK ("sequence" >= 1),
  ADD CONSTRAINT "approval_stage_min_approvals_chk" CHECK ("min_approvals" >= 1),
  ADD CONSTRAINT "approval_stage_amount_nonneg_chk" CHECK (("min_amount" IS NULL OR "min_amount" >= 0) AND ("max_amount" IS NULL OR "max_amount" >= 0)),
  ADD CONSTRAINT "approval_stage_amount_range_chk" CHECK ("min_amount" IS NULL OR "max_amount" IS NULL OR "min_amount" <= "max_amount"),
  ADD CONSTRAINT "approval_stage_sla_chk" CHECK ("sla_hours" IS NULL OR "sla_hours" > 0),
  ADD CONSTRAINT "approval_stage_role_chk" CHECK ("approver_type" <> 'ROLE' OR "approver_role_key" IS NOT NULL),
  ADD CONSTRAINT "approval_stage_user_chk" CHECK ("approver_type" <> 'USER' OR "approver_user_id" IS NOT NULL);

ALTER TABLE "approval_instance"
  ADD CONSTRAINT "approval_instance_amount_chk" CHECK ("amount" IS NULL OR "amount" >= 0),
  ADD CONSTRAINT "approval_instance_currency_chk" CHECK ("currency_code" IS NULL OR "currency_code" ~ '^[A-Z]{3}$');

ALTER TABLE "approval_task"
  ADD CONSTRAINT "approval_task_decided_chk" CHECK ("status" NOT IN ('APPROVED', 'REJECTED', 'RETURNED') OR ("decided_by" IS NOT NULL AND "decided_at" IS NOT NULL)),
  ADD CONSTRAINT "approval_task_reason_chk" CHECK ("status" NOT IN ('REJECTED', 'RETURNED') OR coalesce(length(trim("reason")), 0) > 0);

ALTER TABLE "approval_delegation"
  ADD CONSTRAINT "approval_delegation_window_chk" CHECK ("valid_until" > "valid_from"),
  ADD CONSTRAINT "approval_delegation_distinct_chk" CHECK ("delegator_id" <> "delegate_id");

ALTER TABLE "document"
  ADD CONSTRAINT "document_size_chk" CHECK ("size_bytes" > 0),
  ADD CONSTRAINT "document_sha256_chk" CHECK ("sha256" ~ '^[a-f0-9]{64}$');

ALTER TABLE "numbering_series"
  ADD CONSTRAINT "numbering_next_value_chk" CHECK ("next_value" >= 1),
  ADD CONSTRAINT "numbering_padding_chk" CHECK ("padding" BETWEEN 1 AND 12);

ALTER TABLE "outbox_event"
  ADD CONSTRAINT "outbox_attempts_chk" CHECK ("attempts" >= 0);
