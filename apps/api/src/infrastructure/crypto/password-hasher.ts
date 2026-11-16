import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const scrypt = (password: string, salt: Buffer, keylen: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key))));

/**
 * Password hashing with Node's built-in scrypt (memory-hard KDF; no native
 * dependency). Encoded as `scrypt$N$r$p$saltB64$hashB64` so parameters can be
 * raised later and old hashes re-hashed on next successful login.
 */
export const PASSWORD_PARAMS = { N: 2 ** 15, r: 8, p: 1, keylen: 64 } as const;
const MAXMEM = 128 * PASSWORD_PARAMS.N * PASSWORD_PARAMS.r * 2;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const { N, r, p, keylen } = PASSWORD_PARAMS;
  const key = await scrypt(password.normalize('NFKC'), salt, keylen, { N, r, p, maxmem: MAXMEM });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p) || N > 2 ** 20) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N,
    r,
    p,
    maxmem: 128 * N * r * 2,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function needsRehash(encoded: string): boolean {
  const [, nStr, rStr, pStr] = encoded.split('$');
  return Number(nStr) !== PASSWORD_PARAMS.N || Number(rStr) !== PASSWORD_PARAMS.r || Number(pStr) !== PASSWORD_PARAMS.p;
}

/** A valid hash of a random password, used to equalise timing for unknown accounts. */
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(24).toString('base64'));
  return dummyHash;
}
