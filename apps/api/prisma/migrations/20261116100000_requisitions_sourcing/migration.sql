-- CreateEnum
CREATE TYPE "RequisitionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PENDING_APPROVAL', 'APPROVED', 'RETURNED', 'REJECTED', 'WITHDRAWN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RequisitionPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "LineItemType" AS ENUM ('GOODS', 'SERVICE');

-- CreateEnum
CREATE TYPE "SourcingRoute" AS ENUM ('NONE', 'RFQ', 'DIRECT');

-- CreateEnum
CREATE TYPE "RfqStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'PARTIALLY_RESPONDED', 'RESPONSES_RECEIVED', 'EVALUATION', 'AWARDED', 'CANCELLED', 'CLOSED');

-- CreateEnum
CREATE TYPE "RfqInvitationStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'RESPONDED', 'DECLINED', 'NO_RESPONSE', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_EVALUATION', 'CLARIFICATION_REQUESTED', 'REVISED', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "QuotationReceivedVia" AS ENUM ('MANUAL_ENTRY', 'UPLOADED_DOCUMENT', 'EMAIL', 'OFFLINE');

-- CreateTable
CREATE TABLE "purchase_requisition" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "requisition_no" VARCHAR(64) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "requester_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "cost_centre_id" UUID,
    "justification" VARCHAR(4000) NOT NULL,
    "required_by" DATE NOT NULL,
    "delivery_location" VARCHAR(300) NOT NULL,
    "priority" "RequisitionPriority" NOT NULL DEFAULT 'NORMAL',
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "estimated_subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "estimated_tax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "estimated_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "RequisitionStatus" NOT NULL DEFAULT 'DRAFT',
    "status_reason" VARCHAR(2000),
    "sourcing_route" "SourcingRoute" NOT NULL DEFAULT 'NONE',
    "direct_vendor_id" UUID,
    "direct_reason" VARCHAR(1000),
    "submitted_at" TIMESTAMPTZ(6),
    "approved_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "purchase_requisition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requisition_line" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "requisition_id" UUID NOT NULL,
    "line_no" SMALLINT NOT NULL,
    "item_type" "LineItemType" NOT NULL,
    "description" VARCHAR(1000) NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "uom" VARCHAR(16) NOT NULL,
    "estimated_unit_price" DECIMAL(18,4) NOT NULL,
    "tax_category" VARCHAR(16) NOT NULL,
    "tax_rate" DECIMAL(5,2) NOT NULL,
    "line_subtotal" DECIMAL(18,2) NOT NULL,
    "line_tax" DECIMAL(18,2) NOT NULL,
    "line_total" DECIMAL(18,2) NOT NULL,
    "preferred_vendor_id" UUID,

    CONSTRAINT "requisition_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requisition_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "requisition_id" UUID NOT NULL,
    "from_status" "RequisitionStatus",
    "to_status" "RequisitionStatus" NOT NULL,
    "actor_id" UUID,
    "reason" VARCHAR(2000),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "requisition_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "rfq_no" VARCHAR(64) NOT NULL,
    "requisition_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(4000),
    "delivery_requirements" VARCHAR(2000),
    "delivery_location" VARCHAR(300) NOT NULL,
    "response_deadline" TIMESTAMPTZ(6) NOT NULL,
    "submission_instructions" VARCHAR(4000),
    "terms_and_conditions" VARCHAR(8000),
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "status" "RfqStatus" NOT NULL DEFAULT 'DRAFT',
    "status_reason" VARCHAR(2000),
    "is_standalone" BOOLEAN NOT NULL DEFAULT false,
    "standalone_reason" VARCHAR(1000),
    "rfq_document_id" UUID,
    "sent_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "rfq_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_line" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "rfq_id" UUID NOT NULL,
    "line_no" SMALLINT NOT NULL,
    "requisition_line_id" UUID,
    "item_type" "LineItemType" NOT NULL,
    "description" VARCHAR(1000) NOT NULL,
    "specification" VARCHAR(2000),
    "quantity" DECIMAL(18,4) NOT NULL,
    "uom" VARCHAR(16) NOT NULL,

    CONSTRAINT "rfq_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_invitation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "rfq_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "status" "RfqInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "recipient_email" VARCHAR(254) NOT NULL,
    "invited_by" UUID NOT NULL,
    "invited_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "responded_at" TIMESTAMPTZ(6),
    "last_reminder_at" TIMESTAMPTZ(6),
    "reminder_count" INTEGER NOT NULL DEFAULT 0,
    "decline_reason" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rfq_invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_communication" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "rfq_id" UUID NOT NULL,
    "invitation_id" UUID,
    "kind" VARCHAR(40) NOT NULL,
    "direction" VARCHAR(10) NOT NULL,
    "subject" VARCHAR(300) NOT NULL,
    "body" VARCHAR(8000),
    "recipient" VARCHAR(254),
    "delivery_reference" VARCHAR(100),
    "evidence_document_id" UUID,
    "actor_id" UUID,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfq_communication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rfq_id" UUID NOT NULL,
    "from_status" "RfqStatus",
    "to_status" "RfqStatus" NOT NULL,
    "actor_id" UUID,
    "reason" VARCHAR(2000),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfq_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "quotation_no" VARCHAR(64) NOT NULL,
    "rfq_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "invitation_id" UUID NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "status_reason" VARCHAR(2000),
    "current_version_no" INTEGER NOT NULL DEFAULT 0,
    "late_acceptance_note" VARCHAR(1000),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID NOT NULL,

    CONSTRAINT "quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_version" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "quotation_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "vendor_reference" VARCHAR(80),
    "quotation_date" DATE NOT NULL,
    "valid_until" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "delivery_lead_days" INTEGER,
    "warranty" VARCHAR(300),
    "payment_terms_days" INTEGER,
    "payment_terms" VARCHAR(500),
    "freight" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "other_charges" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "other_charges_note" VARCHAR(300),
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discount_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "grand_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "notes" VARCHAR(4000),
    "change_summary" VARCHAR(2000),
    "received_via" "QuotationReceivedVia" NOT NULL DEFAULT 'MANUAL_ENTRY',
    "source_document_id" UUID,
    "submitted_at" TIMESTAMPTZ(6),
    "submitted_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "quotation_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_version_line" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version_id" UUID NOT NULL,
    "rfq_id" UUID NOT NULL,
    "rfq_line_id" UUID NOT NULL,
    "description" VARCHAR(1000) NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "uom" VARCHAR(16) NOT NULL,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "tax_rate" DECIMAL(5,2) NOT NULL,
    "gross" DECIMAL(18,2) NOT NULL,
    "discount" DECIMAL(18,2) NOT NULL,
    "taxable" DECIMAL(18,2) NOT NULL,
    "tax" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "remarks" VARCHAR(500),

    CONSTRAINT "quotation_version_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_review" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "quotation_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "note" VARCHAR(2000),
    "reviewer_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotation_review_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_requisition_company_id_status_created_at_idx" ON "purchase_requisition"("company_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "purchase_requisition_company_id_requester_id_status_idx" ON "purchase_requisition"("company_id", "requester_id", "status");

-- CreateIndex
CREATE INDEX "purchase_requisition_company_id_department_id_status_idx" ON "purchase_requisition"("company_id", "department_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requisition_company_id_requisition_no_key" ON "purchase_requisition"("company_id", "requisition_no");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requisition_company_id_id_key" ON "purchase_requisition"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "requisition_line_requisition_id_line_no_key" ON "requisition_line"("requisition_id", "line_no");

-- CreateIndex
CREATE INDEX "requisition_status_history_requisition_id_occurred_at_idx" ON "requisition_status_history"("requisition_id", "occurred_at");

-- CreateIndex
CREATE INDEX "rfq_company_id_status_response_deadline_idx" ON "rfq"("company_id", "status", "response_deadline");

-- CreateIndex
CREATE INDEX "rfq_requisition_id_idx" ON "rfq"("requisition_id");

-- CreateIndex
CREATE UNIQUE INDEX "rfq_company_id_rfq_no_key" ON "rfq"("company_id", "rfq_no");

-- CreateIndex
CREATE UNIQUE INDEX "rfq_company_id_id_key" ON "rfq"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "rfq_line_rfq_id_line_no_key" ON "rfq_line"("rfq_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "rfq_line_rfq_id_id_key" ON "rfq_line"("rfq_id", "id");

-- CreateIndex
CREATE INDEX "rfq_invitation_company_id_vendor_id_idx" ON "rfq_invitation"("company_id", "vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "rfq_invitation_rfq_id_vendor_id_key" ON "rfq_invitation"("rfq_id", "vendor_id");

-- CreateIndex
CREATE INDEX "rfq_communication_rfq_id_occurred_at_idx" ON "rfq_communication"("rfq_id", "occurred_at");

-- CreateIndex
CREATE INDEX "rfq_status_history_rfq_id_occurred_at_idx" ON "rfq_status_history"("rfq_id", "occurred_at");

-- CreateIndex
CREATE INDEX "quotation_company_id_status_idx" ON "quotation"("company_id", "status");

-- CreateIndex
CREATE INDEX "quotation_company_id_vendor_id_idx" ON "quotation"("company_id", "vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_company_id_quotation_no_key" ON "quotation"("company_id", "quotation_no");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_rfq_id_vendor_id_key" ON "quotation"("rfq_id", "vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_company_id_id_key" ON "quotation"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_version_quotation_id_version_no_key" ON "quotation_version"("quotation_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_version_line_version_id_rfq_line_id_key" ON "quotation_version_line"("version_id", "rfq_line_id");

-- CreateIndex
CREATE INDEX "quotation_review_quotation_id_occurred_at_idx" ON "quotation_review"("quotation_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "purchase_requisition" ADD CONSTRAINT "purchase_requisition_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisition" ADD CONSTRAINT "purchase_requisition_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisition" ADD CONSTRAINT "purchase_requisition_company_id_department_id_fkey" FOREIGN KEY ("company_id", "department_id") REFERENCES "department"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisition" ADD CONSTRAINT "purchase_requisition_cost_centre_id_fkey" FOREIGN KEY ("cost_centre_id") REFERENCES "cost_centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisition" ADD CONSTRAINT "purchase_requisition_direct_vendor_id_fkey" FOREIGN KEY ("direct_vendor_id") REFERENCES "vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requisition_line" ADD CONSTRAINT "requisition_line_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requisition_line" ADD CONSTRAINT "requisition_line_company_id_requisition_id_fkey" FOREIGN KEY ("company_id", "requisition_id") REFERENCES "purchase_requisition"("company_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requisition_line" ADD CONSTRAINT "requisition_line_preferred_vendor_id_fkey" FOREIGN KEY ("preferred_vendor_id") REFERENCES "vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requisition_status_history" ADD CONSTRAINT "requisition_status_history_requisition_id_fkey" FOREIGN KEY ("requisition_id") REFERENCES "purchase_requisition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requisition_status_history" ADD CONSTRAINT "requisition_status_history_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq" ADD CONSTRAINT "rfq_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq" ADD CONSTRAINT "rfq_company_id_requisition_id_fkey" FOREIGN KEY ("company_id", "requisition_id") REFERENCES "purchase_requisition"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq" ADD CONSTRAINT "rfq_rfq_document_id_fkey" FOREIGN KEY ("rfq_document_id") REFERENCES "document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq" ADD CONSTRAINT "rfq_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_line" ADD CONSTRAINT "rfq_line_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_line" ADD CONSTRAINT "rfq_line_company_id_rfq_id_fkey" FOREIGN KEY ("company_id", "rfq_id") REFERENCES "rfq"("company_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_line" ADD CONSTRAINT "rfq_line_requisition_line_id_fkey" FOREIGN KEY ("requisition_line_id") REFERENCES "requisition_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_invitation" ADD CONSTRAINT "rfq_invitation_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_invitation" ADD CONSTRAINT "rfq_invitation_company_id_rfq_id_fkey" FOREIGN KEY ("company_id", "rfq_id") REFERENCES "rfq"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_invitation" ADD CONSTRAINT "rfq_invitation_company_id_vendor_id_fkey" FOREIGN KEY ("company_id", "vendor_id") REFERENCES "vendor"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_invitation" ADD CONSTRAINT "rfq_invitation_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_communication" ADD CONSTRAINT "rfq_communication_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_communication" ADD CONSTRAINT "rfq_communication_company_id_rfq_id_fkey" FOREIGN KEY ("company_id", "rfq_id") REFERENCES "rfq"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_communication" ADD CONSTRAINT "rfq_communication_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "rfq_invitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_communication" ADD CONSTRAINT "rfq_communication_evidence_document_id_fkey" FOREIGN KEY ("evidence_document_id") REFERENCES "document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_communication" ADD CONSTRAINT "rfq_communication_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_status_history" ADD CONSTRAINT "rfq_status_history_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "rfq"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_status_history" ADD CONSTRAINT "rfq_status_history_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_company_id_rfq_id_fkey" FOREIGN KEY ("company_id", "rfq_id") REFERENCES "rfq"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_company_id_vendor_id_fkey" FOREIGN KEY ("company_id", "vendor_id") REFERENCES "vendor"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "rfq_invitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_version" ADD CONSTRAINT "quotation_version_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_version" ADD CONSTRAINT "quotation_version_company_id_quotation_id_fkey" FOREIGN KEY ("company_id", "quotation_id") REFERENCES "quotation"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_version" ADD CONSTRAINT "quotation_version_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_version" ADD CONSTRAINT "quotation_version_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_version" ADD CONSTRAINT "quotation_version_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_version_line" ADD CONSTRAINT "quotation_version_line_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "quotation_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_version_line" ADD CONSTRAINT "quotation_version_line_rfq_id_rfq_line_id_fkey" FOREIGN KEY ("rfq_id", "rfq_line_id") REFERENCES "rfq_line"("rfq_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_review" ADD CONSTRAINT "quotation_review_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_review" ADD CONSTRAINT "quotation_review_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═══════════════════════════════════════════════════════════════════════════
-- Sourcing guarantees not expressible in schema.prisma (hand-written).
-- ═══════════════════════════════════════════════════════════════════════════

-- Append-only histories & communication logs (reuses kk_reject_mutation).
CREATE TRIGGER requisition_status_history_append_only BEFORE UPDATE OR DELETE ON "requisition_status_history" FOR EACH ROW EXECUTE FUNCTION kk_reject_mutation();
CREATE TRIGGER rfq_status_history_append_only BEFORE UPDATE OR DELETE ON "rfq_status_history" FOR EACH ROW EXECUTE FUNCTION kk_reject_mutation();
CREATE TRIGGER rfq_communication_append_only BEFORE UPDATE OR DELETE ON "rfq_communication" FOR EACH ROW EXECUTE FUNCTION kk_reject_mutation();
CREATE TRIGGER quotation_review_append_only BEFORE UPDATE OR DELETE ON "quotation_review" FOR EACH ROW EXECUTE FUNCTION kk_reject_mutation();

-- A submitted quotation version is immutable: no UPDATE or DELETE of the version or its lines.
CREATE OR REPLACE FUNCTION kk_quotation_version_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.submitted_at IS NOT NULL THEN
    RAISE EXCEPTION 'quotation_version % is submitted and immutable: % is not permitted', OLD.id, TG_OP USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER quotation_version_immutable BEFORE UPDATE OR DELETE ON "quotation_version" FOR EACH ROW EXECUTE FUNCTION kk_quotation_version_immutable();

CREATE OR REPLACE FUNCTION kk_quotation_line_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE submitted timestamptz;
BEGIN
  SELECT submitted_at INTO submitted FROM quotation_version WHERE id = COALESCE(NEW.version_id, OLD.version_id);
  IF submitted IS NOT NULL THEN
    RAISE EXCEPTION 'lines of a submitted quotation version are immutable: % is not permitted', TG_OP USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER quotation_version_line_immutable BEFORE INSERT OR UPDATE OR DELETE ON "quotation_version_line" FOR EACH ROW EXECUTE FUNCTION kk_quotation_line_immutable();

-- At most one unsubmitted (draft) version per quotation; at most one live RFQ per requisition.
CREATE UNIQUE INDEX "quotation_version_one_draft_key" ON "quotation_version" ("quotation_id") WHERE "submitted_at" IS NULL;
CREATE UNIQUE INDEX "rfq_one_live_per_requisition_key" ON "rfq" ("requisition_id") WHERE "requisition_id" IS NOT NULL AND "status" NOT IN ('CANCELLED');

ALTER TABLE "purchase_requisition"
  ADD CONSTRAINT "requisition_totals_chk" CHECK ("estimated_subtotal" >= 0 AND "estimated_tax" >= 0 AND "estimated_total" = "estimated_subtotal" + "estimated_tax"),
  ADD CONSTRAINT "requisition_currency_chk" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "requisition_direct_chk" CHECK ("sourcing_route" <> 'DIRECT' OR ("direct_vendor_id" IS NOT NULL AND "direct_reason" IS NOT NULL));

ALTER TABLE "requisition_line"
  ADD CONSTRAINT "requisition_line_qty_chk" CHECK ("quantity" > 0),
  ADD CONSTRAINT "requisition_line_price_chk" CHECK ("estimated_unit_price" >= 0),
  ADD CONSTRAINT "requisition_line_tax_chk" CHECK ("tax_rate" >= 0 AND "tax_rate" <= 100),
  ADD CONSTRAINT "requisition_line_total_chk" CHECK ("line_total" = "line_subtotal" + "line_tax" AND "line_subtotal" >= 0),
  ADD CONSTRAINT "requisition_line_no_chk" CHECK ("line_no" >= 1);

ALTER TABLE "rfq"
  ADD CONSTRAINT "rfq_standalone_chk" CHECK (("requisition_id" IS NULL) = "is_standalone"),
  ADD CONSTRAINT "rfq_standalone_reason_chk" CHECK (NOT "is_standalone" OR "standalone_reason" IS NOT NULL),
  ADD CONSTRAINT "rfq_currency_chk" CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "rfq_line"
  ADD CONSTRAINT "rfq_line_qty_chk" CHECK ("quantity" > 0);

ALTER TABLE "rfq_invitation"
  ADD CONSTRAINT "rfq_invitation_reminders_chk" CHECK ("reminder_count" >= 0);

ALTER TABLE "rfq_communication"
  ADD CONSTRAINT "rfq_communication_direction_chk" CHECK ("direction" IN ('OUTBOUND', 'INBOUND', 'INTERNAL'));

ALTER TABLE "quotation_version"
  ADD CONSTRAINT "quotation_version_no_chk" CHECK ("version_no" >= 1),
  ADD CONSTRAINT "quotation_version_validity_chk" CHECK ("valid_until" >= "quotation_date"),
  ADD CONSTRAINT "quotation_version_amounts_chk" CHECK ("freight" >= 0 AND "other_charges" >= 0 AND "subtotal" >= 0 AND "discount_total" >= 0 AND "tax_total" >= 0 AND "grand_total" >= 0),
  ADD CONSTRAINT "quotation_version_grand_total_chk" CHECK ("grand_total" = "subtotal" - "discount_total" + "tax_total" + "freight" + "other_charges"),
  ADD CONSTRAINT "quotation_version_lead_chk" CHECK ("delivery_lead_days" IS NULL OR "delivery_lead_days" >= 0),
  ADD CONSTRAINT "quotation_version_revision_summary_chk" CHECK ("version_no" = 1 OR "submitted_at" IS NULL OR "change_summary" IS NOT NULL);

ALTER TABLE "quotation_version_line"
  ADD CONSTRAINT "quotation_line_qty_chk" CHECK ("quantity" > 0),
  ADD CONSTRAINT "quotation_line_price_chk" CHECK ("unit_price" >= 0),
  ADD CONSTRAINT "quotation_line_rates_chk" CHECK ("discount_percent" BETWEEN 0 AND 100 AND "tax_rate" BETWEEN 0 AND 100),
  ADD CONSTRAINT "quotation_line_total_chk" CHECK ("total" = "taxable" + "tax" AND "taxable" = "gross" - "discount");
