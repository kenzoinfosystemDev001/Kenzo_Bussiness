-- CreateEnum
CREATE TYPE "VendorStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "VendorType" AS ENUM ('GOODS_SUPPLIER', 'SERVICE_PROVIDER', 'CONTRACTOR', 'CONSULTANT', 'DISTRIBUTOR', 'MANUFACTURER', 'OTHER');

-- CreateEnum
CREATE TYPE "GstRegistrationType" AS ENUM ('REGISTERED', 'COMPOSITION', 'SEZ', 'UNREGISTERED', 'OVERSEAS');

-- CreateEnum
CREATE TYPE "VendorDocumentType" AS ENUM ('GST_CERTIFICATE', 'PAN_CARD', 'INCORPORATION', 'BANK_PROOF', 'CONTRACT', 'AGREEMENT', 'MSME_CERTIFICATE', 'COMPLIANCE_CERTIFICATE', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "BankAccountStatus" AS ENUM ('PROPOSED', 'ACTIVE', 'SUPERSEDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "BankAccountType" AS ENUM ('CURRENT', 'SAVINGS', 'CASH_CREDIT', 'OVERSEAS');

-- CreateEnum
CREATE TYPE "BankChangeStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED');

-- CreateTable
CREATE TABLE "vendor" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "vendor_code" VARCHAR(64) NOT NULL,
    "legal_name" VARCHAR(200) NOT NULL,
    "trade_name" VARCHAR(200),
    "normalized_name" VARCHAR(200) NOT NULL,
    "vendor_type" "VendorType" NOT NULL,
    "category" VARCHAR(80) NOT NULL,
    "gst_registration_type" "GstRegistrationType" NOT NULL,
    "gstin" VARCHAR(15),
    "pan_enc" VARCHAR(256),
    "pan_last4" VARCHAR(4),
    "pan_fingerprint" CHAR(64),
    "registration_number" VARCHAR(40),
    "msme_registered" BOOLEAN NOT NULL DEFAULT false,
    "msme_number" VARCHAR(40),
    "website" VARCHAR(200),
    "email" VARCHAR(254),
    "phone" VARCHAR(20),
    "address_line1" VARCHAR(200) NOT NULL,
    "address_line2" VARCHAR(200),
    "city" VARCHAR(100) NOT NULL,
    "state" VARCHAR(100) NOT NULL,
    "state_code" VARCHAR(2),
    "postal_code" VARCHAR(20) NOT NULL,
    "country" CHAR(2) NOT NULL DEFAULT 'IN',
    "payment_terms_days" SMALLINT NOT NULL DEFAULT 30,
    "preferred_currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "internal_notes" VARCHAR(4000),
    "status" "VendorStatus" NOT NULL DEFAULT 'DRAFT',
    "status_reason" VARCHAR(1000),
    "submitted_at" TIMESTAMPTZ(6),
    "approved_at" TIMESTAMPTZ(6),
    "activated_at" TIMESTAMPTZ(6),
    "suspended_at" TIMESTAMPTZ(6),
    "archived_at" TIMESTAMPTZ(6),
    "duplicate_override_reason" VARCHAR(1000),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_contact" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "designation" VARCHAR(120),
    "email" VARCHAR(254),
    "phone" VARCHAR(20),
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vendor_contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_bank_account" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "account_holder_name" VARCHAR(200) NOT NULL,
    "bank_name" VARCHAR(120) NOT NULL,
    "branch_name" VARCHAR(120),
    "ifsc" VARCHAR(11),
    "swift_code" VARCHAR(11),
    "account_type" "BankAccountType" NOT NULL DEFAULT 'CURRENT',
    "account_number_enc" VARCHAR(256) NOT NULL,
    "account_last4" VARCHAR(4) NOT NULL,
    "account_fingerprint" CHAR(64) NOT NULL,
    "status" "BankAccountStatus" NOT NULL DEFAULT 'PROPOSED',
    "proof_document_id" UUID,
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "superseded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "vendor_bank_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_bank_change_request" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "proposed_account_id" UUID NOT NULL,
    "previous_account_id" UUID,
    "reason" VARCHAR(1000) NOT NULL,
    "status" "BankChangeStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "outcome_reason" VARCHAR(2000),
    "requested_by" UUID NOT NULL,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vendor_bank_change_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_document" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "document_type" "VendorDocumentType" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "document_number" VARCHAR(80),
    "issue_date" DATE,
    "expiry_date" DATE,
    "version_no" INTEGER NOT NULL DEFAULT 1,
    "previous_version_id" UUID,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "verification_status" "DocumentVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verification_note" VARCHAR(1000),
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "expiry_warned_at" TIMESTAMPTZ(6),
    "expired_notified_at" TIMESTAMPTZ(6),
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vendor_id" UUID NOT NULL,
    "from_status" "VendorStatus",
    "to_status" "VendorStatus" NOT NULL,
    "actor_id" UUID,
    "reason" VARCHAR(2000),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendor_company_id_status_created_at_idx" ON "vendor"("company_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "vendor_company_id_normalized_name_idx" ON "vendor"("company_id", "normalized_name");

-- CreateIndex
CREATE INDEX "vendor_company_id_pan_fingerprint_idx" ON "vendor"("company_id", "pan_fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_company_id_vendor_code_key" ON "vendor"("company_id", "vendor_code");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_company_id_id_key" ON "vendor"("company_id", "id");

-- CreateIndex
CREATE INDEX "vendor_contact_vendor_id_idx" ON "vendor_contact"("vendor_id");

-- CreateIndex
CREATE INDEX "vendor_bank_account_vendor_id_status_idx" ON "vendor_bank_account"("vendor_id", "status");

-- CreateIndex
CREATE INDEX "vendor_bank_account_company_id_account_fingerprint_idx" ON "vendor_bank_account"("company_id", "account_fingerprint");

-- CreateIndex
CREATE INDEX "vendor_bank_change_request_company_id_status_created_at_idx" ON "vendor_bank_change_request"("company_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "vendor_bank_change_request_vendor_id_idx" ON "vendor_bank_change_request"("vendor_id");

-- CreateIndex
CREATE INDEX "vendor_document_vendor_id_document_type_is_current_idx" ON "vendor_document"("vendor_id", "document_type", "is_current");

-- CreateIndex
CREATE INDEX "vendor_document_company_id_verification_status_idx" ON "vendor_document"("company_id", "verification_status");

-- CreateIndex
CREATE INDEX "vendor_document_company_id_expiry_date_idx" ON "vendor_document"("company_id", "expiry_date");

-- CreateIndex
CREATE INDEX "vendor_status_history_vendor_id_occurred_at_idx" ON "vendor_status_history"("vendor_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "vendor" ADD CONSTRAINT "vendor_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor" ADD CONSTRAINT "vendor_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_contact" ADD CONSTRAINT "vendor_contact_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_contact" ADD CONSTRAINT "vendor_contact_company_id_vendor_id_fkey" FOREIGN KEY ("company_id", "vendor_id") REFERENCES "vendor"("company_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bank_account" ADD CONSTRAINT "vendor_bank_account_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bank_account" ADD CONSTRAINT "vendor_bank_account_company_id_vendor_id_fkey" FOREIGN KEY ("company_id", "vendor_id") REFERENCES "vendor"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bank_account" ADD CONSTRAINT "vendor_bank_account_proof_document_id_fkey" FOREIGN KEY ("proof_document_id") REFERENCES "document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bank_account" ADD CONSTRAINT "vendor_bank_account_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bank_change_request" ADD CONSTRAINT "vendor_bank_change_request_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bank_change_request" ADD CONSTRAINT "vendor_bank_change_request_company_id_vendor_id_fkey" FOREIGN KEY ("company_id", "vendor_id") REFERENCES "vendor"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bank_change_request" ADD CONSTRAINT "vendor_bank_change_request_proposed_account_id_fkey" FOREIGN KEY ("proposed_account_id") REFERENCES "vendor_bank_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bank_change_request" ADD CONSTRAINT "vendor_bank_change_request_previous_account_id_fkey" FOREIGN KEY ("previous_account_id") REFERENCES "vendor_bank_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bank_change_request" ADD CONSTRAINT "vendor_bank_change_request_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_document" ADD CONSTRAINT "vendor_document_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_document" ADD CONSTRAINT "vendor_document_company_id_vendor_id_fkey" FOREIGN KEY ("company_id", "vendor_id") REFERENCES "vendor"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_document" ADD CONSTRAINT "vendor_document_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_document" ADD CONSTRAINT "vendor_document_previous_version_id_fkey" FOREIGN KEY ("previous_version_id") REFERENCES "vendor_document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_document" ADD CONSTRAINT "vendor_document_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_document" ADD CONSTRAINT "vendor_document_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_status_history" ADD CONSTRAINT "vendor_status_history_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_status_history" ADD CONSTRAINT "vendor_status_history_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═══════════════════════════════════════════════════════════════════════════
-- Vendor guarantees not expressible in schema.prisma (hand-written).
-- ═══════════════════════════════════════════════════════════════════════════

-- Lifecycle history is append-only (reuses kk_reject_mutation from the foundation migration).
CREATE TRIGGER vendor_status_history_append_only BEFORE UPDATE OR DELETE ON "vendor_status_history"
  FOR EACH ROW EXECUTE FUNCTION kk_reject_mutation();
CREATE TRIGGER vendor_status_history_no_truncate BEFORE TRUNCATE ON "vendor_status_history"
  FOR EACH STATEMENT EXECUTE FUNCTION kk_reject_mutation();

-- One live vendor per GSTIN per company (rejected/archived records keep history without blocking).
CREATE UNIQUE INDEX "vendor_company_gstin_live_key" ON "vendor" ("company_id", "gstin")
  WHERE "gstin" IS NOT NULL AND "status" NOT IN ('REJECTED', 'ARCHIVED');
-- At most one ACTIVE bank account per vendor, one PENDING bank change per vendor,
-- and one current version per (vendor, document type, title).
CREATE UNIQUE INDEX "vendor_bank_account_one_active_key" ON "vendor_bank_account" ("vendor_id") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "vendor_bank_change_one_pending_key" ON "vendor_bank_change_request" ("vendor_id") WHERE "status" = 'PENDING_APPROVAL';
CREATE UNIQUE INDEX "vendor_one_primary_contact_key" ON "vendor_contact" ("vendor_id") WHERE "is_primary";

ALTER TABLE "vendor"
  ADD CONSTRAINT "vendor_gstin_format_chk" CHECK ("gstin" IS NULL OR "gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  ADD CONSTRAINT "vendor_gst_required_chk" CHECK ("gst_registration_type" NOT IN ('REGISTERED', 'COMPOSITION', 'SEZ') OR "gstin" IS NOT NULL),
  ADD CONSTRAINT "vendor_gst_absent_chk" CHECK ("gst_registration_type" IN ('REGISTERED', 'COMPOSITION', 'SEZ') OR "gstin" IS NULL),
  ADD CONSTRAINT "vendor_payment_terms_chk" CHECK ("payment_terms_days" BETWEEN 0 AND 365),
  ADD CONSTRAINT "vendor_currency_chk" CHECK ("preferred_currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "vendor_msme_chk" CHECK (NOT "msme_registered" OR "msme_number" IS NOT NULL),
  ADD CONSTRAINT "vendor_pan_fields_chk" CHECK (("pan_enc" IS NULL) = ("pan_fingerprint" IS NULL));

ALTER TABLE "vendor_bank_account"
  ADD CONSTRAINT "vendor_bank_ifsc_chk" CHECK ("ifsc" IS NULL OR "ifsc" ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  ADD CONSTRAINT "vendor_bank_routing_chk" CHECK ("ifsc" IS NOT NULL OR "swift_code" IS NOT NULL),
  ADD CONSTRAINT "vendor_bank_fingerprint_chk" CHECK ("account_fingerprint" ~ '^[a-f0-9]{64}$');

ALTER TABLE "vendor_bank_change_request"
  ADD CONSTRAINT "vendor_bank_change_distinct_chk" CHECK ("previous_account_id" IS NULL OR "previous_account_id" <> "proposed_account_id");

ALTER TABLE "vendor_document"
  ADD CONSTRAINT "vendor_document_version_chk" CHECK ("version_no" >= 1),
  ADD CONSTRAINT "vendor_document_dates_chk" CHECK ("issue_date" IS NULL OR "expiry_date" IS NULL OR "expiry_date" >= "issue_date"),
  ADD CONSTRAINT "vendor_document_verified_chk" CHECK ("verification_status" = 'PENDING' OR ("verified_by" IS NOT NULL AND "verified_at" IS NOT NULL));
