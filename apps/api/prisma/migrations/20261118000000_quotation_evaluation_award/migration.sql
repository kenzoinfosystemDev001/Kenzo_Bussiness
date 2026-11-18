-- CreateEnum
CREATE TYPE "CriteriaSetStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "CriterionSource" AS ENUM ('AUTO_PRICE', 'AUTO_DELIVERY', 'AUTO_PAYMENT_TERMS', 'MANUAL');

-- CreateEnum
CREATE TYPE "CriterionDirection" AS ENUM ('HIGHER_BETTER', 'LOWER_BETTER');

-- CreateEnum
CREATE TYPE "EvaluationStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AwardStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'AWARDED', 'RETURNED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AwardType" AS ENUM ('FULL', 'PARTIAL');

-- CreateEnum
CREATE TYPE "TaxTreatment" AS ENUM ('EXCLUSIVE', 'INCLUSIVE');

-- AlterTable
ALTER TABLE "quotation_version" ADD COLUMN     "tax_treatment" "TaxTreatment" NOT NULL DEFAULT 'EXCLUSIVE';

-- AlterTable
ALTER TABLE "quotation_version_line" ADD COLUMN     "tax_treatment" "TaxTreatment" NOT NULL DEFAULT 'EXCLUSIVE';

-- AlterTable
ALTER TABLE "rfq" ADD COLUMN     "allow_partial_award" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "exchange_rate" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "base_currency" CHAR(3) NOT NULL,
    "quote_currency" CHAR(3) NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "source" VARCHAR(80) NOT NULL,
    "rate_timestamp" TIMESTAMPTZ(6) NOT NULL,
    "note" VARCHAR(500),
    "approved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by" UUID NOT NULL,

    CONSTRAINT "exchange_rate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_criteria_set" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000),
    "status" "CriteriaSetStatus" NOT NULL DEFAULT 'DRAFT',
    "set_version" INTEGER NOT NULL DEFAULT 1,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "formula_version" VARCHAR(40) NOT NULL,
    "published_at" TIMESTAMPTZ(6),
    "retired_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "evaluation_criteria_set_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_criterion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "set_id" UUID NOT NULL,
    "key" VARCHAR(40) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "weight_percent" DECIMAL(5,2) NOT NULL,
    "source" "CriterionSource" NOT NULL,
    "direction" "CriterionDirection" NOT NULL,
    "guidance" VARCHAR(500),
    "sort_order" SMALLINT NOT NULL,

    CONSTRAINT "evaluation_criterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_evaluation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "rfq_id" UUID NOT NULL,
    "criteria_set_id" UUID NOT NULL,
    "formula_version" VARCHAR(40) NOT NULL,
    "basis_currency" CHAR(3) NOT NULL,
    "status" "EvaluationStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "summary_note" VARCHAR(4000),
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_by" UUID NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "completed_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rfq_evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_evaluation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "evaluation_id" UUID NOT NULL,
    "quotation_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "comparable_total" DECIMAL(18,2),
    "exchange_rate_id" UUID,
    "total_score" DECIMAL(9,4),
    "score_breakdown" JSONB,
    "blockers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "exclusion_reason" VARCHAR(1000),
    "scored_at" TIMESTAMPTZ(6),
    "scored_by" UUID,

    CONSTRAINT "quotation_evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_score" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "quotation_evaluation_id" UUID NOT NULL,
    "criterion_key" VARCHAR(40) NOT NULL,
    "source" "CriterionSource" NOT NULL,
    "weight_percent" DECIMAL(5,2) NOT NULL,
    "raw_value" VARCHAR(40),
    "normalized_score" DECIMAL(9,4),
    "weighted_score" DECIMAL(9,4),
    "missing" BOOLEAN NOT NULL DEFAULT false,
    "note" VARCHAR(1000),
    "scored_by" UUID,
    "scored_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluation_score_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conflict_of_interest_declaration" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "evaluation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "has_conflict" BOOLEAN NOT NULL,
    "details" VARCHAR(2000),
    "declared_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conflict_of_interest_declaration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_note" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "evaluation_id" UUID NOT NULL,
    "note" VARCHAR(2000) NOT NULL,
    "author_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluation_note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_award" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "award_no" VARCHAR(64) NOT NULL,
    "rfq_id" UUID NOT NULL,
    "evaluation_id" UUID NOT NULL,
    "status" "AwardStatus" NOT NULL DEFAULT 'DRAFT',
    "status_reason" VARCHAR(2000),
    "award_type" "AwardType" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "total_awarded_value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "rationale" VARCHAR(4000) NOT NULL,
    "expired_exception" VARCHAR(1000),
    "approval_instance_id" UUID,
    "recommended_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recommended_by" UUID NOT NULL,
    "approved_at" TIMESTAMPTZ(6),
    "awarded_at" TIMESTAMPTZ(6),
    "snapshot" JSONB,
    "award_document_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rfq_award_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_award_line" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "award_id" UUID NOT NULL,
    "rfq_line_id" UUID NOT NULL,
    "quotation_id" UUID NOT NULL,
    "quotation_version_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "tax_treatment" "TaxTreatment" NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "discount_percent" DECIMAL(5,2) NOT NULL,
    "tax_rate" DECIMAL(5,2) NOT NULL,
    "line_total" DECIMAL(18,2) NOT NULL,
    "comparable_total" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "rfq_award_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_award_event" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "award_id" UUID NOT NULL,
    "from_status" "AwardStatus",
    "to_status" "AwardStatus" NOT NULL,
    "reason" VARCHAR(2000),
    "actor_id" UUID,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfq_award_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exchange_rate_company_id_base_currency_quote_currency_idx" ON "exchange_rate"("company_id", "base_currency", "quote_currency");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rate_company_id_base_currency_quote_currency_rate__key" ON "exchange_rate"("company_id", "base_currency", "quote_currency", "rate_timestamp");

