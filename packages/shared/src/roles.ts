import { PERMISSION_KEYS, type PermissionKey, type PermissionScope } from './permissions';

/**
 * System role templates. These are seeded per company as non-deletable system
 * roles. Companies may add custom roles; system roles' grants are versioned with
 * the code base and re-synchronised by the seed.
 *
 * Design rules encoded here:
 *  - Administrators configure the system but do NOT hold sensitive financial
 *    actions (payment approval/release, bank-detail approval) — PRD §2.
 *  - Payment maker (payment.create) and checker (payment.approve/release) are
 *    split across roles; the approval engine additionally prevents the same
 *    user acting as both on one record.
 *  - Auditors are read-only and never receive unmasked bank details by default.
 */

export const SYSTEM_ROLE_KEYS = [
  'SUPER_ADMIN',
  'COMPANY_ADMIN',
  'PROCUREMENT_MANAGER',
  'PROCUREMENT_EXECUTIVE',
  'FINANCE_MANAGER',
  'FINANCE_EXECUTIVE',
  'DEPARTMENT_HEAD',
  'REQUESTER',
  'APPROVER',
  'AUDITOR',
  'READ_ONLY_MANAGEMENT',
] as const;

export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

export type RoleGrants = Partial<Record<PermissionKey, PermissionScope>>;

export interface SystemRoleDefinition {
  key: SystemRoleKey;
  name: string;
  description: string;
  grants: RoleGrants;
}

const C: PermissionScope = 'COMPANY';
const D: PermissionScope = 'DEPARTMENT';
const O: PermissionScope = 'OWN';

const all = (keys: readonly PermissionKey[], scope: PermissionScope = C): RoleGrants => Object.fromEntries(keys.map((k) => [k, scope])) as RoleGrants;

const READ_KEYS = PERMISSION_KEYS.filter((k) => k.endsWith('.read') && k !== 'vendor.bank.read');

