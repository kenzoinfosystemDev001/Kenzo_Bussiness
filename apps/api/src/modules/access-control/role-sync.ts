import { PERMISSIONS, SYSTEM_ROLES, type PermissionDefinition, type PermissionKey } from '@kenzo/shared';
import type { Tx } from '../../infrastructure/prisma/prisma.service';

/** Upserts the code-defined permission catalogue into the `permission` table. */
export async function syncPermissionCatalogue(tx: Tx): Promise<number> {
  const entries = Object.entries(PERMISSIONS) as Array<[PermissionKey, PermissionDefinition]>;
  for (const [key, def] of entries) {
    const data = {
      module: def.module,
      description: def.description,
      sensitive: def.sensitive ?? false,
      requiresMfa: def.requiresMfa ?? false,
      scopable: def.scopable ?? false,
      phase: def.phase,
    };
    await tx.permission.upsert({ where: { key }, create: { key, ...data }, update: data });
  }
  return entries.length;
}

/**
 * Creates or re-synchronises the system roles of one company so their grants
 * exactly match the code-defined templates. Custom roles are untouched.
 */
export async function syncSystemRoles(tx: Tx, companyId: string, actorId: string | null = null): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const def of Object.values(SYSTEM_ROLES)) {
    const role = await tx.role.upsert({
      where: { companyId_key: { companyId, key: def.key } },
      create: { companyId, key: def.key, name: def.name, description: def.description, isSystem: true, createdById: actorId },
      update: { name: def.name, description: def.description, isSystem: true },
    });
    ids.set(def.key, role.id);
    const desired = Object.entries(def.grants) as Array<[PermissionKey, 'OWN' | 'DEPARTMENT' | 'COMPANY']>;
    await tx.rolePermission.deleteMany({ where: { roleId: role.id, permissionKey: { notIn: desired.map(([k]) => k) } } });
    for (const [permissionKey, scope] of desired) {
      await tx.rolePermission.upsert({
        where: { roleId_permissionKey: { roleId: role.id, permissionKey } },
        create: { roleId: role.id, permissionKey, scope },
        update: { scope },
      });
    }
  }
  return ids;
}
