import { z } from 'zod';

/**
 * Vendor master contracts (Phase 02): enums, labels, Indian tax/registry
 * validation, name normalisation for duplicate detection, and request schemas
 * shared by the API (authoritative) and the web app (UX).
 */

export const VENDOR_STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'ARCHIVED'] as const;
export type VendorStatus = (typeof VENDOR_STATUSES)[number];

export const VENDOR_TYPES = ['GOODS_SUPPLIER', 'SERVICE_PROVIDER', 'CONTRACTOR', 'CONSULTANT', 'DISTRIBUTOR', 'MANUFACTURER', 'OTHER'] as const;
export type VendorType = (typeof VENDOR_TYPES)[number];

export const GST_REGISTRATION_TYPES = ['REGISTERED', 'COMPOSITION', 'SEZ', 'UNREGISTERED', 'OVERSEAS'] as const;
export type GstRegistrationType = (typeof GST_REGISTRATION_TYPES)[number];

export const VENDOR_DOCUMENT_TYPES = [
  'GST_CERTIFICATE',
  'PAN_CARD',
  'INCORPORATION',
  'BANK_PROOF',
  'CONTRACT',
  'AGREEMENT',
  'MSME_CERTIFICATE',
  'COMPLIANCE_CERTIFICATE',
  'OTHER',
] as const;
export type VendorDocumentType = (typeof VENDOR_DOCUMENT_TYPES)[number];

export const BANK_ACCOUNT_TYPES = ['CURRENT', 'SAVINGS', 'CASH_CREDIT', 'OVERSEAS'] as const;
export type BankAccountType = (typeof BANK_ACCOUNT_TYPES)[number];

export const VENDOR_STATUS_LABELS: Record<VendorStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under review',
  APPROVED: 'Approved',
  ACTIVE: 'Active',
  REJECTED: 'Rejected',
  SUSPENDED: 'Suspended',
  ARCHIVED: 'Archived',
};

export const VENDOR_TYPE_LABELS: Record<VendorType, string> = {
  GOODS_SUPPLIER: 'Goods supplier',
  SERVICE_PROVIDER: 'Service provider',
  CONTRACTOR: 'Contractor',
  CONSULTANT: 'Consultant',
  DISTRIBUTOR: 'Distributor',
  MANUFACTURER: 'Manufacturer',
  OTHER: 'Other',
};

export const GST_REGISTRATION_LABELS: Record<GstRegistrationType, string> = {
  REGISTERED: 'GST registered (regular)',
  COMPOSITION: 'GST composition scheme',
  SEZ: 'SEZ unit / developer',
  UNREGISTERED: 'Not GST registered',
  OVERSEAS: 'Overseas (non-resident)',
};

export const VENDOR_DOCUMENT_LABELS: Record<VendorDocumentType, string> = {
  GST_CERTIFICATE: 'GST registration certificate',
  PAN_CARD: 'PAN card',
  INCORPORATION: 'Incorporation / registration',
  BANK_PROOF: 'Bank verification (cancelled cheque / letter)',
  CONTRACT: 'Contract',
  AGREEMENT: 'Agreement / NDA',
  MSME_CERTIFICATE: 'MSME / Udyam certificate',
  COMPLIANCE_CERTIFICATE: 'Compliance certificate',
  OTHER: 'Other attachment',
};

export const VENDOR_CATEGORY_SUGGESTIONS = [
  'IT hardware',
  'Software & SaaS',
  'Professional services',
  'Consulting',
  'Facilities & maintenance',
  'Logistics & courier',
  'Office supplies',
  'Marketing & events',
  'Telecom & internet',
  'Travel',
  'Raw materials',
  'Other',
] as const;

/** Allowed lifecycle transitions (PRD §3.2, Master Prompt 02 §3). Approval outcomes drive SUBMITTED/UNDER_REVIEW → APPROVED/REJECTED/DRAFT. */
export const VENDOR_TRANSITIONS: Record<VendorStatus, VendorStatus[]> = {
  DRAFT: ['SUBMITTED', 'ARCHIVED'],
  SUBMITTED: ['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'DRAFT'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED', 'DRAFT'],
  APPROVED: ['ACTIVE', 'SUSPENDED', 'ARCHIVED'],
  ACTIVE: ['SUSPENDED', 'ARCHIVED'],
  REJECTED: ['DRAFT', 'ARCHIVED'],
  SUSPENDED: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: [],
};

