/**
 * Exact fixed-point decimal arithmetic for financial values.
 *
 * Financial values must never pass through IEEE-754 floating point (PRD §8.2).
 * `Dec` stores an arbitrary-precision integer (`units`) and a decimal `scale`,
 * i.e. value = units / 10^scale. All operations are exact; rounding happens
 * only when explicitly requested with a declared rounding mode.
 *
 * Inputs are decimal strings (preferred), bigint, or safe integers. Fractional
 * JS numbers are rejected because they may already carry representation error.
 */

export type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'DOWN';

const DECIMAL_RE = /^([+-])?(\d+)(?:\.(\d+))?$/;
const MAX_SCALE = 18;

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

function divRound(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  if (denominator === 0n) throw new RangeError('Division by zero');
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  let q = n / d;
  const r = n % d;
  if (r !== 0n && mode !== 'DOWN') {
    const twice = r * 2n;
    if (twice > d || (twice === d && (mode === 'HALF_UP' || q % 2n === 1n))) {
      q += 1n;
    }
  }
  return negative ? -q : q;
}

export type DecInput = Dec | string | bigint | number;

export class Dec {
  private constructor(
    readonly units: bigint,
    readonly scale: number,
  ) {}

  static readonly ZERO = new Dec(0n, 0);

  static of(value: DecInput): Dec {
    if (value instanceof Dec) return value;
    if (typeof value === 'bigint') return new Dec(value, 0);
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value)) {
        throw new TypeError(`Refusing non-integer/unsafe number ${value}; pass a decimal string instead`);
      }
      return new Dec(BigInt(value), 0);
    }
    const match = DECIMAL_RE.exec(value.trim());
    if (!match) throw new TypeError(`Invalid decimal value: "${value}"`);
    const [, sign, intPart, fracPart = ''] = match;
    if (fracPart.length > MAX_SCALE) throw new RangeError(`Decimal scale exceeds ${MAX_SCALE}: "${value}"`);
    const units = BigInt(intPart! + fracPart) * (sign === '-' ? -1n : 1n);
    return new Dec(units, fracPart.length);
  }

  static isValid(value: string): boolean {
    const m = DECIMAL_RE.exec(value.trim());
    return !!m && (m[3]?.length ?? 0) <= MAX_SCALE;
  }

  static sum(values: Iterable<DecInput>): Dec {
    let acc = Dec.ZERO;
    for (const v of values) acc = acc.add(v);
    return acc;
  }

  private rescaleUp(scale: number): bigint {
    return this.units * pow10(scale - this.scale);
  }

  add(other: DecInput): Dec {
    const o = Dec.of(other);
    const scale = Math.max(this.scale, o.scale);
    return new Dec(this.rescaleUp(scale) + o.rescaleUp(scale), scale);
  }

  sub(other: DecInput): Dec {
    return this.add(Dec.of(other).neg());
  }

  mul(other: DecInput): Dec {
    const o = Dec.of(other);
    const scale = this.scale + o.scale;
    if (scale > MAX_SCALE * 2) throw new RangeError('Multiplication scale overflow');
    return new Dec(this.units * o.units, scale);
  }

  /** Divides and rounds to `scale` decimal places using `mode`. */
  div(other: DecInput, scale: number, mode: RoundingMode = 'HALF_UP'): Dec {
    const o = Dec.of(other);
    // value = (a/10^sa) / (b/10^sb) ; result units at `scale` = a * 10^(scale + sb - sa) / b
    const exp = scale + o.scale - this.scale;
    const numerator = exp >= 0 ? this.units * pow10(exp) : this.units;
    const denominator = exp >= 0 ? o.units : o.units * pow10(-exp);
    return new Dec(divRound(numerator, denominator, mode), scale);
  }

  round(scale: number, mode: RoundingMode = 'HALF_UP'): Dec {
    if (scale >= this.scale) return new Dec(this.rescaleUp(scale), scale);
    return new Dec(divRound(this.units, pow10(this.scale - scale), mode), scale);
  }

  neg(): Dec {
    return new Dec(-this.units, this.scale);
  }

  abs(): Dec {
    return this.units < 0n ? this.neg() : this;
  }

  cmp(other: DecInput): -1 | 0 | 1 {
    const o = Dec.of(other);
    const scale = Math.max(this.scale, o.scale);
    const a = this.rescaleUp(scale);
    const b = o.rescaleUp(scale);
    return a === b ? 0 : a < b ? -1 : 1;
  }

  eq(other: DecInput): boolean {
    return this.cmp(other) === 0;
  }
  gt(other: DecInput): boolean {
    return this.cmp(other) === 1;
  }
  gte(other: DecInput): boolean {
    return this.cmp(other) >= 0;
  }
  lt(other: DecInput): boolean {
    return this.cmp(other) === -1;
  }
  lte(other: DecInput): boolean {
    return this.cmp(other) <= 0;
  }
  isZero(): boolean {
    return this.units === 0n;
  }
  isNegative(): boolean {
    return this.units < 0n;
  }

  /** Canonical string with exactly `scale` places (defaults to the value's own scale). */
  toFixed(scale: number = this.scale, mode: RoundingMode = 'HALF_UP'): string {
    const r = this.round(scale, mode);
    const negative = r.units < 0n;
    const digits = (negative ? -r.units : r.units).toString().padStart(scale + 1, '0');
    const intPart = scale === 0 ? digits : digits.slice(0, -scale);
    const frac = scale === 0 ? '' : `.${digits.slice(-scale)}`;
    return `${negative ? '-' : ''}${intPart}${frac}`;
  }

  toString(): string {
    return this.toFixed();
  }

  toJSON(): string {
    return this.toFixed();
  }
}

