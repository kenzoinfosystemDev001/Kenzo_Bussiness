import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256-bit URL-safe random token (session cookies, invitation and reset links). */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Tokens are stored only as SHA-256 hashes. */
export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacHex(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Deterministic JSON (sorted keys) so audit hashes are stable. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v === 'bigint') return v.toString();
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
    }
    return v;
  });
}
