import { z } from 'zod';
import { Dec, MONEY_SCALE, computeLineAmounts, type TaxTreatment } from './money';

/**
 * Requisition, RFQ and quotation contracts (Phase 03). Totals are computed with
 * exact decimals by `computeDocumentTotals`; the API is authoritative and the
 * web app uses the same function for previews.
 */

export const REQUISITION_STATUSES = ['DRAFT', 'SUBMITTED', 'PENDING_APPROVAL', 'APPROVED', 'RETURNED', 'REJECTED', 'WITHDRAWN', 'CANCELLED'] as const;
export type RequisitionStatus = (typeof REQUISITION_STATUSES)[number];
export const REQUISITION_STATUS_LABELS: Record<RequisitionStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  PENDING_APPROVAL: 'Pending approval',
  APPROVED: 'Approved',
  RETURNED: 'Returned for clarification',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
  CANCELLED: 'Cancelled',
};
export const REQUISITION_TRANSITIONS: Record<RequisitionStatus, RequisitionStatus[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['PENDING_APPROVAL'],
  PENDING_APPROVAL: ['APPROVED', 'RETURNED', 'REJECTED', 'WITHDRAWN'],
  APPROVED: ['CANCELLED'],
  RETURNED: ['SUBMITTED', 'CANCELLED'],
  REJECTED: [],
  WITHDRAWN: ['SUBMITTED', 'CANCELLED'],
  CANCELLED: [],
};

export const REQUISITION_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export const LINE_ITEM_TYPES = ['GOODS', 'SERVICE'] as const;

export const RFQ_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'SENT',
  'PARTIALLY_RESPONDED',
  'RESPONSES_RECEIVED',
  'EVALUATION',
  'AWARDED',
  'CANCELLED',
  'CLOSED',
] as const;
export type RfqStatus = (typeof RFQ_STATUSES)[number];
export const RFQ_STATUS_LABELS: Record<RfqStatus, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending approval',
  APPROVED: 'Approved',
  SENT: 'Sent',
  PARTIALLY_RESPONDED: 'Partially responded',
  RESPONSES_RECEIVED: 'Responses received',
  EVALUATION: 'Evaluation',
  AWARDED: 'Awarded',
  CANCELLED: 'Cancelled',
  CLOSED: 'Closed',
};
export const RFQ_TRANSITIONS: Record<RfqStatus, RfqStatus[]> = {
  DRAFT: ['PENDING_APPROVAL', 'APPROVED', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'DRAFT', 'CANCELLED'],
  APPROVED: ['SENT', 'CANCELLED'],
  SENT: ['PARTIALLY_RESPONDED', 'RESPONSES_RECEIVED', 'EVALUATION', 'CANCELLED', 'CLOSED'],
  PARTIALLY_RESPONDED: ['RESPONSES_RECEIVED', 'EVALUATION', 'CANCELLED', 'CLOSED'],
  RESPONSES_RECEIVED: ['EVALUATION', 'CANCELLED', 'CLOSED'],
  EVALUATION: ['AWARDED', 'CANCELLED', 'CLOSED'],
  AWARDED: ['CLOSED'],
  CANCELLED: [],
  CLOSED: [],
};

export const RFQ_INVITATION_STATUSES = ['PENDING', 'SENT', 'DELIVERED', 'RESPONDED', 'DECLINED', 'NO_RESPONSE', 'WITHDRAWN'] as const;

export const QUOTATION_STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_EVALUATION', 'CLARIFICATION_REQUESTED', 'REVISED', 'ACCEPTED', 'REJECTED', 'EXPIRED'] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];
export const QUOTATION_STATUS_LABELS: Record<QuotationStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  UNDER_EVALUATION: 'Under evaluation',
  CLARIFICATION_REQUESTED: 'Clarification requested',
  REVISED: 'Revised',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
};
export const QUOTATION_RECEIVED_VIA = ['MANUAL_ENTRY', 'UPLOADED_DOCUMENT', 'EMAIL', 'OFFLINE'] as const;

