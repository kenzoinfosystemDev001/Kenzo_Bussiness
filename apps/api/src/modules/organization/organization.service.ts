import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import type {
  costCentreSchema,
  createCompanySchema,
  departmentSchema,
  updateCompanySchema,
  updateCostCentreSchema,
  updateDepartmentSchema,
} from '@kenzo/shared';
import type { AuthContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService, type Tx } from '../../infrastructure/prisma/prisma.service';
import { CompanyProvisioningService } from './company-provisioning.service';

@Injectable()
export class OrganizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly provisioning: CompanyProvisioningService,
  ) {}

  // ── Company ───────────────────────────────────────────────────────────────
  async currentCompany(auth: AuthContext) {
    const company = await this.prisma.company.findUnique({ where: { id: auth.companyId } });
    if (!company) throw AppError.notFound('Company');
    return company;
  }

  async updateCompany(auth: AuthContext, input: z.infer<typeof updateCompanySchema>) {
    const { version, ...changes } = input;
    await this.prisma.tx(async (tx) => {
      const before = await tx.company.findUniqueOrThrow({ where: { id: auth.companyId } });
      const res = await tx.company.updateMany({
        where: { id: auth.companyId, version },
        data: { ...changes, updatedById: auth.userId, version: { increment: 1 } },
      });
      if (res.count !== 1) throw AppError.versionConflict();
      const changedKeys = Object.keys(changes) as Array<keyof typeof changes>;
      await this.audit.record(tx, {
        action: 'company.updated',
        entityType: 'company',
        entityId: auth.companyId,
        before: Object.fromEntries(changedKeys.map((k) => [k, (before as Record<string, unknown>)[k]])),
        after: changes,
      });
    });
    return this.currentCompany(auth);
  }

  /** Creates a new legal entity; the creator becomes its first Super Admin. */
  async createCompany(auth: AuthContext, input: z.infer<typeof createCompanySchema>) {
    return this.prisma.tx(async (tx) => {
      const { company, roleIds } = await this.provisioning.provision(tx, input, auth.userId);
      await tx.userRoleAssignment.create({
        data: { companyId: company.id, userId: auth.userId, roleId: roleIds.get('SUPER_ADMIN')!, grantedById: auth.userId },
      });
      await this.audit.record(tx, { action: 'company.created', entityType: 'company', entityId: company.id, companyId: company.id, after: input });
      return company;
    });
  }

  // ── Departments ──────────────────────────────────────────────────────────
  listDepartments(auth: AuthContext) {
    return this.prisma.department
      .findMany({
        where: { companyId: auth.companyId },
        include: {
          head: { select: { id: true, fullName: true } },
          parent: { select: { id: true, name: true } },
          _count: { select: { members: true, costCentres: true } },
        },
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      })
      .then((items) => ({ items }));
  }

  private async validateDepartmentRefs(tx: Tx, auth: AuthContext, id: string | null, input: { parentId?: string | null; headUserId?: string | null }) {
    if (input.parentId) {
      if (input.parentId === id) throw AppError.validation([{ path: 'parentId', message: 'A department cannot be its own parent' }]);
      const parent = await tx.department.findFirst({ where: { id: input.parentId, companyId: auth.companyId } });
      if (!parent) throw AppError.validation([{ path: 'parentId', message: 'Parent department not found' }]);
      // Prevent cycles: walk up from the proposed parent.
      let cursor: string | null = parent.parentId;
      for (let depth = 0; cursor && depth < 50; depth++) {
        if (cursor === id) throw AppError.validation([{ path: 'parentId', message: 'This would create a cycle' }]);
        cursor = (await tx.department.findUnique({ where: { id: cursor }, select: { parentId: true } }))?.parentId ?? null;
      }
    }
    if (input.headUserId) {
      const head = await tx.user.findFirst({
        where: {
          id: input.headUserId,
          status: 'ACTIVE',
          OR: [{ companyId: auth.companyId }, { roleAssignments: { some: { companyId: auth.companyId, revokedAt: null } } }],
        },
      });
      if (!head) throw AppError.validation([{ path: 'headUserId', message: 'Department head must be an active user of this company' }]);
    }
  }

  async createDepartment(auth: AuthContext, input: z.infer<typeof departmentSchema>) {
    return this.prisma.tx(async (tx) => {
      await this.validateDepartmentRefs(tx, auth, null, input);
      const d = await tx.department.create({
        data: {
          companyId: auth.companyId,
          code: input.code,
          name: input.name,
          parentId: input.parentId ?? null,
          headUserId: input.headUserId ?? null,
          createdById: auth.userId,
          updatedById: auth.userId,
        },
      });
      await this.audit.record(tx, { action: 'department.created', entityType: 'department', entityId: d.id, after: input });
      return d;
    });
  }

  async updateDepartment(auth: AuthContext, id: string, input: z.infer<typeof updateDepartmentSchema>) {
    const { version, ...changes } = input;
    return this.prisma.tx(async (tx) => {
      const before = await tx.department.findFirst({ where: { id, companyId: auth.companyId } });
      if (!before) throw AppError.notFound('Department');
      await this.validateDepartmentRefs(tx, auth, id, changes);
      if (changes.isActive === false) {
        const children = await tx.department.count({ where: { parentId: id, isActive: true } });
        if (children > 0) throw AppError.invalidState('Deactivate or move child departments first');
      }
      const res = await tx.department.updateMany({ where: { id, version }, data: { ...changes, updatedById: auth.userId, version: { increment: 1 } } });
      if (res.count !== 1) throw AppError.versionConflict();
      await this.audit.record(tx, {
        action: 'department.updated',
        entityType: 'department',
        entityId: id,
        before: { code: before.code, name: before.name, parentId: before.parentId, headUserId: before.headUserId, isActive: before.isActive },
        after: changes,
      });
      return tx.department.findUniqueOrThrow({ where: { id } });
    });
  }

  // ── Cost centres ─────────────────────────────────────────────────────────
  listCostCentres(auth: AuthContext) {
    return this.prisma.costCentre
      .findMany({
        where: { companyId: auth.companyId },
        include: { department: { select: { id: true, name: true } } },
        orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
      })
      .then((items) => ({ items }));
  }

  private async validateCostCentreDept(tx: Tx, auth: AuthContext, departmentId?: string | null) {
    if (!departmentId) return;
    const d = await tx.department.findFirst({ where: { id: departmentId, companyId: auth.companyId } });
    if (!d) throw AppError.validation([{ path: 'departmentId', message: 'Department not found' }]);
  }

  async createCostCentre(auth: AuthContext, input: z.infer<typeof costCentreSchema>) {
    return this.prisma.tx(async (tx) => {
      await this.validateCostCentreDept(tx, auth, input.departmentId);
      const c = await tx.costCentre.create({
        data: {
          companyId: auth.companyId,
          code: input.code,
          name: input.name,
          departmentId: input.departmentId ?? null,
          createdById: auth.userId,
          updatedById: auth.userId,
        },
      });
      await this.audit.record(tx, { action: 'cost_centre.created', entityType: 'cost_centre', entityId: c.id, after: input });
      return c;
    });
  }

  async updateCostCentre(auth: AuthContext, id: string, input: z.infer<typeof updateCostCentreSchema>) {
    const { version, ...changes } = input;
    return this.prisma.tx(async (tx) => {
      const before = await tx.costCentre.findFirst({ where: { id, companyId: auth.companyId } });
      if (!before) throw AppError.notFound('Cost centre');
      await this.validateCostCentreDept(tx, auth, changes.departmentId);
      const res = await tx.costCentre.updateMany({ where: { id, version }, data: { ...changes, updatedById: auth.userId, version: { increment: 1 } } });
      if (res.count !== 1) throw AppError.versionConflict();
      await this.audit.record(tx, {
        action: 'cost_centre.updated',
        entityType: 'cost_centre',
        entityId: id,
        before: { code: before.code, name: before.name, departmentId: before.departmentId, isActive: before.isActive },
        after: changes,
      });
      return tx.costCentre.findUniqueOrThrow({ where: { id } });
    });
  }
}