-- CreateIndex
CREATE INDEX "evaluation_criteria_set_company_id_status_idx" ON "evaluation_criteria_set"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_criteria_set_company_id_name_set_version_key" ON "evaluation_criteria_set"("company_id", "name", "set_version");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_criteria_set_company_id_id_key" ON "evaluation_criteria_set"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_criterion_set_id_key_key" ON "evaluation_criterion"("set_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "rfq_evaluation_rfq_id_key" ON "rfq_evaluation"("rfq_id");

-- CreateIndex
CREATE UNIQUE INDEX "rfq_evaluation_company_id_rfq_id_key" ON "rfq_evaluation"("company_id", "rfq_id");

-- CreateIndex
CREATE UNIQUE INDEX "rfq_evaluation_company_id_id_key" ON "rfq_evaluation"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_evaluation_evaluation_id_quotation_id_key" ON "quotation_evaluation"("evaluation_id", "quotation_id");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_score_quotation_evaluation_id_criterion_key_key" ON "evaluation_score"("quotation_evaluation_id", "criterion_key");

-- CreateIndex
CREATE UNIQUE INDEX "conflict_of_interest_declaration_evaluation_id_user_id_key" ON "conflict_of_interest_declaration"("evaluation_id", "user_id");

-- CreateIndex
CREATE INDEX "evaluation_note_evaluation_id_occurred_at_idx" ON "evaluation_note"("evaluation_id", "occurred_at");

-- CreateIndex
CREATE INDEX "rfq_award_company_id_status_idx" ON "rfq_award"("company_id", "status");

-- CreateIndex
CREATE INDEX "rfq_award_rfq_id_idx" ON "rfq_award"("rfq_id");

-- CreateIndex
CREATE UNIQUE INDEX "rfq_award_company_id_award_no_key" ON "rfq_award"("company_id", "award_no");

-- CreateIndex
CREATE UNIQUE INDEX "rfq_award_company_id_id_key" ON "rfq_award"("company_id", "id");

-- CreateIndex
CREATE INDEX "rfq_award_line_quotation_id_idx" ON "rfq_award_line"("quotation_id");

-- CreateIndex
CREATE UNIQUE INDEX "rfq_award_line_award_id_rfq_line_id_key" ON "rfq_award_line"("award_id", "rfq_line_id");