/** GST tax categories (rates snapshotted on each line; review with your tax adviser). */
export const TAX_CATEGORIES: ReadonlyArray<{ code: string; label: string; rate: string }> = [
  { code: 'GST_0', label: 'GST 0 %', rate: '0' },
  { code: 'GST_5', label: 'GST 5 %', rate: '5' },
  { code: 'GST_12', label: 'GST 12 %', rate: '12' },
  { code: 'GST_18', label: 'GST 18 %', rate: '18' },
  { code: 'GST_28', label: 'GST 28 %', rate: '28' },
  { code: 'EXEMPT', label: 'Exempt', rate: '0' },
  { code: 'NIL', label: 'Nil rated', rate: '0' },
  { code: 'NON_GST', label: 'Non-GST supply', rate: '0' },
];
/** Whether quoted unit prices already contain the tax. Never defaulted away at comparison time. */
export const TAX_TREATMENTS = ['EXCLUSIVE', 'INCLUSIVE'] as const;
export const TAX_TREATMENT_LABELS: Record<TaxTreatment, string> = {
  EXCLUSIVE: 'Tax extra (exclusive)',
  INCLUSIVE: 'Tax included in price',
};

export function taxRateFor(code: string): string | null {
  return TAX_CATEGORIES.find((t) => t.code === code)?.rate ?? null;
}

export const UNITS_OF_MEASURE = [
  'NOS',
  'PCS',
  'SET',
  'BOX',
  'PACK',
  'KG',
  'G',
  'LTR',
  'MTR',
  'SQM',
  'HRS',
  'DAYS',
  'MONTHS',
  'LOT',
  'LICENSE',
  'SERVICE',
] as const;

// ── Deterministic totals ───────────────────────────────────────────────────

export interface PricedLine {
  quantity: string;
  unitPrice: string;
  discountPercent?: string;
  taxRate: string;
}

export interface DocumentTotals {
  lines: Array<{ gross: string; discount: string; taxable: string; tax: string; total: string }>;
  subtotal: string;
  discountTotal: string;
  taxableTotal: string;
  taxTotal: string;
  freight: string;
  otherCharges: string;
  grandTotal: string;
}

/**
 * Line-level rounding (HALF_UP, 2 dp) then exact sums. The grand total is
 * always Σ(taxable) + Σ(tax) + freight + other charges, which under each tax
 * treatment reduces to:
 *
 *   EXCLUSIVE: Σgross − Σdiscount + Σtax + freight + other
 *   INCLUSIVE: Σgross − Σdiscount + freight + other   (the tax is already in it)
 *
 * The same `subtotal` therefore means a different amount payable under each
 * treatment, which is why `taxTreatment` is stored alongside the figures and
 * never defaulted away at comparison time.
 */
export function computeDocumentTotals(
  lines: PricedLine[],
  extras: { freight?: string; otherCharges?: string; taxTreatment?: TaxTreatment } = {},
): DocumentTotals {
  const taxTreatment = extras.taxTreatment ?? 'EXCLUSIVE';
  const computed = lines.map((l) =>
    computeLineAmounts({ quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent ?? '0', taxRatePercent: l.taxRate, taxTreatment }),
  );
  const sum = (k: 'gross' | 'discount' | 'taxable' | 'tax' | 'total') => Dec.sum(computed.map((c) => c[k])).toFixed(MONEY_SCALE);
  const freight = Dec.of(extras.freight ?? '0').round(MONEY_SCALE);
  const other = Dec.of(extras.otherCharges ?? '0').round(MONEY_SCALE);
  const grand = Dec.of(sum('taxable')).add(sum('tax')).add(freight).add(other);
  return {
    lines: computed,
    subtotal: sum('gross'),
    discountTotal: sum('discount'),
    taxableTotal: sum('taxable'),
    taxTotal: sum('tax'),
    freight: freight.toFixed(MONEY_SCALE),
    otherCharges: other.toFixed(MONEY_SCALE),
    grandTotal: grand.toFixed(MONEY_SCALE),
  };
}

// ── Schemas ────────────────────────────────────────────────────────────────

const text = (max: number) => z.string().trim().max(max);
const req = (max: number, label: string) => text(max).min(1, `${label} is required`);
const opt = (max: number) =>
  text(max)
    .nullish()
    .transform((v) => (v ? v : null));
