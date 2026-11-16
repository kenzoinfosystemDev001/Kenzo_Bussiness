import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ApprovalPolicyInput } from '@kenzo/shared';
import type { AuthContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService, type Tx } from '../../infrastructure/prisma/prisma.service';
import { ApproverResolver } from './approver-resolver';

export const POLICY_INCLUDE = {
  stages: { orderBy: [{ sequence: 'asc' }, { name: 'asc' }] },
} satisfies Prisma.ApprovalPolicyInclude;

/**
 * Versioned approval policies. Only DRAFT versions are editable; publishing a
 * draft atomically retires the previously ACTIVE version for that entity type.
 * Running approval instances keep referencing the version they started with,
 * so a policy change never alters an in-flight approval.
 */
@Injectable()
export class ApprovalPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly resolver: ApproverResolver,
  ) {}

  async list(auth: AuthContext, entityType?: string) {
    const items = await this.prisma.approvalPolicy.findMany({
      where: { companyId: auth.companyId, ...(entityType ? { entityType } : {}) },
      include: { ...POLICY_INCLUDE, _count: { select: { instances: true } } },
      orderBy: [{ entityType: 'asc' }, { policyVersion: 'desc' }],
    });
    return { items };
  }

  async get(auth: AuthContext, id: string) {
    const policy = await this.prisma.approvalPolicy.findFirst({
      where: { id, companyId: auth.companyId },
      include: { ...POLICY_INCLUDE, _count: { select: { instances: true } } },
    });
    if (!policy) throw AppError.notFound('Approval policy');
    return policy;
  }

  private async validateReferences(tx: Tx, auth: AuthContext, input: ApprovalPolicyInput) {
    const roleKeys = new Set(input.stages.flatMap((s) => [s.approverRoleKey, s.escalationRoleKey]).filter((k): k is string => !!k));
    if (roleKeys.size > 0) {
      const found = await tx.role.findMany({ where: { companyId: auth.companyId, key: { in: [...roleKeys] } }, select: { key: true } });
      const missing = [...roleKeys].filter((k) => !found.some((f) => f.key === k));
      if (missing.length) throw AppError.validation(missing.map((k) => ({ path: 'stages', message: `Unknown role "${k}"` })));
    }
    const userIds = input.stages.map((s) => s.approverUserId).filter((u): u is string => !!u);
    if (userIds.length) {
      const users = await tx.user.count({ where: { id: { in: userIds }, status: 'ACTIVE' } });
      if (users !== new Set(userIds).size) throw AppError.validation([{ path: 'stages', message: 'An approver user is not active' }]);
    }
    const deptIds = [...new Set(input.stages.flatMap((s) => s.departmentIds))];
    if (deptIds.length) {
      const depts = await tx.department.count({ where: { id: { in: deptIds }, companyId: auth.companyId } });
      if (depts !== deptIds.length) throw AppError.validation([{ path: 'stages', message: 'Unknown department in stage conditions' }]);
    }
  }

  private stageData(input: ApprovalPolicyInput) {
    return input.stages.map((s) => ({
      sequence: s.sequence,
      name: s.name,
      mode: s.mode,
      minApprovals: s.mode === 'ALL' ? 1 : s.minApprovals,
      minAmount: s.minAmount ?? null,
      maxAmount: s.maxAmount ?? null,
      departmentIds: s.departmentIds,
      categoryKeys: s.categoryKeys,
      approverType: s.approverType,
      approverRoleKey: s.approverType === 'ROLE' ? (s.approverRoleKey ?? null) : null,
      approverUserId: s.approverType === 'USER' ? (s.approverUserId ?? null) : null,
      slaHours: s.slaHours ?? null,
      escalationRoleKey: s.escalationRoleKey ?? null,
    }));
  }

  /** Creates a new DRAFT version (version = latest + 1) for the entity type. */
  async createDraft(auth: AuthContext, input: ApprovalPolicyInput) {
    const policy = await this.prisma.tx(async (tx) => {
      await this.validateReferences(tx, auth, input);
      const existingDraft = await tx.approvalPolicy.findFirst({ where: { companyId: auth.companyId, entityType: input.entityType, status: 'DRAFT' } });
      if (existingDraft)
        throw new AppError('CONFLICT', 'A draft already exists for this entity type. Edit or publish it first.', { details: { draftId: existingDraft.id } });
      const latest = await tx.approvalPolicy.aggregate({ where: { companyId: auth.companyId, entityType: input.entityType }, _max: { policyVersion: true } });
      const created = await tx.approvalPolicy.create({
        data: {
          companyId: auth.companyId,
          entityType: input.entityType,
          name: input.name,
          description: input.description ?? null,
          policyVersion: (latest._max.policyVersion ?? 0) + 1,
          status: 'DRAFT',
          requireIndependentApproval: input.requireIndependentApproval,
          distinctApproversAcrossStages: input.distinctApproversAcrossStages,
          allowDelegation: input.allowDelegation,
          excludeInitiatorFromAllStages: input.excludeInitiatorFromAllStages,
          createdById: auth.userId,
          updatedById: auth.userId,
          stages: { create: this.stageData(input) },
        },
      });
      await this.audit.record(tx, { action: 'approval_policy.draft_created', entityType: 'approval_policy', entityId: created.id, after: input });
      return created;
    });
    return this.get(auth, policy.id);
  }

  async updateDraft(auth: AuthContext, id: string, input: ApprovalPolicyInput & { version: number }) {
    await this.prisma.tx(async (tx) => {
      const policy = await tx.approvalPolicy.findFirst({ where: { id, companyId: auth.companyId }, include: POLICY_INCLUDE });
      if (!policy) throw AppError.notFound('Approval policy');
      if (policy.status !== 'DRAFT') throw AppError.invalidState('Only draft policies can be edited. Create a new version instead.');
      if (policy.entityType !== input.entityType) throw AppError.validation([{ path: 'entityType', message: 'Entity type cannot be changed' }]);
      await this.validateReferences(tx, auth, input);
      const res = await tx.approvalPolicy.updateMany({
        where: { id, version: input.version },
        data: {
          name: input.name,
          description: input.description ?? null,
          requireIndependentApproval: input.requireIndependentApproval,
          distinctApproversAcrossStages: input.distinctApproversAcrossStages,
          allowDelegation: input.allowDelegation,
          excludeInitiatorFromAllStages: input.excludeInitiatorFromAllStages,
          updatedById: auth.userId,
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) throw AppError.versionConflict();
      await tx.approvalPolicyStage.deleteMany({ where: { policyId: id } });
      await tx.approvalPolicyStage.createMany({ data: this.stageData(input).map((s) => ({ ...s, policyId: id })) });
      await this.audit.record(tx, { action: 'approval_policy.draft_updated', entityType: 'approval_policy', entityId: id, before: policy, after: input });
    });
    return this.get(auth, id);
  }

  async publish(auth: AuthContext, id: string, reason: string) {
    await this.prisma.tx(async (tx) => {
      const policy = await tx.approvalPolicy.findFirst({ where: { id, companyId: auth.companyId }, include: POLICY_INCLUDE });
      if (!policy) throw AppError.notFound('Approval policy');
      if (policy.status !== 'DRAFT') throw AppError.invalidState('Only draft policies can be published');
      if (policy.stages.length === 0) throw AppError.invalidState('A policy needs at least one stage');
      const previous = await tx.approvalPolicy.findFirst({ where: { companyId: auth.companyId, entityType: policy.entityType, status: 'ACTIVE' } });
      if (previous) {
        await tx.approvalPolicy.update({ where: { id: previous.id }, data: { status: 'RETIRED', retiredAt: new Date(), version: { increment: 1 } } });
      }
      await tx.approvalPolicy.update({
        where: { id },
        data: { status: 'ACTIVE', publishedAt: new Date(), publishedById: auth.userId, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        action: 'approval_policy.published',
        entityType: 'approval_policy',
        entityId: id,
        before: previous ? { activePolicyId: previous.id, version: previous.policyVersion } : null,
        after: { activePolicyId: id, version: policy.policyVersion, entityType: policy.entityType },
        reason,
      });
    });
    return this.get(auth, id);
  }

  /** Copies any version into a new DRAFT for editing. */
  async cloneToDraft(auth: AuthContext, id: string) {
    const source = await this.get(auth, id);
    return this.createDraft(auth, {
      entityType: source.entityType as ApprovalPolicyInput['entityType'],
      name: source.name,
      description: source.description,
      requireIndependentApproval: source.requireIndependentApproval,
      distinctApproversAcrossStages: source.distinctApproversAcrossStages,
      allowDelegation: source.allowDelegation,
      excludeInitiatorFromAllStages: source.excludeInitiatorFromAllStages,
      stages: source.stages.map((s) => ({
        sequence: s.sequence,
        name: s.name,
        mode: s.mode,
        minApprovals: s.minApprovals,
        minAmount: s.minAmount?.toFixed(2) ?? null,
        maxAmount: s.maxAmount?.toFixed(2) ?? null,
        departmentIds: s.departmentIds,
        categoryKeys: s.categoryKeys,
        approverType: s.approverType,
        approverRoleKey: s.approverRoleKey,
        approverUserId: s.approverUserId,
        slaHours: s.slaHours,
        escalationRoleKey: s.escalationRoleKey,
      })),
    });
  }

  /** Dry-run: who would approve a request with these attributes? Creates nothing. */
  async simulate(auth: AuthContext, id: string, input: { amount: string; departmentId?: string | null; categoryKey?: string | null; requesterId: string }) {
    const policy = await this.get(auth, id);
    const requester = await this.prisma.user.findFirst({
      where: { id: input.requesterId, OR: [{ companyId: auth.companyId }, { roleAssignments: { some: { companyId: auth.companyId } } }] },
      select: { id: true, fullName: true, departmentId: true },
    });
    if (!requester) throw AppError.validation([{ path: 'requesterId', message: 'Requester not found' }]);
    const departmentId = input.departmentId ?? requester.departmentId;
    try {
      const chain = await this.resolver.resolve(this.prisma, {
        companyId: auth.companyId,
        policy,
        entityType: policy.entityType,
        amount: input.amount,
        departmentId,
        categoryKey: input.categoryKey ?? null,
        requesterId: requester.id,
        excludedUserIds: [],
      });
      const users = await this.prisma.user.findMany({
        where: { id: { in: chain.flatMap((c) => c.approvers.flatMap((a) => [a.userId, a.delegatedFromId].filter((x): x is string => !!x))) } },
        select: { id: true, fullName: true, email: true },
      });
      const byId = new Map(users.map((u) => [u.id, u]));
      return {
        ok: true,
        stages: chain.map((c) => ({
          sequence: c.stage.sequence,
          name: c.stage.name,
          mode: c.stage.mode,
          required: c.required,
          approvers: c.approvers.map((a) => ({ user: byId.get(a.userId), delegatedFrom: a.delegatedFromId ? byId.get(a.delegatedFromId) : null })),
        })),
        skippedStages: policy.stages.filter((s) => !chain.some((c) => c.stage.id === s.id)).map((s) => ({ sequence: s.sequence, name: s.name })),
      };
    } catch (err) {
      if (err instanceof AppError && err.code === 'APPROVAL_NO_ELIGIBLE_APPROVER') {
        return { ok: false, error: err.message, details: err.options.details ?? null, stages: [], skippedStages: [] };
      }
      throw err;
    }
  }
}
