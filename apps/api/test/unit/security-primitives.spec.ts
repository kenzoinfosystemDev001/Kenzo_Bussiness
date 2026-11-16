import { FieldEncryptionService } from '../../src/infrastructure/crypto/field-encryption.service';
import { hashPassword, needsRehash, verifyPassword } from '../../src/infrastructure/crypto/password-hasher';
import { canonicalJson, sha256Hex } from '../../src/infrastructure/crypto/tokens';
import { base32Decode, base32Encode, hotp, verifyTotp } from '../../src/infrastructure/crypto/totp';
import { decodeCursor, encodeCursor } from '../../src/common/pagination';
import { detectType, sanitizeFileName } from '../../src/modules/documents/file-type';
import type { Env } from '../../src/config/env';

describe('TOTP (RFC 4226 / 6238)', () => {
  // RFC 4226 Appendix D test vectors, secret "12345678901234567890".
  const secret = Buffer.from('12345678901234567890');
  it.each([
    [0, '755224'],
    [1, '287082'],
    [5, '254676'],
    [9, '520489'],
  ])('HOTP counter %i → %s', (counter, code) => {
    expect(hotp(secret, counter)).toBe(code);
  });

  it('accepts ±1 step of drift and rejects others', () => {
    const b32 = base32Encode(secret);
    const t = 59_000; // counter 1
    expect(verifyTotp(b32, hotp(secret, 1), t)).toBe(true);
    expect(verifyTotp(b32, hotp(secret, 2), t)).toBe(true);
    expect(verifyTotp(b32, hotp(secret, 4), t)).toBe(false);
    expect(verifyTotp(b32, 'abcdef', t)).toBe(false);
  });

  it('round-trips base32', () => {
    expect(base32Decode(base32Encode(secret)).equals(secret)).toBe(true);
  });
});

describe('password hashing', () => {
  it('hashes with a random salt and verifies', async () => {
    const a = await hashPassword('Correct-Horse-Battery-9');
    const b = await hashPassword('Correct-Horse-Battery-9');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(await verifyPassword('Correct-Horse-Battery-9', a)).toBe(true);
    expect(await verifyPassword('correct-horse-battery-9', a)).toBe(false);
    expect(needsRehash(a)).toBe(false);
    expect(needsRehash('scrypt$16384$8$1$x$y')).toBe(true);
  });

  it('rejects malformed hashes safely', async () => {
    expect(await verifyPassword('x', 'plaintext')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$999999999$8$1$a$b')).toBe(false);
  });
});

describe('field encryption (AES-256-GCM)', () => {
  const svc = new FieldEncryptionService({ DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64') } as Env);

  it('encrypts with a fresh IV and decrypts', () => {
    const a = svc.encrypt('123456789012', 'bank:1');
    expect(a).not.toBe(svc.encrypt('123456789012', 'bank:1'));
    expect(a).not.toContain('123456789012');
    expect(svc.decrypt(a, 'bank:1')).toBe('123456789012');
  });

  it('detects tampering and wrong associated data', () => {
    const a = svc.encrypt('secret', 'ctx');
    expect(() => svc.decrypt(a, 'other-ctx')).toThrow();
    const parts = a.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => svc.decrypt(parts.join('.'), 'ctx')).toThrow();
  });
});

describe('canonical hashing', () => {
  it('is independent of key order', () => {
    expect(sha256Hex(canonicalJson({ b: 1, a: { d: 2, c: 3 } }))).toBe(sha256Hex(canonicalJson({ a: { c: 3, d: 2 }, b: 1 })));
  });
});

describe('cursor pagination', () => {
  it('round-trips and rejects garbage', () => {
    const row = { createdAt: new Date('2026-01-01T00:00:00Z'), id: '6f1b2c3d-1111-4222-8333-944455556666' };
    expect(decodeCursor(encodeCursor(row))).toEqual(row);
    expect(() => decodeCursor('not-a-cursor')).toThrow();
    expect(decodeCursor(undefined)).toBeNull();
  });
});

describe('file type detection', () => {
  it('trusts content, not the extension', () => {
    expect(detectType('a.pdf', Buffer.from('%PDF-1.4 ...'))?.mime).toBe('application/pdf');
    expect(detectType('a.pdf', Buffer.from('MZ\x90\x00'))).toBeNull();
    expect(detectType('a.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.mime).toBe('image/png');
    expect(detectType('a.exe', Buffer.from('MZ'))).toBeNull();
    expect(detectType('a.csv', Buffer.from('a,b\n1,2'))?.mime).toBe('text/csv');
    expect(detectType('a.csv', Buffer.from([0x61, 0x00, 0x62]))).toBeNull();
  });

  it('sanitises file names', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\x\\in"vo<i>ce.pdf')).toBe('in_vo_i_ce.pdf');
  });
});
