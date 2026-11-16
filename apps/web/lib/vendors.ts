import {
  DOCUMENT_EXPIRY_WARNING_DAYS,
  VENDOR_TRANSITIONS,
  type BankAccountType,
  type DuplicateReason,
  type GstRegistrationType,
  type VendorDocumentType,
  type VendorStatus,
  type VendorType,
} from '@kenzo/shared';

/** Response shapes of `/api/v1/vendors/**` (apps/api/src/modules/vendors). */

export interface VendorRecord {
  id: string;
  companyId: string;
  vendorCode: string;
  legalName: string;
  tradeName: string | null;
  normalizedName: string;
  vendorType: VendorType;
  category: string;
  gstRegistrationType: GstRegistrationType;
  gstin: string | null;
  panMasked: string | null;
  hasPan: boolean;
  registrationNumber: string | null;
  msmeRegistered: boolean;
  msmeNumber: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  stateCode: string | null;
  postalCode: string;
  country: string;
  paymentTermsDays: number;
  preferredCurrency: string;
  internalNotes: string | null;
  status: VendorStatus;
  statusReason: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  activatedAt: string | null;
  suspendedAt: string | null;
  archivedAt: string | null;
  duplicateOverrideReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdById: string;
}

export interface VendorContact {
  id: string;
  name: string;
  designation: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}

export interface DocumentSummary {
  total: number;
  pending: number;
  rejected: number;
  expiring: number;
  expired: number;
}

export type BankStatus = 'VERIFIED' | 'PENDING' | 'NONE';

export interface VendorListItem extends VendorRecord {
  createdBy: { id: string; fullName: string };
  primaryContact: VendorContact | null;
  documentSummary: DocumentSummary;
  bankStatus: BankStatus;
}

