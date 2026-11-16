import { Injectable } from '@nestjs/common';
import type { ApprovalPolicy, ApprovalPolicyStage } from '@prisma/client';
import { Dec } from '@kenzo/shared';
import { AppError } from '../../common/errors/app-error';
import type { Db } from '../../infrastructure/prisma/prisma.service';
import { assignmentStartCutoff } from '../access-control/access-context.loader';

export interface ResolveInput {
  companyId: string;
  policy: ApprovalPolicy & { stages: ApprovalPolicyStage[] };
  entityType: string;
  amount: string | null;
  departmentId: string | null;
  categoryKey: string | null;
  requesterId: string;
  /** Additional actors who must never approve (e.g. vendor creator, payment maker). */
  excludedUserIds: string[];
}

export interface ResolvedApprover {
  userId: string;
  delegatedFromId: string | null;
}

export interface ResolvedStage {
  stage: ApprovalPolicyStage;
  approvers: ResolvedApprover[];
  /** Approvals needed to complete the stage. */
  required: number;
}

/**
 * Turns a policy version + request attributes into concrete approvers.
 *
 * Rules:
 *  - A stage applies when amount ∈ [min,max], department ∈ departmentIds (if
 *    set) and category ∈ categoryKeys (if set).
 *  - Candidates must be ACTIVE and currently hold `approval.task.act` in the
 *    company — an approver who lost the permission is never assigned.
 *  - The requester and explicitly excluded actors are removed (independent
 *    approval / maker-checker). For DEPARTMENT_HEAD, if the requester heads the
 *    department, routing moves up to the parent department's head.
 *  - Active delegations are applied when the policy allows delegation, but a
 *    delegate who is excluded falls back to the original approver.
 *  - A stage with too few eligible approvers fails loudly; stages are never
 *    silently skipped (PRD: "do not silently skip").
 */
@Injectable()
export class ApproverResolver {
  async resolve(db: Db, input: ResolveInput): Promise<ResolvedStage[]> {
    const { policy } = input;
    const excluded = new Set(input.excludedUserIds);
    if (policy.requireIndependentApproval || policy.excludeInitiatorFromAllStages) excluded.add(input.requesterId);

    const amount = Dec.of(input.amount ?? '0');
    const applicable = [...policy.stages]
      .sort((a, b) => a.sequence - b.sequence)
      .filter((s) => {
        if (s.minAmount && amount.lt(s.minAmount.toFixed(2))) return false;
        if (s.maxAmount && amount.gt(s.maxAmount.toFixed(2))) return false;
        if (s.departmentIds.length > 0 && (!input.departmentId || !s.departmentIds.includes(input.departmentId))) return false;
        if (s.categoryKeys.length > 0 && (!input.categoryKey || !s.categoryKeys.includes(input.categoryKey))) return false;
        return true;
      });
    if (applicable.length === 0) {
      throw new AppError('APPROVAL_NO_ELIGIBLE_APPROVER', 'No approval stage of the active policy applies to this request', {
        details: { policyId: policy.id },
      });
    }

    const eligible = await this.eligibleApprovers(db, input.companyId);
    const result: ResolvedStage[] = [];
    const soleApproversSoFar = new Set<string>();

    for (const stage of applicable) {
      const raw = await this.candidates(db, input, stage);
      let approvers: ResolvedApprover[] = [];
      for (const userId of raw) {
        if (excluded.has(userId) || !eligible.has(userId)) continue;
        const delegateId = policy.allowDelegation ? await this.activeDelegate(db, input.companyId, userId, input.entityType) : null;
        if (delegateId && !excluded.has(delegateId) && eligible.has(delegateId)) {
          approvers.push({ userId: delegateId, delegatedFromId: userId });
        } else {
          approvers.push({ userId, delegatedFromId: null });
        }
      }
      // De-duplicate (two candidates may delegate to the same person).
      const seen = new Set<string>();
      approvers = approvers.filter((a) => (seen.has(a.userId) ? false : (seen.add(a.userId), true)));
      if (policy.distinctApproversAcrossStages) {
        approvers = approvers.filter((a) => !soleApproversSoFar.has(a.userId));
      }

      const required = stage.mode === 'ALL' ? approvers.length : stage.minApprovals;
      if (approvers.length === 0 || approvers.length < required) {
        throw new AppError(
          'APPROVAL_NO_ELIGIBLE_APPROVER',
          `Stage "${stage.name}" has no eligible independent approver. Ask an administrator to assign the required role or adjust the policy.`,
          { details: { stage: stage.name, sequence: stage.sequence, approverType: stage.approverType, eligible: approvers.length, required } },
        );
      }
      if (approvers.length === 1) soleApproversSoFar.add(approvers[0]!.userId);
      result.push({ stage, approvers, required });
    }
    return result;
  }

  /** Users who are ACTIVE and currently hold approval.task.act in the company. */
  async eligibleApprovers(db: Db, companyId: string): Promise<Set<string>> {
    const now = new Date();
    const rows = await db.userRoleAssignment.findMany({
      where: {
        companyId,
        revokedAt: null,
        validFrom: { lte: assignmentStartCutoff(now) },
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
        user: { status: 'ACTIVE' },
        role: { permissions: { some: { permissionKey: 'approval.task.act' } } },
      },
      select: { userId: true },
    });
    return new Set(rows.map((r) => r.userId));
  }

  private async candidates(db: Db, input: ResolveInput, stage: ApprovalPolicyStage): Promise<string[]> {
    const now = new Date();
    switch (stage.approverType) {
      case 'USER':
        return stage.approverUserId ? [stage.approverUserId] : [];
      case 'REQUESTER_MANAGER': {
        const requester = await db.user.findUnique({ where: { id: input.requesterId }, select: { managerId: true } });
        return requester?.managerId ? [requester.managerId] : [];
      }
      case 'DEPARTMENT_HEAD': {
        let deptId = input.departmentId;
        for (let depth = 0; deptId && depth < 20; depth++) {
          const dept = await db.department.findFirst({ where: { id: deptId, companyId: input.companyId }, select: { headUserId: true, parentId: true } });
          if (!dept) return [];
          if (dept.headUserId && dept.headUserId !== input.requesterId) return [dept.headUserId];
          deptId = dept.parentId;
        }
        return [];
      }
      case 'ROLE': {
        if (!stage.approverRoleKey) return [];
        const rows = await db.userRoleAssignment.findMany({
          where: {
            companyId: input.companyId,
            revokedAt: null,
            validFrom: { lte: assignmentStartCutoff(now) },
            AND: [
              { OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
              // A department-scoped assignment only approves for that department.
              { OR: [{ departmentId: null }, ...(input.departmentId ? [{ departmentId: input.departmentId }] : [])] },
            ],
            role: { key: stage.approverRoleKey },
            user: { status: 'ACTIVE' },
          },
          select: { userId: true },
          orderBy: { createdAt: 'asc' },
        });
        return [...new Set(rows.map((r) => r.userId))];
      }
      default:
        return [];
    }
  }

  async activeDelegate(db: Db, companyId: string, delegatorId: string, entityType: string): Promise<string | null> {
    const now = new Date();
    const d = await db.approvalDelegation.findFirst({
      where: {
        companyId,
        delegatorId,
        revokedAt: null,
        validFrom: { lte: now },
        validUntil: { gt: now },
        OR: [{ entityTypes: { isEmpty: true } }, { entityTypes: { has: entityType } }],
      },
      orderBy: { createdAt: 'desc' },
      select: { delegateId: true },
    });
    return d?.delegateId ?? null;
  }
}
