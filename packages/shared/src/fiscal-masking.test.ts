import { describe, expect, it } from 'vitest';
import { fiscalYearOf, renderNumberPattern, NUMBER_PATTERN_RE } from './fiscal';
import { isSecretFieldName, maskEmail, maskMiddle, maskTail, redactSecrets } from './masking';
import { PERMISSION_KEYS } from './permissions';
import { SYSTEM_ROLES } from './roles';

describe('fiscalYearOf', () => {
  it('uses April–March by default and the company timezone', () => {
    // 31 Mar 2026 19:00 UTC == 1 Apr 2026 00:30 IST → FY 2026-27
    expect(fiscalYearOf(new Date('2026-03-31T19:00:00Z')).label).toBe('2026-27');
    expect(fiscalYearOf(new Date('2026-03-31T18:00:00Z')).label).toBe('2025-26');
    expect(fiscalYearOf(new Date('2026-11-13T10:00:00Z')).shortLabel).toBe('2627');
  });

  it('supports calendar fiscal years', () => {
    expect(fiscalYearOf(new Date('2026-06-01T00:00:00Z'), 1, 'UTC').label).toBe('2026');
  });
});

describe('renderNumberPattern', () => {
  it('renders tokens', () => {
    const date = new Date('2026-11-13T10:00:00Z');
    const fy = fiscalYearOf(date);
    expect(renderNumberPattern('{PREFIX}-{FY}-{SEQ}', { prefix: 'PO', fiscalYear: fy, date, timeZone: 'Asia/Kolkata', sequence: 123, padding: 6 })).toBe(
      'PO-2026-27-000123',
    );
    expect(renderNumberPattern('{PREFIX}/{YYYY}{MM}/{SEQ:4}', { prefix: 'PR', fiscalYear: fy, date, timeZone: 'Asia/Kolkata', sequence: 7, padding: 6 })).toBe(
      'PR/202611/0007',
    );
  });

  it('validates patterns', () => {
    expect(NUMBER_PATTERN_RE.test('{PREFIX}-{FY}-{SEQ}')).toBe(true);
    expect(NUMBER_PATTERN_RE.test('{PREFIX}-{FY}')).toBe(false);
    expect(NUMBER_PATTERN_RE.test('<script>{SEQ}')).toBe(false);
  });
});

describe('masking', () => {
  it('masks identifiers', () => {
    expect(maskTail('123456789012')).toBe('••••••••9012');
    expect(maskMiddle('ABCDE1234F')).toBe('AB••••••4F');
    expect(maskEmail('priya@kenzo.in')).toBe('pr•••@kenzo.in');
    expect(maskTail(null)).toBeNull();
  });

  it('detects secret field names token-wise', () => {
    expect(isSecretFieldName('passwordHash')).toBe(true);
    expect(isSecretFieldName('bankAccountNumber')).toBe(true);
    expect(isSecretFieldName('panNumber')).toBe(true);
    expect(isSecretFieldName('resetToken')).toBe(true);
    expect(isSecretFieldName('company')).toBe(false);
    expect(isSecretFieldName('companyId')).toBe(false);
    expect(isSecretFieldName('accountName')).toBe(false);
  });

  it('redacts nested secrets', () => {
    expect(redactSecrets({ email: 'a@b.in', passwordHash: 'x', nested: { apiKey: 'k', name: 'n' } })).toEqual({
      email: 'a@b.in',
      passwordHash: '[REDACTED]',
      nested: { apiKey: '[REDACTED]', name: 'n' },
    });
  });
});

describe('role templates', () => {
  it('only reference catalogued permissions', () => {
    for (const role of Object.values(SYSTEM_ROLES)) {
      for (const key of Object.keys(role.grants)) expect(PERMISSION_KEYS).toContain(key);
    }
  });

  it('keep payment maker and checker in different roles (except Super Admin)', () => {
    for (const role of Object.values(SYSTEM_ROLES)) {
      if (role.key === 'SUPER_ADMIN') continue;
      const g = role.grants;
      expect(Boolean(g['payment.create'] && (g['payment.approve'] || g['payment.release']))).toBe(false);
    }
  });

  it('give administrators no financial release authority', () => {
    const g = SYSTEM_ROLES.COMPANY_ADMIN.grants;
    expect(g['payment.release']).toBeUndefined();
    expect(g['payment.approve']).toBeUndefined();
    expect(g['vendor.bank.approve']).toBeUndefined();
  });

  it('never give auditors unmasked bank data', () => {
    expect(SYSTEM_ROLES.AUDITOR.grants['vendor.bank.read']).toBeUndefined();
    expect(Object.keys(SYSTEM_ROLES.AUDITOR.grants).every((k) => k.endsWith('.read'))).toBe(true);
  });
});
