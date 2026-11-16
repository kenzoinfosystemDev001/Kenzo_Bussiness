/**
 * Fiscal-year helpers. Indian companies default to an April–March fiscal year
 * (startMonth = 4). Dates are evaluated in the company's timezone, not UTC, so
 * a transaction at 00:30 IST on 1 April belongs to the new fiscal year.
 */

export interface FiscalYear {
  /** Calendar year in which the fiscal year starts, e.g. 2026 for FY 2026-27. */
  startYear: number;
  /** Human label, e.g. "2026-27" (or "2026" when the FY is the calendar year). */
  label: string;
  /** Compact label for document numbers, e.g. "2627" (or "2026"). */
  shortLabel: string;
}

export function datePartsInTimeZone(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

export function fiscalYearOf(date: Date, startMonth = 4, timeZone = 'Asia/Kolkata'): FiscalYear {
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
    throw new RangeError('Fiscal year start month must be between 1 and 12');
  }
  const { year, month } = datePartsInTimeZone(date, timeZone);
  const startYear = month >= startMonth ? year : year - 1;
  if (startMonth === 1) {
    return { startYear, label: `${startYear}`, shortLabel: `${startYear}` };
  }
  const endYY = String((startYear + 1) % 100).padStart(2, '0');
  const startYY = String(startYear % 100).padStart(2, '0');
  return { startYear, label: `${startYear}-${endYY}`, shortLabel: `${startYY}${endYY}` };
}

/**
 * Renders a numbering pattern. Supported tokens:
 *   {PREFIX} {FY} (e.g. 2026-27) {FYS} (e.g. 2627) {YYYY} {MM} {SEQ} / {SEQ:n} (zero-padded)
 */
export function renderNumberPattern(
  pattern: string,
  vars: { prefix: string; fiscalYear: FiscalYear; date: Date; timeZone: string; sequence: number; padding: number },
): string {
  const { year, month } = datePartsInTimeZone(vars.date, vars.timeZone);
  return pattern
    .replace(/\{PREFIX\}/g, vars.prefix)
    .replace(/\{FY\}/g, vars.fiscalYear.label)
    .replace(/\{FYS\}/g, vars.fiscalYear.shortLabel)
    .replace(/\{YYYY\}/g, String(year))
    .replace(/\{MM\}/g, String(month).padStart(2, '0'))
    .replace(/\{SEQ(?::(\d+))?\}/g, (_m, width?: string) => String(vars.sequence).padStart(width ? Number(width) : vars.padding, '0'));
}

export const NUMBER_PATTERN_RE = /^(?=.*\{SEQ(?::\d{1,2})?\})[A-Za-z0-9{}:/_-]{1,64}$/;
