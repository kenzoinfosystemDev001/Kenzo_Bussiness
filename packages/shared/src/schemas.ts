import { z } from 'zod';
import { APPROVAL_DECISIONS, APPROVAL_ENTITY_TYPES, APPROVER_TYPES, NUMBERED_DOCUMENT_TYPES, STAGE_MODES } from './approvals';
import { Dec } from './money';
import { NUMBER_PATTERN_RE } from './fiscal';
import { PERMISSION_SCOPES, isPermissionKey } from './permissions';

/**
 * Request validation schemas shared by the API (authoritative, server-side)
 * and the web app (UX only — never trusted). All strings are trimmed and
 * length-bounded; free text is stored verbatim and escaped on render.
 */

const trimmed = (max: number) => z.string().trim().max(max);
const required = (max: number, label = 'This field') => trimmed(max).min(1, `${label} is required`);

export const uuid = z.uuid({ message: 'Must be a valid identifier' });
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: 'Enter a valid email address' }));

export const PASSWORD_MIN_LENGTH = 12;
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(128, 'Password must be at most 128 characters')
  .refine((v) => new Set(v).size >= 5, 'Password is too repetitive')
  .refine((v) => /[a-zA-Z]/.test(v) && /[^a-zA-Z]/.test(v), 'Use a mix of letters and numbers or symbols');

export const decimalString = (opts: { min?: string; max?: string; scale?: number } = {}) =>
  z
    .string()
    .trim()
    .refine((v) => Dec.isValid(v), 'Must be a decimal number')
    .refine((v) => (opts.scale === undefined ? true : (v.split('.')[1]?.length ?? 0) <= opts.scale), {
      message: `At most ${opts.scale} decimal places`,
    })
    .refine((v) => (opts.min === undefined ? true : Dec.of(v).gte(opts.min)), { message: `Must be ≥ ${opts.min}` })
    .refine((v) => (opts.max === undefined ? true : Dec.of(v).lte(opts.max)), { message: `Must be ≤ ${opts.max}` });

export const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Use an ISO 4217 currency code');

export const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{0,31}$/, 'Use 1–32 letters, digits, "-" or "_"');

export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const optionalUpper = (re: RegExp, message: string) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .regex(re, message)
    .nullish()
    .or(z.literal('').transform(() => null));

// ── Pagination ─────────────────────────────────────────────────────────────
export const paginationQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(100).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuery>;

// ── Auth ───────────────────────────────────────────────────────────────────
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const mfaCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
  fullName: required(120, 'Name').optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

export const switchCompanySchema = z.object({ companyId: uuid });

// ── Users & roles ──────────────────────────────────────────────────────────
export const roleAssignmentInput = z.object({
  roleId: uuid,
  departmentId: uuid.nullish(),
  validUntil: z.iso.datetime({ offset: true }).nullish(),
});

