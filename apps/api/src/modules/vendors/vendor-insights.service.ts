import { Injectable } from '@nestjs/common';
import type { Prisma, Vendor } from '@prisma/client';
import { DOCUMENT_EXPIRY_WARNING_DAYS, VENDOR_STATUSES, type VendorListQuery } from '@kenzo/shared';
import type { AuthContext } from '../../common/context/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuthorizationService } from '../access-control/authorization.service';
import { bankAccountView, vendorView, VendorCommon } from './vendor-common';
import { VendorDocumentsService, type ComplianceResult } from './vendor-documents.service';

const today = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

/** Transactional relations owned by modules that ship in later phases. */
const FUTURE_RELATIONS = [
  { key: 'rfqs', label: 'RFQ invitations', phase: 3 },
  { key: 'quotations', label: 'Quotations', phase: 3 },
  { key: 'awards', label: 'Awarded quotations', phase: 3 },
  { key: 'purchaseOrders', label: 'Purchase orders', phase: 4 },
  { key: 'goodsReceipts', label: 'Goods receipts', phase: 4 },
  { key: 'serviceAcceptances', label: 'Service acceptances', phase: 4 },
  { key: 'invoices', label: 'Vendor invoices', phase: 5 },
  { key: 'payments', label: 'Payments', phase: 5 },
  { key: 'outstanding', label: 'Outstanding balance', phase: 5 },
  { key: 'disputes', label: 'Disputes', phase: 5 },
] as const;

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

