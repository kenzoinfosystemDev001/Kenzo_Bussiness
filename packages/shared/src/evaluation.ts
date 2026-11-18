import { z } from 'zod';
import { Dec, MONEY_SCALE, type RoundingMode } from './money';

/**
 * Quotation evaluation and award contracts (Phase 04).
 *
 * Everything here is deterministic and reproducible: the same stored inputs
 * and the same formula version always yield the same scores, and every score
 * carries the numbers it was computed from. Nothing in this module reads a
 * clock, a random source or a model.
 */

// ── Comparability ──────────────────────────────────────────────────────────

/**
 * Why two quotations may not be compared on their face value. The comparison
 * engine reports these rather than quietly normalising them away: a buyer who
 * cannot see that one vendor quoted tax-inclusive in USD against an unapproved
 * rate is not comparing like with like.
 */
export const COMPARABILITY_BLOCKERS = ['MIXED_CURRENCY_NO_RATE', 'MIXED_TAX_TREATMENT', 'INCOMPLETE_RESPONSE', 'EXPIRED', 'NO_SUBMITTED_VERSION'] as const;
export type ComparabilityBlocker = (typeof COMPARABILITY_BLOCKERS)[number];

export const COMPARABILITY_BLOCKER_LABELS: Record<ComparabilityBlocker, string> = {
  MIXED_CURRENCY_NO_RATE: 'Quoted in another currency with no approved exchange rate',
  MIXED_TAX_TREATMENT: 'Quoted tax-inclusive while others quoted tax-extra',
  INCOMPLETE_RESPONSE: 'Did not quote every requested item',
  EXPIRED: 'Validity has lapsed',
  NO_SUBMITTED_VERSION: 'No submitted quotation version',
};

/** A blocker that bars a quotation from scoring and from award without an explicit recorded exception. */
export const HARD_BLOCKERS: readonly ComparabilityBlocker[] = ['MIXED_CURRENCY_NO_RATE', 'MIXED_TAX_TREATMENT', 'NO_SUBMITTED_VERSION'];

// ── Criteria ───────────────────────────────────────────────────────────────

/**
 * How a criterion gets its raw value.
 *
 * AUTO_* criteria read a figure the quotation already carries, so they cannot
 * be nudged by a reviewer. MANUAL criteria are scored by a named reviewer on a
 * 0–100 scale and always record who entered them.
 */
export const CRITERION_SOURCES = ['AUTO_PRICE', 'AUTO_DELIVERY', 'AUTO_PAYMENT_TERMS', 'MANUAL'] as const;
export type CriterionSource = (typeof CRITERION_SOURCES)[number];

/** Whether a larger raw value is better (payment credit days) or worse (price, lead time). */
export const CRITERION_DIRECTIONS = ['HIGHER_BETTER', 'LOWER_BETTER'] as const;
export type CriterionDirection = (typeof CRITERION_DIRECTIONS)[number];

export const CRITERION_SOURCE_LABELS: Record<CriterionSource, string> = {
  AUTO_PRICE: 'Total landed cost (from the quotation)',
  AUTO_DELIVERY: 'Delivery lead days (from the quotation)',
  AUTO_PAYMENT_TERMS: 'Payment credit days (from the quotation)',
  MANUAL: 'Scored by a reviewer (0–100)',
};

/** Suggested criteria offered when a company first configures a set. Weights are the company's to choose. */
export const SUGGESTED_CRITERIA: ReadonlyArray<{ key: string; label: string; source: CriterionSource; direction: CriterionDirection; weightPercent: string }> =
  [
    { key: 'PRICE', label: 'Total landed cost', source: 'AUTO_PRICE', direction: 'LOWER_BETTER', weightPercent: '50' },
    { key: 'DELIVERY', label: 'Delivery lead time', source: 'AUTO_DELIVERY', direction: 'LOWER_BETTER', weightPercent: '15' },
    { key: 'QUALITY', label: 'Quality and technical fit', source: 'MANUAL', direction: 'HIGHER_BETTER', weightPercent: '15' },
    { key: 'WARRANTY', label: 'Warranty and support', source: 'MANUAL', direction: 'HIGHER_BETTER', weightPercent: '5' },
    { key: 'VENDOR_PERFORMANCE', label: 'Past vendor performance', source: 'MANUAL', direction: 'HIGHER_BETTER', weightPercent: '5' },
    { key: 'PAYMENT_TERMS', label: 'Payment terms', source: 'AUTO_PAYMENT_TERMS', direction: 'HIGHER_BETTER', weightPercent: '5' },
    { key: 'COMPLIANCE', label: 'Compliance and documentation', source: 'MANUAL', direction: 'HIGHER_BETTER', weightPercent: '5' },
  ];