export const SYSTEM_ROLES: Record<SystemRoleKey, SystemRoleDefinition> = {
  SUPER_ADMIN: {
    key: 'SUPER_ADMIN',
    name: 'Super Admin',
    description: 'Unrestricted platform administration, including company creation. Assign sparingly.',
    grants: all(PERMISSION_KEYS),
  },
  COMPANY_ADMIN: {
    key: 'COMPANY_ADMIN',
    name: 'Company Admin',
    description: 'Configures users, roles, organisation, policies and integrations for one company. Holds no financial release authority.',
    grants: {
      'org.company.read': C,
      'org.company.manage': C,
      'org.department.read': C,
      'org.department.manage': C,
      'org.cost_centre.read': C,
      'org.cost_centre.manage': C,
      'user.read': C,
      'user.invite': C,
      'user.manage': C,
      'user.session.revoke': C,
      'role.read': C,
      'role.manage': C,
      'role.assign': C,
      'audit.read': C,
      'approval.policy.read': C,
      'approval.policy.manage': C,
      'approval.instance.read': C,
      'approval.delegation.admin': C,
      'numbering.read': C,
      'numbering.manage': C,
      'integration.read': C,
      'integration.manage': C,
      'document.upload': C,
      'document.read': C,
    },
  },
  PROCUREMENT_MANAGER: {
    key: 'PROCUREMENT_MANAGER',
    name: 'Procurement Manager',
    description: 'Owns sourcing and purchasing: vendors, RFQs, quotation awards and purchase orders.',
    grants: {
      'org.company.read': C,
      'org.department.read': C,
      'org.cost_centre.read': C,
      'user.read': C,
      'approval.policy.read': C,
      'approval.task.act': C,
      'approval.delegation.manage': C,
      'document.upload': C,
      'document.read': C,
      'vendor.read': C,
      'vendor.create': C,
      'vendor.update': C,
      'vendor.approve': C,
      'vendor.bank.update': C,
      'requisition.create': C,
      'requisition.read': C,
      'requisition.approve': C,
      'rfq.read': C,
      'rfq.manage': C,
      'quotation.read': C,
      'quotation.manage': C,
      'quotation.award': C,
      'po.read': C,
      'po.create': C,
      'po.approve': C,
      'grn.read': C,
      'grn.create': C,
      'report.read': C,
    },
  },
  PROCUREMENT_EXECUTIVE: {
    key: 'PROCUREMENT_EXECUTIVE',
    name: 'Procurement Executive',
    description: 'Executes sourcing: vendor drafts, RFQs, quotation capture, PO drafts and receipts.',
    grants: {
      'org.company.read': C,
      'org.department.read': C,
      'org.cost_centre.read': C,
      'user.read': C,
      'document.upload': C,
      'document.read': C,
      'vendor.read': C,
      'vendor.create': C,
      'vendor.update': C,
      'vendor.bank.update': C,
      'requisition.create': C,
      'requisition.read': C,
      'rfq.read': C,
      'rfq.manage': C,
      'quotation.read': C,
      'quotation.manage': C,
      'po.read': C,
      'po.create': C,
      'grn.read': C,
      'grn.create': C,
    },
  },
  FINANCE_MANAGER: {
    key: 'FINANCE_MANAGER',
    name: 'Finance Manager',
    description: 'Approves invoices and payments within limits; checker for payment release and bank-detail changes.',
    grants: {
      'org.company.read': C,
      'org.department.read': C,
      'org.cost_centre.read': C,
      'user.read': C,
      'approval.policy.read': C,
      'approval.task.act': C,
      'approval.delegation.manage': C,
      'approval.instance.read': C,
      'document.upload': C,
      'document.read': C,
      'vendor.read': C,
      'vendor.bank.read': C,
      'vendor.bank.approve': C,
      'requisition.read': C,
      'po.read': C,
      'grn.read': C,
      'ap_invoice.read': C,
      'ap_invoice.create': C,
      'ap_invoice.approve': C,
      'ar_invoice.read': C,
      'ar_invoice.create': C,
      'ar_invoice.approve': C,
      'payment.read': C,
      'payment.approve': C,
      'payment.release': C,
      'report.read': C,
      'report.export': C,
    },
  },
  FINANCE_EXECUTIVE: {
    key: 'FINANCE_EXECUTIVE',
    name: 'Finance Executive',
    description: 'Registers and validates invoices and records payments (maker). Cannot approve or release payments.',
    grants: {
      'org.company.read': C,
      'org.department.read': C,
      'org.cost_centre.read': C,
      'document.upload': C,
      'document.read': C,
      'vendor.read': C,
      'vendor.bank.read': C,
      'po.read': C,
      'grn.read': C,
      'ap_invoice.read': C,
      'ap_invoice.create': C,
      'ar_invoice.read': C,
      'ar_invoice.create': C,
      'payment.read': C,
      'payment.create': C,
      'report.read': C,
    },
  },
  DEPARTMENT_HEAD: {
    key: 'DEPARTMENT_HEAD',
    name: 'Department Head',
    description: 'Validates business need and budget for their department; approves within delegated limits.',
    grants: {
      'org.company.read': C,
      'org.department.read': C,
      'org.cost_centre.read': C,
      'user.read': D,
      'approval.task.act': C,
      'approval.delegation.manage': C,
      'document.upload': C,
      'document.read': D,
      'requisition.create': C,
      'requisition.read': D,
      'requisition.approve': D,
      'po.read': D,
      'grn.read': D,
      'grn.create': D,
      'report.read': D,
    },
  },
  REQUESTER: {
    key: 'REQUESTER',
    name: 'Requester',
    description: 'Raises purchase requisitions and tracks their own requests. Cannot approve.',
    grants: {
      'org.company.read': C,
      'org.department.read': C,
      'org.cost_centre.read': C,
      'document.upload': C,
      'document.read': O,
      'requisition.create': C,
      'requisition.read': O,
      'grn.read': O,
      'grn.create': O,
    },
  },
  APPROVER: {
    key: 'APPROVER',
    name: 'Approver',
    description: 'Business approver for high-value or exceptional commitments routed by policy.',
    grants: {
      'org.company.read': C,
      'org.department.read': C,
      'approval.task.act': C,
      'approval.delegation.manage': C,
      'document.read': C,
      'report.read': C,
    },
  },
  AUDITOR: {
    key: 'AUDITOR',
    name: 'Auditor',
    description: 'Read-only inspection of transactions, approvals, evidence and audit trails. Assign time-bound.',
    grants: { ...all(READ_KEYS), 'audit.read': C },
  },
  READ_ONLY_MANAGEMENT: {
    key: 'READ_ONLY_MANAGEMENT',
    name: 'Read-only Management',
    description: 'Management visibility into dashboards, commitments and approvals without edit rights.',
    grants: {
      'org.company.read': C,
      'org.department.read': C,
      'org.cost_centre.read': C,
      'approval.instance.read': C,
      'vendor.read': C,
      'requisition.read': C,
      'po.read': C,
      'ap_invoice.read': C,
      'ar_invoice.read': C,
      'payment.read': C,
      'report.read': C,
    },
  },
};
