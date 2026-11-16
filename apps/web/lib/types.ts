/**
 * Response shapes of the Phase 01 API (apps/api/src/modules/**). Dates arrive
 * as ISO strings; Prisma Decimals arrive as decimal strings.
 */
import type { PermissionScope } from '@kenzo/shared';

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
export interface List<T> {
  items: T[];
}

export interface UserBrief {
  id: string;
  fullName: string;
  email?: string;
}

export interface Session {
  user: {
    id: string;
    email: string;
    fullName: string;
    jobTitle: string | null;
    departmentId: string | null;
    mfaEnabled: boolean;
    lastLoginAt: string | null;
    passwordChangedAt: string | null;
  };
  company: {
    id: string;
    code: string;
    displayName: string;
    legalName: string;
    baseCurrency: string;
    timezone: string;
    enforceMfaForPrivileged: boolean;
  } | null;
  companies: Array<{ id: string; code: string; displayName: string }>;
  roleKeys: string[];
  permissions: Record<string, PermissionScope>;
  mfa: { enabled: boolean; verified: boolean; pending: boolean; enforced: boolean };
  csrfToken: string;
  privilegedPermissions: string[];
}

export type UserStatus = 'INVITED' | 'ACTIVE' | 'DEACTIVATED';

export interface UserRow {
  id: string;
  companyId: string;
  email: string;
  fullName: string;
  jobTitle: string | null;
  status: UserStatus;
  departmentId: string | null;
  managerId: string | null;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  activatedAt: string | null;
  deactivatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  department: { id: string; code: string; name: string } | null;
  manager: { id: string; fullName: string } | null;
  roleAssignments: Array<{ id: string; validUntil: string | null; role: { id: string; key: string; name: string } }>;
}

export interface UserDetail extends Omit<UserRow, 'roleAssignments'> {
  roleAssignments: Array<{
    id: string;
    validFrom: string;
    validUntil: string | null;
    revokedAt: string | null;
    createdAt: string;
    department: { id: string; name: string } | null;
    role: { id: string; key: string; name: string; isSystem: boolean };
    grantedBy: { id: string; fullName: string } | null;
  }>;
  activeSessionCount: number | null;
}

export interface PermissionDef {
  key: string;
  module: string;
  description: string;
  sensitive?: boolean;
  requiresMfa?: boolean;
  scopable?: boolean;
  phase: number;
}

export interface Grant {
  key: string;
  scope: PermissionScope;
}

export interface RoleRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  version: number;
  activeAssignments: number;
  permissions: Grant[];
}

export interface RoleDetail {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  version: number;
  permissions: Grant[];
  assignments: Array<{
    id: string;
    validUntil: string | null;
    user: { id: string; fullName: string; email: string; status: UserStatus };
    department: { id: string; name: string } | null;
  }>;
}

export interface Company {
  id: string;
  code: string;
  legalName: string;
  displayName: string;
  gstin: string | null;
  pan: string | null;
  country: string;
  timezone: string;
  baseCurrency: string;
  fiscalYearStartMonth: number;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  status: string;
  enforceMfaForPrivileged: boolean;
  version: number;
}

export interface Department {
  id: string;
  companyId: string;
  code: string;
  name: string;
  parentId: string | null;
  headUserId: string | null;
  isActive: boolean;
  version: number;
  head: { id: string; fullName: string } | null;
  parent: { id: string; name: string } | null;
  _count: { members: number; costCentres: number };
}

export interface CostCentre {
  id: string;
  code: string;
  name: string;
  departmentId: string | null;
  isActive: boolean;
  version: number;
  department: { id: string; name: string } | null;
}

export type StageMode = 'ANY' | 'ALL';
export type ApproverType = 'ROLE' | 'USER' | 'DEPARTMENT_HEAD' | 'REQUESTER_MANAGER';

export interface PolicyStage {
  id: string;
  sequence: number;
  name: string;
  mode: StageMode;
  minApprovals: number;
  minAmount: string | null;
  maxAmount: string | null;
  departmentIds: string[];
  categoryKeys: string[];
  approverType: ApproverType;
  approverRoleKey: string | null;
  approverUserId: string | null;
  slaHours: number | null;
  escalationRoleKey: string | null;
}

export type PolicyStatus = 'DRAFT' | 'ACTIVE' | 'RETIRED';