/** Standard monetary scale for INR and most ISO 4217 currencies. */
export const MONEY_SCALE = 2;

/**
 * Whether a quoted unit price already contains the tax.
 *
 * EXCLUSIVE — tax is added on top of the discounted value (the GST default).
 * INCLUSIVE — the quoted price already contains it, so the tax is extracted
 * out of the discounted value rather than added to it.
 *
 * The two are never interchangeable: the same unit price means a different
 * amount payable under each, so anything that compares or sums quotations must
 * read this field rather than assume one treatment.
 */
export type TaxTreatment = 'EXCLUSIVE' | 'INCLUSIVE';

export interface LineAmountInput {
  quantity: DecInput;
  unitPrice: DecInput;
  /** Percentage discount, e.g. "5" for 5 %. */
  discountPercent?: DecInput;
  /** Tax rate percentage, e.g. "18" for 18 % GST. */
  taxRatePercent?: DecInput;
  /** Defaults to EXCLUSIVE. */
  taxTreatment?: TaxTreatment;
  rounding?: RoundingMode;
}

export interface LineAmounts {
  gross: string;
  discount: string;
  taxable: string;
  tax: string;
  total: string;
}

/**
 * Computes a transaction line using line-level rounding: every component is
 * rounded to MONEY_SCALE before being summed, so document totals are the exact
 * sum of the displayed line values. Tax snapshots must be stored per line.
 *
 * Under both treatments `taxable + tax = total` and `gross - discount` is the
 * discounted value of the line. They differ in where the tax comes from:
 *
 *   EXCLUSIVE: taxable = gross - discount         tax = taxable × rate
 *   INCLUSIVE: taxable = (gross - discount) / (1 + rate)
 *              tax     = (gross - discount) - taxable
 *
 * so an inclusive line's `total` equals its discounted gross, and the customer
 * pays the same amount whatever the rate.
 */
