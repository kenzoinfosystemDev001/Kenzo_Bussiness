import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';

/**
 * Application-level encryption for restricted values (MFA secrets now; vendor
 * bank / tax identifiers in Phase 02). AES-256-GCM with a random 96-bit IV per
 * value. Format: `v1.<iv>.<tag>.<ciphertext>` (base64url). The `v1` prefix
 * names the key generation so keys can be rotated with a re-encryption job.
 */
@Injectable()
export class FieldEncryptionService {
  private readonly key: Buffer;

  constructor(@Inject(ENV) env: Env) {
    this.key = Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64');
  }

  encrypt(plaintext: string, associatedData?: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    if (associatedData) cipher.setAAD(Buffer.from(associatedData));
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
  }

  /**
   * Deterministic keyed fingerprint (HMAC-SHA256 with an HKDF-derived key) used
   * to find duplicates of encrypted values (PAN, bank account numbers) without
   * decrypting them. Not reversible; different `kind`s never collide.
   */
  fingerprint(kind: 'pan' | 'bank_account', value: string): string {
    const key = Buffer.from(hkdfSync('sha256', this.key, Buffer.alloc(0), `kk-fingerprint:${kind}`, 32));
    return createHmac('sha256', key).update(value.replace(/[\s-]/g, '').toUpperCase()).digest('hex');
  }

  decrypt(encoded: string, associatedData?: string): string {
    const [version, ivB64, tagB64, ctB64] = encoded.split('.');
    if (version !== 'v1' || !ivB64 || !tagB64 || ctB64 === undefined) throw new Error('Unsupported ciphertext format');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64url'));
    if (associatedData) decipher.setAAD(Buffer.from(associatedData));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]).toString('utf8');
  }
}
