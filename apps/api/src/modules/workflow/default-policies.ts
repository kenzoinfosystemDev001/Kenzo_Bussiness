import type { ApprovalEntityType, ApproverType, StageMode } from '@kenzo/shared';

export interface PolicyStageTemplate {
  sequence: number;
  name: string;
  mode: StageMode;
  minApprovals?: number;
  minAmount?: string;
  maxAmount?: string;
  approverType: ApproverType;
  approverRoleKey?: string;
  slaHours?: number;
  escalationRoleKey?: string;
}

export interface PolicyTemplate {
  entityType: ApprovalEntityType;
  name: string;
  description: string;
  allowDelegation: boolean;
  stages: PolicyStageTemplate[];
}

/**
 * Starting points derived from the PRD §2.3 illustrative matrix. They are
 * provisioned as DRAFT and must be reviewed by finance/directors before being
 * published — amounts are explicitly "illustrative only" in the PRD.
 *
 * Amount-banded stages: a stage applies when the request amount falls within
 * [minAmount, maxAmount]. E.g. ≤ ₹10,000 → manager; ₹10,001–₹50,000 → manager
 * then finance; > ₹50,000 → manager, finance, then director.
 */
export const DEFAULT_POLICY_TEMPLATES: PolicyTemplate[] = [
  {
    entityType: 'purchase_requisition',
    name: 'Purchase requisition approval (PRD example matrix)',
    description: 'Department head for all amounts; finance above ₹10,000; director-level approver above ₹50,000. Review thresholds before publishing.',
    allowDelegation: true,
    stages: [
      { sequence: 1, name: 'Department head', mode: 'ANY', approverType: 'DEPARTMENT_HEAD', slaHours: 48, escalationRoleKey: 'APPROVER' },
      { sequence: 2, name: 'Finance validation', mode: 'ANY', minAmount: '10000.01', approverType: 'ROLE', approverRoleKey: 'FINANCE_MANAGER', slaHours: 48 },
      { sequence: 3, name: 'Director approval', mode: 'ANY', minAmount: '50000.01', approverType: 'ROLE', approverRoleKey: 'APPROVER', slaHours: 72 },
    ],
  },
  {
    entityType: 'vendor',
    name: 'Vendor onboarding approval',
    description:
      'Procurement review of the business profile and documents, then finance verification of tax and bank details. The vendor creator is always excluded.',
    allowDelegation: true,
    stages: [
      {
        sequence: 1,
        name: 'Procurement review',
        mode: 'ANY',
        approverType: 'ROLE',
        approverRoleKey: 'PROCUREMENT_MANAGER',
        slaHours: 48,
        escalationRoleKey: 'APPROVER',
      },
      { sequence: 2, name: 'Finance verification (tax & bank)', mode: 'ANY', approverType: 'ROLE', approverRoleKey: 'FINANCE_MANAGER', slaHours: 48 },
    ],
  },
  {
    entityType: 'rfq',
    name: 'Standalone RFQ authorisation',
    description: 'An RFQ raised without an approved requisition needs procurement sign-off before it reaches vendors.',
    allowDelegation: true,
    stages: [
      { sequence: 1, name: 'Procurement authorisation', mode: 'ANY', approverType: 'ROLE', approverRoleKey: 'PROCUREMENT_MANAGER', slaHours: 24, escalationRoleKey: 'APPROVER' },
    ],
  },
  {
    entityType: 'vendor_bank_change',
    name: 'Vendor bank-detail change (maker-checker)',
    description: 'Vendor master reviewer then finance approver. The proposer and the vendor creator are always excluded.',
    allowDelegation: false,
    stages: [
      { sequence: 1, name: 'Vendor master review', mode: 'ANY', approverType: 'ROLE', approverRoleKey: 'PROCUREMENT_MANAGER', slaHours: 24 },
      { sequence: 2, name: 'Finance approval', mode: 'ANY', approverType: 'ROLE', approverRoleKey: 'FINANCE_MANAGER', slaHours: 24 },
    ],
  },
  {
    entityType: 'payment',
    name: 'Payment release (maker-checker)',
    description: 'Independent payment approver. The payment maker can never approve or release their own payment.',
    allowDelegation: false,
    stages: [{ sequence: 1, name: 'Independent payment approval', mode: 'ANY', approverType: 'ROLE', approverRoleKey: 'FINANCE_MANAGER', slaHours: 24 }],
  },
];
