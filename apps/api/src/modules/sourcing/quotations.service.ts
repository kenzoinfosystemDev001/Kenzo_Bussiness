import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { type Quotation, type QuotationStatus } from '@prisma/client';
import { computeDocumentTotals, type QuotationVersionInput } from '@kenzo/shared';
import type { AuthContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { NumberingService } from '../../infrastructure/numbering/numbering.service';
import { PrismaService, type Db, type Tx } from '../../infrastructure/prisma/prisma.service';
import { AuthorizationService } from '../access-control/authorization.service';
import { DocumentsService } from '../documents/documents.service';
import { RfqService } from './rfq.service';
import { dec, SourcingCommon, todayUtc } from './sourcing-common';

/** Statuses from which a new revision may be prepared. */
const REVISABLE: QuotationStatus[] = ['SUBMITTED', 'UNDER_EVALUATION', 'CLARIFICATION_REQUESTED', 'REVISED'];

@Injectable()
export class QuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly common: SourcingCommon,
    private readonly rfqs: RfqService,
    private readonly numbering: NumberingService,
    private readonly authz: AuthorizationService,
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Computes every money figure on the server with exact decimals and writes a
   * version plus its lines. The version is left unsubmitted so it can still be
   * edited; `submitVersion` freezes it (a database trigger then rejects any
   * further change to the row or its lines).
   */
  private async writeVersion(
    tx: Tx,
    auth: AuthContext,
    quotation: Quotation,
    versionNo: number,
    input: QuotationVersionInput,
    changeSummary: string | null,
  ): Promise<string> {
    const rfqLines = await tx.rfqLine.findMany({ where: { rfqId: quotation.rfqId } });
    const byId = new Map(rfqLines.map((l) => [l.id, l]));
    for (const line of input.lines) {
      if (!byId.has(line.rfqLineId)) throw AppError.validation([{ path: 'lines', message: 'A quoted item does not belong to this RFQ' }]);
    }
    if (input.sourceDocumentId) {
      const doc = await tx.document.findFirst({ where: { id: input.sourceDocumentId, companyId: auth.companyId } });
      if (!doc) throw AppError.validation([{ path: 'sourceDocumentId', message: 'Attached document not found' }]);
    }

    const totals = computeDocumentTotals(
      input.lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent, taxRate: l.taxRate })),
      { freight: input.freight, otherCharges: input.otherCharges },
    );

    const versionId = randomUUID();
    await tx.quotationVersion.create({
      data: {
        id: versionId,
        companyId: auth.companyId,
        quotationId: quotation.id,
        versionNo,
        vendorReference: input.vendorReference ?? null,
        quotationDate: new Date(`${input.quotationDate}T00:00:00Z`),
        validUntil: new Date(`${input.validUntil}T00:00:00Z`),
        currency: input.currency,
        deliveryLeadDays: input.deliveryLeadDays ?? null,
        warranty: input.warranty ?? null,
        paymentTermsDays: input.paymentTermsDays ?? null,
        paymentTerms: input.paymentTerms ?? null,
        freight: totals.freight,
        otherCharges: totals.otherCharges,
        otherChargesNote: input.otherChargesNote ?? null,
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        grandTotal: totals.grandTotal,
        notes: input.notes ?? null,
        changeSummary,
        receivedVia: input.receivedVia,
        sourceDocumentId: input.sourceDocumentId ?? null,
        createdById: auth.userId,
      },
    });
    await tx.quotationVersionLine.createMany({
      data: input.lines.map((l, i) => ({
        versionId,
        rfqId: quotation.rfqId,
        rfqLineId: l.rfqLineId,
        description: l.description ?? byId.get(l.rfqLineId)!.description,
        quantity: l.quantity,
        uom: byId.get(l.rfqLineId)!.uom,
        unitPrice: l.unitPrice,
        discountPercent: l.discountPercent,
        taxRate: l.taxRate,
        gross: totals.lines[i]!.gross,
        discount: totals.lines[i]!.discount,
        taxable: totals.lines[i]!.taxable,
        tax: totals.lines[i]!.tax,
        total: totals.lines[i]!.total,
        remarks: l.remarks ?? null,
      })),
    });
    return versionId;
  }

  /** Freezes a version. After this the database rejects any edit to it or its lines. */
  private async submitVersion(tx: Tx, auth: AuthContext, quotationId: string, versionId: string, status: QuotationStatus) {
    await tx.quotationVersion.update({ where: { id: versionId }, data: { submittedAt: new Date(), submittedById: auth.userId } });
    const version = await tx.quotationVersion.findUniqueOrThrow({ where: { id: versionId } });
    await tx.quotation.update({ where: { id: quotationId }, data: { status, currentVersionNo: version.versionNo, version: { increment: 1 } } });
    return version;
  }

  private async assertRfqAcceptsQuotations(tx: Tx, auth: AuthContext, rfqId: string) {
    const rfq = await this.common.loadRfq(tx, auth, rfqId);
    if (!['SENT', 'PARTIALLY_RESPONDED', 'RESPONSES_RECEIVED', 'EVALUATION'].includes(rfq.status)) {
      throw AppError.invalidState(`Quotations cannot be registered against a ${rfq.status.toLowerCase().replace(/_/g, ' ')} RFQ`);
    }
    return rfq;
  }

  /**
   * Registers a vendor's response. Quotations are entered by staff on the
   * vendor's behalf (manually or from an uploaded document); responses received
   * outside the system are recorded with `receivedVia`.
   */
  async register(auth: AuthContext, rfqId: string, input: QuotationVersionInput & { vendorId: string; submit: boolean; lateAcceptanceReason?: string | null }) {
    const quotationId = await this.prisma.tx(async (tx) => {
      await this.common.lockRfq(tx, rfqId);
      const rfq = await this.assertRfqAcceptsQuotations(tx, auth, rfqId);
      const invitation = await tx.rfqInvitation.findFirst({ where: { rfqId, vendorId: input.vendorId, status: { not: 'WITHDRAWN' } } });
      if (!invitation) throw AppError.validation([{ path: 'vendorId', message: 'That vendor was not invited to this RFQ' }]);
      const existing = await tx.quotation.findFirst({ where: { rfqId, vendorId: input.vendorId } });
      if (existing) throw new AppError('CONFLICT', `A quotation already exists for this vendor (${existing.quotationNo}). Record a revision instead.`, { details: { quotationId: existing.id } });

      const late = new Date() > rfq.responseDeadline;
      if (late && input.submit && !input.lateAcceptanceReason) {
        throw AppError.validation([{ path: 'lateAcceptanceReason', message: 'The response deadline has passed — record why this late quotation is accepted' }]);
      }
      if (input.currency !== rfq.currency) {
        throw AppError.validation([{ path: 'currency', message: `This RFQ asks for quotes in ${rfq.currency}` }]);
      }

      const id = randomUUID();
      const quotationNo = await this.numbering.next(tx, { companyId: auth.companyId, documentType: 'quotation', entityId: id, issuedById: auth.userId });
      const quotation = await tx.quotation.create({
        data: {
          id,
          companyId: auth.companyId,
          quotationNo,
          rfqId,
          vendorId: input.vendorId,
          invitationId: invitation.id,
          status: 'DRAFT',
          lateAcceptanceNote: late ? (input.lateAcceptanceReason ?? null) : null,
          createdById: auth.userId,
        },
      });
      const versionId = await this.writeVersion(tx, auth, quotation, 1, input, null);
      if (input.submit) {
        await this.submitVersion(tx, auth, id, versionId, 'SUBMITTED');
        await tx.rfqInvitation.update({ where: { id: invitation.id }, data: { status: 'RESPONDED', respondedAt: new Date() } });
        await tx.rfqCommunication.create({
          data: {
            companyId: auth.companyId,
            rfqId,
            invitationId: invitation.id,
            kind: 'QUOTATION_RECEIVED',
            direction: 'INBOUND',
            subject: `Quotation ${quotationNo} received`,
            body: `Recorded via ${input.receivedVia.toLowerCase().replace(/_/g, ' ')}${late ? ' after the response deadline' : ''}.`,
            actorId: auth.userId,
          },
        });
        await this.rfqs.refreshResponseStatus(tx, rfqId, auth.userId);
      }
      await this.audit.record(tx, {
        action: input.submit ? 'quotation.submitted' : 'quotation.drafted',
        entityType: 'quotation',
        entityId: id,
        after: { quotationNo, rfqId, vendorId: input.vendorId, versionNo: 1, grandTotal: null, receivedVia: input.receivedVia, late },
      });
      return id;
    });
    return this.detail(auth, quotationId);
  }

  /** Replaces an unsubmitted draft version in place (nothing is frozen yet). */
  async updateDraft(auth: AuthContext, quotationId: string, input: QuotationVersionInput) {
    await this.prisma.tx(async (tx) => {
      await this.common.lockQuotation(tx, quotationId);
      const quotation = await this.load(tx, auth, quotationId);
      const draft = await tx.quotationVersion.findFirst({ where: { quotationId, submittedAt: null } });
      if (!draft) throw AppError.invalidState('There is no unsubmitted version to edit');
      await tx.quotationVersionLine.deleteMany({ where: { versionId: draft.id } });
      await tx.quotationVersion.delete({ where: { id: draft.id } });
      await this.writeVersion(tx, auth, quotation, draft.versionNo, input, draft.changeSummary);
      await this.audit.record(tx, { action: 'quotation.draft_updated', entityType: 'quotation', entityId: quotationId, after: { versionNo: draft.versionNo } });
    });
    return this.detail(auth, quotationId);
  }

  async submitDraft(auth: AuthContext, quotationId: string, changeSummary: string | null | undefined, lateAcceptanceReason: string | null | undefined) {
    await this.prisma.tx(async (tx) => {
      await this.common.lockQuotation(tx, quotationId);
      const quotation = await this.load(tx, auth, quotationId);
      const rfq = await this.assertRfqAcceptsQuotations(tx, auth, quotation.rfqId);
      const draft = await tx.quotationVersion.findFirst({ where: { quotationId, submittedAt: null } });
      if (!draft) throw AppError.invalidState('There is no unsubmitted version to submit');
      if (draft.versionNo > 1 && !changeSummary) {
        throw AppError.validation([{ path: 'changeSummary', message: 'Describe what changed in this revision' }]);
      }
      if (new Date() > rfq.responseDeadline && !lateAcceptanceReason && !quotation.lateAcceptanceNote) {
        throw AppError.validation([{ path: 'lateAcceptanceReason', message: 'The response deadline has passed — record why this late quotation is accepted' }]);
      }
      if (changeSummary) await tx.quotationVersion.update({ where: { id: draft.id }, data: { changeSummary } });
      if (lateAcceptanceReason) await tx.quotation.update({ where: { id: quotationId }, data: { lateAcceptanceNote: lateAcceptanceReason } });

      const first = draft.versionNo === 1;
      await this.submitVersion(tx, auth, quotationId, draft.id, first ? 'SUBMITTED' : 'REVISED');
      if (first) {
        await tx.rfqInvitation.update({ where: { id: quotation.invitationId }, data: { status: 'RESPONDED', respondedAt: new Date() } });
        await this.rfqs.refreshResponseStatus(tx, quotation.rfqId, auth.userId);
      }
      await tx.quotationReview.create({
        data: { quotationId, versionNo: draft.versionNo, action: first ? 'SUBMITTED' : 'REVISION_SUBMITTED', note: changeSummary ?? null, reviewerId: auth.userId },
      });
      await this.audit.record(tx, {
        action: first ? 'quotation.submitted' : 'quotation.revised',
        entityType: 'quotation',
        entityId: quotationId,
        after: { versionNo: draft.versionNo, changeSummary },
      });
    });
    return this.detail(auth, quotationId);
  }

  /**
   * Starts a revision: creates version n+1 as an editable draft. The previous
   * submitted version stays untouched and remains in the history.
   */
  async startRevision(auth: AuthContext, quotationId: string, input: QuotationVersionInput) {
    await this.prisma.tx(async (tx) => {
      await this.common.lockQuotation(tx, quotationId);
      const quotation = await this.load(tx, auth, quotationId);
      await this.assertRfqAcceptsQuotations(tx, auth, quotation.rfqId);
      if (!REVISABLE.includes(quotation.status)) throw AppError.invalidState(`A ${quotation.status.toLowerCase().replace(/_/g, ' ')} quotation cannot be revised`);
      const openDraft = await tx.quotationVersion.findFirst({ where: { quotationId, submittedAt: null } });
      if (openDraft) throw AppError.invalidState(`Version ${openDraft.versionNo} is still a draft — submit or discard it first`);
      const latest = await tx.quotationVersion.findFirstOrThrow({ where: { quotationId }, orderBy: { versionNo: 'desc' } });
      await this.writeVersion(tx, auth, quotation, latest.versionNo + 1, input, null);
      await this.audit.record(tx, { action: 'quotation.revision_started', entityType: 'quotation', entityId: quotationId, after: { versionNo: latest.versionNo + 1 } });
    });
    return this.detail(auth, quotationId);
  }

  async discardDraft(auth: AuthContext, quotationId: string) {
    await this.prisma.tx(async (tx) => {
      await this.common.lockQuotation(tx, quotationId);
      await this.load(tx, auth, quotationId);
      const draft = await tx.quotationVersion.findFirst({ where: { quotationId, submittedAt: null } });
      if (!draft) throw AppError.invalidState('There is no unsubmitted version to discard');
      if (draft.versionNo === 1) throw AppError.invalidState('Cancel the quotation instead of discarding its only version');
      await tx.quotationVersionLine.deleteMany({ where: { versionId: draft.id } });
      await tx.quotationVersion.delete({ where: { id: draft.id } });
      await this.audit.record(tx, { action: 'quotation.draft_discarded', entityType: 'quotation', entityId: quotationId, before: { versionNo: draft.versionNo } });
    });
    return this.detail(auth, quotationId);
  }

  /** Reviewer actions that do not change the quoted figures. */
  async review(auth: AuthContext, quotationId: string, action: 'REQUEST_CLARIFICATION' | 'REJECT' | 'NOTE', note: string) {
    await this.prisma.tx(async (tx) => {
      await this.common.lockQuotation(tx, quotationId);
      const quotation = await this.load(tx, auth, quotationId);
      const next: QuotationStatus | null = action === 'REQUEST_CLARIFICATION' ? 'CLARIFICATION_REQUESTED' : action === 'REJECT' ? 'REJECTED' : null;
      if (next) {
        if (['ACCEPTED', 'REJECTED', 'EXPIRED'].includes(quotation.status)) throw AppError.invalidState(`This quotation is already ${quotation.status.toLowerCase()}`);
        await tx.quotation.update({ where: { id: quotationId }, data: { status: next, statusReason: note, version: { increment: 1 } } });
      }
      await tx.quotationReview.create({ data: { quotationId, versionNo: quotation.currentVersionNo, action, note, reviewerId: auth.userId } });
      await this.audit.record(tx, { action: `quotation.${action.toLowerCase()}`, entityType: 'quotation', entityId: quotationId, before: { status: quotation.status }, after: { status: next ?? quotation.status }, reason: note });
    });
    return this.detail(auth, quotationId);
  }

  /** Marks quotations whose validity has lapsed. Idempotent; safe to run repeatedly. */
  async expireLapsed(companyId: string): Promise<{ expired: number }> {
    const today = todayUtc();
    const candidates = await this.prisma.quotation.findMany({
      where: { companyId, status: { in: ['SUBMITTED', 'UNDER_EVALUATION', 'CLARIFICATION_REQUESTED', 'REVISED'] } },
      include: { versions: { orderBy: { versionNo: 'desc' }, take: 1, select: { validUntil: true, versionNo: true } } },
    });
    let expired = 0;
    for (const q of candidates) {
      const current = q.versions[0];
      if (!current || current.validUntil >= today) continue;
      await this.prisma.tx(async (tx) => {
        const claimed = await tx.quotation.updateMany({ where: { id: q.id, status: q.status }, data: { status: 'EXPIRED', statusReason: `Validity lapsed on ${current.validUntil.toISOString().slice(0, 10)}`, version: { increment: 1 } } });
        if (claimed.count !== 1) return;
        await tx.quotationReview.create({ data: { quotationId: q.id, versionNo: current.versionNo, action: 'EXPIRED', note: `Valid until ${current.validUntil.toISOString().slice(0, 10)}`, reviewerId: q.createdById } });
        await this.audit.record(tx, { action: 'quotation.expired', entityType: 'quotation', entityId: q.id, companyId, actorId: null, after: { validUntil: current.validUntil } });
        expired++;
      });
    }
    return { expired };
  }

  async addAttachment(auth: AuthContext, quotationId: string, file: { originalname: string; buffer: Buffer; size: number }) {
    const quotation = await this.load(this.prisma, auth, quotationId);
    const doc = await this.documents.upload(auth, file, { entityType: 'quotation', entityId: quotation.id });
    return { id: doc.id, originalName: doc.originalName, mimeType: doc.mimeType, sizeBytes: doc.sizeBytes, createdAt: doc.createdAt };
  }

  private async load(db: Db, auth: AuthContext, id: string): Promise<Quotation> {
    const q = await db.quotation.findFirst({ where: { id, companyId: auth.companyId } });
    if (!q) throw AppError.notFound('Quotation');
    return q;
  }

  async detail(auth: AuthContext, id: string) {
    const q = await this.prisma.quotation.findFirst({
      where: { id, companyId: auth.companyId },
      include: {
        rfq: { select: { id: true, rfqNo: true, title: true, status: true, currency: true, responseDeadline: true } },
        vendor: { select: { id: true, vendorCode: true, legalName: true, status: true, paymentTermsDays: true } },
        createdBy: { select: { id: true, fullName: true } },
        versions: {
          orderBy: { versionNo: 'desc' },
          include: {
            lines: { include: { rfqLine: { select: { id: true, lineNo: true, description: true, quantity: true, uom: true } } } },
            submittedBy: { select: { id: true, fullName: true } },
            createdBy: { select: { id: true, fullName: true } },
            sourceDocument: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true } },
          },
        },
        reviews: { orderBy: { occurredAt: 'asc' }, include: { reviewer: { select: { id: true, fullName: true } } } },
      },
    });
    if (!q) throw AppError.notFound('Quotation');
    const attachments = await this.prisma.documentLink.findMany({
      where: { entityType: 'quotation', entityId: id, document: { deletedAt: null, companyId: auth.companyId } },
      include: { document: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true } } },
    });
    const today = todayUtc();
    return {
      ...q,
      versions: q.versions.map((v) => ({
        ...v,
        freight: dec(v.freight),
        otherCharges: dec(v.otherCharges),
        subtotal: dec(v.subtotal),
        discountTotal: dec(v.discountTotal),
        taxTotal: dec(v.taxTotal),
        grandTotal: dec(v.grandTotal),
        isDraft: v.submittedAt === null,
        isExpired: v.validUntil < today,
        lines: v.lines.map((l) => ({
          ...l,
          quantity: dec(l.quantity, 4),
          unitPrice: dec(l.unitPrice, 4),
          discountPercent: dec(l.discountPercent),
          taxRate: dec(l.taxRate),
          gross: dec(l.gross),
          discount: dec(l.discount),
          taxable: dec(l.taxable),
          tax: dec(l.tax),
          total: dec(l.total),
          rfqLine: { ...l.rfqLine, quantity: dec(l.rfqLine.quantity, 4) },
        })),
      })),
      attachments: attachments.map((a) => a.document),
      viewer: {
        canManage: this.authz.has(auth, 'quotation.manage'),
        canAward: this.authz.has(auth, 'quotation.award'),
        hasOpenDraft: q.versions.some((v) => v.submittedAt === null),
      },
    };
  }

  /**
   * Side-by-side preparation view for the comparison engine (award logic lands
   * with the evaluation module). Figures come straight from stored decimals;
   * items a vendor did not quote are reported as missing rather than zero.
   */
  async comparison(auth: AuthContext, rfqId: string) {
    const rfq = await this.common.loadRfq(this.prisma, auth, rfqId);
    const [lines, quotations] = await Promise.all([
      this.prisma.rfqLine.findMany({ where: { rfqId }, orderBy: { lineNo: 'asc' } }),
      this.prisma.quotation.findMany({
        where: { rfqId, status: { notIn: ['DRAFT'] } },
        include: {
          vendor: { select: { id: true, vendorCode: true, legalName: true, status: true } },
          versions: { orderBy: { versionNo: 'desc' }, take: 1, include: { lines: true } },
        },
      }),
    ]);
    const columns = quotations
      .filter((q) => q.versions.length > 0)
      .map((q) => {
        const v = q.versions[0]!;
        const byLine = new Map(v.lines.map((l) => [l.rfqLineId, l]));
        const quotedLines = lines.map((l) => {
          const ql = byLine.get(l.id);
          return ql
            ? { rfqLineId: l.id, quoted: true, unitPrice: dec(ql.unitPrice, 4), quantity: dec(ql.quantity, 4), total: dec(ql.total), discountPercent: dec(ql.discountPercent), taxRate: dec(ql.taxRate) }
            : { rfqLineId: l.id, quoted: false, unitPrice: null, quantity: null, total: null, discountPercent: null, taxRate: null };
        });
        return {
          quotationId: q.id,
          quotationNo: q.quotationNo,
          status: q.status,
          versionNo: v.versionNo,
          vendor: q.vendor,
          currency: v.currency,
          validUntil: v.validUntil,
          isExpired: v.validUntil < todayUtc(),
          deliveryLeadDays: v.deliveryLeadDays,
          warranty: v.warranty,
          paymentTermsDays: v.paymentTermsDays,
          paymentTerms: v.paymentTerms,
          subtotal: dec(v.subtotal),
          discountTotal: dec(v.discountTotal),
          taxTotal: dec(v.taxTotal),
          freight: dec(v.freight),
          otherCharges: dec(v.otherCharges),
          grandTotal: dec(v.grandTotal),
          linesQuoted: v.lines.length,
          linesMissing: lines.length - v.lines.length,
          lines: quotedLines,
        };
      });
    const currencies = [...new Set(columns.map((c) => c.currency))];
    return {
      rfq: { id: rfq.id, rfqNo: rfq.rfqNo, title: rfq.title, status: rfq.status, currency: rfq.currency, responseDeadline: rfq.responseDeadline },
      lines: lines.map((l) => ({ ...l, quantity: dec(l.quantity, 4) })),
      columns,
      /** Facts the evaluator must see before comparing; never hidden behind a single score. */
      caveats: {
        comparable: currencies.length <= 1,
        currencies,
        incompleteResponses: columns.filter((c) => c.linesMissing > 0).map((c) => ({ quotationNo: c.quotationNo, missing: c.linesMissing })),
        expired: columns.filter((c) => c.isExpired).map((c) => c.quotationNo),
        awaitingResponses: await this.prisma.rfqInvitation.count({ where: { rfqId, status: { in: ['SENT', 'DELIVERED'] } } }),
      },
    };
  }

  async listForRfq(auth: AuthContext, rfqId: string) {
    await this.common.loadRfq(this.prisma, auth, rfqId);
    const items = await this.prisma.quotation.findMany({
      where: { rfqId },
      include: {
        vendor: { select: { id: true, vendorCode: true, legalName: true } },
        versions: { orderBy: { versionNo: 'desc' }, take: 1, select: { versionNo: true, grandTotal: true, currency: true, validUntil: true, submittedAt: true, deliveryLeadDays: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return {
      items: items.map((q) => ({
        ...q,
        versions: q.versions.map((v) => ({ ...v, grandTotal: dec(v.grandTotal) })),
      })),
    };
  }
}