export interface VendorListResponse {
  items: VendorListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface VendorStats {
  totals: { all: number; active: number; inReview: number; awaitingActivation: number; drafts: number; suspended: number; msme: number };
  byStatus: Record<VendorStatus, number>;
  byType: Array<{ vendorType: VendorType; count: number }>;
  byCategory: Array<{ category: string; count: number }>;
  byGstRegistration: Array<{ gstRegistrationType: GstRegistrationType; count: number }>;
  compliance: {
    documentsPendingVerification: number;
    documentsExpiringSoon: number;
    documentsExpired: number;
    bankChangesPending: number;
    warningDays: number;
  };
  trend: { months: string[]; created: number[]; activated: number[] };
  recent: Array<{ id: string; vendorCode: string; legalName: string; status: VendorStatus; category: string; city: string; updatedAt: string }>;
}

export interface DuplicateMatch {
  vendorId: string;
  vendorCode: string;
  legalName: string;
  tradeName: string | null;
  status: VendorStatus;
  city: string;
  gstin: string | null;
  reasons: DuplicateReason[];
  similarity: number;
  strong: boolean;
}

export type VerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

export interface VendorDocumentRow {
  id: string;
  vendorId: string;
  documentId: string;
  documentType: VendorDocumentType;
  title: string;
  documentNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  versionNo: number;
  previousVersionId: string | null;
  isCurrent: boolean;
  isExpired?: boolean;
  verificationStatus: VerificationStatus;
  verificationNote: string | null;
  verifiedAt: string | null;
  createdAt: string;
  document: { id?: string; originalName: string; mimeType: string; sizeBytes: number; scanStatus?: string };
  uploadedBy: { id: string; fullName: string };
  verifiedBy: { id: string; fullName: string } | null;
}

export type BankAccountStatus = 'PROPOSED' | 'ACTIVE' | 'SUPERSEDED' | 'REJECTED';

export interface BankAccountView {
  id: string;
  vendorId: string;
  accountHolderName: string;
  bankName: string;
  branchName: string | null;
  ifsc: string | null;
  swiftCode: string | null;
  accountType: BankAccountType;
  accountMasked: string;
  accountLast4: string;
  status: BankAccountStatus;
  verifiedAt: string | null;
  supersededAt: string | null;
  createdAt: string;
  verifiedBy?: { id: string; fullName: string } | null;
}

export type BankChangeStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'RETURNED' | 'CANCELLED';

export interface BankChangeRequest {
  id: string;
  vendorId: string;
  proposedAccountId: string;
  previousAccountId: string | null;
  reason: string;
  status: BankChangeStatus;
  outcomeReason: string | null;
  decidedAt: string | null;
  createdAt: string;
  requestedById: string;
  requestedBy: { id: string; fullName: string };
}

export interface BankQueueItem extends BankChangeRequest {
  vendor: { id: string; vendorCode: string; legalName: string; status: VendorStatus };
  proposedAccount: BankAccountView;
  previousAccount: BankAccountView | null;
  approval: { instanceId: string; status: string; pendingWith: string[]; myTaskId: string | null } | null;
}

export type RequirementState = 'VERIFIED' | 'PENDING' | 'REJECTED' | 'EXPIRED' | 'MISSING';

export interface Compliance {
  requirements: Array<{ documentType: VendorDocumentType; label: string; state: RequirementState; vendorDocumentId: string | null; expiryDate: string | null }>;
  compliant: boolean;
  verifiedCount: number;
}

export interface Indicator {
  key: string;
  label: string;
  status: 'measured' | 'insufficient_data' | 'not_available';
  score: number | null;
  value: string | null;
  formula: string;
  inputs: Record<string, number | string | null>;
  explanation: string;
  availableInPhase?: number;
}

export interface VendorApproval {
  id: string;
  entityType: 'vendor' | 'vendor_bank_change';
  entityId: string;
  status: string;
  submittedAt: string;
  completedAt: string | null;
  outcomeReason: string | null;
  requester: { id: string; fullName: string };
  tasks: Array<{
    id: string;
    sequence: number;
    status: string;
    assigneeId: string;
    reason: string | null;
    decidedAt: string | null;
    assignee: { id: string; fullName: string };
    stage: { name: string };
  }>;
  myPendingTaskId: string | null;
}

export interface Vendor360 {
  vendor: VendorRecord;
  contacts: VendorContact[];
  documents: VendorDocumentRow[];
  bank: { accounts: BankAccountView[]; changeRequests: BankChangeRequest[]; canReveal: boolean; canRequestChange: boolean };
  compliance: Compliance;
  performance: { indicators: Indicator[]; overall: number | null; measuredCount: number };
  statusHistory: Array<{
    id: string;
    fromStatus: VendorStatus | null;
    toStatus: VendorStatus;
    reason: string | null;
    occurredAt: string;
    actor: { id: string; fullName: string } | null;
  }>;
  approvals: VendorApproval[];
  activity: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    reason: string | null;
    outcome: string;
    ipAddress: string | null;
    correlationId: string | null;
    occurredAt: string;
    actor: { id: string; fullName: string } | null;
  }> | null;
  relations: Array<{ key: string; label: string; phase: number; available: boolean }>;
  viewer: {
    canEdit: boolean;
    canApprove: boolean;
    canVerifyDocuments: boolean;
    isCreator: boolean;
    pendingApprovalTaskId: string | null;
    pendingApprovalInstanceId: string | null;
  };
}

export interface DocumentQueueItem extends Omit<VendorDocumentRow, 'document'> {
  vendor: { id: string; vendorCode: string; legalName: string; status: VendorStatus };
  document: { originalName: string; mimeType: string; sizeBytes: number };
}

// ── Lifecycle actions ───────────────────────────────────────────────────────

export type VendorAction = 'submit' | 'withdraw' | 'start-review' | 'activate' | 'suspend' | 'reactivate' | 'archive' | 'reopen';

export interface ActionAvailability {
  action: VendorAction;
  label: string;
  /** Null when allowed; otherwise why the action is unavailable (shown as a tooltip). */
  disabledReason: string | null;
  /** Visible at all for this status. */
  visible: boolean;
  requiresReason: boolean;
  tone: 'primary' | 'secondary' | 'danger';
}

export interface ActionContext {
  status: VendorStatus;
  canEdit: boolean;
  canApprove: boolean;
  isCreator: boolean;
  /** For activation: all required documents verified. */
  compliant: boolean;
  /** Viewer has a pending approval task on this vendor (can start review). */
  hasPendingTask: boolean;
}