export const CRITERIA_SET_STATUSES = ['DRAFT', 'ACTIVE', 'RETIRED'] as const;
export type CriteriaSetStatus = (typeof CRITERIA_SET_STATUSES)[number];

// ── Scoring ────────────────────────────────────────────────────────────────

/**
 * The scoring formula is versioned and stored on every evaluation, so a score
 * computed last quarter can still be explained even after the formula changes.
 *
 * weighted-sum-v1
 *   Each criterion yields a 0–100 normalised score, which is multiplied by its
 *   weight. The candidate total is the sum, to 4 dp, HALF_UP.
 *
 *   LOWER_BETTER   score = best / value × 100   (best = smallest value)
 *   HIGHER_BETTER  score = value / best × 100   (best = largest value)
 *
 *   A zero best (a free quote, same-day delivery, cash terms) makes the ratio
 *   undefined, so the best candidate scores 100 and every other candidate 0.
 *   A missing raw value scores 0 and is reported as missing rather than
 *   silently treated as the worst real figure.
 */
export const SCORING_FORMULA_VERSION = 'weighted-sum-v1';
export const SCORE_SCALE = 4;
export const SCORE_ROUNDING: RoundingMode = 'HALF_UP';

export interface ScoringCriterion {
  key: string;
  label: string;
  /** 0–100, and the set must total exactly 100. */
  weightPercent: string;
  source: CriterionSource;
  direction: CriterionDirection;
}

export interface ScoringCandidate {
  /** Opaque to the engine; echoed back on the result. */
  ref: string;
  /** Raw value per criterion key. `null` means the quotation does not carry one. */
  values: Record<string, string | null>;
}

export interface CriterionScore {
  key: string;
  label: string;
  weightPercent: string;
  source: CriterionSource;
  direction: CriterionDirection;
  /** The figure the score was computed from, exactly as supplied. */
  rawValue: string | null;
  /** The best raw value among the scored candidates for this criterion. */
  bestValue: string | null;
  /** 0–100. */
  normalizedScore: string;
  /** normalizedScore × weightPercent ÷ 100. */
  weightedScore: string;
  missing: boolean;
}

export interface CandidateScore {
  ref: string;
  totalScore: string;
  criteria: CriterionScore[];
  /** Criterion keys with no raw value on this candidate. */
  missingCriteria: string[];
}

export interface ScoringResult {
  formulaVersion: string;
  candidates: CandidateScore[];
  /** Candidate refs in descending score order; ties keep input order. */
  ranking: string[];
}

export class WeightsError extends Error {}

/** Weights must be non-negative, at most 100 each, and total exactly 100. */
export function validateWeights(criteria: ReadonlyArray<{ key: string; weightPercent: string }>): void {
  if (criteria.length === 0) throw new WeightsError('Add at least one evaluation criterion');
  const keys = new Set<string>();
  for (const c of criteria) {
    if (keys.has(c.key)) throw new WeightsError(`Criterion "${c.key}" appears more than once`);
    keys.add(c.key);
    const w = Dec.of(c.weightPercent);
    if (w.isNegative()) throw new WeightsError(`Weight for "${c.key}" cannot be negative`);
    if (w.gt('100')) throw new WeightsError(`Weight for "${c.key}" cannot exceed 100 %`);
  }
  const total = Dec.sum(criteria.map((c) => c.weightPercent));
  if (!total.eq('100')) throw new WeightsError(`Weights must total exactly 100 % (currently ${total.toFixed(2)} %)`);
}

/**
 * Scores every candidate against every criterion and returns the full working,
 * not just the totals. Pure: no clock, no randomness, no I/O.
 */
