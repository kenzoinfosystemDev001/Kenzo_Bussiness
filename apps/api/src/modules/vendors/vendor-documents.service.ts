import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import type { Prisma, Vendor, VendorDocument, VendorDocumentType } from '@prisma/client';
import { DOCUMENT_EXPIRY_WARNING_DAYS, VENDOR_DOCUMENT_LABELS, requiredVendorDocuments, type VendorDocumentMetaInput } from '@kenzo/shared';
import { ENV, type Env } from '../../config/env';
import type { AuthContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { NotificationService } from '../../infrastructure/notifications/notification.service';
import { PrismaService, type Db } from '../../infrastructure/prisma/prisma.service';
import { AuthorizationService } from '../access-control/authorization.service';
import { SegregationOfDutiesService } from '../access-control/segregation-of-duties.service';
import { assignmentStartCutoff } from '../access-control/access-context.loader';
import { DocumentsService } from '../documents/documents.service';
import { VendorCommon } from './vendor-common';

/** Document types where a new upload supersedes the current one (a vendor has one GST certificate). */
const SINGLE_INSTANCE_TYPES: VendorDocumentType[] = ['GST_CERTIFICATE', 'PAN_CARD', 'INCORPORATION', 'BANK_PROOF', 'MSME_CERTIFICATE'];

export type RequirementState = 'VERIFIED' | 'PENDING' | 'REJECTED' | 'EXPIRED' | 'MISSING';

export interface ComplianceResult {
  requirements: Array<{ documentType: VendorDocumentType; label: string; state: RequirementState; vendorDocumentId: string | null; expiryDate: Date | null }>;
  compliant: boolean;
  verifiedCount: number;
}

const startOfTodayUtc = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

@Injectable()
export class VendorDocumentsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('VendorDocuments');
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly common: VendorCommon,
    private readonly authz: AuthorizationService,
    private readonly sod: SegregationOfDutiesService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap(): void {
    // Anyone who may read the vendor may download its linked documents (via signed URL + session).
    this.documents.registerLinkAccess('vendor', async (db, auth, vendorId) => {
      if (!this.authz.has(auth, 'vendor.read')) return false;
      return (await db.vendor.count({ where: { id: vendorId, companyId: auth.companyId } })) === 1;
    });
    const every = this.env.VENDOR_EXPIRY_SCAN_MS;
    if (every > 0 && this.env.NODE_ENV !== 'test') {
      this.timer = setInterval(() => void this.runExpiryScan(null).catch((e: Error) => this.logger.error(`expiry scan failed: ${e.message}`)), every);
      this.timer.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async upload(auth: AuthContext, vendorId: string, file: { originalname: string; buffer: Buffer; size: number }, meta: VendorDocumentMetaInput) {
    const vendor = await this.common.load(this.prisma, auth, vendorId);
    if (vendor.status === 'ARCHIVED') throw AppError.invalidState('Archived vendors cannot receive new documents');

    let previous: VendorDocument | null = null;
    if (meta.replacesId) {
      previous = await this.prisma.vendorDocument.findFirst({ where: { id: meta.replacesId, vendorId, companyId: auth.companyId } });
      if (!previous) throw AppError.validation([{ path: 'replacesId', message: 'Document to replace not found' }]);
      if (!previous.isCurrent) throw AppError.invalidState('Only the current version can be replaced');
      if (previous.documentType !== meta.documentType)
        throw AppError.validation([{ path: 'documentType', message: 'A replacement must keep the same document type' }]);
    } else if (SINGLE_INSTANCE_TYPES.includes(meta.documentType)) {
      previous = await this.prisma.vendorDocument.findFirst({ where: { vendorId, documentType: meta.documentType, isCurrent: true } });
    }

    const stored = await this.documents.upload(auth, file, { entityType: 'vendor', entityId: vendorId, linkType: meta.documentType });
    return this.prisma.tx(async (tx) => {
      if (previous) {
        const flipped = await tx.vendorDocument.updateMany({ where: { id: previous.id, isCurrent: true }, data: { isCurrent: false } });
        if (flipped.count !== 1) throw AppError.versionConflict();
      }
      const created = await tx.vendorDocument.create({
        data: {
          companyId: auth.companyId,
          vendorId,
          documentId: stored.id,
          documentType: meta.documentType,
          title: meta.title,
          documentNumber: meta.documentNumber ?? null,
          issueDate: meta.issueDate ? new Date(`${meta.issueDate}T00:00:00Z`) : null,
          expiryDate: meta.expiryDate ? new Date(`${meta.expiryDate}T00:00:00Z`) : null,
          versionNo: previous ? previous.versionNo + 1 : 1,
          previousVersionId: previous?.id ?? null,
          uploadedById: auth.userId,
        },
        include: { document: { select: { originalName: true, mimeType: true, sizeBytes: true, sha256: true } } },
      });
      await this.audit.record(tx, {
        action: previous ? 'vendor.document.versioned' : 'vendor.document.uploaded',
        entityType: 'vendor',
        entityId: vendorId,
        after: {
          vendorDocumentId: created.id,
          documentType: meta.documentType,
          version: created.versionNo,
          expiryDate: meta.expiryDate ?? null,
          sha256: stored.sha256,
        },
      });
      return created;
    });
  }

  /**
   * Verification by an authorised reviewer. The uploader can never verify their
   * own document. BANK_PROOF may also be verified by bank-detail approvers.
   */
  async verify(auth: AuthContext, vendorId: string, vendorDocumentId: string, decision: 'VERIFIED' | 'REJECTED', note: string | null) {
    return this.prisma.tx(async (tx) => {
      const doc = await tx.vendorDocument.findFirst({ where: { id: vendorDocumentId, vendorId, companyId: auth.companyId } });
      if (!doc) throw AppError.notFound('Document');
      const allowed = this.authz.has(auth, 'vendor.approve') || (doc.documentType === 'BANK_PROOF' && this.authz.has(auth, 'vendor.bank.approve'));
      if (!allowed) throw AppError.forbidden('You are not allowed to verify this document');
      if (doc.documentType === 'BANK_PROOF') this.authz.assertMfa(auth, 'vendor.bank.approve');
      this.sod.assert('SELF_APPROVAL', auth.userId, [doc.uploadedById]);
      if (!doc.isCurrent) throw AppError.invalidState('Only the current version can be verified');
      if (doc.verificationStatus !== 'PENDING') throw AppError.invalidState(`This document is already ${doc.verificationStatus.toLowerCase()}`);
      const updated = await tx.vendorDocument.update({
        where: { id: doc.id },
        data: { verificationStatus: decision, verificationNote: note, verifiedById: auth.userId, verifiedAt: new Date() },
      });
      await this.audit.record(tx, {
        action: `vendor.document.${decision === 'VERIFIED' ? 'verified' : 'rejected'}`,
        entityType: 'vendor',
        entityId: vendorId,
        after: { vendorDocumentId: doc.id, documentType: doc.documentType, version: doc.versionNo },
        reason: note,
      });
      if (decision === 'REJECTED') {
        const vendor = await tx.vendor.findUniqueOrThrow({ where: { id: vendorId } });
        await this.notifications.notify(tx, {
          companyId: auth.companyId,
          userId: doc.uploadedById,
          type: 'vendor.document.rejected',
          title: `${VENDOR_DOCUMENT_LABELS[doc.documentType]} rejected — ${vendor.legalName}`,
          body: note ?? undefined,
          link: `/vendors/${vendorId}?tab=documents`,
          entityType: 'vendor',
          entityId: vendorId,
        });
      }
      return updated;
    });
  }

  async compliance(db: Db, vendor: Vendor): Promise<ComplianceResult> {
    const [docs, bankCount] = await Promise.all([
      db.vendorDocument.findMany({ where: { vendorId: vendor.id, isCurrent: true } }),
      db.vendorBankAccount.count({ where: { vendorId: vendor.id, status: { in: ['PROPOSED', 'ACTIVE'] } } }),
    ]);
    const today = startOfTodayUtc();
    const required = requiredVendorDocuments({
      gstRegistrationType: vendor.gstRegistrationType,
      msmeRegistered: vendor.msmeRegistered,
      hasBankAccount: bankCount > 0,
    });
    const requirements = required.map((type) => {
      const doc = docs.find((d) => d.documentType === type);
      let state: RequirementState = 'MISSING';
      if (doc) {
        if (doc.expiryDate && doc.expiryDate < today) state = 'EXPIRED';
        else state = doc.verificationStatus;
      }
      return { documentType: type, label: VENDOR_DOCUMENT_LABELS[type], state, vendorDocumentId: doc?.id ?? null, expiryDate: doc?.expiryDate ?? null };
    });
    const verifiedCount = requirements.filter((r) => r.state === 'VERIFIED').length;
    return { requirements, compliant: verifiedCount === requirements.length, verifiedCount };
  }

  /** Document verification workspace queue. */
  async queue(auth: AuthContext, q: { filter: 'pending_verification' | 'expiring' | 'expired' | 'rejected'; page: number; pageSize: number }) {
    const today = startOfTodayUtc();
    const soon = new Date(today.getTime() + DOCUMENT_EXPIRY_WARNING_DAYS * 86_400_000);
    const filter: Prisma.VendorDocumentWhereInput =
      q.filter === 'pending_verification'
        ? { verificationStatus: 'PENDING' }
        : q.filter === 'rejected'
          ? { verificationStatus: 'REJECTED' }
          : q.filter === 'expiring'
            ? { expiryDate: { gte: today, lte: soon } }
            : { expiryDate: { lt: today } };
    const where: Prisma.VendorDocumentWhereInput = { companyId: auth.companyId, isCurrent: true, vendor: { status: { not: 'ARCHIVED' } }, ...filter };
    const [total, items] = await Promise.all([
      this.prisma.vendorDocument.count({ where }),
      this.prisma.vendorDocument.findMany({
        where,
        include: {
          vendor: { select: { id: true, vendorCode: true, legalName: true, status: true } },
          document: { select: { originalName: true, mimeType: true, sizeBytes: true } },
          uploadedBy: { select: { id: true, fullName: true } },
          verifiedBy: { select: { id: true, fullName: true } },
        },
        orderBy: q.filter === 'expiring' || q.filter === 'expired' ? [{ expiryDate: 'asc' }] : [{ createdAt: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return {
      items,
      total,
      page: q.page,
      pageSize: q.pageSize,
      canVerify: this.authz.has(auth, 'vendor.approve') || this.authz.has(auth, 'vendor.bank.approve'),
    };
  }

  /** Users who should hear about vendor compliance events: holders of vendor.approve. */
  private async complianceRecipients(db: Db, companyId: string): Promise<string[]> {
    const now = new Date();
    const rows = await db.userRoleAssignment.findMany({
      where: {
        companyId,
        revokedAt: null,
        validFrom: { lte: assignmentStartCutoff(now) },
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
        user: { status: 'ACTIVE' },
        role: { permissions: { some: { permissionKey: 'vendor.approve' } } },
      },
      select: { userId: true },
    });
    return [...new Set(rows.map((r) => r.userId))];
  }

  /**
   * Idempotent expiry notifications: one warning per document when it enters the
   * warning window and one notice when it expires. `companyId` null = all companies.
   */
  async runExpiryScan(companyId: string | null): Promise<{ warned: number; expired: number }> {
    const today = startOfTodayUtc();
    const soon = new Date(today.getTime() + DOCUMENT_EXPIRY_WARNING_DAYS * 86_400_000);
    const base: Prisma.VendorDocumentWhereInput = {
      isCurrent: true,
      vendor: { status: { notIn: ['ARCHIVED', 'REJECTED'] } },
      ...(companyId ? { companyId } : {}),
    };
    const [expiring, expired] = await Promise.all([
      this.prisma.vendorDocument.findMany({
        where: { ...base, expiryDate: { gte: today, lte: soon }, expiryWarnedAt: null },
        include: { vendor: true },
        take: 500,
      }),
      this.prisma.vendorDocument.findMany({ where: { ...base, expiryDate: { lt: today }, expiredNotifiedAt: null }, include: { vendor: true }, take: 500 }),
    ]);
    let warned = 0;
    let expiredCount = 0;
    for (const [list, kind] of [
      [expiring, 'expiring'],
      [expired, 'expired'],
    ] as const) {
      for (const doc of list) {
        await this.prisma.tx(async (tx) => {
          const claim = await tx.vendorDocument.updateMany({
            where: { id: doc.id, ...(kind === 'expiring' ? { expiryWarnedAt: null } : { expiredNotifiedAt: null }) },
            data: kind === 'expiring' ? { expiryWarnedAt: new Date() } : { expiredNotifiedAt: new Date() },
          });
          if (claim.count !== 1) return;
          const recipients = new Set([...(await this.complianceRecipients(tx, doc.companyId)), doc.vendor.createdById]);
          const days = Math.round(((doc.expiryDate?.getTime() ?? 0) - today.getTime()) / 86_400_000);
          const title =
            kind === 'expiring'
              ? `${VENDOR_DOCUMENT_LABELS[doc.documentType]} for ${doc.vendor.legalName} expires in ${days} day${days === 1 ? '' : 's'}`
              : `${VENDOR_DOCUMENT_LABELS[doc.documentType]} for ${doc.vendor.legalName} has expired`;
          for (const userId of recipients) {
            await this.notifications.notify(tx, {
              companyId: doc.companyId,
              userId,
              type: `vendor.document.${kind}`,
              title,
              body: `Upload a renewed document to keep ${doc.vendor.vendorCode} compliant.`,
              link: `/vendors/${doc.vendorId}?tab=documents`,
              entityType: 'vendor',
              entityId: doc.vendorId,
            });
          }
          await this.audit.record(tx, {
            action: `vendor.document.${kind}_notified`,
            entityType: 'vendor',
            entityId: doc.vendorId,
            companyId: doc.companyId,
            actorId: null,
            after: { vendorDocumentId: doc.id, expiryDate: doc.expiryDate, recipients: recipients.size },
          });
          if (kind === 'expiring') warned++;
          else expiredCount++;
        });
      }
    }
    return { warned, expired: expiredCount };
  }
}