export function computeLineAmounts(input: LineAmountInput): LineAmounts {
  const mode = input.rounding ?? 'HALF_UP';
  const qty = Dec.of(input.quantity);
  const price = Dec.of(input.unitPrice);
  if (qty.isNegative()) throw new RangeError('Quantity must not be negative');
  if (price.isNegative()) throw new RangeError('Unit price must not be negative');
  const discountPct = Dec.of(input.discountPercent ?? '0');
  const taxPct = Dec.of(input.taxRatePercent ?? '0');
  if (discountPct.isNegative() || discountPct.gt('100')) throw new RangeError('Discount must be within 0–100 %');
  if (taxPct.isNegative()) throw new RangeError('Tax rate must not be negative');

  const gross = qty.mul(price).round(MONEY_SCALE, mode);
  const discount = gross.mul(discountPct).div('100', MONEY_SCALE, mode);
  const net = gross.sub(discount);

  let taxable: Dec;
  let tax: Dec;
  if ((input.taxTreatment ?? 'EXCLUSIVE') === 'INCLUSIVE') {
    // Extract the tax out of the discounted value; the remainder is taxable, so
    // the two always add back to exactly what the vendor quoted.
    taxable = net.mul('100').div(Dec.of('100').add(taxPct), MONEY_SCALE, mode);
    tax = net.sub(taxable);
  } else {
    taxable = net;
    tax = taxable.mul(taxPct).div('100', MONEY_SCALE, mode);
  }
  const total = taxable.add(tax);
  return {
    gross: gross.toFixed(MONEY_SCALE),
    discount: discount.toFixed(MONEY_SCALE),
    taxable: taxable.toFixed(MONEY_SCALE),
    tax: tax.toFixed(MONEY_SCALE),
    total: total.toFixed(MONEY_SCALE),
  };
}

/**
 * Splits `total` across `weights` proportionally using the largest-remainder
 * method so the parts always sum exactly to `total` (e.g. allocating freight).
 */
export function allocateProportionally(total: DecInput, weights: DecInput[], scale = MONEY_SCALE): string[] {
  if (weights.length === 0) return [];
  const t = Dec.of(total).round(scale);
  const ws = weights.map((w) => Dec.of(w));
  if (ws.some((w) => w.isNegative())) throw new RangeError('Weights must not be negative');
  const weightSum = Dec.sum(ws);
  if (weightSum.isZero()) throw new RangeError('Weights must not all be zero');

  // Work in integer units of 10^-scale.
  const totalUnits = t.units;
  const commonScale = Math.max(...ws.map((w) => w.scale));
  const wUnits = ws.map((w) => w.units * pow10(commonScale - w.scale));
  const sumUnits = wUnits.reduce((a, b) => a + b, 0n);
  const sign = totalUnits < 0n ? -1n : 1n;
  const absTotal = totalUnits * sign;

  const base = wUnits.map((w) => (absTotal * w) / sumUnits);
  const remainders = wUnits.map((w, i) => ({ i, r: (absTotal * w) % sumUnits }));
  let leftover = absTotal - base.reduce((a, b) => a + b, 0n);
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of remainders) {
    if (leftover === 0n) break;
    base[i] = base[i]! + 1n;
    leftover -= 1n;
  }
  return base.map((u) =>
    Dec.of(`${u * sign}`)
      .div(pow10(scale), scale, 'DOWN')
      .toFixed(scale),
  );
}

/** Formats a decimal string for display, e.g. formatMoney("123456.5", "INR") → "₹1,23,456.50". */
export function formatMoney(amount: DecInput, currency = 'INR', locale = 'en-IN'): string {
  const fixed = Dec.of(amount).toFixed(MONEY_SCALE);
  const negative = fixed.startsWith('-');
  const [intPart = '0', frac = '00'] = fixed.replace('-', '').split('.');
  // Intl formats the integer part safely (it is an exact integer string); the
  // fractional part is appended verbatim so no float rounding is introduced.
  const groupedInt = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(BigInt(intPart));
  const symbol =
    new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((part) => part.type === 'currency')
      ?.value ?? currency;
  return `${negative ? '-' : ''}${symbol}${groupedInt}.${frac}`;
}
