-- Reverts 20261116100000_requisitions_sourcing.
-- WARNING: drops all requisition/RFQ/quotation data. Development rollback / CI gate only.
DROP TABLE IF EXISTS "quotation_review" CASCADE;
DROP TABLE IF EXISTS "quotation_version_line" CASCADE;
DROP TABLE IF EXISTS "quotation_version" CASCADE;
DROP TABLE IF EXISTS "quotation" CASCADE;
DROP TABLE IF EXISTS "rfq_status_history" CASCADE;
DROP TABLE IF EXISTS "rfq_communication" CASCADE;
DROP TABLE IF EXISTS "rfq_invitation" CASCADE;
DROP TABLE IF EXISTS "rfq_line" CASCADE;
DROP TABLE IF EXISTS "rfq" CASCADE;
DROP TABLE IF EXISTS "requisition_status_history" CASCADE;
DROP TABLE IF EXISTS "requisition_line" CASCADE;
DROP TABLE IF EXISTS "purchase_requisition" CASCADE;
DROP FUNCTION IF EXISTS kk_quotation_line_immutable();
DROP FUNCTION IF EXISTS kk_quotation_version_immutable();
DROP TYPE IF EXISTS "QuotationReceivedVia";
DROP TYPE IF EXISTS "QuotationStatus";
DROP TYPE IF EXISTS "RfqInvitationStatus";
DROP TYPE IF EXISTS "RfqStatus";
DROP TYPE IF EXISTS "SourcingRoute";
DROP TYPE IF EXISTS "LineItemType";
DROP TYPE IF EXISTS "RequisitionPriority";
DROP TYPE IF EXISTS "RequisitionStatus";
