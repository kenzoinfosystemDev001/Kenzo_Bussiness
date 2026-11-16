import { describe, expect, it } from 'vitest';
import { Dec, allocateProportionally, computeLineAmounts, formatMoney } from './money';

describe('Dec', () => {
  it('adds without floating point error', () => {
    expect(Dec.of('0.1').add('0.2').toString()).toBe('0.3');
    expect(Dec.sum(['10.10', '20.20', '30.30']).toFixed(2)).toBe('60.60');
  });

  it('multiplies exactly and rounds explicitly', () => {
    expect(Dec.of('3').mul('33.335').toFixed(2)).toBe('100.01');
    expect(Dec.of('2.675').round(2).toString()).toBe('2.68'); // float would give 2.67
  });

  it('supports half-even (banker) rounding', () => {
    expect(Dec.of('2.125').round(2, 'HALF_EVEN').toString()).toBe('2.12');
    expect(Dec.of('2.135').round(2, 'HALF_EVEN').toString()).toBe('2.14');
    expect(Dec.of('-2.125').round(2, 'HALF_UP').toString()).toBe('-2.13');
  });

  it('divides with declared scale', () => {
    expect(Dec.of('100').div('3', 2).toString()).toBe('33.33');
    expect(Dec.of('200').div('3', 2).toString()).toBe('66.67');
    expect(() => Dec.of('1').div('0', 2)).toThrow(RangeError);
  });

  it('compares across scales', () => {
    expect(Dec.of('1.50').eq('1.5')).toBe(true);
    expect(Dec.of('1.499').lt('1.5')).toBe(true);
  });

  it('rejects unsafe inputs', () => {
    expect(() => Dec.of(0.1)).toThrow(TypeError);
    expect(() => Dec.of('1e5')).toThrow(TypeError);
    expect(() => Dec.of('abc')).toThrow(TypeError);
    expect(Dec.of(42).toString()).toBe('42');
  });
});

describe('computeLineAmounts', () => {
  it('computes GST line amounts with line-level rounding', () => {
    expect(computeLineAmounts({ quantity: '10', unitPrice: '1234.56', discountPercent: '5', taxRatePercent: '18' })).toEqual({
      gross: '12345.60',
      discount: '617.28',
      taxable: '11728.32',
      tax: '2111.10',
      total: '13839.42',
    });
  });

  it('rejects negative quantities and out-of-range discounts', () => {
    expect(() => computeLineAmounts({ quantity: '-1', unitPrice: '1' })).toThrow();
    expect(() => computeLineAmounts({ quantity: '1', unitPrice: '1', discountPercent: '101' })).toThrow();
  });
});

describe('allocateProportionally', () => {
  it('always sums exactly to the total', () => {
    const parts = allocateProportionally('100.00', ['1', '1', '1']);
    expect(parts).toEqual(['33.34', '33.33', '33.33']);
    expect(Dec.sum(parts).toFixed(2)).toBe('100.00');
  });

  it('allocates by weight', () => {
    expect(allocateProportionally('500', ['3', '1'])).toEqual(['375.00', '125.00']);
  });

  it('handles negative totals', () => {
    const parts = allocateProportionally('-10.00', ['1', '2']);
    expect(Dec.sum(parts).toFixed(2)).toBe('-10.00');
  });
});

describe('formatMoney', () => {
  it('formats INR using Indian digit grouping', () => {
    expect(formatMoney('1234567.5')).toBe('₹12,34,567.50');
    expect(formatMoney('-42')).toBe('-₹42.00');
  });
});
