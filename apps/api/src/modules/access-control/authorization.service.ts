import { Injectable } from '@nestjs/common';
import { PERMISSIONS, SCOPE_RANK, type PermissionDefinition, type PermissionKey } from '@kenzo/shared';
import type { AuthContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';

/** Attributes of the record being acted on (PRD §2.1 `allow(action, resource, user)`). */
export interface ResourceRef {
  companyId: string;
  departmentId?: string | null;
  ownerId?: string | null;
}

/**
 * Central authorization decision point:
 *
 *   allow = user active (session layer)
 *         AND user.company == resource.company
 *         AND role grants permission
 *         AND scope matches (OWN → owner, DEPARTMENT → covered dept, COMPANY → any)
 *         AND MFA satisfied for privileged permissions when the company enforces it
 *
 * Controllers apply @RequirePermissions as a coarse gate; services call
 * `assertCan` with the loaded record for the record-level decision.
 */
@Injectable()
export class AuthorizationService {
  has(auth: AuthContext, permission: PermissionKey): boolean {
    return auth.permissions.has(permission);
  }

  can(auth: AuthContext, permission: PermissionKey, resource?: ResourceRef): boolean {
    const scope = auth.permissions.get(permission);
    if (!scope) return false;
    if (!resource) return true;
    if (resource.companyId !== auth.companyId) return false;
    if (scope === 'COMPANY') return true;
    if (resource.ownerId && resource.ownerId === auth.userId) return true;
    if (scope === 'DEPARTMENT') return !!resource.departmentId && auth.departmentScopeIds.includes(resource.departmentId);
    return false;
  }

  /**
   * Throws NOT_FOUND (not FORBIDDEN) for cross-company records so the existence
   * of another tenant's record is never disclosed.
   */
  assertCan(auth: AuthContext, permission: PermissionKey, resource?: ResourceRef, what = 'Record'): void {
    if (resource && resource.companyId !== auth.companyId) throw AppError.notFound(what);
    this.assertMfa(auth, permission);
    if (!this.can(auth, permission, resource)) throw AppError.forbidden();
  }

  assertMfa(auth: AuthContext, permission: PermissionKey): void {
    const def = PERMISSIONS[permission] as PermissionDefinition;
    if (def.requiresMfa && auth.companyEnforcesMfa && !auth.mfaVerified) {
      throw new AppError('MFA_REQUIRED', 'This action requires multi-factor authentication. Enable and verify MFA to continue.');
    }
  }

  /**
   * Builds a Prisma-compatible filter restricting a list query to what the user
   * may see for `permission`. Returns null if the user cannot see anything.
   */
  scopeFilter(
    auth: AuthContext,
    permission: PermissionKey,
    fields: { department?: string; owner?: string } = { department: 'departmentId', owner: 'createdById' },
  ): Record<string, unknown> | null {
    const scope = auth.permissions.get(permission);
    if (!scope) return null;
    const base = { companyId: auth.companyId };
    if (scope === 'COMPANY') return base;
    const or: Record<string, unknown>[] = [];
    if (fields.owner) or.push({ [fields.owner]: auth.userId });
    if (SCOPE_RANK[scope] >= SCOPE_RANK.DEPARTMENT && fields.department && auth.departmentScopeIds.length > 0) {
      or.push({ [fields.department]: { in: auth.departmentScopeIds } });
    }
    if (or.length === 0) return null;
    return { ...base, OR: or };
  }
}
