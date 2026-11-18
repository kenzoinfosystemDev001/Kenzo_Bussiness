import { describe, expect, it } from 'vitest';
import { computeDocumentTotals, computeLineAmounts } from './index';
import {
  normalizeAmount,
  scoreCandidates,
  validateWeights,
  WeightsError,
  SCORING_FORMULA_VERSION,
  type ApprovedRate,
  type ScoringCriterion,
} from './evaluation';

describe('tax treatment', () => {
  it('adds tax on top of the discounted value when exclusive', () => {
    const r = computeLineAmounts({ quantity: '10', unitPrice: '100', discountPercent: '10', taxRatePercent: '18' });
    expect(r.gross).toBe('1000.00');
    expect(r.discount).toBe('100.00');
    expect(r.taxable).toBe('900.00');
    expect(r.tax).toBe('162.00');
    expect(r.total).toBe('1062.00');
  });

  it('extracts tax out of the discounted value when inclusive', () => {
    const r = computeLineAmounts({ quantity: '10', unitPrice: '100', discountPercent: '10', taxRatePercent: '18', taxTreatment: 'INCLUSIVE' });
    expect(r.gross).toBe('1000.00');
    expect(r.discount).toBe('100.00');
    // 900 / 1.18 = 762.711864… → 762.71, and the tax is the remainder.
    expect(r.taxable).toBe('762.71');
    expect(r.tax).toBe('137.29');
    // The customer pays the discounted quoted price, whatever the rate.
    expect(r.total).toBe('900.00');
  });

  it('never treats the two as equivalent: the same inputs give different totals', () => {
    const base = { quantity: '4', unitPrice: '250.50', taxRatePercent: '12' } as const;
    const exclusive = computeLineAmounts(base);
    const inclusive = computeLineAmounts({ ...base, taxTreatment: 'INCLUSIVE' });
    expect(exclusive.total).not.toBe(inclusive.total);
    expect(exclusive.total).toBe('1122.24');
    expect(inclusive.total).toBe('1002.00');
  });

  it('keeps taxable + tax = total under both treatments', () => {
    for (const taxTreatment of ['EXCLUSIVE', 'INCLUSIVE'] as const) {
      for (const rate of ['0', '5', '12', '18', '28']) {
        const r = computeLineAmounts({ quantity: '7', unitPrice: '33.33', discountPercent: '7.5', taxRatePercent: rate, taxTreatment });
        expect(Number(r.taxable) + Number(r.tax)).toBeCloseTo(Number(r.total), 2);
      }
    }
  });

  it('a zero-rated inclusive line is the same as an exclusive one', () => {
    const a = computeLineAmounts({ quantity: '3', unitPrice: '99.99', taxRatePercent: '0' });
    const b = computeLineAmounts({ quantity: '3', unitPrice: '99.99', taxRatePercent: '0', taxTreatment: 'INCLUSIVE' });
    expect(a).toEqual(b);
  });
});

describe('document totals', () => {
  const lines = [
    { quantity: '2', unitPrice: '1000', discountPercent: '5', taxRate: '18' },
    { quantity: '1', unitPrice: '500', discountPercent: '0', taxRate: '12' },
  ];

  it('adds tax, freight and other charges for an exclusive quotation', () => {
    const t = computeDocumentTotals(lines, { freight: '250', otherCharges: '50' });
    expect(t.subtotal).toBe('2500.00');
    expect(t.discountTotal).toBe('100.00');
    expect(t.taxableTotal).toBe('2400.00');
    expect(t.taxTotal).toBe('402.00'); // 1900 × 18 % + 500 × 12 %
    expect(t.grandTotal).toBe('3102.00');
    // The Phase 03 identity still holds for exclusive quotations.
    expect(Number(t.subtotal) - Number(t.discountTotal) + Number(t.taxTotal) + 250 + 50).toBeCloseTo(Number(t.grandTotal), 2);
  });

  it('does not add the tax again for an inclusive quotation', () => {
    const t = computeDocumentTotals(lines, { freight: '250', otherCharges: '50', taxTreatment: 'INCLUSIVE' });
    expect(t.subtotal).toBe('2500.00');
    expect(t.discountTotal).toBe('100.00');
    expect(t.grandTotal).toBe('2700.00'); // 2400 discounted + 300 charges
    expect(Number(t.taxableTotal) + Number(t.taxTotal)).toBeCloseTo(2400, 2);
  });

  it('is line-rounded, so the total is the exact sum of the displayed lines', () => {
    const odd = Array.from({ length: 7 }, () => ({ quantity: '3', unitPrice: '0.005', discountPercent: '0', taxRate: '18' }));
    const t = computeDocumentTotals(odd);
    const sum = t.lines.reduce((a, l) => a + Number(l.total), 0);
    expect(sum).toBeCloseTo(Number(t.grandTotal), 2);
  });
});

