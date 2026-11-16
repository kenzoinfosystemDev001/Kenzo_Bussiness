import { formatMoney } from '@kenzo/shared';

export { formatMoney };

const DATE = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const DATE_TIME = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d ? DATE.format(d) : '—';
}

export function formatDateTime(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d ? DATE_TIME.format(d) : '—';
}

const RTF = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

export function relativeTime(value: string | Date | null | undefined, now: Date = new Date()): string {
  const d = toDate(value);
  if (!d) return '—';
  const seconds = Math.round((d.getTime() - now.getTime()) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return RTF.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

/** SNAKE_CASE / snake_case / dotted.keys → "Sentence case". */
export function humanize(value: string): string {
  const s = value.replace(/[._]/g, ' ').toLowerCase().trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase() || '?';
}

export function formatAmount(amount: string | null | undefined, currency: string | null | undefined): string {
  if (!amount) return '—';
  try {
    return formatMoney(amount, currency ?? 'INR');
  } catch {
    return `${currency ?? ''} ${amount}`.trim();
  }
}

export function chunk(value: string, size = 4): string {
  return value.match(new RegExp(`.{1,${size}}`, 'g'))?.join(' ') ?? value;
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