export function canTransition(from: VendorStatus, to: VendorStatus): boolean {
  return VENDOR_TRANSITIONS[from].includes(to);
}

/** Documents a vendor must hold (current, verified, unexpired) to be fully compliant. */
export function requiredVendorDocuments(v: {
  gstRegistrationType: GstRegistrationType;
  msmeRegistered: boolean;
  hasBankAccount: boolean;
}): VendorDocumentType[] {
  const docs: VendorDocumentType[] = [];
  if (v.gstRegistrationType === 'OVERSEAS') docs.push('INCORPORATION');
  else {
    docs.push('PAN_CARD');
    if (v.gstRegistrationType !== 'UNREGISTERED') docs.push('GST_CERTIFICATE');
  }
  if (v.msmeRegistered) docs.push('MSME_CERTIFICATE');
  if (v.hasBankAccount) docs.push('BANK_PROOF');
  return docs;
}

// ── Indian registries ──────────────────────────────────────────────────────

/** GST state codes (first two digits of a GSTIN). */
export const INDIAN_STATES: ReadonlyArray<{ code: string; name: string }> = [
  { code: '01', name: 'Jammu and Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman and Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
  { code: '97', name: 'Other Territory' },
];

export function stateCodeFor(stateName: string): string | null {
  const n = stateName.trim().toLowerCase();
  return INDIAN_STATES.find((s) => s.name.toLowerCase() === n)?.code ?? null;
}

export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const SWIFT_PATTERN = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;
export const UDYAM_PATTERN = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/;

/** GSTIN check-digit (base-36 Luhn-style mod) validation. */
export function isValidGstinChecksum(gstin: string): boolean {
  const g = gstin.toUpperCase();
  if (!GSTIN_PATTERN.test(g)) return false;
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = chars.indexOf(g[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return chars[(36 - (sum % 36)) % 36] === g[14];
}

/** Computes the check digit for the first 14 characters (useful for tests and fixtures). */
export function gstinWithChecksum(first14: string): string {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = chars.indexOf(first14[i]!.toUpperCase()) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return first14.toUpperCase() + chars[(36 - (sum % 36)) % 36];
}

// ── Name normalisation & similarity (duplicate detection) ───────────────────

const LEGAL_SUFFIXES = new Set([
  'private',
  'pvt',
  'limited',
  'ltd',
  'llp',
  'inc',
  'incorporated',
  'corp',
  'corporation',
  'co',
  'company',
  'opc',
  'plc',
  'llc',
  'gmbh',
  'pte',
  'the',
]);

/** "M/s. Acme Technologies Pvt. Ltd." → "acme technologies" */
export function normalizeVendorName(name: string): string {
  const tokens = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/\bm\/s\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1]!)) tokens.pop();
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[0]!)) tokens.shift();
  return tokens.join(' ');
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = s.replace(/\s+/g, ' ');
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Sørensen–Dice coefficient over character bigrams of normalised names (0..1). */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeVendorName(a);
  const nb = normalizeVendorName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const A = bigrams(na);
  const B = bigrams(nb);
  let overlap = 0;
  let total = 0;
  for (const [, n] of A) total += n;
  for (const [, n] of B) total += n;
  for (const [g, n] of A) overlap += Math.min(n, B.get(g) ?? 0);
  return total === 0 ? 0 : (2 * overlap) / total;
}

export const DUPLICATE_REASONS = ['GSTIN', 'PAN', 'BANK_ACCOUNT', 'NAME_EXACT', 'NAME_SIMILAR'] as const;
export type DuplicateReason = (typeof DUPLICATE_REASONS)[number];
export const STRONG_DUPLICATE_REASONS: DuplicateReason[] = ['GSTIN', 'PAN', 'BANK_ACCOUNT', 'NAME_EXACT'];
export const NAME_SIMILARITY_THRESHOLD = 0.82;

