-- Reverts 20261116000000_vendor_management.
-- WARNING: drops all vendor data. Development rollback / CI gate only;
-- production follows a forward-fix policy.
DROP TABLE IF EXISTS "vendor_status_history" CASCADE;
DROP TABLE IF EXISTS "vendor_document" CASCADE;
DROP TABLE IF EXISTS "vendor_bank_change_request" CASCADE;
DROP TABLE IF EXISTS "vendor_bank_account" CASCADE;
DROP TABLE IF EXISTS "vendor_contact" CASCADE;
DROP TABLE IF EXISTS "vendor" CASCADE;
DROP TYPE IF EXISTS "BankChangeStatus";
DROP TYPE IF EXISTS "BankAccountType";
DROP TYPE IF EXISTS "BankAccountStatus";
DROP TYPE IF EXISTS "DocumentVerificationStatus";
DROP TYPE IF EXISTS "VendorDocumentType";
DROP TYPE IF EXISTS "GstRegistrationType";
DROP TYPE IF EXISTS "VendorType";
DROP TYPE IF EXISTS "VendorStatus";
