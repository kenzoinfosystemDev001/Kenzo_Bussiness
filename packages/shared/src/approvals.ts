/** Business entity types that may be routed through the approval engine. */
export const APPROVAL_ENTITY_TYPES = [
  'purchase_requisition',
  'vendor',
  'vendor_bank_change',
  'rfq',
  'rfq_award',
  'purchase_order',
  'ap_invoice',
  'ar_invoice',
  'payment',
] as const;
export type ApprovalEntityType = (typeof APPROVAL_ENTITY_TYPES)[number];

export const APPROVAL_ENTITY_LABELS: Record<ApprovalEntityType, string> = {
  purchase_requisition: 'Purchase requisition',
  vendor: 'Vendor onboarding',
  vendor_bank_change: 'Vendor bank-detail change',
  rfq: 'Standalone RFQ',
  rfq_award: 'Quotation award',
  purchase_order: 'Purchase order',
  ap_invoice: 'Vendor invoice (AP)',
  ar_invoice: 'Customer invoice (AR)',
  payment: 'Payment release',
};

/** How the approvers within a single stage combine. */
export const STAGE_MODES = ['ANY', 'ALL'] as const;
export type StageMode = (typeof STAGE_MODES)[number];

/** How a stage resolves its approvers at submission time. */
export const APPROVER_TYPES = ['ROLE', 'USER', 'DEPARTMENT_HEAD', 'REQUESTER_MANAGER'] as const;
export type ApproverType = (typeof APPROVER_TYPES)[number];

export const APPROVAL_DECISIONS = ['APPROVE', 'REJECT', 'RETURN'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export const APPROVAL_INSTANCE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED'] as const;
export type ApprovalInstanceStatus = (typeof APPROVAL_INSTANCE_STATUSES)[number];

export const APPROVAL_TASK_STATUSES = ['WAITING', 'PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'SKIPPED', 'CANCELLED'] as const;
export type ApprovalTaskStatus = (typeof APPROVAL_TASK_STATUSES)[number];

/** Document types that draw from numbering series. */
export const NUMBERED_DOCUMENT_TYPES = [
  'vendor',
  'purchase_requisition',
  'rfq',
  'quotation',
  'purchase_order',
  'goods_receipt',
  'service_acceptance',
  'ap_invoice',
  'ar_invoice',
  'credit_note',
  'debit_note',
  'payment',
] as const;
export type NumberedDocumentType = (typeof NUMBERED_DOCUMENT_TYPES)[number];

export const DEFAULT_NUMBER_PREFIXES: Record<NumberedDocumentType, string> = {
  vendor: 'VEN',
  purchase_requisition: 'PR',
  rfq: 'RFQ',
  quotation: 'QTN',
  purchase_order: 'PO',
  goods_receipt: 'GRN',
  service_acceptance: 'SAN',
  ap_invoice: 'APINV',
  ar_invoice: 'INV',
  credit_note: 'CN',
  debit_note: 'DN',
  payment: 'PAY',
};
