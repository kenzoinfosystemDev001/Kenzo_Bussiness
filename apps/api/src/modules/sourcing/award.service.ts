import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Prisma, type ApprovalInstance, type RfqAward, type AwardStatus } from '@prisma/client';
import { AWARD_STATUS_LABELS, AWARD_TRANSITIONS, Dec, HARD_BLOCKERS, type ComparabilityBlocker, type RecommendAwardInput } from '@kenzo/shared';
import type { AuthContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { NotificationService } from '../../infrastructure/notifications/notification.service';
import { NumberingService } from '../../infrastructure/numbering/numbering.service';
import { PrismaService, type Db, type Tx } from '../../infrastructure/prisma/prisma.service';
import { AuthorizationService } from '../access-control/authorization.service';
import { DocumentsService } from '../documents/documents.service';
import { ApprovalEngine } from '../workflow/approval-engine.service';
import { ApprovalHooksRegistry } from '../workflow/approval-hooks';
import { EvaluationService } from './evaluation.service';
import { dec, SourcingCommon, todayUtc } from './sourcing-common';

@Injectable()
export class AwardService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly common: SourcingCommon,
    private readonly evaluation: EvaluationService,
    private readonly numbering: NumberingService,
    private readonly engine: ApprovalEngine,
    private readonly hooks: ApprovalHooksRegistry,
    private readonly authz: AuthorizationService,
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit(): void {
    // The engine decides approvals; this module only reacts to the outcome.
    this.hooks.register('rfq_award', {
      onApproved: (tx, i) => this.onOutcome(tx, i, 'APPROVED', 'Award approved'),
      onRejected: (tx, i, reason) => this.onOutcome(tx, i, 'REJECTED', reason),
      onReturned: (tx, i, reason) => this.onOutcome(tx, i, 'RETURNED', `Returned for clarification: ${reason}`),
      onCancelled: (tx, i, reason) => this.onOutcome(tx, i, 'CANCELLED', `Withdrawn: ${reason}`),
    });
    this.documents.registerLinkAccess('rfq_award', async (db, auth, id) => {
      if (!this.authz.has(auth, 'quotation.read')) return false;
      return (await db.rfqAward.count({ where: { id, companyId: auth.companyId } })) === 1;
    });
  }

  private async onOutcome(tx: Tx, instance: ApprovalInstance, to: AwardStatus, reason: string) {
    const award = await tx.rfqAward.findUniqueOrThrow({ where: { id: instance.entityId } });
    const decider = await tx.approvalTask.findFirst({
      where: { instanceId: instance.id, status: { in: ['APPROVED', 'REJECTED', 'RETURNED'] } },
      orderBy: { decidedAt: 'desc' },
    });
    await this.transition(tx, award, to, {
      actorId: decider?.decidedById ?? null,
      reason,
      data: to === 'APPROVED' ? { approvedAt: new Date() } : {},
    });
  }

  // ── State ────────────────────────────────────────────────────────────────

  private async lock(tx: Tx, id: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM rfq_award WHERE id = ${id}::uuid FOR UPDATE`;
  }

  private async transition(
    tx: Tx,
    award: RfqAward,
    to: AwardStatus,
    opts: { actorId: string | null; reason?: string | null; data?: Prisma.RfqAwardUncheckedUpdateInput },
  ): Promise<RfqAward> {
    if (!AWARD_TRANSITIONS[award.status].includes(to)) {
      throw AppError.invalidState(`A ${AWARD_STATUS_LABELS[award.status].toLowerCase()} award cannot become ${AWARD_STATUS_LABELS[to].toLowerCase()}`, {
        from: award.status,
        to,
      });
    }
    const res = await tx.rfqAward.updateMany({
      where: { id: award.id, status: award.status, version: award.version },
      data: { status: to, statusReason: opts.reason ?? null, version: { increment: 1 }, ...(opts.data ?? {}) },
    });
    if (res.count !== 1) throw AppError.versionConflict();
    await tx.rfqAwardEvent.create({ data: { awardId: award.id, fromStatus: award.status, toStatus: to, reason: opts.reason ?? null, actorId: opts.actorId } });
    await this.audit.record(tx, {
      action: `award.status.${to.toLowerCase()}`,
      entityType: 'rfq_award',
      entityId: award.id,
      companyId: award.companyId,
      actorId: opts.actorId,
      before: { status: award.status },
      after: { status: to },
      reason: opts.reason ?? null,
    });
    return tx.rfqAward.findUniqueOrThrow({ where: { id: award.id } });
  }

  private async load(db: Db, auth: AuthContext, id: string): Promise<RfqAward> {
    const a = await db.rfqAward.findFirst({ where: { id, companyId: auth.companyId } });
    if (!a) throw AppError.notFound('Award');
    return a;
  }

  // ── Recommendation ───────────────────────────────────────────────────────

  /**
   * Records an award recommendation and submits it to the approval engine in
   * one transaction. Every award rule is checked here, against rows locked for
   * the duration, so two reviewers racing to recommend cannot both win.
   */
  async recommend(auth: AuthContext, rfqId: string, input: RecommendAwardInput) {
    const awardId = await this.prisma.tx(async (tx) => {
      await this.common.lockRfq(tx, rfqId);
      const rfq = await this.common.loadRfq(tx, auth, rfqId);
      const evaluation = await this.evaluation.loadEvaluation(tx, auth, rfqId);

      // §7: the evaluation must be finished before anything may be awarded.
      if (evaluation.status !== 'COMPLETED') throw AppError.invalidState('Complete the evaluation before recommending an award');
      await this.evaluation.assertMayEvaluate(tx, evaluation.id, auth.userId);

      const live = await tx.rfqAward.findFirst({ where: { rfqId, status: { notIn: ['REJECTED', 'CANCELLED'] } } });
      if (live) throw AppError.invalidState(`This RFQ already has a ${AWARD_STATUS_LABELS[live.status].toLowerCase()} (${live.awardNo})`);

      const rfqLines = await tx.rfqLine.findMany({ where: { rfqId }, orderBy: { lineNo: 'asc' } });
      const rfqLineIds = new Set(rfqLines.map((l) => l.id));

      const seen = new Set<string>();
      for (const l of input.lines) {
        if (!rfqLineIds.has(l.rfqLineId)) throw AppError.validation([{ path: 'lines', message: 'An item does not belong to this RFQ' }]);
        if (seen.has(l.rfqLineId)) throw AppError.validation([{ path: 'lines', message: 'Each item may be awarded once' }]);
        seen.add(l.rfqLineId);
      }

      // §7: partial awards (fewer lines than asked, or more than one vendor)
      // are a policy decision taken when the RFQ was raised.
      const vendorsOnAward = new Set<string>();
      const resolved = [];
      const today = todayUtc();
      let expiredPresent = false;

      for (const line of input.lines) {
        const quotation = await tx.quotation.findFirst({
          where: { id: line.quotationId, rfqId, companyId: auth.companyId },
          include: { vendor: true, versions: { where: { submittedAt: { not: null } }, orderBy: { versionNo: 'desc' }, take: 1, include: { lines: true } } },
        });
        // §7: the selected quotation must belong to this RFQ…
        if (!quotation) throw AppError.validation([{ path: 'lines', message: 'A selected quotation does not belong to this RFQ' }]);
        // …and be a valid submitted version.
        const version = quotation.versions[0];
        if (!version) throw AppError.validation([{ path: 'lines', message: `${quotation.quotationNo} has no submitted version` }]);

        const quotedLine = version.lines.find((l) => l.rfqLineId === line.rfqLineId);
        if (!quotedLine) throw AppError.validation([{ path: 'lines', message: `${quotation.quotationNo} did not quote one of the selected items` }]);

        const qe = await tx.quotationEvaluation.findUnique({ where: { evaluationId_quotationId: { evaluationId: evaluation.id, quotationId: quotation.id } } });
        if (!qe) throw AppError.validation([{ path: 'lines', message: `${quotation.quotationNo} was not part of the evaluation` }]);
        if (qe.excluded)
          throw AppError.validation([{ path: 'lines', message: `${quotation.quotationNo} was excluded from the evaluation: ${qe.exclusionReason}` }]);
        if ((qe.blockers as ComparabilityBlocker[]).some((b) => HARD_BLOCKERS.includes(b))) {
          throw AppError.validation([{ path: 'lines', message: `${quotation.quotationNo} is not comparable with the others and cannot be awarded` }]);
        }
        if (qe.versionNo !== version.versionNo) {
          throw AppError.invalidState(`${quotation.quotationNo} was revised after it was evaluated — re-run the evaluation before awarding`);
        }

        // §7: unexpired unless an authorised exception is recorded.
        if (version.validUntil < today) {
          expiredPresent = true;
          if (!input.expiredQuotationException) {
            throw AppError.validation([
              {
                path: 'expiredQuotationException',
                message: `${quotation.quotationNo} expired on ${version.validUntil.toISOString().slice(0, 10)} — record an exception to award it`,
              },
            ]);
          }
        }

        vendorsOnAward.add(quotation.vendorId);
        resolved.push({ line, quotation, version, quotedLine, qe });
      }

      const isPartial = input.lines.length < rfqLines.length || vendorsOnAward.size > 1;
      if (isPartial && !rfq.allowPartialAward) {
        throw AppError.invalidState(
          vendorsOnAward.size > 1
            ? 'This RFQ does not permit splitting items across vendors. Award every item to one vendor, or raise an RFQ that allows a partial award.'
            : 'This RFQ does not permit a partial award. Award every requested item, or raise an RFQ that allows a partial award.',
        );
      }

      const basis = evaluation.basisCurrency;
      const { quotations: comparable } = await this.evaluation.comparable(tx, rfq, basis);
      const rateByQuotation = new Map(comparable.map((c) => [c.quotationId, c]));

      const awardNo = await this.numbering.next(tx, { companyId: auth.companyId, documentType: 'rfq_award', issuedById: auth.userId });
      const award = await tx.rfqAward.create({
        data: {
          companyId: auth.companyId,
          awardNo,
          rfqId,
          evaluationId: evaluation.id,
          awardType: isPartial ? 'PARTIAL' : 'FULL',
          currency: basis,
          rationale: input.rationale,
          expiredException: expiredPresent ? input.expiredQuotationException : null,
          recommendedById: auth.userId,
        },
      });

      let total = Dec.of('0');
      for (const r of resolved) {
        // The line's share of the comparable total: the quoted line total
        // converted at the same approved rate that valued the quotation.
        const c = rateByQuotation.get(r.quotation.id);
        const lineTotal = r.quotedLine.total;
        const comparableLineTotal =
          r.version.currency === basis
            ? lineTotal
            : c?.comparableTotal && !r.version.grandTotal.isZero()
              ? new Prisma.Decimal(
                  Dec.of(lineTotal.toFixed(2))
                    .mul(Dec.of(c.comparableTotal).div(r.version.grandTotal.toFixed(2), 8, 'HALF_UP'))
                    .toFixed(2),
                )
              : lineTotal;

        await tx.rfqAwardLine.create({
          data: {
            awardId: award.id,
            rfqLineId: r.line.rfqLineId,
            quotationId: r.quotation.id,
            quotationVersionId: r.version.id,
            vendorId: r.quotation.vendorId,
            currency: r.version.currency,
            taxTreatment: r.version.taxTreatment,
            quantity: r.quotedLine.quantity,
            unitPrice: r.quotedLine.unitPrice,
            discountPercent: r.quotedLine.discountPercent,
            taxRate: r.quotedLine.taxRate,
            lineTotal,
            comparableTotal: comparableLineTotal,
          },
        });
        total = total.add(comparableLineTotal.toFixed(2));
      }
      await tx.rfqAward.update({ where: { id: award.id }, data: { totalAwardedValue: new Prisma.Decimal(total.toFixed(2)) } });
      await tx.rfqAwardEvent.create({
        data: { awardId: award.id, fromStatus: null, toStatus: 'DRAFT', reason: 'Recommendation raised', actorId: auth.userId },
      });

      // §6: approval runs on the shared engine, and the people with an interest
      // in the outcome are barred from deciding it — the recommender, whoever
      // recorded each winning quotation, and whoever created each winning
      // vendor. Recording a quotation is clerical work, so it does not bar
      // anyone from recommending; it bars them from approving their own
      // recommendation, which is where the control belongs.
      const excluded = new Set<string>([auth.userId, ...resolved.map((r) => r.quotation.createdById), ...resolved.map((r) => r.quotation.vendor.createdById)]);
      const instance = await this.engine.submit(tx, auth, {
        entityType: 'rfq_award',
        entityId: award.id,
        entityReference: award.awardNo,
        entitySummary: `Award for RFQ ${rfq.rfqNo}: ${rfq.title}`,
        amount: total.toFixed(2),
        currencyCode: basis,
        requesterId: auth.userId,
        excludedUserIds: [...excluded],
      });
      const refreshed = await tx.rfqAward.findUniqueOrThrow({ where: { id: award.id } });
      await this.transition(tx, refreshed, 'PENDING_APPROVAL', {
        actorId: auth.userId,
        reason: 'Submitted for approval',
        data: { approvalInstanceId: instance.id },
      });

      await this.audit.record(tx, {
        action: 'award.recommended',
        entityType: 'rfq_award',
        entityId: award.id,
        after: {
          awardNo,
          rfqId,
          awardType: isPartial ? 'PARTIAL' : 'FULL',
          vendors: [...vendorsOnAward],
          lines: resolved.map((r) => ({ rfqLineId: r.line.rfqLineId, quotationNo: r.quotation.quotationNo, lineTotal: r.quotedLine.total.toFixed(2) })),
          totalAwardedValue: total.toFixed(2),
          currency: basis,
          expiredException: expiredPresent ? input.expiredQuotationException : null,
        },
        reason: input.rationale,
      });
      return award.id;
    });
    return this.detail(auth, awardId);
  }

  // ── Issue ────────────────────────────────────────────────────────────────

  /**
   * Issues an approved award: freezes the commercial snapshot, accepts the
   * winning quotations, rejects the rest, closes the RFQ and notifies every
   * vendor who responded. The snapshot is written once and never recomputed —
   * a later price change cannot rewrite what was awarded.
   */
  async issue(auth: AuthContext, id: string) {
    await this.prisma.tx(async (tx) => {
      await this.lock(tx, id);
      const award = await this.load(tx, auth, id);
      if (award.status !== 'APPROVED') throw AppError.invalidState('Only an approved award can be issued');

      const rfq = await this.common.loadRfq(tx, auth, award.rfqId);
      await this.common.lockRfq(tx, rfq.id);

      const lines = await tx.rfqAwardLine.findMany({
        where: { awardId: id },
        include: {
          rfqLine: true,
          vendor: { select: { id: true, vendorCode: true, legalName: true } },
          quotation: { select: { id: true, quotationNo: true } },
          quotationVersion: true,
        },
        orderBy: { rfqLine: { lineNo: 'asc' } },
      });

      const snapshot = {
        awardNo: award.awardNo,
        rfqNo: rfq.rfqNo,
        currency: award.currency,
        issuedAt: new Date().toISOString(),
        totalAwardedValue: award.totalAwardedValue.toFixed(2),
        lines: lines.map((l) => ({
          lineNo: l.rfqLine.lineNo,
          description: l.rfqLine.description,
          uom: l.rfqLine.uom,
          vendor: { id: l.vendor.id, code: l.vendor.vendorCode, name: l.vendor.legalName },
          quotationNo: l.quotation.quotationNo,
          quotationVersionNo: l.quotationVersion.versionNo,
          quotationCurrency: l.currency,
          taxTreatment: l.taxTreatment,
          validUntil: l.quotationVersion.validUntil.toISOString().slice(0, 10),
          deliveryLeadDays: l.quotationVersion.deliveryLeadDays,
          warranty: l.quotationVersion.warranty,
          paymentTerms: l.quotationVersion.paymentTerms,
          paymentTermsDays: l.quotationVersion.paymentTermsDays,
          quantity: l.quantity.toFixed(4),
          unitPrice: l.unitPrice.toFixed(4),
          discountPercent: l.discountPercent.toFixed(2),
          taxRate: l.taxRate.toFixed(2),
          lineTotal: l.lineTotal.toFixed(2),
          comparableTotal: l.comparableTotal.toFixed(2),
        })),
      };

      const awardedQuotationIds = new Set(lines.map((l) => l.quotationId));
      const now = new Date();
      for (const quotationId of awardedQuotationIds) {
        const q = await tx.quotation.findUniqueOrThrow({ where: { id: quotationId } });
        await tx.quotation.update({
          where: { id: quotationId },
          data: { status: 'ACCEPTED', statusReason: `Awarded under ${award.awardNo}`, version: { increment: 1 } },
        });
        await tx.quotationReview.create({
          data: { quotationId, versionNo: q.currentVersionNo, action: 'AWARDED', note: `Awarded under ${award.awardNo}`, reviewerId: auth.userId },
        });
      }
      const losing = await tx.quotation.findMany({
        where: { rfqId: rfq.id, id: { notIn: [...awardedQuotationIds] }, status: { notIn: ['REJECTED', 'DRAFT'] } },
      });
      for (const q of losing) {
        await tx.quotation.update({
          where: { id: q.id },
          data: { status: 'REJECTED', statusReason: `Not selected under ${award.awardNo}`, version: { increment: 1 } },
        });
        await tx.quotationReview.create({
          data: {
            quotationId: q.id,
            versionNo: q.currentVersionNo,
            action: 'NOT_SELECTED',
            note: `Not selected under ${award.awardNo}`,
            reviewerId: auth.userId,
          },
        });
      }

      const issued = await this.transition(tx, award, 'AWARDED', {
        actorId: auth.userId,
        reason: 'Award issued',
        data: { awardedAt: now, snapshot: snapshot as unknown as Prisma.InputJsonValue },
      });

      await this.common.transitionRfq(tx, rfq, 'AWARDED', { actorId: auth.userId, reason: `Awarded under ${award.awardNo}` });

      // Tell every vendor who responded where they stand.
      for (const quotationId of awardedQuotationIds) {
        const line = lines.find((l) => l.quotationId === quotationId)!;
        await this.notifyVendor(tx, rfq.companyId, line.vendor.legalName, quotationId, award.awardNo, rfq.rfqNo, true);
      }
      for (const q of losing) await this.notifyVendor(tx, rfq.companyId, null, q.id, award.awardNo, rfq.rfqNo, false);

      await this.audit.record(tx, {
        action: 'award.issued',
        entityType: 'rfq_award',
        entityId: issued.id,
        after: { awardNo: award.awardNo, awarded: [...awardedQuotationIds], notSelected: losing.map((q) => q.id), snapshotLines: snapshot.lines.length },
      });
    });
    return this.detail(auth, id);
  }

  private async notifyVendor(tx: Tx, companyId: string, vendorName: string | null, quotationId: string, awardNo: string, rfqNo: string, won: boolean) {
    const quotation = await tx.quotation.findUniqueOrThrow({ where: { id: quotationId }, include: { vendor: true, invitation: true } });
    const to = quotation.invitation.recipientEmail;
    if (!to) return;
    const name = vendorName ?? quotation.vendor.legalName;
    await this.notifications.queueEmail(tx, {
      to,
      subject: won ? `Award of RFQ ${rfqNo} (${awardNo})` : `Outcome of RFQ ${rfqNo}`,
      text: won
        ? [
            `Dear ${name},`,
            '',
            `Your quotation ${quotation.quotationNo} has been accepted under award ${awardNo} for RFQ ${rfqNo}.`,
            '',
            'A purchase order will follow.',
          ].join('\n')
        : [
            `Dear ${name},`,
            '',
            `Thank you for quoting on RFQ ${rfqNo}. On this occasion the business has been placed elsewhere.`,
            '',
            'We will continue to invite you to future requests.',
          ].join('\n'),
      template: won ? 'award.won' : 'award.not_selected',
      companyId,
      aggregateId: quotationId,
    });
  }

  /** Cancels a recommendation that has not been issued, with a recorded reason. */
  async cancel(auth: AuthContext, id: string, reason: string) {
    await this.prisma.tx(async (tx) => {
      await this.lock(tx, id);
      const award = await this.load(tx, auth, id);
      if (award.status === 'AWARDED') throw AppError.invalidState('An issued award cannot be cancelled; raise a cancellation document instead');
      if (award.approvalInstanceId && award.status === 'PENDING_APPROVAL') {
        // Cancelling the approval fires onCancelled, which transitions the award.
        await this.engine.cancel(auth, award.approvalInstanceId, reason);
        return;
      }
      await this.transition(tx, award, 'CANCELLED', { actorId: auth.userId, reason });
    });
    return this.detail(auth, id);
  }

  /** Puts a returned recommendation back into the approval queue unchanged. */
  async resubmit(auth: AuthContext, id: string) {
    await this.prisma.tx(async (tx) => {
      await this.lock(tx, id);
      const award = await this.load(tx, auth, id);
      if (award.status !== 'RETURNED') throw AppError.invalidState('Only a returned recommendation can be resubmitted');
      const rfq = await this.common.loadRfq(tx, auth, award.rfqId);
      const lines = await tx.rfqAwardLine.findMany({
        where: { awardId: id },
        include: { quotation: { select: { createdById: true } }, vendor: { select: { createdById: true } } },
      });
      const instance = await this.engine.submit(tx, auth, {
        entityType: 'rfq_award',
        entityId: award.id,
        entityReference: award.awardNo,
        entitySummary: `Award for RFQ ${rfq.rfqNo}: ${rfq.title}`,
        amount: award.totalAwardedValue.toFixed(2),
        currencyCode: award.currency,
        requesterId: auth.userId,
        excludedUserIds: [...new Set([auth.userId, ...lines.map((l) => l.quotation.createdById), ...lines.map((l) => l.vendor.createdById)])],
      });
      await this.transition(tx, award, 'PENDING_APPROVAL', {
        actorId: auth.userId,
        reason: 'Resubmitted for approval',
        data: { approvalInstanceId: instance.id },
      });
    });
    return this.detail(auth, id);
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  async detail(auth: AuthContext, id: string) {
    const award = await this.prisma.rfqAward.findFirst({
      where: { id, companyId: auth.companyId },
      include: {
        rfq: { select: { id: true, rfqNo: true, title: true, status: true, allowPartialAward: true } },
        recommendedBy: { select: { id: true, fullName: true } },
        approvalInstance: { select: { id: true, status: true, currentSequence: true, submittedAt: true, completedAt: true, outcomeReason: true } },
        lines: {
          include: {
            rfqLine: { select: { id: true, lineNo: true, description: true, uom: true } },
            vendor: { select: { id: true, vendorCode: true, legalName: true } },
            quotation: { select: { id: true, quotationNo: true } },
            quotationVersion: {
              select: { id: true, versionNo: true, validUntil: true, deliveryLeadDays: true, warranty: true, paymentTerms: true, paymentTermsDays: true },
            },
          },
          orderBy: { rfqLine: { lineNo: 'asc' } },
        },
        events: { include: { actor: { select: { id: true, fullName: true } } }, orderBy: { occurredAt: 'asc' } },
      },
    });
    if (!award) throw AppError.notFound('Award');
    return {
      id: award.id,
      awardNo: award.awardNo,
      status: award.status,
      statusReason: award.statusReason,
      awardType: award.awardType,
      currency: award.currency,
      totalAwardedValue: dec(award.totalAwardedValue),
      rationale: award.rationale,
      expiredException: award.expiredException,
      rfq: award.rfq,
      recommendedBy: award.recommendedBy,
      recommendedAt: award.recommendedAt,
      approvedAt: award.approvedAt,
      awardedAt: award.awardedAt,
      approval: award.approvalInstance,
      awardDocumentId: award.awardDocumentId,
      /** Present only once issued: the frozen commercial terms. */
      snapshot: award.snapshot,
      lines: award.lines.map((l) => ({
        rfqLine: l.rfqLine,
        vendor: l.vendor,
        quotation: l.quotation,
        quotationVersion: l.quotationVersion,
        currency: l.currency,
        taxTreatment: l.taxTreatment,
        quantity: dec(l.quantity, 4),
        unitPrice: dec(l.unitPrice, 4),
        discountPercent: dec(l.discountPercent),
        taxRate: dec(l.taxRate),
        lineTotal: dec(l.lineTotal),
        comparableTotal: dec(l.comparableTotal),
      })),
      events: award.events.map((e) => ({ fromStatus: e.fromStatus, toStatus: e.toStatus, reason: e.reason, actor: e.actor, occurredAt: e.occurredAt })),
    };
  }

  async forRfq(auth: AuthContext, rfqId: string) {
    await this.common.loadRfq(this.prisma, auth, rfqId);
    const awards = await this.prisma.rfqAward.findMany({
      where: { rfqId, companyId: auth.companyId },
      orderBy: { recommendedAt: 'desc' },
      select: { id: true },
    });
    return { items: await Promise.all(awards.map((a) => this.detail(auth, a.id))) };
  }

  async list(auth: AuthContext, query: { status?: string[]; page: number; pageSize: number }) {
    const where: Prisma.RfqAwardWhereInput = { companyId: auth.companyId, ...(query.status?.length ? { status: { in: query.status as AwardStatus[] } } : {}) };
    const [total, rows] = await Promise.all([
      this.prisma.rfqAward.count({ where }),
      this.prisma.rfqAward.findMany({
        where,
        include: {
          rfq: { select: { rfqNo: true, title: true } },
          recommendedBy: { select: { id: true, fullName: true } },
          lines: { select: { vendorId: true } },
        },
        orderBy: { recommendedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      items: rows.map((a) => ({
        id: a.id,
        awardNo: a.awardNo,
        status: a.status,
        awardType: a.awardType,
        currency: a.currency,
        totalAwardedValue: dec(a.totalAwardedValue),
        rfq: a.rfq,
        recommendedBy: a.recommendedBy,
        recommendedAt: a.recommendedAt,
        vendorCount: new Set(a.lines.map((l) => l.vendorId)).size,
      })),
    };
  }
}