export function scoreCandidates(criteria: ReadonlyArray<ScoringCriterion>, candidates: ReadonlyArray<ScoringCandidate>): ScoringResult {
  validateWeights(criteria);

  // Best value per criterion, computed only over candidates that carry one.
  const best = new Map<string, Dec | null>();
  for (const c of criteria) {
    const present = candidates.map((cand) => cand.values[c.key]).filter((v): v is string => v !== null && v !== undefined && v !== '');
    if (present.length === 0) {
      best.set(c.key, null);
      continue;
    }
    let b = Dec.of(present[0]!);
    for (const v of present.slice(1)) {
      const d = Dec.of(v);
      if (c.direction === 'LOWER_BETTER' ? d.lt(b) : d.gt(b)) b = d;
    }
    best.set(c.key, b);
  }

  const scored = candidates.map((cand) => {
    const criterionScores = criteria.map((c): CriterionScore => {
      const raw = cand.values[c.key];
      const b = best.get(c.key) ?? null;
      const weight = Dec.of(c.weightPercent);
      const base = {
        key: c.key,
        label: c.label,
        weightPercent: weight.toFixed(2),
        source: c.source,
        direction: c.direction,
        bestValue: b === null ? null : b.toFixed(b.scale),
      };
      if (raw === null || raw === undefined || raw === '' || b === null) {
        return { ...base, rawValue: raw ?? null, normalizedScore: zero(), weightedScore: zero(), missing: true };
      }
      const value = Dec.of(raw);
      let normalized: Dec;
      if (b.isZero() || value.isZero()) {
        // A ratio against zero is undefined: the best candidate takes full
        // marks and the rest take none, rather than dividing by zero.
        const isBest = value.eq(b);
        normalized = Dec.of(isBest ? '100' : '0');
      } else if (c.direction === 'LOWER_BETTER') {
        normalized = b.div(value, SCORE_SCALE, SCORE_ROUNDING).mul('100');
      } else {
        normalized = value.div(b, SCORE_SCALE, SCORE_ROUNDING).mul('100');
      }
      normalized = clamp(normalized);
      const weighted = normalized.mul(weight).div('100', SCORE_SCALE, SCORE_ROUNDING);
      return {
        ...base,
        rawValue: value.toFixed(value.scale),
        normalizedScore: normalized.toFixed(SCORE_SCALE),
        weightedScore: weighted.toFixed(SCORE_SCALE),
        missing: false,
      };
    });
    return {
      ref: cand.ref,
      totalScore: Dec.sum(criterionScores.map((s) => s.weightedScore)).toFixed(SCORE_SCALE),
      criteria: criterionScores,
      missingCriteria: criterionScores.filter((s) => s.missing).map((s) => s.key),
    };
  });

  const ranking = scored
    .map((s, i) => ({ ref: s.ref, score: Dec.of(s.totalScore), i }))
    .sort((a, b) => (a.score.eq(b.score) ? a.i - b.i : b.score.cmp(a.score)))
    .map((s) => s.ref);

  return { formulaVersion: SCORING_FORMULA_VERSION, candidates: scored, ranking };
}

const zero = () => Dec.of('0').toFixed(SCORE_SCALE);
const clamp = (d: Dec) => (d.gt('100') ? Dec.of('100') : d.isNegative() ? Dec.of('0') : d);

// ── Currency normalisation ─────────────────────────────────────────────────

export interface ApprovedRate {
  baseCurrency: string;
  quoteCurrency: string;
  /** Units of `baseCurrency` per one `quoteCurrency`. */
  rate: string;
  source: string;
  rateTimestamp: string;
}

/**
 * Converts `amount` from `from` into `to`. Returns null when no approved rate
 * covers the pair, which the caller must surface as "not comparable" rather
 * than fall back to 1:1.
 */
export function normalizeAmount(
  amount: string,
  from: string,
  to: string,
  rates: ReadonlyArray<ApprovedRate>,
): { amount: string; rate: ApprovedRate | null } | null {
  if (from === to) return { amount: Dec.of(amount).toFixed(MONEY_SCALE), rate: null };
  const rate = rates.find((r) => r.baseCurrency === to && r.quoteCurrency === from);
  if (!rate) return null;
  return { amount: Dec.of(amount).mul(rate.rate).round(MONEY_SCALE, 'HALF_UP').toFixed(MONEY_SCALE), rate };
}

// ── Award ──────────────────────────────────────────────────────────────────

export const AWARD_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'AWARDED', 'RETURNED', 'REJECTED', 'CANCELLED'] as const;
export type AwardStatus = (typeof AWARD_STATUSES)[number];

