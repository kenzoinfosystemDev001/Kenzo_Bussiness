/**
 * Permission catalogue — the single source of truth for every permission key
 * the platform recognises. The API seeds these into the `permission` table and
 * the authorization layer refuses any key not present here.
 *
 * Key format: `<resource>.<action>` (dot-separated, lower snake case segments).
 *
 * `scopable` permissions can be granted at OWN / DEPARTMENT / COMPANY scope.
 * Non-scopable permissions are always COMPANY scoped.
 *
 * `phase` records when the owning module ships. Permissions for future phases are
 * catalogued now so that role templates are complete and stable; the endpoints
 * that enforce them are delivered with their module.
 */

export const PERMISSION_SCOPES = ['OWN', 'DEPARTMENT', 'COMPANY'] as const;
export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

export const SCOPE_RANK: Record<PermissionScope, number> = {
  OWN: 1,
  DEPARTMENT: 2,
  COMPANY: 3,
};

export interface PermissionDefinition {
  module: string;
  description: string;
  /** Grants access to restricted data or high-consequence actions. Changes are always audited. */
  sensitive?: boolean;
  /** When the company enforces MFA for privileged actions, the session must be MFA-verified. */
  requiresMfa?: boolean;
  /** Supports OWN/DEPARTMENT/COMPANY scoping. */
  scopable?: boolean;
  phase: 1 | 2 | 3 | 4 | 5;
}

const p = (def: PermissionDefinition): PermissionDefinition => def;