const ACTION_META: Record<VendorAction, { label: string; requiresReason: boolean; tone: ActionAvailability['tone'] }> = {
  submit: { label: 'Submit for approval', requiresReason: false, tone: 'primary' },
  'start-review': { label: 'Start review', requiresReason: false, tone: 'primary' },
  activate: { label: 'Activate', requiresReason: false, tone: 'primary' },
  reactivate: { label: 'Reactivate', requiresReason: true, tone: 'primary' },
  reopen: { label: 'Reopen as draft', requiresReason: true, tone: 'secondary' },
  withdraw: { label: 'Withdraw submission', requiresReason: true, tone: 'secondary' },
  suspend: { label: 'Suspend', requiresReason: true, tone: 'danger' },
  archive: { label: 'Archive', requiresReason: true, tone: 'danger' },
};

/** Which lifecycle actions a status allows (mirrors VENDOR_TRANSITIONS and the API guards). */
export function vendorActions(ctx: ActionContext): ActionAvailability[] {
  const s = ctx.status;
  const t = VENDOR_TRANSITIONS[s];
  const visibleFor: Record<VendorAction, boolean> = {
    submit: s === 'DRAFT',
    withdraw: s === 'SUBMITTED' || s === 'UNDER_REVIEW',
    'start-review': s === 'SUBMITTED',
    activate: s === 'APPROVED',
    suspend: t.includes('SUSPENDED'),
    reactivate: s === 'SUSPENDED',
    archive: t.includes('ARCHIVED'),
    reopen: s === 'REJECTED',
  };
  const needsEdit = ['submit', 'withdraw', 'reopen'] as const;
  const needsApprove = ['activate', 'suspend', 'reactivate', 'archive'] as const;
  return (Object.keys(ACTION_META) as VendorAction[]).map((action) => {
    let reason: string | null = null;
    if ((needsEdit as readonly string[]).includes(action) && !ctx.canEdit) reason = 'Requires permission to edit vendors';
    if ((needsApprove as readonly string[]).includes(action) && !ctx.canApprove) reason = 'Requires vendor approval permission';
    if (action === 'start-review' && !ctx.hasPendingTask && !ctx.canApprove) reason = 'Only an assigned approver can start the review';
    if (action === 'activate' && !reason) {
      if (ctx.isCreator) reason = 'The person who created a vendor cannot activate it (separation of duties)';
      else if (!ctx.compliant) reason = 'All required documents must be verified and unexpired first';
    }
    return { action, ...ACTION_META[action], visible: visibleFor[action], disabledReason: reason };
  });
}

// ── Document expiry ─────────────────────────────────────────────────────────

export type ExpiryState = { kind: 'none' } | { kind: 'valid'; days: number } | { kind: 'expiring'; days: number } | { kind: 'expired'; days: number };

/** Classifies a YYYY-MM-DD (or ISO) expiry date against "today" (UTC date granularity, matching the API). */
export function documentExpiryState(expiryDate: string | null | undefined, now: Date = new Date(), warningDays = DOCUMENT_EXPIRY_WARNING_DAYS): ExpiryState {
  if (!expiryDate) return { kind: 'none' };
  const exp = Date.parse(`${expiryDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(exp)) return { kind: 'none' };
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.round((exp - today) / 86_400_000);
  if (days < 0) return { kind: 'expired', days: -days };
  if (days <= warningDays) return { kind: 'expiring', days };
  return { kind: 'valid', days };
}

export function expiryLabel(state: ExpiryState): string {
  switch (state.kind) {
    case 'none':
      return 'No expiry';
    case 'expired':
      return state.days === 0 ? 'Expired today' : `Expired ${state.days} day${state.days === 1 ? '' : 's'} ago`;
    case 'expiring':
      return state.days === 0 ? 'Expires today' : `Expires in ${state.days} day${state.days === 1 ? '' : 's'}`;
    case 'valid':
      return `Valid · ${state.days} days left`;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const DUPLICATE_REASON_LABELS: Record<DuplicateReason, string> = {
  GSTIN: 'Same GSTIN',
  PAN: 'Same PAN',
  BANK_ACCOUNT: 'Same bank account',
  NAME_EXACT: 'Same legal name',
  NAME_SIMILAR: 'Similar name',
};

/** Strong duplicates require an explicit, recorded override reason before creation. */
export function duplicateOverrideRequired(matches: DuplicateMatch[]): boolean {
  return matches.some((m) => m.strong);
}

export const OVERRIDE_REASON_MIN = 10;
