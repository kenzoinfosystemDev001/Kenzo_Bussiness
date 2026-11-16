import { Injectable } from '@nestjs/common';
import { PERMISSIONS, SCOPE_RANK, SYSTEM_ROLE_KEYS, isAdministrativePermission, isScopable, type PermissionKey, type PermissionScope } from '@kenzo/shared';
import type { AuthContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

type Grant = { key: string; scope: PermissionScope };

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  catalogue() {
    return {
      items: Object.entries(PERMISSIONS).map(([key, def]) => ({ key, ...def })),
    };
  }

  async list(auth: AuthContext) {
    const roles = await this.prisma.role.findMany({
      where: { companyId: auth.companyId },
      include: {
        permissions: { select: { permissionKey: true, scope: true } },
        _count: { select: { assignments: { where: { revokedAt: null } } } },
      },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
    return {
      items: roles.map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        description: r.description,
        isSystem: r.isSystem,
        version: r.version,
        activeAssignments: r._count.assignments,
        permissions: r.permissions.map((p) => ({ key: p.permissionKey, scope: p.scope })),
      })),
    };
  }

  async get(auth: AuthContext, id: string) {
    const role = await this.prisma.role.findFirst({
      where: { id, companyId: auth.companyId },
      include: {
        permissions: { select: { permissionKey: true, scope: true } },
        assignments: {
          where: { revokedAt: null },
          select: {
            id: true,
            validUntil: true,
            user: { select: { id: true, fullName: true, email: true, status: true } },
            department: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!role) throw AppError.notFound('Role');
    return { ...role, permissions: role.permissions.map((p) => ({ key: p.permissionKey, scope: p.scope })) };
  }

  /** Normalises grants and enforces anti-escalation for administrative permissions. */
  private normalise(auth: AuthContext, grants: Grant[]): Array<{ key: PermissionKey; scope: PermissionScope }> {
    const out = new Map<PermissionKey, PermissionScope>();
    for (const g of grants) {
      const key = g.key as PermissionKey;
      const scope: PermissionScope = isScopable(key) ? g.scope : 'COMPANY';
      const mine = auth.permissions.get(key);
      if (isAdministrativePermission(key) && (!mine || SCOPE_RANK[mine] < SCOPE_RANK[scope])) {
        throw new AppError('FORBIDDEN', `You cannot grant "${key}" at ${scope} scope because you do not hold it`);
      }
      out.set(key, scope);
    }
    return [...out].map(([key, scope]) => ({ key, scope }));
  }

  async create(auth: AuthContext, input: { key: string; name: string; description?: string | null; permissions: Grant[] }) {
    if ((SYSTEM_ROLE_KEYS as readonly string[]).includes(input.key)) {
      throw AppError.validation([{ path: 'key', message: 'This key is reserved for a system role' }]);
    }
    const grants = this.normalise(auth, input.permissions);
    const role = await this.prisma.tx(async (tx) => {
      const created = await tx.role.create({
        data: {
          companyId: auth.companyId,
          key: input.key,
          name: input.name,
          description: input.description ?? null,
          isSystem: false,
          createdById: auth.userId,
          updatedById: auth.userId,
          permissions: { create: grants.map((g) => ({ permissionKey: g.key, scope: g.scope })) },
        },
      });
      await this.audit.record(tx, {
        action: 'role.created',
        entityType: 'role',
        entityId: created.id,
        after: { key: input.key, name: input.name, permissions: grants },
      });
      return created;
    });
    return this.get(auth, role.id);
  }

  async update(auth: AuthContext, id: string, input: { name?: string; description?: string | null; permissions?: Grant[]; reason: string }) {
    await this.prisma.tx(async (tx) => {
      const role = await tx.role.findFirst({ where: { id, companyId: auth.companyId }, include: { permissions: true } });
      if (!role) throw AppError.notFound('Role');
      if (role.isSystem) throw AppError.invalidState('System roles are managed by the platform and cannot be edited. Create a custom role instead.');
      const grants = input.permissions ? this.normalise(auth, input.permissions) : undefined;
      await tx.role.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          updatedById: auth.userId,
          version: { increment: 1 },
        },
      });
      if (grants) {
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        await tx.rolePermission.createMany({ data: grants.map((g) => ({ roleId: id, permissionKey: g.key, scope: g.scope })) });
      }
      await this.audit.record(tx, {
        action: 'role.updated',
        entityType: 'role',
        entityId: id,
        before: { name: role.name, description: role.description, permissions: role.permissions.map((p) => ({ key: p.permissionKey, scope: p.scope })) },
        after: { name: input.name, description: input.description, permissions: grants },
        reason: input.reason,
      });
    });
    return this.get(auth, id);
  }

  async remove(auth: AuthContext, id: string) {
    await this.prisma.tx(async (tx) => {
      const role = await tx.role.findFirst({ where: { id, companyId: auth.companyId } });
      if (!role) throw AppError.notFound('Role');
      if (role.isSystem) throw AppError.invalidState('System roles cannot be deleted');
      const assignments = await tx.userRoleAssignment.count({ where: { roleId: id } });
      if (assignments > 0) throw AppError.invalidState('This role has assignment history and cannot be deleted. Revoke and keep it for audit.');
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      await tx.role.delete({ where: { id } });
      await this.audit.record(tx, { action: 'role.deleted', entityType: 'role', entityId: id, before: { key: role.key, name: role.name } });
    });
  }
}