// ── Schemas ────────────────────────────────────────────────────────────────

const text = (max: number) => z.string().trim().max(max);
const req = (max: number, label: string) => text(max).min(1, `${label} is required`);
const optText = (max: number) =>
  text(max)
    .nullish()
    .transform((v) => (v ? v : null));
const upperOpt = (max: number) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const vendorContactSchema = z.object({
  name: req(120, 'Contact name'),
  designation: optText(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .pipe(z.email({ message: 'Enter a valid email' }))
    .nullish()
    .or(z.literal('').transform(() => null)),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9][0-9 -]{6,18}$/, 'Enter a valid phone number')
    .nullish()
    .or(z.literal('').transform(() => null)),
  isPrimary: z.boolean().default(false),
});
export type VendorContactInput = z.infer<typeof vendorContactSchema>;

export const vendorBankSchema = z
  .object({
    accountHolderName: req(200, 'Account holder name'),
    bankName: req(120, 'Bank name'),
    branchName: optText(120),
    accountType: z.enum(BANK_ACCOUNT_TYPES).default('CURRENT'),
    ifsc: upperOpt(11),
    swiftCode: upperOpt(11),
    accountNumber: z
      .string()
      .trim()
      .toUpperCase()
      .transform((v) => v.replace(/[\s-]/g, ''))
      .pipe(z.string().min(5, 'Account number is too short').max(34, 'Account number is too long')),
    confirmAccountNumber: z.string().trim().optional(),
    proofDocumentId: z.uuid().nullish(),
  })
  .superRefine((b, ctx) => {
    if (b.accountType === 'OVERSEAS') {
      if (!b.swiftCode || !SWIFT_PATTERN.test(b.swiftCode)) ctx.addIssue({ code: 'custom', path: ['swiftCode'], message: 'Enter a valid SWIFT/BIC code' });
      if (!/^[A-Z0-9]{5,34}$/.test(b.accountNumber))
        ctx.addIssue({ code: 'custom', path: ['accountNumber'], message: 'Use 5–34 letters or digits (IBAN or account number)' });
    } else {
      if (!b.ifsc || !IFSC_PATTERN.test(b.ifsc))
        ctx.addIssue({ code: 'custom', path: ['ifsc'], message: 'Enter a valid 11-character IFSC (e.g. HDFC0001234)' });
      if (!/^\d{9,18}$/.test(b.accountNumber)) ctx.addIssue({ code: 'custom', path: ['accountNumber'], message: 'Indian account numbers have 9–18 digits' });
    }
    if (b.confirmAccountNumber !== undefined && b.confirmAccountNumber.replace(/[\s-]/g, '').toUpperCase() !== b.accountNumber) {
      ctx.addIssue({ code: 'custom', path: ['confirmAccountNumber'], message: 'Account numbers do not match' });
    }
  });
export type VendorBankInput = z.infer<typeof vendorBankSchema>;

export const vendorProfileObject = z.object({
  legalName: req(200, 'Legal name'),
  tradeName: optText(200),
  vendorType: z.enum(VENDOR_TYPES),
  category: req(80, 'Category'),
  gstRegistrationType: z.enum(GST_REGISTRATION_TYPES),
  gstin: upperOpt(15),
  pan: upperOpt(10),
  registrationNumber: upperOpt(40),
  msmeRegistered: z.boolean().default(false),
  msmeNumber: upperOpt(40),
  website: z
    .string()
    .trim()
    .max(200)
    .refine((v) => /^https?:\/\/[^\s]+\.[^\s]+$/i.test(v), 'Enter a full URL starting with http(s)://')
    .nullish()
    .or(z.literal('').transform(() => null)),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .pipe(z.email({ message: 'Enter a valid email' }))
    .nullish()
    .or(z.literal('').transform(() => null)),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9][0-9 -]{6,18}$/, 'Enter a valid phone number')
    .nullish()
    .or(z.literal('').transform(() => null)),
  addressLine1: req(200, 'Address'),
  addressLine2: optText(200),
  city: req(100, 'City'),
  state: req(100, 'State'),
  postalCode: req(20, 'Postal code'),
  country: z.string().trim().toUpperCase().length(2, 'Use a 2-letter country code').default('IN'),
  paymentTermsDays: z.number().int().min(0, 'Cannot be negative').max(365, 'At most 365 days').default(30),
  preferredCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Use an ISO 4217 code')
    .default('INR'),
  internalNotes: optText(4000),
});