describe('weights', () => {
  it('accepts a set totalling exactly 100', () => {
    expect(() =>
      validateWeights([
        { key: 'PRICE', weightPercent: '60' },
        { key: 'QUALITY', weightPercent: '40' },
      ]),
    ).not.toThrow();
  });

  it('accepts fractional weights that still total 100', () => {
    expect(() =>
      validateWeights([
        { key: 'A', weightPercent: '33.33' },
        { key: 'B', weightPercent: '33.33' },
        { key: 'C', weightPercent: '33.34' },
      ]),
    ).not.toThrow();
  });

  it('rejects a set that does not total 100, naming the actual total', () => {
    expect(() =>
      validateWeights([
        { key: 'PRICE', weightPercent: '60' },
        { key: 'QUALITY', weightPercent: '30' },
      ]),
    ).toThrow(/exactly 100 %.*90\.00/s);
  });

  it('rejects 99.99 — near enough is not enough for a weighting', () => {
    expect(() => validateWeights([{ key: 'A', weightPercent: '99.99' }])).toThrow(WeightsError);
  });

  it('rejects duplicates, negatives and an empty set', () => {
    expect(() =>
      validateWeights([
        { key: 'A', weightPercent: '50' },
        { key: 'A', weightPercent: '50' },
      ]),
    ).toThrow(/more than once/);
    expect(() =>
      validateWeights([
        { key: 'A', weightPercent: '-10' },
        { key: 'B', weightPercent: '110' },
      ]),
    ).toThrow(/cannot be negative/);
    expect(() => validateWeights([])).toThrow(/at least one/);
  });
});

