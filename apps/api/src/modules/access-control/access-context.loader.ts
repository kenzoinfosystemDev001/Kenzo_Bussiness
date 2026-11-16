import { Injectable } from '@nestjs/common';
import { isPermissionKey, widerScope, type PermissionKey, type PermissionScope } from '@kenzo/shared';
import { PrismaService, type Db } from '../../infrastructure/prisma/prisma.service';

/**
 * Assignments default `valid_from` to the DATABASE clock, while queries use the
 * application clock. A small tolerance prevents a freshly granted role from
 * appearing "not yet valid" when the two clocks differ by a few seconds.
 * (Future-dated assignments are not exposed through the API.)
 */
export const CLOCK_SKEW_TOLERANCE_MS = 2 * 60 * 1000;
export function assignmentStartCutoff(now: Date): Date {
  return new Date(now.getTime() + CLOCK_SKEW_TOLERANCE_MS);
}

export interface EffectiveAccess {
  permissions: Map<PermissionKey, PermissionScope>;
  roleKeys: string[];
  departmentScopeIds: string[];
}

/**
 * Resolves a user's effective permissions within one company from their active
 * role assignments (not revoked, within validity window). The widest scope wins
 * when several roles grant the same permission.
 */
@Injectable()
export class AccessContextLoader {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns null when the user has no active assignment in the company (no access at all). */
  async load(userId: string, companyId: string, db: Db = this.prisma): Promise<EffectiveAccess | null> {
    const now = new Date();
    const [assignments, user, headed] = await Promise.all([
      db.userRoleAssignment.findMany({
        where: {
          userId,
          companyId,
          revokedAt: null,
          validFrom: { lte: assignmentStartCutoff(now) },
          OR: [{ validUntil: null }, { validUntil: { gt: now } }],
        },
        include: { role: { include: { permissions: true } } },
      }),
      db.user.findUnique({ where: { id: userId }, select: { departmentId: true, companyId: true } }),
      db.department.findMany({ where: { companyId, headUserId: userId, isActive: true }, select: { id: true } }),
    ]);
    if (assignments.length === 0) return null;

    const permissions = new Map<PermissionKey, PermissionScope>();
    const roleKeys = new Set<string>();
    const departments = new Set<string>();
    if (user?.departmentId && user.companyId === companyId) departments.add(user.departmentId);
    for (const d of headed) departments.add(d.id);

    for (const a of assignments) {
      roleKeys.add(a.role.key);
      if (a.departmentId) departments.add(a.departmentId);
      for (const rp of a.role.permissions) {
        if (!isPermissionKey(rp.permissionKey)) continue;
        const existing = permissions.get(rp.permissionKey);
        permissions.set(rp.permissionKey, existing ? widerScope(existing, rp.scope) : rp.scope);
      }
    }
    return { permissions, roleKeys: [...roleKeys].sort(), departmentScopeIds: [...departments] };
  }

  /** Companies in which the user currently holds at least one active assignment. */
  async accessibleCompanies(userId: string): Promise<Array<{ id: string; code: string; displayName: string }>> {
    const now = new Date();
    return this.prisma.company.findMany({
      where: {
        status: 'ACTIVE',
        roleAssignments: {
          some: { userId, revokedAt: null, validFrom: { lte: assignmentStartCutoff(now) }, OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
        },
      },
      select: { id: true, code: true, displayName: true },
      orderBy: { displayName: 'asc' },
    });
  }
}
