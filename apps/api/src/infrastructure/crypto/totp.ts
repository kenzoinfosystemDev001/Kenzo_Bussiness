import { createHmac, randomBytes } from 'node:crypto';

/**
 * RFC 6238 TOTP (SHA-1, 6 digits, 30 s step) — compatible with Google
 * Authenticator, Microsoft Authenticator, 1Password, etc.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(msg).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, '0');
}

export function totp(secretBase32: string, at = Date.now(), step = 30): string {
  return hotp(base32Decode(secretBase32), Math.floor(at / 1000 / step));
}

/** Accepts the current code and ±`window` steps for clock drift. */
export function verifyTotp(secretBase32: string, code: string, at = Date.now(), window = 1, step = 30): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(at / 1000 / step);
  for (let i = -window; i <= window; i++) {
    if (hotp(secret, counter + i) === code) return true;
  }
  return false;
}

export function otpauthUri(secretBase32: string, account: string, issuer = 'Kenzo-Kore BusinessOS'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