const decimal = (opts: { positive?: boolean; scale: number; max?: string }) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => Dec.isValid(v), 'Enter a number')
    .refine((v) => (v.split('.')[1]?.length ?? 0) <= opts.scale, `At most ${opts.scale} decimal places`)
    .refine((v) => (opts.positive ? Dec.of(v).gt('0') : Dec.of(v).gte('0')), opts.positive ? 'Must be greater than 0' : 'Cannot be negative')
    .refine((v) => Dec.of(v).lte(opts.max ?? '999999999999'), 'Value is too large');
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((v) => !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()), 'Invalid date');
const todayIso = () => new Date().toISOString().slice(0, 10);

export const requisitionLineSchema = z.object({
  itemType: z.enum(LINE_ITEM_TYPES),
  description: req(1000, 'Description'),
  quantity: decimal({ positive: true, scale: 4, max: '99999999' }),
  uom: z.enum(UNITS_OF_MEASURE),
  estimatedUnitPrice: decimal({ scale: 4, max: '9999999999' }),
  taxCategory: z.string().refine((c) => taxRateFor(c) !== null, 'Select a tax category'),
  preferredVendorId: z.uuid().nullish(),
});
export type RequisitionLineInput = z.infer<typeof requisitionLineSchema>;

export const requisitionSchema = z.object({
  title: req(200, 'Title'),
  departmentId: z.uuid({ message: 'Select a department' }),
  costCentreId: z.uuid().nullish(),
  justification: req(4000, 'Business justification').min(10, 'Explain the business need (at least 10 characters)'),
  requiredBy: isoDate.refine((d) => d >= todayIso(), 'Required-by date cannot be in the past'),
  deliveryLocation: req(300, 'Delivery location'),
  priority: z.enum(REQUISITION_PRIORITIES).default('NORMAL'),
  lines: z.array(requisitionLineSchema).min(1, 'Add at least one line item').max(100, 'At most 100 lines'),
});
export type RequisitionInput = z.infer<typeof requisitionSchema>;
export const updateRequisitionSchema = requisitionSchema.extend({ version: z.number().int().nonnegative() });

export const requisitionListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
  q: z.string().trim().max(100).optional(),
  status: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : []))
    .pipe(z.array(z.enum(REQUISITION_STATUSES))),
  scope: z.enum(['mine', 'all']).default('all'),
  departmentId: z.uuid().optional(),
  priority: z.enum(REQUISITION_PRIORITIES).optional(),
  sourcing: z.enum(['ready', 'rfq', 'direct']).optional(),
  sort: z.enum(['createdAt', 'requiredBy', 'estimatedTotal', 'requisitionNo', 'status']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const directPurchaseSchema = z.object({ vendorId: z.uuid(), reason: req(1000, 'Reason').min(10, 'Explain why competitive sourcing is not needed') });

export const rfqLineInput = z.object({
  requisitionLineId: z.uuid().nullish(),
  itemType: z.enum(LINE_ITEM_TYPES),
  description: req(1000, 'Description'),
  specification: opt(2000),
  quantity: decimal({ positive: true, scale: 4, max: '99999999' }),
  uom: z.enum(UNITS_OF_MEASURE),
});

export const rfqSchema = z
  .object({
    requisitionId: z.uuid().nullish(),
    title: req(200, 'Title'),
    description: opt(4000),
    deliveryRequirements: opt(2000),
    deliveryLocation: req(300, 'Delivery location'),
    responseDeadline: z.iso
      .datetime({ offset: true })
      .refine((d) => new Date(d).getTime() > Date.now() + 60 * 60 * 1000, 'Deadline must be at least 1 hour from now'),
    submissionInstructions: opt(4000),
    termsAndConditions: opt(8000),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/)
      .default('INR'),
    standaloneReason: opt(1000),
    /** From a requisition: subset of requisition line ids to include (default all). Standalone: explicit lines. */
    requisitionLineIds: z.array(z.uuid()).max(100).optional(),
    lines: z.array(rfqLineInput).max(100).optional(),
    /** Procurement policy decision, made when the RFQ is raised: may different lines go to different vendors? */
    allowPartialAward: z.boolean().default(false),
    vendorIds: z.array(z.uuid()).max(50).default([]),
  })
  .superRefine((r, ctx) => {
    if (!r.requisitionId) {
      if (!r.standaloneReason) ctx.addIssue({ code: 'custom', path: ['standaloneReason'], message: 'Standalone RFQs need a justification' });
      if (!r.lines?.length) ctx.addIssue({ code: 'custom', path: ['lines'], message: 'Add at least one item' });
    }
  });