export interface ApprovalPolicy {
  id: string;
  entityType: string;
  name: string;
  description: string | null;
  policyVersion: number;
  status: PolicyStatus;
  requireIndependentApproval: boolean;
  distinctApproversAcrossStages: boolean;
  allowDelegation: boolean;
  excludeInitiatorFromAllStages: boolean;
  publishedAt: string | null;
  retiredAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  stages: PolicyStage[];
  _count?: { instances: number };
}

export interface SimulationResult {
  ok: boolean;
  error?: string;
  details?: Record<string, unknown> | null;
  stages: Array<{ sequence: number; name: string; mode: StageMode; required: number; approvers: Array<{ user?: UserBrief; delegatedFrom: UserBrief | null }> }>;
  skippedStages: Array<{ sequence: number; name: string }>;
}

export type InstanceStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'RETURNED' | 'CANCELLED';
export type TaskStatus = 'WAITING' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'RETURNED' | 'SKIPPED' | 'CANCELLED';

export interface InstanceSummary {
  id: string;
  entityType: string;
  entityId: string;
  entityReference: string | null;
  entitySummary: string | null;
  amount: string | null;
  currencyCode: string | null;
  status: InstanceStatus;
  submittedAt: string;
  requester: UserBrief;
}

export interface TaskRow {
  id: string;
  instanceId: string;
  sequence: number;
  status: TaskStatus;
  reason: string | null;
  dueAt: string | null;
  decidedAt: string | null;
  isEscalation: boolean;
  createdAt: string;
  stage: { name: string; mode: StageMode };
  delegatedFrom: UserBrief | null;
  instance: InstanceSummary;
}

export interface InstanceRow extends InstanceSummary {
  completedAt: string | null;
  createdAt: string;
  policy: { name: string; policyVersion: number };
  tasks: Array<{ assignee: UserBrief; sequence: number }>;
}

export interface InstanceTask {
  id: string;
  sequence: number;
  status: TaskStatus;
  reason: string | null;
  isEscalation: boolean;
  activatedAt: string | null;
  dueAt: string | null;
  decidedAt: string | null;
  assignee: UserBrief;
  delegatedFrom: UserBrief | null;
  decidedBy: UserBrief | null;
  stage: { name: string; mode: StageMode; minApprovals: number; slaHours: number | null };
}

export interface ApprovalEvent {
  id: string;
  type: string;
  sequence: number | null;
  reason: string | null;
  occurredAt: string;
  actor: { id: string; fullName: string } | null;
  metadata: unknown;
}

export interface InstanceDetail extends InstanceSummary {
  completedAt: string | null;
  outcomeReason: string | null;
  currentSequence: number | null;
  departmentId: string | null;
  policy: {
    id: string;
    name: string;
    policyVersion: number;
    allowDelegation: boolean;
    requireIndependentApproval: boolean;
    distinctApproversAcrossStages: boolean;
  };
  tasks: InstanceTask[];
  events: ApprovalEvent[];
  viewer: { isRequester: boolean; pendingTaskId: string | null; canAdminister: boolean };
}

export interface Delegation {
  id: string;
  delegator: UserBrief;
  delegate: UserBrief;
  entityTypes: string[];
  validFrom: string;
  validUntil: string;
  reason: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  reason: string | null;
  outcome: string;
  ipAddress: string | null;
  correlationId: string | null;
  occurredAt: string;
  actor: UserBrief | null;
}

export interface AuditDetail extends AuditRow {
  companyId: string | null;
  beforeData: unknown;
  afterData: unknown;
  beforeHash: string | null;
  afterHash: string | null;
  userAgent: string | null;
}

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NumberingSeries {
  id: string;
  documentType: string;
  prefix: string;
  pattern: string;
  padding: number;
  resetPolicy: 'NEVER' | 'FISCAL_YEAR';
  version: number;
  periods: Array<{ periodKey: string; nextValue: string }>;
  preview: { periodKey: string; nextSequence: number; example: string };
}

export interface IntegrationConfig {
  id: string;
  kind: string;
  provider: string;
  name: string;
  enabled: boolean;
  settings: Record<string, string | number | boolean>;
  secretRef: string | null;
  lastSyncAt: string | null;
  version: number;
  updatedAt: string;
}

export interface SessionRow {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  expiresAt: string;
  mfaVerifiedAt: string | null;
  current: boolean;
}