export const AWARD_STATUS_LABELS: Record<AwardStatus, string> = {
  DRAFT: 'Draft recommendation',
  PENDING_APPROVAL: 'Pending approval',
  APPROVED: 'Approved',
  AWARDED: 'Awarded',
  RETURNED: 'Returned for clarification',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

export const AWARD_TRANSITIONS: Record<AwardStatus, AwardStatus[]> = {
  DRAFT: ['PENDING_APPROVAL', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED'],
  // Approval and issue are separate steps: approval authorises the award,
  // issuing it notifies vendors and freezes the commercial snapshot.
  APPROVED: ['AWARDED', 'CANCELLED'],
  AWARDED: [],
  RETURNED: ['PENDING_APPROVAL', 'CANCELLED'],
  REJECTED: [],
  CANCELLED: [],
};

export const AWARD_TYPES = ['FULL', 'PARTIAL'] as const;
export type AwardType = (typeof AWARD_TYPES)[number];

// ── Schemas ────────────────────────────────────────────────────────────────

const text = (max: number) => z.string().trim().max(max);
const req = (max: number, label: string) => text(max).min(1, `${label} is required`);
const opt = (max: number) =>
  text(max)
    .nullish()
    .transform((v) => (v ? v : null));

const weight = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => Dec.isValid(v), 'Enter a number')
  .refine((v) => (v.split('.')[1]?.length ?? 0) <= 2, 'At most 2 decimal places')
  .refine((v) => Dec.of(v).gte('0') && Dec.of(v).lte('100'), 'Weight must be between 0 and 100');

export const criterionSchema = z.object({
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'Use letters, digits and underscores'),
  label: req(120, 'Label'),
  weightPercent: weight,
  source: z.enum(CRITERION_SOURCES),
  direction: z.enum(CRITERION_DIRECTIONS),
  guidance: opt(500),
});

export const criteriaSetSchema = z
  .object({
    name: req(120, 'Name'),
    description: opt(1000),
    isDefault: z.boolean().default(false),
    criteria: z.array(criterionSchema).min(1, 'Add at least one criterion').max(20, 'At most 20 criteria'),
  })
  .superRefine((s, ctx) => {
    try {
      validateWeights(s.criteria);
    } catch (err) {
      ctx.addIssue({ code: 'custom', path: ['criteria'], message: (err as Error).message });
    }
  });
export type CriteriaSetInput = z.infer<typeof criteriaSetSchema>;

export const updateCriteriaSetSchema = z.intersection(criteriaSetSchema, z.object({ version: z.number().int().nonnegative() }));

export const startEvaluationSchema = z.object({
  criteriaSetId: z.uuid({ message: 'Select an evaluation criteria set' }),
  /** Currency every quotation is normalised into. Defaults to the RFQ currency. */
  basisCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .optional(),
});

export const manualScoreSchema = z.object({
  scores: z
    .array(
      z.object({
        criterionKey: z.string().trim().toUpperCase().max(40),
        /** 0–100. */
        value: z
          .union([z.string(), z.number()])
          .transform((v) => String(v).trim())
          .refine((v) => Dec.isValid(v), 'Enter a number')
          .refine((v) => Dec.of(v).gte('0') && Dec.of(v).lte('100'), 'Score must be between 0 and 100'),
        note: opt(1000),
      }),
    )
    .min(1, 'Enter at least one score')
    .max(20),
});

export const exchangeRateSchema = z.object({
  baseCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/),
  quoteCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/),
  rate: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => Dec.isValid(v), 'Enter a number')
    .refine((v) => Dec.of(v).gt('0'), 'Rate must be greater than 0')
    .refine((v) => (v.split('.')[1]?.length ?? 0) <= 8, 'At most 8 decimal places'),
  source: req(80, 'Rate source'),
  rateTimestamp: z.iso.datetime({ offset: true }),
  note: opt(500),
});

export const conflictDeclarationSchema = z.object({
  hasConflict: z.boolean(),
  details: opt(2000),
});

export const awardLineSchema = z.object({
  rfqLineId: z.uuid(),
  quotationId: z.uuid(),
});

export const recommendAwardSchema = z.object({
  lines: z.array(awardLineSchema).min(1, 'Select a vendor for at least one item').max(100),
  rationale: req(4000, 'Recommendation rationale').min(20, 'Explain the recommendation (at least 20 characters)'),
  /** Required when awarding a quotation whose validity has lapsed. */
  expiredQuotationException: opt(1000),
});
export type RecommendAwardInput = z.infer<typeof recommendAwardSchema>;

export const awardDecisionSchema = z.object({ reason: req(2000, 'Reason').min(5, 'Give a reason') });
export const evaluationNoteSchema = z.object({ note: req(2000, 'Note').min(5, 'Add a note for the record') });