export type RfqInput = z.infer<typeof rfqSchema>;

export const updateRfqSchema = z.object({
  title: req(200, 'Title').optional(),
  description: opt(4000).optional(),
  deliveryRequirements: opt(2000).optional(),
  deliveryLocation: req(300, 'Delivery location').optional(),
  responseDeadline: z.iso.datetime({ offset: true }).optional(),
  submissionInstructions: opt(4000).optional(),
  termsAndConditions: opt(8000).optional(),
  version: z.number().int().nonnegative(),
});

export const extendDeadlineSchema = z.object({
  responseDeadline: z.iso.datetime({ offset: true }).refine((d) => new Date(d).getTime() > Date.now(), 'New deadline must be in the future'),
  reason: req(1000, 'Reason').min(5, 'Give a reason'),
});

export const inviteVendorsSchema = z.object({ vendorIds: z.array(z.uuid()).min(1, 'Select at least one vendor').max(50) });
export const reminderSchema = z.object({ invitationIds: z.array(z.uuid()).max(50).optional(), message: opt(2000) });
export const declineInvitationSchema = z.object({ reason: req(1000, 'Reason').min(3, 'Record the vendor’s reason') });

export const rfqListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
  q: z.string().trim().max(100).optional(),
  status: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : []))
    .pipe(z.array(z.enum(RFQ_STATUSES))),
  sort: z.enum(['createdAt', 'responseDeadline', 'rfqNo', 'status']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const quotationLineInput = z.object({
  rfqLineId: z.uuid(),
  description: opt(1000),
  quantity: decimal({ positive: true, scale: 4, max: '99999999' }),
  unitPrice: decimal({ scale: 4, max: '9999999999' }),
  discountPercent: decimal({ scale: 2, max: '100' }).default('0'),
  taxRate: decimal({ scale: 2, max: '100' }),
  remarks: opt(500),
});

export const quotationVersionSchema = z
  .object({
    vendorReference: opt(80),
    quotationDate: isoDate,
    validUntil: isoDate,
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/)
      .default('INR'),
    deliveryLeadDays: z.number().int().min(0).max(3650).nullish(),
    warranty: opt(300),
    paymentTermsDays: z.number().int().min(0).max(365).nullish(),
    paymentTerms: opt(500),
    freight: decimal({ scale: 2 }).default('0'),
    otherCharges: decimal({ scale: 2 }).default('0'),
    otherChargesNote: opt(300),
    notes: opt(4000),
    taxTreatment: z.enum(TAX_TREATMENTS).default('EXCLUSIVE'),
    receivedVia: z.enum(QUOTATION_RECEIVED_VIA).default('MANUAL_ENTRY'),
    sourceDocumentId: z.uuid().nullish(),
    lines: z.array(quotationLineInput).min(1, 'Quote at least one item').max(100),
  })
  .superRefine((q, ctx) => {
    if (q.validUntil < q.quotationDate) ctx.addIssue({ code: 'custom', path: ['validUntil'], message: 'Validity must be on or after the quotation date' });
    if (q.receivedVia === 'UPLOADED_DOCUMENT' && !q.sourceDocumentId)
      ctx.addIssue({ code: 'custom', path: ['sourceDocumentId'], message: 'Attach the vendor’s quotation document' });
    const ids = q.lines.map((l) => l.rfqLineId);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['lines'], message: 'Each RFQ item may be quoted once' });
  });
export type QuotationVersionInput = z.infer<typeof quotationVersionSchema>;

export const createQuotationSchema = quotationVersionSchema.and(
  z.object({
    vendorId: z.uuid(),
    submit: z.boolean().default(false),
    lateAcceptanceReason: opt(1000),
  }),
);

export const submitQuotationVersionSchema = z.object({ changeSummary: opt(2000), lateAcceptanceReason: opt(1000) });
export const quotationActionSchema = z.object({ note: req(2000, 'Note').min(5, 'Add a note for the record') });