export const inviteUserSchema = z.object({
  email: emailSchema,
  fullName: required(120, 'Name'),
  jobTitle: trimmed(120).nullish(),
  departmentId: uuid.nullish(),
  managerId: uuid.nullish(),
  roleAssignments: z.array(roleAssignmentInput).max(20).default([]),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const updateUserSchema = z.object({
  fullName: required(120, 'Name').optional(),
  jobTitle: trimmed(120).nullish(),
  departmentId: uuid.nullish(),
  managerId: uuid.nullish(),
  version: z.number().int().nonnegative(),
});

export const userStatusChangeSchema = z.object({
  reason: required(500, 'Reason'),
});

export const listUsersQuery = paginationQuery.extend({
  status: z.enum(['INVITED', 'ACTIVE', 'DEACTIVATED']).optional(),
  departmentId: uuid.optional(),
  roleId: uuid.optional(),
});

export const permissionGrantInput = z.object({
  key: z.string().refine(isPermissionKey, 'Unknown permission'),
  scope: z.enum(PERMISSION_SCOPES).default('COMPANY'),
});

export const createRoleSchema = z.object({
  key: codeSchema,
  name: required(80, 'Name'),
  description: trimmed(500).nullish(),
  permissions: z.array(permissionGrantInput).max(200),
});

export const updateRoleSchema = z.object({
  name: required(80, 'Name').optional(),
  description: trimmed(500).nullish(),
  permissions: z.array(permissionGrantInput).max(200).optional(),
  reason: required(500, 'Reason'),
});

// ── Organization ───────────────────────────────────────────────────────────
export const companyProfileSchema = z.object({
  legalName: required(200, 'Legal name'),
  displayName: required(120, 'Display name'),
  gstin: optionalUpper(GSTIN_RE, 'Enter a valid 15-character GSTIN'),
  pan: optionalUpper(PAN_RE, 'Enter a valid 10-character PAN'),
  country: z.string().trim().toUpperCase().length(2).default('IN'),
  timezone: required(64, 'Timezone').refine((tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown timezone'),
  baseCurrency: currencyCode.default('INR'),
  fiscalYearStartMonth: z.number().int().min(1).max(12).default(4),
  addressLine1: trimmed(200).nullish(),
  addressLine2: trimmed(200).nullish(),
  city: trimmed(100).nullish(),
  state: trimmed(100).nullish(),
  postalCode: trimmed(20).nullish(),
});

export const createCompanySchema = companyProfileSchema.extend({ code: codeSchema });
export const updateCompanySchema = companyProfileSchema.partial().extend({
  enforceMfaForPrivileged: z.boolean().optional(),
  version: z.number().int().nonnegative(),
});

export const departmentSchema = z.object({
  code: codeSchema,
  name: required(120, 'Name'),
  parentId: uuid.nullish(),
  headUserId: uuid.nullish(),
});
export const updateDepartmentSchema = departmentSchema.partial().extend({
  isActive: z.boolean().optional(),
  version: z.number().int().nonnegative(),
});

export const costCentreSchema = z.object({
  code: codeSchema,
  name: required(120, 'Name'),
  departmentId: uuid.nullish(),
});
export const updateCostCentreSchema = costCentreSchema.partial().extend({
  isActive: z.boolean().optional(),
  version: z.number().int().nonnegative(),
});

// ── Approval policies ──────────────────────────────────────────────────────
const money = decimalString({ min: '0', scale: 2 });

export const approvalStageSchema = z
  .object({
    sequence: z.number().int().min(1).max(20),
    name: required(120, 'Stage name'),
    mode: z.enum(STAGE_MODES).default('ANY'),
    minApprovals: z.number().int().min(1).max(10).default(1),
    minAmount: money.nullish(),
    maxAmount: money.nullish(),
    departmentIds: z.array(uuid).max(50).default([]),
    categoryKeys: z.array(trimmed(64)).max(50).default([]),
    approverType: z.enum(APPROVER_TYPES),
    approverRoleKey: codeSchema.nullish(),
    approverUserId: uuid.nullish(),
    slaHours: z.number().int().min(1).max(720).nullish(),
    escalationRoleKey: codeSchema.nullish(),
  })
  .superRefine((s, ctx) => {
    if (s.approverType === 'ROLE' && !s.approverRoleKey) ctx.addIssue({ code: 'custom', path: ['approverRoleKey'], message: 'Select the approver role' });
    if (s.approverType === 'USER' && !s.approverUserId) ctx.addIssue({ code: 'custom', path: ['approverUserId'], message: 'Select the approver' });
    if (s.minAmount && s.maxAmount && Dec.of(s.minAmount).gt(s.maxAmount))
      ctx.addIssue({ code: 'custom', path: ['maxAmount'], message: 'Maximum must be ≥ minimum' });
  });
export type ApprovalStageInput = z.infer<typeof approvalStageSchema>;

export const approvalPolicySchema = z
  .object({
    entityType: z.enum(APPROVAL_ENTITY_TYPES),
    name: required(120, 'Name'),
    description: trimmed(1000).nullish(),
    requireIndependentApproval: z.boolean().default(true),
    distinctApproversAcrossStages: z.boolean().default(true),
    allowDelegation: z.boolean().default(true),
    excludeInitiatorFromAllStages: z.boolean().default(true),
    stages: z.array(approvalStageSchema).min(1, 'Add at least one stage').max(20),
  })
  .superRefine((p, ctx) => {
    const seen = new Set<string>();
    p.stages.forEach((s, i) => {
      const key = `${s.sequence}:${s.name.toLowerCase()}`;
      if (seen.has(key)) ctx.addIssue({ code: 'custom', path: ['stages', i, 'name'], message: 'Duplicate stage' });
      seen.add(key);
    });
  });
export type ApprovalPolicyInput = z.infer<typeof approvalPolicySchema>;

export const simulatePolicySchema = z.object({
  amount: money.default('0'),
  departmentId: uuid.nullish(),
  categoryKey: trimmed(64).nullish(),
  requesterId: uuid,
});

export const approvalDecisionSchema = z
  .object({
    decision: z.enum(APPROVAL_DECISIONS),
    reason: trimmed(2000).nullish(),
  })
  .superRefine((d, ctx) => {
    if (d.decision !== 'APPROVE' && !d.reason) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'A reason is required to reject or return' });
  });
export type ApprovalDecisionInput = z.infer<typeof approvalDecisionSchema>;

export const delegateTaskSchema = z.object({
  toUserId: uuid,
  reason: required(500, 'Reason'),
});

export const createDelegationSchema = z
  .object({
    delegatorId: uuid.optional(),
    delegateId: uuid,
    validFrom: z.iso.datetime({ offset: true }),
    validUntil: z.iso.datetime({ offset: true }),
    entityTypes: z.array(z.enum(APPROVAL_ENTITY_TYPES)).max(20).default([]),
    reason: required(500, 'Reason'),
  })
  .refine((d) => new Date(d.validUntil) > new Date(d.validFrom), {
    path: ['validUntil'],
    message: 'End must be after start',
  });

export const cancelApprovalSchema = z.object({ reason: required(500, 'Reason') });

// ── Numbering & integrations ───────────────────────────────────────────────
export const numberingSeriesSchema = z.object({
  documentType: z.enum(NUMBERED_DOCUMENT_TYPES),
  prefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,10}$/, 'Prefix must be 1–10 letters/digits'),
  pattern: z.string().trim().regex(NUMBER_PATTERN_RE, 'Pattern must include {SEQ} and only safe characters'),
  padding: z.number().int().min(3).max(10).default(6),
  resetPolicy: z.enum(['NEVER', 'FISCAL_YEAR']).default('FISCAL_YEAR'),
});

export const INTEGRATION_KINDS = ['SSO', 'EMAIL', 'STORAGE', 'OCR', 'ERP', 'HRMS', 'EXPENSE', 'BANK'] as const;

export const integrationConfigSchema = z.object({
  kind: z.enum(INTEGRATION_KINDS),
  provider: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9_-]{1,40}$/),
  name: required(120, 'Name'),
  enabled: z.boolean().default(false),
  /** Non-secret settings only (URLs, client IDs, regions). Secrets go to the secret manager. */
  settings: z
    .record(z.string().max(64), z.union([z.string().max(500), z.number(), z.boolean()]))
    .refine((s) => Object.keys(s).length <= 40, 'Too many settings'),
  /** Reference/name of the secret in the secret manager — never the secret itself. */
  secretRef: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9/_.:-]{1,200}$/, 'Secret reference must be a name, not a value')
    .nullish(),
});

export const auditQuerySchema = paginationQuery.extend({
  entityType: z.string().trim().max(64).optional(),
  entityId: z.string().trim().max(64).optional(),
  actorId: uuid.optional(),
  action: z.string().trim().max(100).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
