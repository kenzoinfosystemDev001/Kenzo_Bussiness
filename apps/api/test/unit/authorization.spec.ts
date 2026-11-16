import type { PermissionKey, PermissionScope } from '@kenzo/shared';
import type { AuthContext } from '../../src/common/context/request-context';
import { AuthorizationService } from '../../src/modules/access-control/authorization.service';
import { SegregationOfDutiesService } from '../../src/modules/access-control/segregation-of-duties.service';

function auth(grants: Array<[PermissionKey, PermissionScope]>, extra: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 'u1',
    sessionId: 's1',
    email: 'u1@example.test',
    fullName: 'U1',
    companyId: 'c1',
    homeCompanyId: 'c1',
    departmentId: 'd1',
    departmentScopeIds: ['d1'],
    permissions: new Map(grants),
    roleKeys: [],
    mfaEnabled: false,
    mfaVerified: false,
    mfaPending: false,
    companyEnforcesMfa: false,
    ...extra,
  };
}

describe('AuthorizationService', () => {
  const authz = new AuthorizationService();

  it('denies without the permission', () => {
    expect(authz.can(auth([]), 'user.read')).toBe(false);
  });

  it('never allows cross-company access, even at COMPANY scope, and hides existence', () => {
    const a = auth([['user.read', 'COMPANY']]);
    expect(authz.can(a, 'user.read', { companyId: 'c2' })).toBe(false);
    expect(() => authz.assertCan(a, 'user.read', { companyId: 'c2' })).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  it('applies OWN scope', () => {
    const a = auth([['requisition.read', 'OWN']]);
    expect(authz.can(a, 'requisition.read', { companyId: 'c1', ownerId: 'u1' })).toBe(true);
    expect(authz.can(a, 'requisition.read', { companyId: 'c1', ownerId: 'u2', departmentId: 'd1' })).toBe(false);
  });

  it('applies DEPARTMENT scope to covered departments only', () => {
    const a = auth([['requisition.read', 'DEPARTMENT']]);
    expect(authz.can(a, 'requisition.read', { companyId: 'c1', ownerId: 'u2', departmentId: 'd1' })).toBe(true);
    expect(authz.can(a, 'requisition.read', { companyId: 'c1', ownerId: 'u2', departmentId: 'd9' })).toBe(false);
    expect(authz.can(a, 'requisition.read', { companyId: 'c1', ownerId: 'u2', departmentId: null })).toBe(false);
  });

  it('builds list filters matching the scope', () => {
    expect(authz.scopeFilter(auth([['requisition.read', 'COMPANY']]), 'requisition.read')).toEqual({ companyId: 'c1' });
    expect(authz.scopeFilter(auth([['requisition.read', 'OWN']]), 'requisition.read')).toEqual({ companyId: 'c1', OR: [{ createdById: 'u1' }] });
    expect(authz.scopeFilter(auth([['requisition.read', 'DEPARTMENT']]), 'requisition.read')).toEqual({
      companyId: 'c1',
      OR: [{ createdById: 'u1' }, { departmentId: { in: ['d1'] } }],
    });
    expect(authz.scopeFilter(auth([]), 'requisition.read')).toBeNull();
  });

  it('requires MFA for privileged permissions only when the company enforces it', () => {
    const relaxed = auth([['payment.release', 'COMPANY']]);
    expect(() => authz.assertCan(relaxed, 'payment.release')).not.toThrow();
    const strict = auth([['payment.release', 'COMPANY']], { companyEnforcesMfa: true });
    expect(() => authz.assertCan(strict, 'payment.release')).toThrow(expect.objectContaining({ code: 'MFA_REQUIRED' }));
    expect(() => authz.assertCan({ ...strict, mfaVerified: true }, 'payment.release')).not.toThrow();
  });
});

describe('SegregationOfDutiesService', () => {
  const sod = new SegregationOfDutiesService();

  it('blocks the maker from acting as checker', () => {
    expect(() => sod.assert('PAYMENT_MAKER_CHECKER', 'u1', ['u1'])).toThrow(expect.objectContaining({ code: 'SEGREGATION_OF_DUTIES' }));
    expect(() => sod.assert('BANK_CHANGE_MAKER_CHECKER', 'u2', ['u1', null])).not.toThrow();
  });
});
