-- Reverts 20261113000000_foundation.
--
-- WARNING: this drops every foundation table and therefore ALL data in them.
-- It exists for development rollback and for the CI migration gate
-- (scripts/validate-migrations.ts). Production follows a forward-fix policy:
-- never run this against a database that holds business data.

DROP TABLE IF EXISTS "outbox_event" CASCADE;
DROP TABLE IF EXISTS "generated_number" CASCADE;
DROP TABLE IF EXISTS "numbering_series" CASCADE;
DROP TABLE IF EXISTS "integration_config" CASCADE;
DROP TABLE IF EXISTS "notification" CASCADE;
DROP TABLE IF EXISTS "document_link" CASCADE;
DROP TABLE IF EXISTS "document" CASCADE;
DROP TABLE IF EXISTS "audit_event" CASCADE;
DROP TABLE IF EXISTS "approval_delegation" CASCADE;
DROP TABLE IF EXISTS "approval_event" CASCADE;
DROP TABLE IF EXISTS "approval_task" CASCADE;
DROP TABLE IF EXISTS "approval_instance" CASCADE;
DROP TABLE IF EXISTS "approval_policy_stage" CASCADE;
DROP TABLE IF EXISTS "approval_policy" CASCADE;
DROP TABLE IF EXISTS "user_role_assignment" CASCADE;
DROP TABLE IF EXISTS "role_permission" CASCADE;
DROP TABLE IF EXISTS "role" CASCADE;
DROP TABLE IF EXISTS "permission" CASCADE;
DROP TABLE IF EXISTS "auth_token" CASCADE;
DROP TABLE IF EXISTS "session" CASCADE;
DROP TABLE IF EXISTS "app_user" CASCADE;
DROP TABLE IF EXISTS "cost_centre" CASCADE;
DROP TABLE IF EXISTS "department" CASCADE;
DROP TABLE IF EXISTS "company" CASCADE;

DROP FUNCTION IF EXISTS kk_reject_mutation();

DROP TYPE IF EXISTS "NumberResetPolicy";
DROP TYPE IF EXISTS "OutboxStatus";
DROP TYPE IF EXISTS "DocumentScanStatus";
DROP TYPE IF EXISTS "ApprovalTaskStatus";
DROP TYPE IF EXISTS "ApprovalInstanceStatus";
DROP TYPE IF EXISTS "ApproverType";
DROP TYPE IF EXISTS "ApprovalStageMode";
DROP TYPE IF EXISTS "ApprovalPolicyStatus";
DROP TYPE IF EXISTS "AuthTokenType";
DROP TYPE IF EXISTS "PermissionScope";
DROP TYPE IF EXISTS "UserStatus";
DROP TYPE IF EXISTS "CompanyStatus";