type ProfileShape = z.infer<typeof vendorProfileObject>;

/** Conditional rules shared by create/update (applied to the merged record). */
export function vendorProfileIssues(v: ProfileShape): Array<{ path: string; message: string }> {
  const issues: Array<{ path: string; message: string }> = [];
  const gstRequired = ['REGISTERED', 'COMPOSITION', 'SEZ'].includes(v.gstRegistrationType);
  const overseas = v.gstRegistrationType === 'OVERSEAS';
  if (overseas && v.country === 'IN') issues.push({ path: 'country', message: 'Overseas vendors must have a country other than India' });
  if (!overseas && v.country !== 'IN') issues.push({ path: 'gstRegistrationType', message: 'Vendors outside India must use the "Overseas" registration type' });
  if (gstRequired) {
    if (!v.gstin) issues.push({ path: 'gstin', message: 'GSTIN is required for GST-registered vendors' });
    else if (!GSTIN_PATTERN.test(v.gstin)) issues.push({ path: 'gstin', message: 'GSTIN must be 15 characters, e.g. 29ABCDE1234F1Z5' });
    else if (!isValidGstinChecksum(v.gstin)) issues.push({ path: 'gstin', message: 'GSTIN check digit is invalid — please re-check the number' });
    else {
      const sc = stateCodeFor(v.state);
      if (sc && sc !== v.gstin.slice(0, 2))
        issues.push({ path: 'gstin', message: `GSTIN state code ${v.gstin.slice(0, 2)} does not match ${v.state} (${sc})` });
    }
  } else if (v.gstin) {
    issues.push({ path: 'gstin', message: 'Remove the GSTIN or change the registration type' });
  }
  if (!overseas) {
    if (!v.pan) issues.push({ path: 'pan', message: 'PAN is required for Indian vendors' });
    else if (!PAN_PATTERN.test(v.pan)) issues.push({ path: 'pan', message: 'PAN must be 10 characters, e.g. ABCDE1234F' });
    else if (v.gstin && GSTIN_PATTERN.test(v.gstin) && v.gstin.slice(2, 12) !== v.pan)
      issues.push({ path: 'pan', message: 'PAN does not match the PAN embedded in the GSTIN' });
    if (!/^[1-9][0-9]{5}$/.test(v.postalCode)) issues.push({ path: 'postalCode', message: 'Indian PIN codes have 6 digits' });
    if (!stateCodeFor(v.state)) issues.push({ path: 'state', message: 'Select an Indian state or union territory' });
  }
  if (v.msmeRegistered) {
    if (!v.msmeNumber) issues.push({ path: 'msmeNumber', message: 'Udyam registration number is required for MSME vendors' });
    else if (!UDYAM_PATTERN.test(v.msmeNumber)) issues.push({ path: 'msmeNumber', message: 'Format: UDYAM-XX-00-0000000' });
  } else if (v.msmeNumber) {
    issues.push({ path: 'msmeNumber', message: 'Tick "MSME registered" or remove the Udyam number' });
  }
  return issues;
}

const withProfileRules = <T extends z.ZodType<ProfileShape>>(schema: T) =>
  schema.superRefine((v, ctx) => {
    for (const i of vendorProfileIssues(v)) ctx.addIssue({ code: 'custom', path: [i.path], message: i.message });
  });

export const vendorProfileSchema = withProfileRules(vendorProfileObject);
export type VendorProfileInput = z.infer<typeof vendorProfileSchema>;