@Injectable()
export class VendorInsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly common: VendorCommon,
    private readonly docs: VendorDocumentsService,
    private readonly authz: AuthorizationService,
  ) {}

  async list(auth: AuthContext, q: VendorListQuery) {
    const t = today();
    const soon = new Date(t.getTime() + DOCUMENT_EXPIRY_WARNING_DAYS * 86_400_000);
    const and: Prisma.VendorWhereInput[] = [{ companyId: auth.companyId }];
    if (q.status.length) and.push({ status: { in: q.status } });
    else and.push({ status: { not: 'ARCHIVED' } });
    if (q.vendorType) and.push({ vendorType: q.vendorType });
    if (q.category) and.push({ category: { equals: q.category, mode: 'insensitive' } });
    if (q.gstRegistrationType) and.push({ gstRegistrationType: q.gstRegistrationType });
    if (q.msme) and.push({ msmeRegistered: q.msme === 'true' });
    if (q.q) {
      const term = q.q.trim();
      and.push({
        OR: [
          { legalName: { contains: term, mode: 'insensitive' } },
          { tradeName: { contains: term, mode: 'insensitive' } },
          { vendorCode: { contains: term, mode: 'insensitive' } },
          { gstin: { contains: term.toUpperCase() } },
          { city: { contains: term, mode: 'insensitive' } },
          { contacts: { some: { OR: [{ name: { contains: term, mode: 'insensitive' } }, { email: { contains: term.toLowerCase() } }] } } },
        ],
      });
    }
    if (q.documentAlert === 'expiring') and.push({ documents: { some: { isCurrent: true, expiryDate: { gte: t, lte: soon } } } });
    if (q.documentAlert === 'expired') and.push({ documents: { some: { isCurrent: true, expiryDate: { lt: t } } } });
    if (q.documentAlert === 'pending_verification') and.push({ documents: { some: { isCurrent: true, verificationStatus: 'PENDING' } } });
    if (q.documentAlert === 'missing') and.push({ documents: { none: { isCurrent: true } } });

    const where: Prisma.VendorWhereInput = { AND: and };
    const [total, rows] = await Promise.all([
      this.prisma.vendor.count({ where }),
      this.prisma.vendor.findMany({
        where,
        include: {
          contacts: { where: { isPrimary: true }, take: 1 },
          documents: { where: { isCurrent: true }, select: { verificationStatus: true, expiryDate: true } },
          bankAccounts: { where: { status: { in: ['ACTIVE', 'PROPOSED'] } }, select: { status: true } },
          createdBy: { select: { id: true, fullName: true } },
        },
        orderBy: [{ [q.sort]: q.order }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map(({ contacts, documents, bankAccounts, ...v }) => ({
        ...vendorView(v as Vendor),
        createdBy: (v as { createdBy: { id: string; fullName: string } }).createdBy,
        primaryContact: contacts[0] ?? null,
        documentSummary: {
          total: documents.length,
          pending: documents.filter((d) => d.verificationStatus === 'PENDING').length,
          rejected: documents.filter((d) => d.verificationStatus === 'REJECTED').length,
          expiring: documents.filter((d) => d.expiryDate && d.expiryDate >= t && d.expiryDate <= soon).length,
          expired: documents.filter((d) => d.expiryDate && d.expiryDate < t).length,
        },
        bankStatus: bankAccounts.some((b) => b.status === 'ACTIVE') ? 'VERIFIED' : bankAccounts.length ? 'PENDING' : 'NONE',
      })),
    };
  }

  /** Vendor overview dashboard — every number is a live count. */
  async stats(auth: AuthContext) {
    const companyId = auth.companyId;
    const t = today();
    const soon = new Date(t.getTime() + DOCUMENT_EXPIRY_WARNING_DAYS * 86_400_000);
    const sixMonthsAgo = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 5, 1));
    const [byStatus, byType, byCategory, byGst, msme, docsPending, docsExpiring, docsExpired, bankPending, recent, createdSeries, activatedSeries] =
      await Promise.all([
        this.prisma.vendor.groupBy({ by: ['status'], where: { companyId }, _count: { _all: true } }),
        this.prisma.vendor.groupBy({ by: ['vendorType'], where: { companyId, status: { not: 'ARCHIVED' } }, _count: { _all: true } }),
        this.prisma.vendor.groupBy({
          by: ['category'],
          where: { companyId, status: { not: 'ARCHIVED' } },
          _count: { _all: true },
          orderBy: { _count: { category: 'desc' } },
          take: 8,
        }),
        this.prisma.vendor.groupBy({ by: ['gstRegistrationType'], where: { companyId, status: { not: 'ARCHIVED' } }, _count: { _all: true } }),
        this.prisma.vendor.count({ where: { companyId, msmeRegistered: true, status: { not: 'ARCHIVED' } } }),
        this.prisma.vendorDocument.count({ where: { companyId, isCurrent: true, verificationStatus: 'PENDING', vendor: { status: { not: 'ARCHIVED' } } } }),
        this.prisma.vendorDocument.count({ where: { companyId, isCurrent: true, expiryDate: { gte: t, lte: soon }, vendor: { status: { not: 'ARCHIVED' } } } }),
        this.prisma.vendorDocument.count({
          where: { companyId, isCurrent: true, expiryDate: { lt: t }, vendor: { status: { notIn: ['ARCHIVED', 'REJECTED'] } } },
        }),
        this.prisma.vendorBankChangeRequest.count({ where: { companyId, status: 'PENDING_APPROVAL' } }),
        this.prisma.vendor.findMany({
          where: { companyId },
          orderBy: { updatedAt: 'desc' },
          take: 6,
          select: { id: true, vendorCode: true, legalName: true, status: true, category: true, city: true, updatedAt: true },
        }),
        this.prisma.$queryRaw<Array<{ month: Date; count: bigint }>>`
        SELECT date_trunc('month', created_at) AS month, count(*)::bigint AS count
        FROM vendor WHERE company_id = ${companyId}::uuid AND created_at >= ${sixMonthsAgo}
        GROUP BY 1 ORDER BY 1`,
        this.prisma.$queryRaw<Array<{ month: Date; count: bigint }>>`
        SELECT date_trunc('month', activated_at) AS month, count(*)::bigint AS count
        FROM vendor WHERE company_id = ${companyId}::uuid AND activated_at >= ${sixMonthsAgo}
        GROUP BY 1 ORDER BY 1`,
      ]);
    const statusCounts = Object.fromEntries(VENDOR_STATUSES.map((s) => [s, byStatus.find((b) => b.status === s)?._count._all ?? 0])) as Record<string, number>;
    const months = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 5 + i, 1)));
    const series = (rows: Array<{ month: Date; count: bigint }>) =>
      months.map((m) => Number(rows.find((r) => new Date(r.month).getTime() === m.getTime())?.count ?? 0));
    return {
      totals: {
        all: Object.values(statusCounts).reduce((a, b) => a + b, 0) - statusCounts.ARCHIVED!,
        active: statusCounts.ACTIVE,
        inReview: statusCounts.SUBMITTED! + statusCounts.UNDER_REVIEW!,
        awaitingActivation: statusCounts.APPROVED,
        drafts: statusCounts.DRAFT,
        suspended: statusCounts.SUSPENDED,
        msme,
      },
      byStatus: statusCounts,
      byType: byType.map((b) => ({ vendorType: b.vendorType, count: b._count._all })),
      byCategory: byCategory.map((b) => ({ category: b.category, count: b._count._all })),
      byGstRegistration: byGst.map((b) => ({ gstRegistrationType: b.gstRegistrationType, count: b._count._all })),
      compliance: {
        documentsPendingVerification: docsPending,
        documentsExpiringSoon: docsExpiring,
        documentsExpired: docsExpired,
        bankChangesPending: bankPending,
        warningDays: DOCUMENT_EXPIRY_WARNING_DAYS,
      },
      trend: { months: months.map((m) => m.toISOString().slice(0, 7)), created: series(createdSeries), activated: series(activatedSeries) },
      recent,
    };
  }

  /** Transparent, explainable indicators — no AI, every input shown (PRD §3.2, MP02 §8). */
  async performance(
    vendor: Vendor,
    compliance: ComplianceResult,
    hasVerifiedBank: boolean,
    standardTermsDays = 30,
  ): Promise<{ indicators: Indicator[]; overall: number | null; measuredCount: number }> {
    const profileFields: Array<[string, unknown]> = [
      ['trade name', vendor.tradeName],
      ['email', vendor.email],
      ['phone', vendor.phone],
      ['website', vendor.website],
      ['registration number', vendor.registrationNumber],
      ['address line 2', vendor.addressLine2],
    ];
    const contacts = await this.prisma.vendorContact.count({ where: { vendorId: vendor.id } });
    const filled = profileFields.filter(([, v]) => v !== null && v !== '').length + (contacts > 0 ? 1 : 0);
    const totalFields = profileFields.length + 1;

    const indicators: Indicator[] = [
      {
        key: 'document_compliance',
        label: 'Document compliance',
        status: compliance.requirements.length ? 'measured' : 'insufficient_data',
        score: compliance.requirements.length ? Math.round((compliance.verifiedCount / compliance.requirements.length) * 100) : null,
        value: `${compliance.verifiedCount} of ${compliance.requirements.length} required documents verified and valid`,
        formula: 'verified & unexpired required documents ÷ required documents × 100',
        inputs: Object.fromEntries(compliance.requirements.map((r) => [r.label, r.state])),
        explanation: 'Required documents depend on GST registration type, MSME status and whether bank details are held.',
      },
      {
        key: 'bank_verification',
        label: 'Bank details verified',
        status: 'measured',
        score: hasVerifiedBank ? 100 : 0,
        value: hasVerifiedBank ? 'Active account verified through maker-checker' : 'No verified bank account',
        formula: '100 if an ACTIVE account was verified by an independent approver, else 0',
        inputs: { verifiedAccount: hasVerifiedBank ? 'yes' : 'no' },
        explanation: 'Payments can only be released to a verified account.',
      },
      {
        key: 'payment_terms',
        label: 'Payment terms',
        status: 'measured',
        score: Math.min(100, Math.round((vendor.paymentTermsDays / standardTermsDays) * 100)),
        value: `${vendor.paymentTermsDays} days (standard ${standardTermsDays})`,
        formula: 'min(100, vendor credit days ÷ company standard days × 100)',
        inputs: { vendorTermsDays: vendor.paymentTermsDays, standardTermsDays },
        explanation: 'Longer credit terms improve working capital. Standard is the company default of 30 days.',
      },
      {
        key: 'profile_completeness',
        label: 'Profile completeness',
        status: 'measured',
        score: Math.round((filled / totalFields) * 100),
        value: `${filled} of ${totalFields} optional profile items present`,
        formula: 'present optional fields (incl. ≥1 contact) ÷ tracked fields × 100',
        inputs: Object.fromEntries([...profileFields.map(([k, v]) => [k, v ? 'present' : 'missing']), ['contacts', contacts]]),
        explanation: 'Complete profiles reduce onboarding queries and payment errors.',
      },
      {
        key: 'on_time_delivery',
        label: 'On-time delivery',
        status: 'not_available',
        score: null,
        value: null,
        formula: 'accepted receipts delivered on/before agreed date ÷ eligible completed deliveries',
        inputs: {},
        explanation: 'Calculated from goods receipts and PO delivery schedules.',
        availableInPhase: 4,
      },
      {
        key: 'acceptance_rate',
        label: 'Accepted vs rejected quantity',
        status: 'not_available',
        score: null,
        value: null,
        formula: 'accepted quantity ÷ received quantity across GRNs',
        inputs: {},
        explanation: 'Calculated from goods receipt notes.',
        availableInPhase: 4,
      },
      {
        key: 'quotation_competitiveness',
        label: 'Quotation competitiveness',
        status: 'not_available',
        score: null,
        value: null,
        formula: 'share of RFQs where the vendor’s normalised landed cost was lowest or within 5 %',
        inputs: {},
        explanation: 'Calculated from RFQ comparisons.',
        availableInPhase: 3,
      },
      {
        key: 'invoice_disputes',
        label: 'Invoice disputes',
        status: 'not_available',
        score: null,
        value: null,
        formula: '100 − (disputed invoices ÷ invoices × 100)',
        inputs: {},
        explanation: 'Calculated from accounts payable.',
        availableInPhase: 5,
      },
    ];
    const measured = indicators.filter((i) => i.status === 'measured' && i.score !== null);
    return {
      indicators,
      measuredCount: measured.length,
      overall: measured.length ? Math.round(measured.reduce((a, i) => a + (i.score ?? 0), 0) / measured.length) : null,
    };
  }

  /** Vendor 360 — every section is read from the database. */
  async vendor360(auth: AuthContext, id: string) {
    const vendor = await this.common.load(this.prisma, auth, id);
    const [contacts, documents, bankAccounts, bankChanges, history, approvals] = await Promise.all([
      this.prisma.vendorContact.findMany({ where: { vendorId: id }, orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] }),
      this.prisma.vendorDocument.findMany({
        where: { vendorId: id },
        include: {
          document: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true, scanStatus: true } },
          uploadedBy: { select: { id: true, fullName: true } },
          verifiedBy: { select: { id: true, fullName: true } },
        },
        orderBy: [{ documentType: 'asc' }, { versionNo: 'desc' }],
      }),
      this.prisma.vendorBankAccount.findMany({
        where: { vendorId: id },
        include: { verifiedBy: { select: { id: true, fullName: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.vendorBankChangeRequest.findMany({
        where: { vendorId: id },
        include: { requestedBy: { select: { id: true, fullName: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.vendorStatusHistory.findMany({
        where: { vendorId: id },
        include: { actor: { select: { id: true, fullName: true } } },
        orderBy: { occurredAt: 'asc' },
      }),
      this.prisma.approvalInstance.findMany({
        where: {
          companyId: auth.companyId,
          OR: [
            { entityType: 'vendor', entityId: id },
            {
              entityType: 'vendor_bank_change',
              entityId: { in: (await this.prisma.vendorBankChangeRequest.findMany({ where: { vendorId: id }, select: { id: true } })).map((r) => r.id) },
            },
          ],
        },
        include: {
          requester: { select: { id: true, fullName: true } },
          tasks: {
            include: { assignee: { select: { id: true, fullName: true } }, stage: { select: { name: true } } },
            orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }],
          },
        },
        orderBy: { submittedAt: 'desc' },
      }),
    ]);
    const activity = this.authz.has(auth, 'audit.read')
      ? await this.prisma.auditEvent.findMany({
          where: { companyId: auth.companyId, entityType: 'vendor', entityId: id },
          include: { actor: { select: { id: true, fullName: true } } },
          orderBy: { occurredAt: 'desc' },
          take: 50,
        })
      : null;
    const compliance = await this.docs.compliance(this.prisma, vendor);
    const hasVerifiedBank = bankAccounts.some((a) => a.status === 'ACTIVE' && !!a.verifiedAt);
    const performance = await this.performance(vendor, compliance, hasVerifiedBank);
    const pendingVendorApproval = approvals.find((a) => a.entityType === 'vendor' && a.status === 'PENDING');

    return {
      vendor: vendorView(vendor),
      contacts,
      documents: documents.map((d) => ({ ...d, isExpired: !!d.expiryDate && d.expiryDate < today() })),
      bank: {
        accounts: bankAccounts.map((a) => ({ ...bankAccountView(a), verifiedBy: a.verifiedBy })),
        changeRequests: bankChanges,
        canReveal: this.authz.has(auth, 'vendor.bank.read'),
        canRequestChange: this.authz.has(auth, 'vendor.bank.update'),
      },
      compliance,
      performance,
      statusHistory: history,
      approvals: approvals.map((a) => ({
        ...a,
        myPendingTaskId: a.tasks.find((t) => t.assigneeId === auth.userId && t.status === 'PENDING')?.id ?? null,
      })),
      activity,
      relations: FUTURE_RELATIONS.map((r) => ({ ...r, available: false, count: null, records: [] as unknown[] })),
      viewer: {
        canEdit: this.authz.has(auth, 'vendor.update'),
        canApprove: this.authz.has(auth, 'vendor.approve'),
        canVerifyDocuments: this.authz.has(auth, 'vendor.approve') || this.authz.has(auth, 'vendor.bank.approve'),
        isCreator: vendor.createdById === auth.userId,
        pendingApprovalTaskId: pendingVendorApproval?.tasks.find((t) => t.assigneeId === auth.userId && t.status === 'PENDING')?.id ?? null,
        pendingApprovalInstanceId: pendingVendorApproval?.id ?? null,
      },
    };
  }
}
