import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type CriterionSource,
  type EvaluationCriterion,
  type Quotation,
  type QuotationVersion,
  type QuotationVersionLine,
  type Rfq,
} from '@prisma/client';
import {
  COMPARABILITY_BLOCKER_LABELS,
  CRITERION_SOURCE_LABELS,
  Dec,
  HARD_BLOCKERS,
  SCORING_FORMULA_VERSION,
  WeightsError,
  computeDocumentTotals,
  normalizeAmount,
  scoreCandidates,
  validateWeights,
  type ApprovedRate,
  type ComparabilityBlocker,
  type CriteriaSetInput,
  type ScoringCriterion,
} from '@kenzo/shared';
import type { AuthContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService, type Db, type Tx } from '../../infrastructure/prisma/prisma.service';
import { dec, SourcingCommon, todayUtc } from './sourcing-common';

/** Quotation statuses that belong in an evaluation round at all. */
const EVALUABLE = ['SUBMITTED', 'UNDER_EVALUATION', 'CLARIFICATION_REQUESTED', 'REVISED', 'ACCEPTED', 'EXPIRED'] as const;

type VersionWithLines = QuotationVersion & { lines: QuotationVersionLine[] };
type QuotationWithLatest = Quotation & {
  vendor: { id: string; vendorCode: string; legalName: string; status: string };
  versions: VersionWithLines[];
};

/** A quotation reduced to the figures the comparison and scoring engines read. */
export interface ComparableQuotation {
  quotationId: string;
  quotationNo: string;
  versionNo: number;
  version: VersionWithLines;
  vendor: { id: string; vendorCode: string; legalName: string; status: string };
  blockers: ComparabilityBlocker[];
  /** Grand total in the basis currency, or null when no approved rate covers it. */
  comparableTotal: string | null;
  exchangeRateId: string | null;
}

