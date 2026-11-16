import { describe, expect, it } from 'vitest';
import {
  canTransition,
  createVendorSchema,
  gstinWithChecksum,
  isValidGstinChecksum,
  nameSimilarity,
  normalizeVendorName,
  requiredVendorDocuments,
  stateCodeFor,
  vendorBankSchema,
} from './vendors';

const base = {
  legalName: 'Acme Technologies Pvt Ltd',
  vendorType: 'GOODS_SUPPLIER',
  category: 'IT hardware',
  gstRegistrationType: 'REGISTERED',
  pan: 'ABCDE1234F',
  gstin: gstinWithChecksum('29ABCDE1234F1Z'),
  addressLine1: '12 MG Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  postalCode: '560001',
  country: 'IN',
};

describe('GSTIN', () => {
  it('validates the check digit', () => {
    const g = gstinWithChecksum('27AAPFU0939F1Z');
    expect(g).toBe('27AAPFU0939F1ZV'); // published example GSTIN
    expect(isValidGstinChecksum(g)).toBe(true);
    expect(isValidGstinChecksum('27AAPFU0939F1ZA')).toBe(false);
    expect(isValidGstinChecksum('not-a-gstin')).toBe(false);
  });

  it('maps states to GST codes', () => {
    expect(stateCodeFor('Karnataka')).toBe('29');
    expect(stateCodeFor('maharashtra')).toBe('27');
    expect(stateCodeFor('Atlantis')).toBeNull();
  });
});

describe('name normalisation & similarity', () => {
  it('strips legal suffixes, punctuation and M/s', () => {
    expect(normalizeVendorName('M/s. Acme Technologies Pvt. Ltd.')).toBe('acme technologies');
    expect(normalizeVendorName('ACME TECHNOLOGIES PRIVATE LIMITED')).toBe('acme technologies');
    expect(normalizeVendorName('Tata & Sons Ltd')).toBe('tata and sons');
  });

  it('scores similar names high and different names low', () => {
    expect(nameSimilarity('Zenith Logistics Pvt Ltd', 'ZENITH LOGISTICS PRIVATE LIMITED')).toBe(1);
    expect(nameSimilarity('Zenith Logistics', 'Zenith Logistic')).toBeGreaterThan(0.85);
    expect(nameSimilarity('Zenith Logistics', 'Orbit Foods')).toBeLessThan(0.3);
  });
});

describe('vendor profile rules', () => {
  const issues = (overrides: Record<string, unknown>) => {
    const r = createVendorSchema.safeParse({ ...base, ...overrides });
    return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
  };

  it('accepts a valid registered vendor', () => {
    expect(issues({})).toEqual([]);
  });

  it('applies conditional GST/PAN/overseas/MSME rules', () => {
    expect(issues({ gstin: null })).toContain('gstin');
    expect(issues({ gstRegistrationType: 'UNREGISTERED' })).toContain('gstin');
    expect(issues({ gstRegistrationType: 'UNREGISTERED', gstin: null })).toEqual([]);
    expect(issues({ pan: 'ZZZZZ9999Z' })).toContain('pan');
    expect(issues({ state: 'Maharashtra' })).toContain('gstin');
    expect(issues({ postalCode: '5600' })).toContain('postalCode');
    expect(issues({ gstRegistrationType: 'OVERSEAS', gstin: null, pan: null, country: 'IN' })).toContain('country');
    expect(issues({ gstRegistrationType: 'OVERSEAS', gstin: null, pan: null, country: 'SG', state: 'Singapore', postalCode: '018989' })).toEqual([]);
    expect(issues({ msmeRegistered: true })).toContain('msmeNumber');
    expect(issues({ msmeRegistered: true, msmeNumber: 'UDYAM-KR-03-0012345' })).toEqual([]);
    expect(
      issues({
        contacts: [
          { name: 'A', isPrimary: true },
          { name: 'B', isPrimary: true },
        ],
      }),
    ).toContain('contacts');
  });

  it('validates bank details by account type', () => {
    const ok = vendorBankSchema.safeParse({ accountHolderName: 'A', bankName: 'HDFC', ifsc: 'hdfc0001234', accountNumber: '1234 5678 9012' });
    expect(ok.success && ok.data.accountNumber).toBe('123456789012');
    expect(ok.success && ok.data.ifsc).toBe('HDFC0001234');
    expect(
      vendorBankSchema.safeParse({ accountHolderName: 'A', bankName: 'B', ifsc: 'HDFC0001234', accountNumber: '123456789', confirmAccountNumber: '123456780' })
        .success,
    ).toBe(false);
    expect(
      vendorBankSchema.safeParse({ accountHolderName: 'A', bankName: 'B', accountType: 'OVERSEAS', swiftCode: 'DBSSSGSG', accountNumber: 'SG12DBS0001' })
        .success,
    ).toBe(true);
  });
});

describe('lifecycle & compliance rules', () => {
  it('allows only defined transitions', () => {
    expect(canTransition('DRAFT', 'SUBMITTED')).toBe(true);
    expect(canTransition('DRAFT', 'ACTIVE')).toBe(false);
    expect(canTransition('APPROVED', 'ACTIVE')).toBe(true);
    expect(canTransition('ARCHIVED', 'ACTIVE')).toBe(false);
    expect(canTransition('SUSPENDED', 'ACTIVE')).toBe(true);
  });

  it('derives required documents from the profile', () => {
    expect(requiredVendorDocuments({ gstRegistrationType: 'REGISTERED', msmeRegistered: true, hasBankAccount: true })).toEqual([
      'PAN_CARD',
      'GST_CERTIFICATE',
      'MSME_CERTIFICATE',
      'BANK_PROOF',
    ]);
    expect(requiredVendorDocuments({ gstRegistrationType: 'OVERSEAS', msmeRegistered: false, hasBankAccount: false })).toEqual(['INCORPORATION']);
  });
});