-- CreateIndex
CREATE INDEX "rfq_award_event_award_id_occurred_at_idx" ON "rfq_award_event"("award_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "exchange_rate" ADD CONSTRAINT "exchange_rate_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rate" ADD CONSTRAINT "exchange_rate_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_criteria_set" ADD CONSTRAINT "evaluation_criteria_set_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_criteria_set" ADD CONSTRAINT "evaluation_criteria_set_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_criterion" ADD CONSTRAINT "evaluation_criterion_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "evaluation_criteria_set"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_evaluation" ADD CONSTRAINT "rfq_evaluation_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_evaluation" ADD CONSTRAINT "rfq_evaluation_company_id_rfq_id_fkey" FOREIGN KEY ("company_id", "rfq_id") REFERENCES "rfq"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_evaluation" ADD CONSTRAINT "rfq_evaluation_criteria_set_id_fkey" FOREIGN KEY ("criteria_set_id") REFERENCES "evaluation_criteria_set"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_evaluation" ADD CONSTRAINT "rfq_evaluation_started_by_fkey" FOREIGN KEY ("started_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_evaluation" ADD CONSTRAINT "quotation_evaluation_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "rfq_evaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_evaluation" ADD CONSTRAINT "quotation_evaluation_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_evaluation" ADD CONSTRAINT "quotation_evaluation_exchange_rate_id_fkey" FOREIGN KEY ("exchange_rate_id") REFERENCES "exchange_rate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_score" ADD CONSTRAINT "evaluation_score_quotation_evaluation_id_fkey" FOREIGN KEY ("quotation_evaluation_id") REFERENCES "quotation_evaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_score" ADD CONSTRAINT "evaluation_score_scored_by_fkey" FOREIGN KEY ("scored_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict_of_interest_declaration" ADD CONSTRAINT "conflict_of_interest_declaration_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict_of_interest_declaration" ADD CONSTRAINT "conflict_of_interest_declaration_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "rfq_evaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict_of_interest_declaration" ADD CONSTRAINT "conflict_of_interest_declaration_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_note" ADD CONSTRAINT "evaluation_note_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "rfq_evaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_note" ADD CONSTRAINT "evaluation_note_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_award" ADD CONSTRAINT "rfq_award_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_award" ADD CONSTRAINT "rfq_award_company_id_rfq_id_fkey" FOREIGN KEY ("company_id", "rfq_id") REFERENCES "rfq"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_award" ADD CONSTRAINT "rfq_award_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "rfq_evaluation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_award" ADD CONSTRAINT "rfq_award_recommended_by_fkey" FOREIGN KEY ("recommended_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_award" ADD CONSTRAINT "rfq_award_approval_instance_id_fkey" FOREIGN KEY ("approval_instance_id") REFERENCES "approval_instance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_award" ADD CONSTRAINT "rfq_award_award_document_id_fkey" FOREIGN KEY ("award_document_id") REFERENCES "document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_award_line" ADD CONSTRAINT "rfq_award_line_award_id_fkey" FOREIGN KEY ("award_id") REFERENCES "rfq_award"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_award_line" ADD CONSTRAINT "rfq_award_line_rfq_line_id_fkey" FOREIGN KEY ("rfq_line_id") REFERENCES "rfq_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_award_line" ADD CONSTRAINT "rfq_award_line_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_award_line" ADD CONSTRAINT "rfq_award_line_quotation_version_id_fkey" FOREIGN KEY ("quotation_version_id") REFERENCES "quotation_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_award_line" ADD CONSTRAINT "rfq_award_line_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_award_event" ADD CONSTRAINT "rfq_award_event_award_id_fkey" FOREIGN KEY ("award_id") REFERENCES "rfq_award"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_award_event" ADD CONSTRAINT "rfq_award_event_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ───────────────────────── Integrity (Phase 04) ─────────────────────────
--
-- The application enforces these too; they are repeated here so a bug, a
-- migration or a direct SQL session cannot leave the evaluation trail in a
-- state the engine would later have to guess about.

-- A quotation's grand total depends on its tax treatment: an inclusive quote
-- already contains the tax, so adding it again would double-count. The Phase 03
-- constraint assumed every quote was tax-extra.
ALTER TABLE "quotation_version" DROP CONSTRAINT "quotation_version_grand_total_chk";
ALTER TABLE "quotation_version"
  ADD CONSTRAINT "quotation_version_grand_total_chk" CHECK (
    "grand_total" = CASE
      WHEN "tax_treatment" = 'EXCLUSIVE' THEN "subtotal" - "discount_total" + "tax_total" + "freight" + "other_charges"
      ELSE "subtotal" - "discount_total" + "freight" + "other_charges"
    END
  );

ALTER TABLE "exchange_rate"
  ADD CONSTRAINT "exchange_rate_positive_chk" CHECK ("rate" > 0),
  ADD CONSTRAINT "exchange_rate_currency_chk" CHECK ("base_currency" ~ '^[A-Z]{3}$' AND "quote_currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "exchange_rate_distinct_chk" CHECK ("base_currency" <> "quote_currency");

ALTER TABLE "evaluation_criterion"
  ADD CONSTRAINT "evaluation_criterion_weight_chk" CHECK ("weight_percent" >= 0 AND "weight_percent" <= 100),
  ADD CONSTRAINT "evaluation_criterion_key_chk" CHECK ("key" ~ '^[A-Z][A-Z0-9_]{1,39}$');

ALTER TABLE "evaluation_criteria_set"
  ADD CONSTRAINT "criteria_set_version_chk" CHECK ("set_version" >= 1),
  ADD CONSTRAINT "criteria_set_published_chk" CHECK ("status" = 'DRAFT' OR "published_at" IS NOT NULL);

ALTER TABLE "rfq_evaluation"
  ADD CONSTRAINT "rfq_evaluation_currency_chk" CHECK ("basis_currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "rfq_evaluation_completed_chk" CHECK ("status" <> 'COMPLETED' OR ("completed_at" IS NOT NULL AND "completed_by" IS NOT NULL));

ALTER TABLE "quotation_evaluation"
  ADD CONSTRAINT "quotation_evaluation_version_chk" CHECK ("version_no" >= 1),
  ADD CONSTRAINT "quotation_evaluation_score_chk" CHECK ("total_score" IS NULL OR ("total_score" >= 0 AND "total_score" <= 100)),
  ADD CONSTRAINT "quotation_evaluation_excluded_chk" CHECK (NOT "excluded" OR "exclusion_reason" IS NOT NULL);

ALTER TABLE "evaluation_score"
  ADD CONSTRAINT "evaluation_score_weight_chk" CHECK ("weight_percent" >= 0 AND "weight_percent" <= 100),
  ADD CONSTRAINT "evaluation_score_normalized_chk" CHECK ("normalized_score" IS NULL OR ("normalized_score" >= 0 AND "normalized_score" <= 100)),
  ADD CONSTRAINT "evaluation_score_weighted_chk" CHECK ("weighted_score" IS NULL OR ("weighted_score" >= 0 AND "weighted_score" <= 100)),
  -- A missing figure carries no score, and a present one is always scored.
  ADD CONSTRAINT "evaluation_score_missing_chk" CHECK (("missing" AND "raw_value" IS NULL) OR (NOT "missing" AND "normalized_score" IS NOT NULL));

ALTER TABLE "conflict_of_interest_declaration"
  ADD CONSTRAINT "conflict_declaration_details_chk" CHECK (NOT "has_conflict" OR "details" IS NOT NULL);

ALTER TABLE "rfq_award"
  ADD CONSTRAINT "rfq_award_currency_chk" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "rfq_award_value_chk" CHECK ("total_awarded_value" >= 0),
  -- An issued award must carry its approval, its timestamps and its frozen snapshot.
  ADD CONSTRAINT "rfq_award_issued_chk" CHECK (
    "status" <> 'AWARDED' OR ("awarded_at" IS NOT NULL AND "approved_at" IS NOT NULL AND "snapshot" IS NOT NULL)
  ),
  ADD CONSTRAINT "rfq_award_approved_chk" CHECK ("status" NOT IN ('APPROVED', 'AWARDED') OR "approval_instance_id" IS NOT NULL);

ALTER TABLE "rfq_award_line"
  ADD CONSTRAINT "rfq_award_line_qty_chk" CHECK ("quantity" > 0),
  ADD CONSTRAINT "rfq_award_line_price_chk" CHECK ("unit_price" >= 0),
  ADD CONSTRAINT "rfq_award_line_rates_chk" CHECK ("discount_percent" BETWEEN 0 AND 100 AND "tax_rate" BETWEEN 0 AND 100),
  ADD CONSTRAINT "rfq_award_line_totals_chk" CHECK ("line_total" >= 0 AND "comparable_total" >= 0),
  ADD CONSTRAINT "rfq_award_line_currency_chk" CHECK ("currency" ~ '^[A-Z]{3}$');

-- A line's arithmetic depends on its tax basis in the same way as the document
-- total: an inclusive line extracts the tax out of the discounted value, so its
-- taxable amount is below gross - discount by exactly the tax.
ALTER TABLE "quotation_version_line" DROP CONSTRAINT "quotation_line_total_chk";
ALTER TABLE "quotation_version_line"
  ADD CONSTRAINT "quotation_line_total_chk" CHECK (
    "total" = "taxable" + "tax"
    AND CASE
      WHEN "tax_treatment" = 'EXCLUSIVE' THEN "taxable" = "gross" - "discount"
      ELSE "taxable" + "tax" = "gross" - "discount"
    END
  );

-- Append-only trails (kk_reject_mutation is defined by the foundation migration).
CREATE TRIGGER rfq_award_event_append_only BEFORE UPDATE OR DELETE ON "rfq_award_event" FOR EACH ROW EXECUTE FUNCTION kk_reject_mutation();
CREATE TRIGGER evaluation_note_append_only BEFORE UPDATE OR DELETE ON "evaluation_note" FOR EACH ROW EXECUTE FUNCTION kk_reject_mutation();
CREATE TRIGGER conflict_declaration_append_only BEFORE UPDATE OR DELETE ON "conflict_of_interest_declaration" FOR EACH ROW EXECUTE FUNCTION kk_reject_mutation();
-- A rate that was used to value an award is evidence; correcting one means recording a new rate.
CREATE TRIGGER exchange_rate_append_only BEFORE UPDATE OR DELETE ON "exchange_rate" FOR EACH ROW EXECUTE FUNCTION kk_reject_mutation();

-- An awarded award is a commercial commitment: neither it nor its lines may be
-- edited afterwards. Cancellation of an issued award is a new document, not an
-- update of this one.
CREATE OR REPLACE FUNCTION kk_award_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'AWARDED' THEN
    RAISE EXCEPTION 'rfq_award % is awarded and immutable: % is not permitted', OLD.id, TG_OP USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER rfq_award_immutable BEFORE UPDATE OR DELETE ON "rfq_award" FOR EACH ROW EXECUTE FUNCTION kk_award_immutable();

CREATE OR REPLACE FUNCTION kk_award_line_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_status "AwardStatus";
BEGIN
  SELECT status INTO current_status FROM rfq_award WHERE id = COALESCE(NEW.award_id, OLD.award_id);
  IF current_status IN ('AWARDED', 'PENDING_APPROVAL', 'APPROVED') THEN
    RAISE EXCEPTION 'lines of a % award are immutable: % is not permitted', current_status, TG_OP USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER rfq_award_line_immutable BEFORE INSERT OR UPDATE OR DELETE ON "rfq_award_line" FOR EACH ROW EXECUTE FUNCTION kk_award_line_immutable();

-- An RFQ has at most one award that is still live. A rejected or cancelled
-- recommendation may be replaced; an issued one may not.
CREATE UNIQUE INDEX "rfq_award_one_live_key" ON "rfq_award" ("rfq_id") WHERE "status" NOT IN ('REJECTED', 'CANCELLED');

-- Exactly one default criteria set per company, and one ACTIVE version per name.
CREATE UNIQUE INDEX "criteria_set_one_default_key" ON "evaluation_criteria_set" ("company_id") WHERE "is_default" AND "status" = 'ACTIVE';
CREATE UNIQUE INDEX "criteria_set_one_active_key" ON "evaluation_criteria_set" ("company_id", "name") WHERE "status" = 'ACTIVE';