export const PERMISSIONS = {
  // ── Platform ────────────────────────────────────────────────────────────
  'platform.company.create': p({ module: 'organization', description: 'Create new companies / legal entities', sensitive: true, requiresMfa: true, phase: 1 }),

  // ── Organization ────────────────────────────────────────────────────────
  'org.company.read': p({ module: 'organization', description: 'View company profile and settings', phase: 1 }),
  'org.company.manage': p({ module: 'organization', description: 'Update company profile, fiscal and security settings', sensitive: true, phase: 1 }),
  'org.department.read': p({ module: 'organization', description: 'View departments', phase: 1 }),
  'org.department.manage': p({ module: 'organization', description: 'Create and update departments', phase: 1 }),
  'org.cost_centre.read': p({ module: 'organization', description: 'View cost centres', phase: 1 }),
  'org.cost_centre.manage': p({ module: 'organization', description: 'Create and update cost centres', phase: 1 }),

  // ── Identity & access ───────────────────────────────────────────────────
  'user.read': p({ module: 'identity', description: 'View users', scopable: true, phase: 1 }),
  'user.invite': p({ module: 'identity', description: 'Invite new users', sensitive: true, phase: 1 }),
  'user.manage': p({ module: 'identity', description: 'Update, activate and deactivate users', sensitive: true, phase: 1 }),
  'user.session.revoke': p({ module: 'identity', description: "Revoke other users' sessions", sensitive: true, phase: 1 }),
  'role.read': p({ module: 'identity', description: 'View roles and the permission matrix', phase: 1 }),
  'role.manage': p({ module: 'identity', description: 'Create and edit custom roles', sensitive: true, requiresMfa: true, phase: 1 }),
  'role.assign': p({ module: 'identity', description: 'Assign and revoke roles for users', sensitive: true, requiresMfa: true, phase: 1 }),

  // ── Audit ───────────────────────────────────────────────────────────────
  'audit.read': p({ module: 'audit', description: 'View the audit log', sensitive: true, phase: 1 }),

  // ── Approvals / workflow ───────────────────────────────────────────────
  'approval.policy.read': p({ module: 'workflow', description: 'View approval policies', phase: 1 }),
  'approval.policy.manage': p({
    module: 'workflow',
    description: 'Create, version and publish approval policies',
    sensitive: true,
    requiresMfa: true,
    phase: 1,
  }),
  'approval.task.act': p({ module: 'workflow', description: 'Act on approval tasks assigned to you', phase: 1 }),
  'approval.instance.read': p({ module: 'workflow', description: 'View all approval instances in the company', phase: 1 }),
  'approval.delegation.manage': p({ module: 'workflow', description: 'Delegate your approval authority', phase: 1 }),
  'approval.delegation.admin': p({ module: 'workflow', description: "Manage other users' delegations and run escalations", sensitive: true, phase: 1 }),

  // ── Shared infrastructure ──────────────────────────────────────────────
  'numbering.read': p({ module: 'numbering', description: 'View numbering series', phase: 1 }),
  'numbering.manage': p({ module: 'numbering', description: 'Configure numbering series', sensitive: true, phase: 1 }),
  'integration.read': p({ module: 'integrations', description: 'View integration configuration', phase: 1 }),
  'integration.manage': p({ module: 'integrations', description: 'Configure integrations', sensitive: true, requiresMfa: true, phase: 1 }),
  'document.upload': p({ module: 'documents', description: 'Upload documents', phase: 1 }),
  'document.read': p({ module: 'documents', description: 'Download documents', scopable: true, phase: 1 }),

  // ── Vendors (Phase 2) ──────────────────────────────────────────────────
  'vendor.read': p({ module: 'vendors', description: 'View vendor master', phase: 2 }),
  'vendor.create': p({ module: 'vendors', description: 'Create vendor drafts', phase: 2 }),
  'vendor.update': p({ module: 'vendors', description: 'Edit vendor master data', phase: 2 }),
  'vendor.approve': p({ module: 'vendors', description: 'Approve, activate or suspend vendors', sensitive: true, phase: 2 }),
  'vendor.bank.read': p({ module: 'vendors', description: 'Reveal unmasked vendor bank and tax identifiers', sensitive: true, requiresMfa: true, phase: 2 }),
  'vendor.bank.update': p({ module: 'vendors', description: 'Propose vendor bank detail changes', sensitive: true, phase: 2 }),
  'vendor.bank.approve': p({ module: 'vendors', description: 'Approve vendor bank detail changes', sensitive: true, requiresMfa: true, phase: 2 }),

  // ── Requisitions & sourcing (Phase 3) ──────────────────────────────────
  'requisition.create': p({ module: 'requisitions', description: 'Raise purchase requisitions', phase: 3 }),
  'requisition.read': p({ module: 'requisitions', description: 'View purchase requisitions', scopable: true, phase: 3 }),
  'requisition.approve': p({ module: 'requisitions', description: 'Approve purchase requisitions', scopable: true, phase: 3 }),
  'rfq.read': p({ module: 'sourcing', description: 'View RFQs', phase: 3 }),
  'rfq.standalone': p({ module: 'sourcing', description: 'Create RFQs without an approved requisition (subject to approval)', sensitive: true, phase: 3 }),
  'rfq.manage': p({ module: 'sourcing', description: 'Create and publish RFQs', phase: 3 }),
  'quotation.read': p({ module: 'sourcing', description: 'View vendor quotations and comparisons', phase: 3 }),
  'quotation.manage': p({ module: 'sourcing', description: 'Capture quotations and evaluations', phase: 3 }),
  'quotation.award': p({ module: 'sourcing', description: 'Recommend and award quotations', sensitive: true, phase: 3 }),

  // ── Procurement (Phase 4) ──────────────────────────────────────────────
  'po.read': p({ module: 'procurement', description: 'View purchase orders', scopable: true, phase: 4 }),
  'po.create': p({ module: 'procurement', description: 'Create and revise purchase orders', phase: 4 }),
  'po.approve': p({ module: 'procurement', description: 'Approve purchase orders', sensitive: true, phase: 4 }),
  'grn.read': p({ module: 'procurement', description: 'View goods receipts and service acceptances', scopable: true, phase: 4 }),
  'grn.create': p({ module: 'procurement', description: 'Record goods receipts and service acceptance', scopable: true, phase: 4 }),

  // ── Billing & payments (Phase 5) ───────────────────────────────────────
  'ap_invoice.read': p({ module: 'billing-ap', description: 'View vendor invoices', phase: 5 }),
  'ap_invoice.create': p({ module: 'billing-ap', description: 'Register and validate vendor invoices', phase: 5 }),
  'ap_invoice.approve': p({ module: 'billing-ap', description: 'Approve vendor invoices', sensitive: true, phase: 5 }),
  'ar_invoice.read': p({ module: 'billing-ar', description: 'View customer invoices', phase: 5 }),
  'ar_invoice.create': p({ module: 'billing-ar', description: 'Draft customer invoices', phase: 5 }),
  'ar_invoice.approve': p({ module: 'billing-ar', description: 'Approve and issue customer invoices', sensitive: true, phase: 5 }),
  'payment.read': p({ module: 'payments', description: 'View payments and allocations', phase: 5 }),
  'payment.create': p({ module: 'payments', description: 'Record payment proposals (maker)', sensitive: true, phase: 5 }),
  'payment.approve': p({ module: 'payments', description: 'Approve payments (checker)', sensitive: true, requiresMfa: true, phase: 5 }),
  'payment.release': p({ module: 'payments', description: 'Mark payments released with evidence', sensitive: true, requiresMfa: true, phase: 5 }),

  // ── Reporting ──────────────────────────────────────────────────────────
  'report.read': p({ module: 'reporting', description: 'View dashboards and reports', scopable: true, phase: 5 }),
  'report.export': p({ module: 'reporting', description: 'Export report data', sensitive: true, phase: 5 }),
} as const satisfies Record<string, PermissionDefinition>;

export type PermissionKey = keyof typeof PERMISSIONS;

export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

export function isPermissionKey(value: string): value is PermissionKey {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}

export function isScopable(key: PermissionKey): boolean {
  return (PERMISSIONS[key] as PermissionDefinition).scopable === true;
}

/**
 * Administrative permissions control the platform itself (who can do what,
 * policies, configuration, the audit trail). Anti-escalation applies to these:
 * a user can only grant an administrative permission they hold themselves at
 * ≥ scope. Business permissions (vendors, requisitions, payments …) are
 * assignable by anyone holding `role.assign`; every grant is audited, and
 * record-level maker-checker rules still bind the grantee.
 */
const ADMIN_PREFIXES = [
  'platform.',
  'org.company.manage',
  'user.',
  'role.',
  'audit.',
  'approval.policy.manage',
  'approval.delegation.admin',
  'numbering.manage',
  'integration.manage',
];

export function isAdministrativePermission(key: PermissionKey): boolean {
  return ADMIN_PREFIXES.some((p) => (p.endsWith('.') ? key.startsWith(p) : key === p));
}

/** Returns the widest of two scopes. */
export function widerScope(a: PermissionScope, b: PermissionScope): PermissionScope {
  return SCOPE_RANK[a] >= SCOPE_RANK[b] ? a : b;
}
