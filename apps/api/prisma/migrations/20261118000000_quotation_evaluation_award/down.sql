-- Reverts 20261118000000_quotation_evaluation_award.
-- WARNING: drops all evaluation and award data. Development rollback / CI gate only.
DROP TABLE IF EXISTS "rfq_award_event" CASCADE;
DROP TABLE IF EXISTS "rfq_award_line" CASCADE;
DROP TABLE IF EXISTS "rfq_award" CASCADE;
DROP TABLE IF EXISTS "evaluation_note" CASCADE;
DROP TABLE IF EXISTS "conflict_of_interest_declaration" CASCADE;
DROP TABLE IF EXISTS "evaluation_score" CASCADE;
DROP TABLE IF EXISTS "quotation_evaluation" CASCADE;
DROP TABLE IF EXISTS "rfq_evaluation" CASCADE;
DROP TABLE IF EXISTS "evaluation_criterion" CASCADE;
DROP TABLE IF EXISTS "evaluation_criteria_set" CASCADE;
DROP TABLE IF EXISTS "exchange_rate" CASCADE;

DROP FUNCTION IF EXISTS kk_award_line_immutable();
DROP FUNCTION IF EXISTS kk_award_immutable();

-- Restore the Phase 03 columns and the tax-exclusive total identity they assumed.
ALTER TABLE "quotation_version" DROP CONSTRAINT IF EXISTS "quotation_version_grand_total_chk";
ALTER TABLE "quotation_version_line" DROP CONSTRAINT IF EXISTS "quotation_line_total_chk";
ALTER TABLE "quotation_version_line" DROP COLUMN IF EXISTS "tax_treatment";
ALTER TABLE "quotation_version_line"
  ADD CONSTRAINT "quotation_line_total_chk" CHECK ("total" = "taxable" + "tax" AND "taxable" = "gross" - "discount");
ALTER TABLE "quotation_version" DROP COLUMN IF EXISTS "tax_treatment";
ALTER TABLE "quotation_version"
  ADD CONSTRAINT "quotation_version_grand_total_chk"
  CHECK ("grand_total" = "subtotal" - "discount_total" + "tax_total" + "freight" + "other_charges");
ALTER TABLE "rfq" DROP COLUMN IF EXISTS "allow_partial_award";

DROP TYPE IF EXISTS "TaxTreatment";
DROP TYPE IF EXISTS "AwardType";
DROP TYPE IF EXISTS "AwardStatus";
DROP TYPE IF EXISTS "EvaluationStatus";
DROP TYPE IF EXISTS "CriterionDirection";
DROP TYPE IF EXISTS "CriterionSource";
DROP TYPE IF EXISTS "CriteriaSetStatus";
