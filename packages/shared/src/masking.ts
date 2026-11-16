/**
 * Masking for restricted identifiers (bank account numbers, PAN, GSTIN, IFSC).
 * Values are masked by default in every API response; only callers holding the
 * relevant reveal permission (e.g. `vendor.bank.read`) receive the clear value,
 * and every reveal is audited.
 */

const MASK_CHAR = '•';

/** Keeps the last `visible` characters, e.g. maskTail("123456789012") → "••••••••9012". */
export function maskTail(value: string | null | undefined, visible = 4): string | null {
  if (value === null || value === undefined) return null;
  const clean = value.replace(/\s+/g, '');
  if (clean.length <= visible) return MASK_CHAR.repeat(clean.length);
  return MASK_CHAR.repeat(clean.length - visible) + clean.slice(-visible);
}

/** "ABCDE1234F" → "AB••••••4F" */
export function maskMiddle(value: string | null | undefined, head = 2, tail = 2): string | null {
  if (value === null || value === undefined) return null;
  const clean = value.replace(/\s+/g, '');
  if (clean.length <= head + tail) return MASK_CHAR.repeat(clean.length);
  return clean.slice(0, head) + MASK_CHAR.repeat(clean.length - head - tail) + clean.slice(-tail);
}

/** "priya.sharma@kenzo.in" → "pr••••••••@kenzo.in" */
export function maskEmail(value: string | null | undefined): string | null {
  if (!value) return value ?? null;
  const at = value.indexOf('@');
  if (at <= 0) return maskMiddle(value);
  const local = value.slice(0, at);
  const keep = Math.min(2, local.length);
  return local.slice(0, keep) + MASK_CHAR.repeat(Math.max(local.length - keep, 1)) + value.slice(at);
}

/**
 * Field-name tokens whose values must never be written to logs or audit
 * payloads in clear text. Keys are split on camelCase / snake_case boundaries
 * and matched token-wise, so `panNumber` is redacted but `company` is not.
 */
const SECRET_TOKENS = new Set(['password', 'passcode', 'secret', 'token', 'otp', 'authorization', 'cookie', 'ifsc', 'pan', 'aadhaar', 'card', 'cvv', 'hash']);
const SECRET_PAIRS: Array<[string, string]> = [
  ['api', 'key'],
  ['private', 'key'],
  ['account', 'number'],
  ['mfa', 'code'],
];

function keyTokens(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function isSecretFieldName(key: string): boolean {
  const tokens = keyTokens(key);
  if (tokens.some((t) => SECRET_TOKENS.has(t) || (t.endsWith('token') && t.length > 5))) return true;
  return SECRET_PAIRS.some(([a, b]) => tokens.some((t, i) => t === a && tokens[i + 1] === b));
}

/** Recursively replaces secret-looking fields with "[REDACTED]". Safe for audit payloads. */
export function redactSecrets<T>(input: T, depth = 0): T {
  if (depth > 8 || input === null || typeof input !== 'object') return input;
  if (input instanceof Date) return input;
  if (Array.isArray(input)) return input.map((v) => redactSecrets(v, depth + 1)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    out[k] = isSecretFieldName(k) ? (v === null || v === undefined ? v : '[REDACTED]') : redactSecrets(v, depth + 1);
  }
  return out as T;
}