@Injectable()
export class EvaluationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly common: SourcingCommon,
    private readonly audit: AuditService,
  ) {}

  // ── Criteria sets ────────────────────────────────────────────────────────

  async listCriteriaSets(auth: AuthContext) {
    const items = await this.prisma.evaluationCriteriaSet.findMany({
      where: { companyId: auth.companyId },
      include: { criteria: { orderBy: { sortOrder: 'asc' } } },
      orderBy: [{ status: 'asc' }, { name: 'asc' }, { setVersion: 'desc' }],
    });
    return { items: items.map((s) => this.presentCriteriaSet(s)) };
  }

  private presentCriteriaSet(set: { criteria: EvaluationCriterion[] } & Record<string, unknown>) {
    return {
      ...set,
      criteria: (set.criteria ?? []).map((c) => ({ ...c, weightPercent: dec(c.weightPercent) })),
    };
  }

  /**
   * Creates a draft set. Weights are validated here and again on publish: a
   * draft may be saved while it is still being worked out, but nothing may
   * score against a set whose weights do not total 100 %.
   */
  async createCriteriaSet(auth: AuthContext, input: CriteriaSetInput) {
    const id = await this.prisma.tx(async (tx) => {
      const prior = await tx.evaluationCriteriaSet.findFirst({
        where: { companyId: auth.companyId, name: input.name },
        orderBy: { setVersion: 'desc' },
      });
      const set = await tx.evaluationCriteriaSet.create({
        data: {
          companyId: auth.companyId,
          name: input.name,
          description: input.description,
          setVersion: (prior?.setVersion ?? 0) + 1,
          isDefault: input.isDefault,
          formulaVersion: SCORING_FORMULA_VERSION,
          createdById: auth.userId,
          criteria: {
            create: input.criteria.map((c, i) => ({
              key: c.key,
              label: c.label,
              weightPercent: new Prisma.Decimal(c.weightPercent),
              source: c.source as CriterionSource,
              direction: c.direction,
              guidance: c.guidance,
              sortOrder: i + 1,
            })),
          },
        },
      });
      await this.audit.record(tx, {
        action: 'evaluation.criteria_set.created',
        entityType: 'evaluation_criteria_set',
        entityId: set.id,
        after: { name: set.name, setVersion: set.setVersion, criteria: input.criteria.map((c) => ({ key: c.key, weightPercent: c.weightPercent })) },
      });
      return set.id;
    });
    return this.criteriaSet(auth, id);
  }

  async criteriaSet(auth: AuthContext, id: string) {
    const set = await this.prisma.evaluationCriteriaSet.findFirst({
      where: { id, companyId: auth.companyId },
      include: { criteria: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!set) throw AppError.notFound('Evaluation criteria set');
    return this.presentCriteriaSet(set);
  }

  /**
   * Publishes a draft. The weights must total exactly 100 %, and the previously
   * active set of the same name is retired so in-flight evaluations keep the
   * version they started with while new ones pick up this one.
   */
  async publishCriteriaSet(auth: AuthContext, id: string) {
    await this.prisma.tx(async (tx) => {
      const set = await tx.evaluationCriteriaSet.findFirst({ where: { id, companyId: auth.companyId }, include: { criteria: true } });
      if (!set) throw AppError.notFound('Evaluation criteria set');
      if (set.status !== 'DRAFT') throw AppError.invalidState('Only a draft criteria set can be published');
      try {
        validateWeights(set.criteria.map((c) => ({ key: c.key, weightPercent: c.weightPercent.toFixed(2) })));
      } catch (err) {
        if (err instanceof WeightsError) throw AppError.validation([{ path: 'criteria', message: err.message }]);
        throw err;
      }
      const superseded = await tx.evaluationCriteriaSet.findMany({ where: { companyId: auth.companyId, name: set.name, status: 'ACTIVE' } });
      for (const old of superseded) {
        await tx.evaluationCriteriaSet.update({
          where: { id: old.id },
          data: { status: 'RETIRED', retiredAt: new Date(), isDefault: false, updatedById: auth.userId },
        });
      }
      if (set.isDefault) {
        await tx.evaluationCriteriaSet.updateMany({ where: { companyId: auth.companyId, isDefault: true, id: { not: set.id } }, data: { isDefault: false } });
      }
      await tx.evaluationCriteriaSet.update({
        where: { id: set.id },
        data: { status: 'ACTIVE', publishedAt: new Date(), updatedById: auth.userId, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        action: 'evaluation.criteria_set.published',
        entityType: 'evaluation_criteria_set',
        entityId: set.id,
        before: { status: 'DRAFT' },
        after: { status: 'ACTIVE', retired: superseded.map((s) => s.id) },
      });
    });
    return this.criteriaSet(auth, id);
  }

  // ── Exchange rates ───────────────────────────────────────────────────────

  async listRates(auth: AuthContext) {
    const items = await this.prisma.exchangeRate.findMany({
      where: { companyId: auth.companyId },
      orderBy: [{ baseCurrency: 'asc' }, { quoteCurrency: 'asc' }, { rateTimestamp: 'desc' }],
      take: 200,
      include: { approvedBy: { select: { id: true, fullName: true } } },
    });
    return { items: items.map((r) => ({ ...r, rate: dec(r.rate, 8) })) };
  }

  async recordRate(
    auth: AuthContext,
    input: { baseCurrency: string; quoteCurrency: string; rate: string; source: string; rateTimestamp: string; note: string | null },
  ) {
    const created = await this.prisma.tx(async (tx) => {
      const rate = await tx.exchangeRate.create({
        data: {
          companyId: auth.companyId,
          baseCurrency: input.baseCurrency,
          quoteCurrency: input.quoteCurrency,
          rate: new Prisma.Decimal(input.rate),
          source: input.source,
          rateTimestamp: new Date(input.rateTimestamp),
          note: input.note,
          approvedById: auth.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'exchange_rate.recorded',
        entityType: 'exchange_rate',
        entityId: rate.id,
        after: { pair: `${input.quoteCurrency}->${input.baseCurrency}`, rate: input.rate, source: input.source, rateTimestamp: input.rateTimestamp },
      });
      return rate;
    });
    return { ...created, rate: dec(created.rate, 8) };
  }

  /** Latest approved rate per pair into `basis`, newest first. */
  private async ratesInto(db: Db, companyId: string, basis: string): Promise<ApprovedRate[]> {
    const rows = await db.exchangeRate.findMany({
      where: { companyId, baseCurrency: basis },
      orderBy: { rateTimestamp: 'desc' },
    });
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!latest.has(r.quoteCurrency)) latest.set(r.quoteCurrency, r);
    return [...latest.values()].map((r) => ({
      baseCurrency: r.baseCurrency,
      quoteCurrency: r.quoteCurrency,
      rate: r.rate.toFixed(8),
      source: r.source,
      rateTimestamp: r.rateTimestamp.toISOString(),
    }));
  }

  private rateIdFor(rows: Array<{ id: string; quoteCurrency: string; rateTimestamp: Date }>, quoteCurrency: string, timestamp: string): string | null {
    return rows.find((r) => r.quoteCurrency === quoteCurrency && r.rateTimestamp.toISOString() === timestamp)?.id ?? null;
  }

  // ── Comparison ───────────────────────────────────────────────────────────

  /**
   * Reduces every quotation on an RFQ to a comparable shape, in the basis
   * currency, recording exactly why any of them is not comparable. Nothing is
   * normalised silently: a quotation in another currency with no approved rate
   * comes back with a null total and a blocker, never a face-value figure.
   */
  async comparable(
    db: Db,
    rfq: Rfq,
    basisCurrency: string,
  ): Promise<{ quotations: ComparableQuotation[]; rates: ApprovedRate[]; rateRows: Array<{ id: string; quoteCurrency: string; rateTimestamp: Date }> }> {
    const [rfqLines, quotations, rates, rateRows] = await Promise.all([
      db.rfqLine.findMany({ where: { rfqId: rfq.id }, orderBy: { lineNo: 'asc' } }),
      db.quotation.findMany({
        where: { rfqId: rfq.id, status: { in: [...EVALUABLE] } },
        include: {
          vendor: { select: { id: true, vendorCode: true, legalName: true, status: true } },
          versions: { where: { submittedAt: { not: null } }, orderBy: { versionNo: 'desc' }, take: 1, include: { lines: true } },
        },
        orderBy: { createdAt: 'asc' },
      }) as Promise<QuotationWithLatest[]>,
      this.ratesInto(db, rfq.companyId, basisCurrency),
      db.exchangeRate.findMany({
        where: { companyId: rfq.companyId, baseCurrency: basisCurrency },
        select: { id: true, quoteCurrency: true, rateTimestamp: true },
      }),
    ]);

    // A tax treatment is only a comparability problem when the responses mix
    // them: a field where every vendor quoted inclusive is internally consistent.
    const treatments = new Set(quotations.flatMap((q) => q.versions.map((v) => v.taxTreatment)));
    const mixedTreatment = treatments.size > 1;
    const today = todayUtc();

    const out: ComparableQuotation[] = quotations.map((q) => {
      const version = q.versions[0];
      const blockers: ComparabilityBlocker[] = [];
      if (!version) {
        return {
          quotationId: q.id,
          quotationNo: q.quotationNo,
          versionNo: 0,
          version: null as unknown as VersionWithLines,
          vendor: q.vendor,
          blockers: ['NO_SUBMITTED_VERSION'],
          comparableTotal: null,
          exchangeRateId: null,
        };
      }
      if (version.lines.length < rfqLines.length) blockers.push('INCOMPLETE_RESPONSE');
      if (version.validUntil < today) blockers.push('EXPIRED');
      if (mixedTreatment) blockers.push('MIXED_TAX_TREATMENT');

      const converted = normalizeAmount(version.grandTotal.toFixed(2), version.currency, basisCurrency, rates);
      if (!converted) blockers.push('MIXED_CURRENCY_NO_RATE');

      return {
        quotationId: q.id,
        quotationNo: q.quotationNo,
        versionNo: version.versionNo,
        version,
        vendor: q.vendor,
        blockers,
        comparableTotal: converted?.amount ?? null,
        exchangeRateId: converted?.rate ? this.rateIdFor(rateRows, converted.rate.quoteCurrency, converted.rate.rateTimestamp) : null,
      };
    });
    return { quotations: out, rates, rateRows };
  }

  /**
   * The comparison workspace payload: the full landed-cost breakdown per
   * vendor, item-wise figures, lowest-comparable-price markers and every
   * caveat a buyer must see before drawing a conclusion.
   */
  async comparison(auth: AuthContext, rfqId: string) {
    const rfq = await this.common.loadRfq(this.prisma, auth, rfqId);
    const evaluation = await this.prisma.rfqEvaluation.findUnique({
      where: { rfqId },
      include: {
        criteriaSet: { include: { criteria: { orderBy: { sortOrder: 'asc' } } } },
        quotations: { include: { scores: true } },
      },
    });
    const basisCurrency = evaluation?.basisCurrency ?? rfq.currency;
    const [lines, { quotations, rates }] = await Promise.all([
      this.prisma.rfqLine.findMany({ where: { rfqId }, orderBy: { lineNo: 'asc' } }),
      this.comparable(this.prisma, rfq, basisCurrency),
    ]);

    const scoreByQuotation = new Map((evaluation?.quotations ?? []).map((qe) => [qe.quotationId, qe]));

    const columns = quotations.map((c) => {
      const v = c.version;
      const byLine = v ? new Map(v.lines.map((l) => [l.rfqLineId, l])) : new Map<string, QuotationVersionLine>();
      const qe = scoreByQuotation.get(c.quotationId);
      return {
        quotationId: c.quotationId,
        quotationNo: c.quotationNo,
        versionNo: c.versionNo,
        vendor: c.vendor,
        currency: v?.currency ?? null,
        taxTreatment: v?.taxTreatment ?? null,
        validUntil: v?.validUntil ?? null,
        deliveryLeadDays: v?.deliveryLeadDays ?? null,
        warranty: v?.warranty ?? null,
        paymentTermsDays: v?.paymentTermsDays ?? null,
        paymentTerms: v?.paymentTerms ?? null,
        notes: v?.notes ?? null,
        /** Every component of the landed cost, so the arithmetic is auditable on screen. */
        landedCost: v
          ? {
              subtotal: dec(v.subtotal),
              discountTotal: dec(v.discountTotal),
              taxableTotal: dec(v.subtotal.sub(v.discountTotal)),
              taxTotal: dec(v.taxTotal),
              freight: dec(v.freight),
              otherCharges: dec(v.otherCharges),
              otherChargesNote: v.otherChargesNote,
              grandTotal: dec(v.grandTotal),
            }
          : null,
        comparableTotal: c.comparableTotal,
        blockers: c.blockers,
        blockerLabels: c.blockers.map((b) => COMPARABILITY_BLOCKER_LABELS[b]),
        linesQuoted: v?.lines.length ?? 0,
        linesMissing: lines.length - (v?.lines.length ?? 0),
        score: qe?.totalScore ? dec(qe.totalScore, 4) : null,
        excluded: qe?.excluded ?? false,
        exclusionReason: qe?.exclusionReason ?? null,
        lines: lines.map((l) => {
          const ql = byLine.get(l.id);
          if (!ql) return { rfqLineId: l.id, quoted: false };
          return {
            rfqLineId: l.id,
            quoted: true,
            quantity: dec(ql.quantity, 4),
            unitPrice: dec(ql.unitPrice, 4),
            discountPercent: dec(ql.discountPercent),
            taxRate: dec(ql.taxRate),
            gross: dec(ql.gross),
            discount: dec(ql.discount),
            taxable: dec(ql.taxable),
            tax: dec(ql.tax),
            total: dec(ql.total),
            remarks: ql.remarks,
          };
        }),
      };
    });

    // "Lowest" is computed only across quotations that are actually comparable;
    // a cheaper figure behind a hard blocker is not a lower price, it is an
    // unknown one.
    const comparableColumns = columns.filter((c) => !c.blockers.some((b) => HARD_BLOCKERS.includes(b)) && !c.excluded);
    const lowestTotal = this.lowestRef(comparableColumns.map((c) => ({ ref: c.quotationId, value: c.comparableTotal })));
    const lowestByLine: Record<string, string | null> = {};
    for (const l of lines) {
      lowestByLine[l.id] = this.lowestRef(
        comparableColumns.map((c) => {
          const ql = c.lines.find((x) => x.rfqLineId === l.id);
          return { ref: c.quotationId, value: ql && ql.quoted ? (ql.total ?? null) : null };
        }),
      );
    }

    return {
      rfq: {
        id: rfq.id,
        rfqNo: rfq.rfqNo,
        title: rfq.title,
        status: rfq.status,
        currency: rfq.currency,
        responseDeadline: rfq.responseDeadline,
        allowPartialAward: rfq.allowPartialAward,
      },
      basisCurrency,
      lines: lines.map((l) => ({
        id: l.id,
        lineNo: l.lineNo,
        description: l.description,
        specification: l.specification,
        quantity: dec(l.quantity, 4),
        uom: l.uom,
      })),
      columns,
      indicators: { lowestTotalQuotationId: lowestTotal, lowestByLine },
      rates,
      evaluation: evaluation
        ? {
            id: evaluation.id,
            status: evaluation.status,
            formulaVersion: evaluation.formulaVersion,
            basisCurrency: evaluation.basisCurrency,
            criteriaSet: { id: evaluation.criteriaSet.id, name: evaluation.criteriaSet.name, setVersion: evaluation.criteriaSet.setVersion },
            criteria: evaluation.criteriaSet.criteria.map((c) => ({
              key: c.key,
              label: c.label,
              weightPercent: dec(c.weightPercent),
              source: c.source,
              direction: c.direction,
              guidance: c.guidance,
            })),
          }
        : null,
      /**
       * Deterministic observations, derived only from the records above. No
       * model is consulted: every statement here can be traced to a figure on
       * this page (docs/PHASE_04_COMPLETION_REPORT.md §AI).
       */
      insights: this.insights(columns, lines.length, basisCurrency),
      caveats: {
        comparable: comparableColumns.length === columns.length && columns.length > 0,
        currencies: [...new Set(columns.map((c) => c.currency).filter(Boolean))],
        taxTreatments: [...new Set(columns.map((c) => c.taxTreatment).filter(Boolean))],
        awaitingResponses: await this.prisma.rfqInvitation.count({ where: { rfqId, status: { in: ['SENT', 'DELIVERED'] } } }),
      },
    };
  }

  /** Reference with the smallest value, ignoring nulls; null when nothing qualifies. */
  private lowestRef(values: Array<{ ref: string; value: string | null | undefined }>): string | null {
    let best: { ref: string; value: Dec } | null = null;
    for (const v of values) {
      if (v.value === null || v.value === undefined) continue;
      const d = Dec.of(v.value);
      if (!best || d.lt(best.value)) best = { ref: v.ref, value: d };
    }
    return best?.ref ?? null;
  }

  /**
   * Plain-language observations computed from the comparison itself: price
   * spread, missing information and risks. Each carries the quotations it is
   * about, so a reader can check it against the table.
   */
  private insights(columns: Array<Record<string, unknown>>, lineCount: number, basis: string) {
    const out: Array<{ kind: string; text: string; quotationIds: string[] }> = [];
    const totals = columns
      .filter((c) => c.comparableTotal && !(c.blockers as ComparabilityBlocker[]).some((b) => HARD_BLOCKERS.includes(b)))
      .map((c) => ({ id: c.quotationId as string, no: c.quotationNo as string, total: Dec.of(c.comparableTotal as string) }));

    if (totals.length >= 2) {
      const sorted = [...totals].sort((a, b) => a.total.cmp(b.total));
      const low = sorted[0]!;
      const high = sorted[sorted.length - 1]!;
      const spread = high.total.sub(low.total);
      const pct = low.total.isZero() ? null : spread.div(low.total, 4, 'HALF_UP').mul('100').toFixed(2);
      out.push({
        kind: 'PRICE_SPREAD',
        text: `Comparable totals run from ${low.total.toFixed(2)} ${basis} (${low.no}) to ${high.total.toFixed(2)} ${basis} (${high.no})${pct ? `, a spread of ${pct} %` : ''}.`,
        quotationIds: [low.id, high.id],
      });
    }
    const incomplete = columns.filter((c) => (c.linesMissing as number) > 0);
    if (incomplete.length) {
      out.push({
        kind: 'MISSING_ITEMS',
        text: `${incomplete.length} of ${columns.length} quotations did not price every one of the ${lineCount} requested items, so their totals cover less scope.`,
        quotationIds: incomplete.map((c) => c.quotationId as string),
      });
    }
    const blocked = columns.filter((c) => (c.blockers as ComparabilityBlocker[]).some((b) => HARD_BLOCKERS.includes(b)));
    if (blocked.length) {
      out.push({
        kind: 'NOT_COMPARABLE',
        text: `${blocked.length} quotation(s) cannot be compared on face value and are excluded from the lowest-price markers.`,
        quotationIds: blocked.map((c) => c.quotationId as string),
      });
    }
    const expired = columns.filter((c) => (c.blockers as ComparabilityBlocker[]).includes('EXPIRED'));
    if (expired.length) {
      out.push({
        kind: 'EXPIRED',
        text: `${expired.length} quotation(s) have passed their validity date and need a recorded exception or a fresh quote before award.`,
        quotationIds: expired.map((c) => c.quotationId as string),
      });
    }
    return out;
  }

  // ── Evaluation round ─────────────────────────────────────────────────────

  /** Opens the round, freezing the criteria set and basis currency it will use. */
  async start(auth: AuthContext, rfqId: string, input: { criteriaSetId: string; basisCurrency?: string }) {
    await this.prisma.tx(async (tx) => {
      await this.common.lockRfq(tx, rfqId);
      const rfq = await this.common.loadRfq(tx, auth, rfqId);
      const existing = await tx.rfqEvaluation.findUnique({ where: { rfqId } });
      if (existing) throw AppError.invalidState('This RFQ already has an evaluation round');

      const set = await tx.evaluationCriteriaSet.findFirst({ where: { id: input.criteriaSetId, companyId: auth.companyId }, include: { criteria: true } });
      if (!set) throw AppError.validation([{ path: 'criteriaSetId', message: 'Criteria set not found' }]);
      if (set.status !== 'ACTIVE') throw AppError.validation([{ path: 'criteriaSetId', message: 'Only a published (active) criteria set can be used' }]);

      const submitted = await tx.quotation.count({ where: { rfqId, status: { in: [...EVALUABLE] } } });
      if (submitted === 0) throw AppError.invalidState('No submitted quotation to evaluate');

      // The RFQ moves into EVALUATION only from a status that permits it; the
      // shared transition table decides, not this module.
      if (rfq.status !== 'EVALUATION') await this.common.transitionRfq(tx, rfq, 'EVALUATION', { actorId: auth.userId, reason: 'Evaluation started' });

      const evaluation = await tx.rfqEvaluation.create({
        data: {
          companyId: auth.companyId,
          rfqId,
          criteriaSetId: set.id,
          formulaVersion: set.formulaVersion,
          basisCurrency: input.basisCurrency ?? rfq.currency,
          startedById: auth.userId,
        },
      });
      // Seed the round: every quotation gets its row, its comparable total and
      // its automatic scores straight away, so the workspace is populated
      // before anyone enters a judgement and a quotation can be excluded
      // without having to be scored first.
      await this.rescore(tx, auth, rfqId);

      await this.audit.record(tx, {
        action: 'evaluation.started',
        entityType: 'rfq_evaluation',
        entityId: evaluation.id,
        after: { rfqId, criteriaSetId: set.id, setVersion: set.setVersion, formulaVersion: set.formulaVersion, basisCurrency: evaluation.basisCurrency },
      });
    });
    return this.detail(auth, rfqId);
  }

  async loadEvaluation(db: Db, auth: AuthContext, rfqId: string) {
    const evaluation = await db.rfqEvaluation.findFirst({
      where: { rfqId, companyId: auth.companyId },
      include: { criteriaSet: { include: { criteria: { orderBy: { sortOrder: 'asc' } } } } },
    });
    if (!evaluation) throw AppError.notFound('Evaluation');
    return evaluation;
  }

  /**
   * Records a reviewer's conflict-of-interest declaration. Required before
   * that reviewer may score or recommend, and a declared conflict bars them
   * from both — the declaration is evidence, not a formality.
   */
  async declareConflict(auth: AuthContext, rfqId: string, input: { hasConflict: boolean; details: string | null }) {
    if (input.hasConflict && !input.details) throw AppError.validation([{ path: 'details', message: 'Describe the conflict' }]);
    await this.prisma.tx(async (tx) => {
      const evaluation = await this.loadEvaluation(tx, auth, rfqId);
      const prior = await tx.conflictOfInterestDeclaration.findUnique({ where: { evaluationId_userId: { evaluationId: evaluation.id, userId: auth.userId } } });
      if (prior) throw AppError.invalidState('You have already declared for this evaluation');
      await tx.conflictOfInterestDeclaration.create({
        data: { companyId: auth.companyId, evaluationId: evaluation.id, userId: auth.userId, hasConflict: input.hasConflict, details: input.details },
      });
      await this.audit.record(tx, {
        action: 'evaluation.conflict_declared',
        entityType: 'rfq_evaluation',
        entityId: evaluation.id,
        after: { userId: auth.userId, hasConflict: input.hasConflict },
      });
    });
    return this.detail(auth, rfqId);
  }

  /** Throws unless this user has declared, and declared no conflict. */
  async assertMayEvaluate(db: Db, evaluationId: string, userId: string): Promise<void> {
    const declaration = await db.conflictOfInterestDeclaration.findUnique({ where: { evaluationId_userId: { evaluationId, userId } } });
    if (!declaration) {
      throw new AppError('CONFLICT_DECLARATION_REQUIRED', 'Declare any conflict of interest before taking part in this evaluation');
    }
    if (declaration.hasConflict) {
      throw new AppError('SEGREGATION_OF_DUTIES', 'You declared a conflict of interest in this evaluation and cannot score or recommend on it');
    }
  }

  async addNote(auth: AuthContext, rfqId: string, note: string) {
    await this.prisma.tx(async (tx) => {
      const evaluation = await this.loadEvaluation(tx, auth, rfqId);
      await tx.evaluationNote.create({ data: { evaluationId: evaluation.id, note, authorId: auth.userId } });
    });
    return this.detail(auth, rfqId);
  }

  /**
   * Enters or replaces this reviewer's manual scores for one quotation, then
   * re-runs the engine. Manual scores are the reviewer's own 0–100 judgements;
   * automatic criteria are never writable here, so no caller can push a price
   * score that contradicts the quotation.
   */
  async score(auth: AuthContext, rfqId: string, quotationId: string, input: { scores: Array<{ criterionKey: string; value: string; note: string | null }> }) {
    await this.prisma.tx(async (tx) => {
      const evaluation = await this.loadEvaluation(tx, auth, rfqId);
      if (evaluation.status !== 'IN_PROGRESS') throw AppError.invalidState('This evaluation is closed');
      await this.assertMayEvaluate(tx, evaluation.id, auth.userId);

      const quotation = await tx.quotation.findFirst({ where: { id: quotationId, rfqId, companyId: auth.companyId } });
      if (!quotation) throw AppError.notFound('Quotation');

      const manualKeys = new Set(evaluation.criteriaSet.criteria.filter((c) => c.source === 'MANUAL').map((c) => c.key));
      for (const s of input.scores) {
        if (!manualKeys.has(s.criterionKey)) {
          throw AppError.validation([
            {
              path: 'scores',
              message: `"${s.criterionKey}" is not a reviewer-scored criterion. ${CRITERION_SOURCE_LABELS.AUTO_PRICE.split('(')[0]?.trim() ?? 'Automatic'} criteria are read from the quotation.`,
            },
          ]);
        }
      }

      const qe = await tx.quotationEvaluation.findUnique({ where: { evaluationId_quotationId: { evaluationId: evaluation.id, quotationId } } });
      const manualStore = new Map<string, { value: string; note: string | null }>();
      if (qe) {
        const existing = await tx.evaluationScore.findMany({ where: { quotationEvaluationId: qe.id, source: 'MANUAL' } });
        for (const e of existing) if (e.rawValue) manualStore.set(e.criterionKey, { value: e.rawValue, note: e.note });
      }
      for (const s of input.scores) manualStore.set(s.criterionKey, { value: s.value, note: s.note });

      await this.rescore(tx, auth, rfqId, { [quotationId]: manualStore });
      await this.audit.record(tx, {
        action: 'evaluation.scored',
        entityType: 'rfq_evaluation',
        entityId: evaluation.id,
        after: { quotationId, scores: input.scores.map((s) => ({ criterionKey: s.criterionKey, value: s.value })) },
      });
    });
    return this.detail(auth, rfqId);
  }

  /**
   * Re-runs the whole round through the shared scoring engine and persists the
   * result with its full working. Automatic criteria are read from the stored
   * quotation figures every time, so a revision or a new exchange rate is
   * reflected the next time anything is scored.
   *
   * `overrides` supplies freshly entered manual scores for one quotation;
   * every other manual score is read back from the database.
   */
  private async rescore(tx: Tx, auth: AuthContext, rfqId: string, overrides: Record<string, Map<string, { value: string; note: string | null }>> = {}) {
    const evaluation = await this.loadEvaluation(tx, auth, rfqId);
    const rfq = await this.common.loadRfq(tx, auth, rfqId);
    const { quotations, rateRows } = await this.comparable(tx, rfq, evaluation.basisCurrency);

    const criteria: ScoringCriterion[] = evaluation.criteriaSet.criteria.map((c) => ({
      key: c.key,
      label: c.label,
      weightPercent: c.weightPercent.toFixed(2),
      source: c.source,
      direction: c.direction,
    }));

    // Existing manual scores, so a re-run never discards a reviewer's judgement.
    const existingRows = await tx.evaluationScore.findMany({
      where: { quotationEvaluation: { evaluationId: evaluation.id }, source: 'MANUAL' },
      include: { quotationEvaluation: { select: { quotationId: true } } },
    });
    const manual = new Map<string, Map<string, { value: string; note: string | null }>>();
    for (const row of existingRows) {
      const qid = row.quotationEvaluation.quotationId;
      if (!manual.has(qid)) manual.set(qid, new Map());
      if (row.rawValue) manual.get(qid)!.set(row.criterionKey, { value: row.rawValue, note: row.note });
    }
    for (const [qid, map] of Object.entries(overrides)) manual.set(qid, map);

    // Candidates exclude anything a hard blocker makes incomparable: scoring
    // such a quotation against the others would be the very equivalence the
    // engine must not assert.
    const scorable = quotations.filter((q) => q.version && !q.blockers.some((b) => HARD_BLOCKERS.includes(b)));
    const candidates = scorable.map((q) => ({
      ref: q.quotationId,
      values: Object.fromEntries(criteria.map((c) => [c.key, this.rawValueFor(c.source, q, manual.get(q.quotationId)?.get(c.key)?.value ?? null)])),
    }));

    const result = candidates.length ? scoreCandidates(criteria, candidates) : null;
    const scoreByRef = new Map((result?.candidates ?? []).map((c) => [c.ref, c]));

    for (const q of quotations) {
      const scored = scoreByRef.get(q.quotationId);
      const qe = await tx.quotationEvaluation.upsert({
        where: { evaluationId_quotationId: { evaluationId: evaluation.id, quotationId: q.quotationId } },
        create: {
          evaluationId: evaluation.id,
          quotationId: q.quotationId,
          versionNo: q.versionNo,
          comparableTotal: q.comparableTotal ? new Prisma.Decimal(q.comparableTotal) : null,
          exchangeRateId: q.exchangeRateId,
          blockers: q.blockers,
          totalScore: scored ? new Prisma.Decimal(scored.totalScore) : null,
          scoreBreakdown: scored
            ? (JSON.parse(JSON.stringify({ formulaVersion: result!.formulaVersion, ...scored })) as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          scoredAt: scored ? new Date() : null,
          scoredById: scored ? auth.userId : null,
        },
        update: {
          versionNo: q.versionNo,
          comparableTotal: q.comparableTotal ? new Prisma.Decimal(q.comparableTotal) : null,
          exchangeRateId: q.exchangeRateId,
          blockers: q.blockers,
          totalScore: scored ? new Prisma.Decimal(scored.totalScore) : null,
          scoreBreakdown: scored
            ? (JSON.parse(JSON.stringify({ formulaVersion: result!.formulaVersion, ...scored })) as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          scoredAt: scored ? new Date() : null,
          scoredById: scored ? auth.userId : null,
        },
      });

      await tx.evaluationScore.deleteMany({ where: { quotationEvaluationId: qe.id } });
      if (!scored) continue;
      for (const s of scored.criteria) {
        const entered = s.source === 'MANUAL' ? (manual.get(q.quotationId)?.get(s.key) ?? null) : null;
        await tx.evaluationScore.create({
          data: {
            quotationEvaluationId: qe.id,
            criterionKey: s.key,
            source: s.source,
            weightPercent: new Prisma.Decimal(s.weightPercent),
            rawValue: s.rawValue,
            normalizedScore: s.missing ? null : new Prisma.Decimal(s.normalizedScore),
            weightedScore: s.missing ? null : new Prisma.Decimal(s.weightedScore),
            missing: s.missing,
            note: entered?.note ?? null,
            scoredById: s.source === 'MANUAL' ? auth.userId : null,
          },
        });
      }
    }
    void rateRows;
  }

  /** The figure a criterion reads, by source. Automatic values come only from the quotation. */
  private rawValueFor(source: CriterionSource, q: ComparableQuotation, manualValue: string | null): string | null {
    switch (source) {
      case 'AUTO_PRICE':
        return q.comparableTotal;
      case 'AUTO_DELIVERY':
        return q.version?.deliveryLeadDays === null || q.version?.deliveryLeadDays === undefined ? null : String(q.version.deliveryLeadDays);
      case 'AUTO_PAYMENT_TERMS':
        return q.version?.paymentTermsDays === null || q.version?.paymentTermsDays === undefined ? null : String(q.version.paymentTermsDays);
      case 'MANUAL':
        return manualValue;
    }
  }

  /** Re-runs scoring on demand, e.g. after a revision or a new exchange rate. */
  async recompute(auth: AuthContext, rfqId: string) {
    await this.prisma.tx(async (tx) => {
      const evaluation = await this.loadEvaluation(tx, auth, rfqId);
      if (evaluation.status !== 'IN_PROGRESS') throw AppError.invalidState('This evaluation is closed');
      await this.assertMayEvaluate(tx, evaluation.id, auth.userId);
      await this.rescore(tx, auth, rfqId);
      await this.audit.record(tx, { action: 'evaluation.recomputed', entityType: 'rfq_evaluation', entityId: evaluation.id, after: { by: auth.userId } });
    });
    return this.detail(auth, rfqId);
  }

  /** Excludes a quotation from the round with a recorded reason, then re-scores. */
  async exclude(auth: AuthContext, rfqId: string, quotationId: string, reason: string) {
    await this.prisma.tx(async (tx) => {
      const evaluation = await this.loadEvaluation(tx, auth, rfqId);
      if (evaluation.status !== 'IN_PROGRESS') throw AppError.invalidState('This evaluation is closed');
      await this.assertMayEvaluate(tx, evaluation.id, auth.userId);
      const qe = await tx.quotationEvaluation.findUnique({ where: { evaluationId_quotationId: { evaluationId: evaluation.id, quotationId } } });
      if (!qe) throw AppError.notFound('Quotation in this evaluation');
      await tx.quotationEvaluation.update({ where: { id: qe.id }, data: { excluded: true, exclusionReason: reason } });
      await tx.quotationReview.create({
        data: { quotationId, versionNo: qe.versionNo, action: 'EXCLUDED_FROM_EVALUATION', note: reason, reviewerId: auth.userId },
      });
      await this.audit.record(tx, {
        action: 'evaluation.quotation_excluded',
        entityType: 'rfq_evaluation',
        entityId: evaluation.id,
        after: { quotationId, reason },
      });
    });
    return this.detail(auth, rfqId);
  }

  /** The full evaluation view: criteria, per-quotation scores and the trail. */
  async detail(auth: AuthContext, rfqId: string) {
    const evaluation = await this.prisma.rfqEvaluation.findFirst({
      where: { rfqId, companyId: auth.companyId },
      include: {
        criteriaSet: { include: { criteria: { orderBy: { sortOrder: 'asc' } } } },
        startedBy: { select: { id: true, fullName: true } },
        quotations: {
          include: {
            scores: { include: { scoredBy: { select: { id: true, fullName: true } } } },
            quotation: { include: { vendor: { select: { id: true, vendorCode: true, legalName: true } } } },
          },
        },
        declarations: { include: { user: { select: { id: true, fullName: true } } }, orderBy: { declaredAt: 'asc' } },
        notes: { include: { author: { select: { id: true, fullName: true } } }, orderBy: { occurredAt: 'asc' } },
      },
    });
    if (!evaluation) throw AppError.notFound('Evaluation');

    const ranked = [...evaluation.quotations]
      .filter((q) => q.totalScore !== null && !q.excluded)
      .sort((a, b) => b.totalScore!.cmp(a.totalScore!))
      .map((q) => q.quotationId);

    return {
      id: evaluation.id,
      rfqId: evaluation.rfqId,
      status: evaluation.status,
      basisCurrency: evaluation.basisCurrency,
      formulaVersion: evaluation.formulaVersion,
      summaryNote: evaluation.summaryNote,
      startedAt: evaluation.startedAt,
      startedBy: evaluation.startedBy,
      completedAt: evaluation.completedAt,
      criteriaSet: {
        id: evaluation.criteriaSet.id,
        name: evaluation.criteriaSet.name,
        setVersion: evaluation.criteriaSet.setVersion,
        criteria: evaluation.criteriaSet.criteria.map((c) => ({
          key: c.key,
          label: c.label,
          weightPercent: dec(c.weightPercent),
          source: c.source,
          direction: c.direction,
          guidance: c.guidance,
        })),
      },
      ranking: ranked,
      quotations: evaluation.quotations.map((q) => ({
        quotationId: q.quotationId,
        quotationNo: q.quotation.quotationNo,
        vendor: q.quotation.vendor,
        versionNo: q.versionNo,
        comparableTotal: dec(q.comparableTotal),
        totalScore: dec(q.totalScore, 4),
        blockers: q.blockers,
        blockerLabels: (q.blockers as ComparabilityBlocker[]).map((b) => COMPARABILITY_BLOCKER_LABELS[b] ?? b),
        excluded: q.excluded,
        exclusionReason: q.exclusionReason,
        scoredAt: q.scoredAt,
        /** Every criterion with the figure it used — the "show the working" view. */
        scores: q.scores.map((s) => ({
          criterionKey: s.criterionKey,
          source: s.source,
          weightPercent: dec(s.weightPercent),
          rawValue: s.rawValue,
          normalizedScore: dec(s.normalizedScore, 4),
          weightedScore: dec(s.weightedScore, 4),
          missing: s.missing,
          note: s.note,
          scoredBy: s.scoredBy,
          scoredAt: s.scoredAt,
        })),
      })),
      declarations: evaluation.declarations.map((d) => ({ user: d.user, hasConflict: d.hasConflict, details: d.details, declaredAt: d.declaredAt })),
      notes: evaluation.notes.map((n) => ({ note: n.note, author: n.author, occurredAt: n.occurredAt })),
    };
  }

  /** Marks the round complete so an award recommendation may be raised. */
  async complete(auth: AuthContext, rfqId: string, summaryNote: string) {
    await this.prisma.tx(async (tx) => {
      const evaluation = await this.loadEvaluation(tx, auth, rfqId);
      if (evaluation.status !== 'IN_PROGRESS') throw AppError.invalidState('This evaluation is already closed');
      await this.assertMayEvaluate(tx, evaluation.id, auth.userId);
      const scored = await tx.quotationEvaluation.count({ where: { evaluationId: evaluation.id, totalScore: { not: null }, excluded: false } });
      if (scored === 0) throw AppError.invalidState('Score at least one comparable quotation before completing the evaluation');
      const res = await tx.rfqEvaluation.updateMany({
        where: { id: evaluation.id, version: evaluation.version },
        data: { status: 'COMPLETED', completedAt: new Date(), completedById: auth.userId, summaryNote, version: { increment: 1 } },
      });
      if (res.count !== 1) throw AppError.versionConflict();
      await this.audit.record(tx, { action: 'evaluation.completed', entityType: 'rfq_evaluation', entityId: evaluation.id, after: { scored, summaryNote } });
    });
    return this.detail(auth, rfqId);
  }

  /** Totals recomputed from stored line figures — used by the reports to prove the arithmetic. */
  recomputeTotals(version: VersionWithLines) {
    return computeDocumentTotals(
      version.lines.map((l) => ({
        quantity: l.quantity.toFixed(4),
        unitPrice: l.unitPrice.toFixed(4),
        discountPercent: l.discountPercent.toFixed(2),
        taxRate: l.taxRate.toFixed(2),
      })),
      { freight: version.freight.toFixed(2), otherCharges: version.otherCharges.toFixed(2), taxTreatment: version.taxTreatment },
    );
  }
}