describe('scoreCandidates', () => {
  const criteria: ScoringCriterion[] = [
    { key: 'PRICE', label: 'Price', weightPercent: '60', source: 'AUTO_PRICE', direction: 'LOWER_BETTER' },
    { key: 'DELIVERY', label: 'Delivery', weightPercent: '20', source: 'AUTO_DELIVERY', direction: 'LOWER_BETTER' },
    { key: 'QUALITY', label: 'Quality', weightPercent: '20', source: 'MANUAL', direction: 'HIGHER_BETTER' },
  ];

  it('gives the best value on every criterion a perfect 100', () => {
    const r = scoreCandidates(criteria, [
      { ref: 'a', values: { PRICE: '1000', DELIVERY: '10', QUALITY: '100' } },
      { ref: 'b', values: { PRICE: '2000', DELIVERY: '20', QUALITY: '50' } },
    ]);
    const a = r.candidates.find((c) => c.ref === 'a')!;
    expect(a.totalScore).toBe('100.0000');
    expect(r.ranking).toEqual(['a', 'b']);
  });

  it('scales a lower-is-better criterion by the ratio to the best', () => {
    const r = scoreCandidates(criteria, [
      { ref: 'a', values: { PRICE: '1000', DELIVERY: '10', QUALITY: '100' } },
      { ref: 'b', values: { PRICE: '2000', DELIVERY: '20', QUALITY: '100' } },
    ]);
    const b = r.candidates.find((c) => c.ref === 'b')!;
    // price 1000/2000 = 50 → 30; delivery 10/20 = 50 → 10; quality 100 → 20
    expect(b.criteria.find((c) => c.key === 'PRICE')!.normalizedScore).toBe('50.0000');
    expect(b.totalScore).toBe('60.0000');
  });

  it('scales a higher-is-better criterion the other way', () => {
    const payment: ScoringCriterion[] = [{ key: 'TERMS', label: 'Terms', weightPercent: '100', source: 'AUTO_PAYMENT_TERMS', direction: 'HIGHER_BETTER' }];
    const r = scoreCandidates(payment, [
      { ref: 'a', values: { TERMS: '30' } },
      { ref: 'b', values: { TERMS: '60' } },
    ]);
    expect(r.candidates.find((c) => c.ref === 'b')!.totalScore).toBe('100.0000');
    expect(r.candidates.find((c) => c.ref === 'a')!.totalScore).toBe('50.0000');
  });

  it('scores a missing figure as zero and reports it rather than guessing', () => {
    const r = scoreCandidates(criteria, [
      { ref: 'a', values: { PRICE: '1000', DELIVERY: '10', QUALITY: '80' } },
      { ref: 'b', values: { PRICE: '1000', DELIVERY: null, QUALITY: '80' } },
    ]);
    const b = r.candidates.find((c) => c.ref === 'b')!;
    expect(b.missingCriteria).toEqual(['DELIVERY']);
    const delivery = b.criteria.find((c) => c.key === 'DELIVERY')!;
    expect(delivery.missing).toBe(true);
    expect(delivery.weightedScore).toBe('0.0000');
    expect(b.totalScore).toBe('80.0000');
  });

  it('ignores missing values when choosing the best, so one blank does not reset the scale', () => {
    const r = scoreCandidates(criteria, [
      { ref: 'a', values: { PRICE: '500', DELIVERY: null, QUALITY: '100' } },
      { ref: 'b', values: { PRICE: '1000', DELIVERY: '5', QUALITY: '100' } },
    ]);
    expect(r.candidates.find((c) => c.ref === 'b')!.criteria.find((c) => c.key === 'DELIVERY')!.bestValue).toBe('5');
  });

  it('handles a zero best value without dividing by zero', () => {
    const r = scoreCandidates(criteria, [
      { ref: 'a', values: { PRICE: '1000', DELIVERY: '0', QUALITY: '50' } },
      { ref: 'b', values: { PRICE: '1000', DELIVERY: '5', QUALITY: '50' } },
    ]);
    expect(r.candidates.find((c) => c.ref === 'a')!.criteria.find((c) => c.key === 'DELIVERY')!.normalizedScore).toBe('100.0000');
    expect(r.candidates.find((c) => c.ref === 'b')!.criteria.find((c) => c.key === 'DELIVERY')!.normalizedScore).toBe('0.0000');
  });

  it('shows the working: every score carries its raw value, best value and weight', () => {
    const r = scoreCandidates(criteria, [{ ref: 'a', values: { PRICE: '1234.50', DELIVERY: '14', QUALITY: '77' } }]);
    const price = r.candidates[0]!.criteria.find((c) => c.key === 'PRICE')!;
    expect(price).toMatchObject({ rawValue: '1234.50', bestValue: '1234.50', weightPercent: '60.00', source: 'AUTO_PRICE', direction: 'LOWER_BETTER' });
  });

  it('is reproducible: the same inputs always give the same scores', () => {
    const candidates = [
      { ref: 'a', values: { PRICE: '1000', DELIVERY: '10', QUALITY: '80' } },
      { ref: 'b', values: { PRICE: '1500', DELIVERY: '7', QUALITY: '95' } },
    ];
    expect(scoreCandidates(criteria, candidates)).toEqual(scoreCandidates(criteria, candidates));
    expect(scoreCandidates(criteria, candidates).formulaVersion).toBe(SCORING_FORMULA_VERSION);
  });

  it('breaks ties by input order rather than at random', () => {
    const r = scoreCandidates(criteria, [
      { ref: 'first', values: { PRICE: '100', DELIVERY: '5', QUALITY: '50' } },
      { ref: 'second', values: { PRICE: '100', DELIVERY: '5', QUALITY: '50' } },
    ]);
    expect(r.ranking).toEqual(['first', 'second']);
  });

  it('refuses to score against weights that do not total 100', () => {
    const bad: ScoringCriterion[] = [{ key: 'PRICE', label: 'Price', weightPercent: '90', source: 'AUTO_PRICE', direction: 'LOWER_BETTER' }];
    expect(() => scoreCandidates(bad, [{ ref: 'a', values: { PRICE: '1' } }])).toThrow(WeightsError);
  });
});

describe('normalizeAmount', () => {
  const rates: ApprovedRate[] = [
    { baseCurrency: 'INR', quoteCurrency: 'USD', rate: '83.25', source: 'RBI reference', rateTimestamp: '2026-11-17T12:00:00.000Z' },
  ];

  it('returns the amount unchanged when the currencies match', () => {
    expect(normalizeAmount('1500.5', 'INR', 'INR', [])).toEqual({ amount: '1500.50', rate: null });
  });

  it('converts at the approved rate and names the rate it used', () => {
    const r = normalizeAmount('100', 'USD', 'INR', rates)!;
    expect(r.amount).toBe('8325.00');
    expect(r.rate?.source).toBe('RBI reference');
    expect(r.rate?.rateTimestamp).toBe('2026-11-17T12:00:00.000Z');
  });

  it('returns null rather than assuming 1:1 when no approved rate covers the pair', () => {
    expect(normalizeAmount('100', 'EUR', 'INR', rates)).toBeNull();
    expect(normalizeAmount('100', 'USD', 'EUR', rates)).toBeNull();
  });

  it('rounds the converted amount to the money scale, half up', () => {
    const odd: ApprovedRate[] = [{ ...rates[0]!, rate: '83.333333' }];
    expect(normalizeAmount('3', 'USD', 'INR', odd)!.amount).toBe('250.00');
    expect(normalizeAmount('1.005', 'USD', 'INR', odd)!.amount).toBe('83.75');
  });
});