export const createVendorSchema = vendorProfileObject
  .extend({
    contacts: z.array(vendorContactSchema).max(10).default([]),
    bankAccount: vendorBankSchema.nullish(),
    duplicateOverrideReason: optText(1000),
  })
  .superRefine((v, ctx) => {
    for (const i of vendorProfileIssues(v)) ctx.addIssue({ code: 'custom', path: [i.path], message: i.message });
    if (v.contacts.filter((c) => c.isPrimary).length > 1) ctx.addIssue({ code: 'custom', path: ['contacts'], message: 'Only one primary contact is allowed' });
    if (v.bankAccount && v.gstRegistrationType === 'OVERSEAS' && v.bankAccount.accountType !== 'OVERSEAS') {
      ctx.addIssue({ code: 'custom', path: ['bankAccount', 'accountType'], message: 'Overseas vendors need an overseas bank account' });
    }
  });
export type CreateVendorInput = z.infer<typeof createVendorSchema>;

export const updateVendorSchema = vendorProfileObject.partial().extend({
  version: z.number().int().nonnegative(),
});
export type UpdateVendorInput = z.infer<typeof updateVendorSchema>;

export const vendorReasonSchema = z.object({ reason: req(1000, 'Reason').min(5, 'Please give a meaningful reason (≥ 5 characters)') });
export const vendorSubmitSchema = z.object({ note: optText(1000) });

export const duplicateCheckSchema = z.object({
  legalName: text(200).optional(),
  gstin: upperOpt(15).optional(),
  pan: upperOpt(10).optional(),
  accountNumber: z
    .string()
    .trim()
    .toUpperCase()
    .transform((v) => v.replace(/[\s-]/g, ''))
    .optional(),
  excludeVendorId: z.uuid().optional(),
});

export const VENDOR_SORT_FIELDS = ['legalName', 'vendorCode', 'createdAt', 'updatedAt', 'status'] as const;

export const vendorListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
  q: z.string().trim().max(100).optional(),
  status: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : []))
    .pipe(z.array(z.enum(VENDOR_STATUSES))),
  vendorType: z.enum(VENDOR_TYPES).optional(),
  category: z.string().trim().max(80).optional(),
  gstRegistrationType: z.enum(GST_REGISTRATION_TYPES).optional(),
  msme: z.enum(['true', 'false']).optional(),
  documentAlert: z.enum(['expiring', 'expired', 'pending_verification', 'missing']).optional(),
  sort: z.enum(VENDOR_SORT_FIELDS).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type VendorListQuery = z.infer<typeof vendorListQuery>;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((v) => !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()), 'Invalid date');

/** Multipart text fields accompanying a vendor document upload. */
export const vendorDocumentMetaSchema = z
  .object({
    documentType: z.enum(VENDOR_DOCUMENT_TYPES),
    title: req(200, 'Title'),
    documentNumber: upperOpt(80),
    issueDate: isoDate.optional().or(z.literal('').transform(() => undefined)),
    expiryDate: isoDate.optional().or(z.literal('').transform(() => undefined)),
    replacesId: z
      .uuid()
      .optional()
      .or(z.literal('').transform(() => undefined)),
  })
  .refine((d) => !d.issueDate || !d.expiryDate || d.expiryDate >= d.issueDate, { path: ['expiryDate'], message: 'Expiry must be on or after the issue date' });
export type VendorDocumentMetaInput = z.infer<typeof vendorDocumentMetaSchema>;

export const verifyVendorDocumentSchema = z
  .object({
    decision: z.enum(['VERIFIED', 'REJECTED']),
    note: optText(1000),
  })
  .refine((d) => d.decision === 'VERIFIED' || !!d.note, { path: ['note'], message: 'Explain why the document is rejected' });

export const bankChangeRequestSchema = vendorBankSchema.and(z.object({ reason: req(1000, 'Reason').min(5, 'Please give a meaningful reason') }));

export const revealSchema = z.object({ reason: req(500, 'Reason').min(5, 'State why you need to see the full value') });

export const vendorDocumentQueueQuery = z.object({
  filter: z.enum(['pending_verification', 'expiring', 'expired', 'rejected']).default('pending_verification'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});

export const bankChangeQueueQuery = z.object({
  status: z.enum(['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED']).default('PENDING_APPROVAL'),
});

/** Days before expiry at which a document is reported as "expiring". */
export const DOCUMENT_EXPIRY_WARNING_DAYS = 30;
