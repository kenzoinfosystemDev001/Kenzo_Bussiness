import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { cursorWhere, decodeCursor, pageOf } from '../../common/pagination';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuthorizationService } from '../access-control/authorization.service';
import { ApproverResolver } from './approver-resolver';

const USER_BRIEF = { select: { id: true, fullName: true, email: true } } as const;

@Injectable()
export class ApprovalQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly resolver: ApproverResolver,
  ) {}

  /** The approver's inbox. */
  async myTasks(auth: AuthContext, q: { status: 'PENDING' | 'DECIDED'; cursor?: string; limit: number }) {
    const cursor = decodeCursor(q.cursor);
    const where: Prisma.ApprovalTaskWhereInput = {
      assigneeId: auth.userId,
      instance: { companyId: auth.companyId },
      ...(q.status === 'PENDING' ? { status: 'PENDING' } : { status: { in: ['APPROVED', 'REJECTED', 'RETURNED'] } }),
      ...(cursorWhere(cursor) as Prisma.ApprovalTaskWhereInput),
    };
    const rows = await this.prisma.approvalTask.findMany({
      where,
      include: {
        stage: { select: { name: true, mode: true } },
        delegatedFrom: USER_BRIEF,
        instance: {
          select: {
            id: true,
            entityType: true,
            entityId: true,
            entityReference: true,
            entitySummary: true,
            amount: true,
            currencyCode: true,
            status: true,
            submittedAt: true,
            requester: USER_BRIEF,
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    return pageOf(rows, q.limit);
  }

  async pendingCount(auth: AuthContext): Promise<{ pending: number; overdue: number }> {
    const base = { assigneeId: auth.userId, status: 'PENDING' as const, instance: { companyId: auth.companyId } };
    const [pending, overdue] = await Promise.all([
      this.prisma.approvalTask.count({ where: base }),
      this.prisma.approvalTask.count({ where: { ...base, dueAt: { lt: new Date() } } }),
    ]);
    return { pending, overdue };
  }

  /** Instances visible to the user: all (approval.instance.read), else own requests and ones they act on. */
  async listInstances(auth: AuthContext, q: { status?: string; entityType?: string; mine?: boolean; cursor?: string; limit: number }) {
    const cursor = decodeCursor(q.cursor);
    const visibility: Prisma.ApprovalInstanceWhereInput =
      this.authz.has(auth, 'approval.instance.read') && !q.mine
        ? {}
        : { OR: [{ requesterId: auth.userId }, { tasks: { some: { OR: [{ assigneeId: auth.userId }, { delegatedFromId: auth.userId }] } } }] };
    const rows = await this.prisma.approvalInstance.findMany({
      where: {
        companyId: auth.companyId,
        ...visibility,
        ...(q.status ? { status: q.status as Prisma.EnumApprovalInstanceStatusFilter['equals'] } : {}),
        ...(q.entityType ? { entityType: q.entityType } : {}),
        ...(cursorWhere(cursor) as Prisma.ApprovalInstanceWhereInput),
      },
      include: {
        requester: USER_BRIEF,
        policy: { select: { name: true, policyVersion: true } },
        tasks: { where: { status: 'PENDING' }, select: { assignee: USER_BRIEF, sequence: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    return pageOf(rows, q.limit);
  }

  async getInstance(auth: AuthContext, id: string) {
    const instance = await this.prisma.approvalInstance.findFirst({
      where: { id, companyId: auth.companyId },
      include: {
        requester: USER_BRIEF,
        policy: {
          select: { id: true, name: true, policyVersion: true, allowDelegation: true, requireIndependentApproval: true, distinctApproversAcrossStages: true },
        },
        tasks: {
          include: {
            assignee: USER_BRIEF,
            delegatedFrom: USER_BRIEF,
            decidedBy: USER_BRIEF,
            stage: { select: { name: true, mode: true, minApprovals: true, slaHours: true } },
          },
          orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }],
        },
        events: { orderBy: { occurredAt: 'asc' } },
      },
    });
    if (!instance) throw AppError.notFound('Approval');
    const involved = instance.requesterId === auth.userId || instance.tasks.some((t) => t.assigneeId === auth.userId || t.delegatedFromId === auth.userId);
    if (!involved && !this.authz.has(auth, 'approval.instance.read')) throw AppError.notFound('Approval');

    const actorIds = [...new Set(instance.events.map((e) => e.actorId).filter((x): x is string => !!x))];
    const actors = await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true } });
    const byId = new Map(actors.map((a) => [a.id, a]));
    return {
      ...instance,
      events: instance.events.map((e) => ({ ...e, actor: e.actorId ? (byId.get(e.actorId) ?? null) : null })),
      viewer: {
        isRequester: instance.requesterId === auth.userId,
        pendingTaskId: instance.tasks.find((t) => t.assigneeId === auth.userId && t.status === 'PENDING')?.id ?? null,
        canAdminister: this.authz.has(auth, 'approval.delegation.admin'),
      },
    };
  }

  /** Independent, active approvers in the company (for delegation pickers) — needs only approval.task.act. */
  async eligibleApprovers(auth: AuthContext, search?: string) {
    const ids = await this.resolver.eligibleApprovers(this.prisma, auth.companyId);
    ids.delete(auth.userId);
    const items = await this.prisma.user.findMany({
      where: {
        id: { in: [...ids] },
        ...(search ? { OR: [{ fullName: { contains: search, mode: 'insensitive' } }, { email: { contains: search.toLowerCase() } }] } : {}),
      },
      select: { id: true, fullName: true, email: true, jobTitle: true },
      orderBy: { fullName: 'asc' },
      take: 50,
    });
    return { items };
  }

  // ── Delegations ──────────────────────────────────────────────────────────
  async listDelegations(auth: AuthContext) {
    const admin = this.authz.has(auth, 'approval.delegation.admin');
    const items = await this.prisma.approvalDelegation.findMany({
      where: {
        companyId: auth.companyId,
        ...(admin ? {} : { OR: [{ delegatorId: auth.userId }, { delegateId: auth.userId }] }),
      },
      include: { delegator: USER_BRIEF, delegate: USER_BRIEF },
      orderBy: [{ revokedAt: { sort: 'desc', nulls: 'first' } }, { validFrom: 'desc' }],
      take: 200,
    });
    return { items };
  }

  async createDelegation(
    auth: AuthContext,
    input: { delegatorId?: string; delegateId: string; validFrom: string; validUntil: string; entityTypes: string[]; reason: string },
  ) {
    const delegatorId = input.delegatorId ?? auth.userId;
    if (delegatorId !== auth.userId && !this.authz.has(auth, 'approval.delegation.admin')) throw AppError.forbidden('You can only delegate your own approvals');
    if (delegatorId === input.delegateId) throw AppError.validation([{ path: 'delegateId', message: 'Choose someone else' }]);
    const eligible = await this.resolver.eligibleApprovers(this.prisma, auth.companyId);
    if (!eligible.has(input.delegateId))
      throw AppError.validation([{ path: 'delegateId', message: 'The delegate must be an active approver in this company' }]);
    if (!eligible.has(delegatorId)) throw AppError.validation([{ path: 'delegatorId', message: 'The delegator is not an approver in this company' }]);
    return this.prisma.tx(async (tx) => {
      const overlapping = await tx.approvalDelegation.count({
        where: {
          companyId: auth.companyId,
          delegatorId,
          revokedAt: null,
          validFrom: { lt: new Date(input.validUntil) },
          validUntil: { gt: new Date(input.validFrom) },
        },
      });
      if (overlapping > 0) throw new AppError('CONFLICT', 'An active delegation already overlaps this period');
      const d = await tx.approvalDelegation.create({
        data: {
          companyId: auth.companyId,
          delegatorId,
          delegateId: input.delegateId,
          validFrom: new Date(input.validFrom),
          validUntil: new Date(input.validUntil),
          entityTypes: input.entityTypes,
          reason: input.reason,
          createdById: auth.userId,
        },
      });
      await this.audit.record(tx, { action: 'approval.delegation.created', entityType: 'approval_delegation', entityId: d.id, after: input });
      return d;
    });
  }

  async revokeDelegation(auth: AuthContext, id: string) {
    await this.prisma.tx(async (tx) => {
      const d = await tx.approvalDelegation.findFirst({ where: { id, companyId: auth.companyId } });
      if (!d) throw AppError.notFound('Delegation');
      if (d.delegatorId !== auth.userId && !this.authz.has(auth, 'approval.delegation.admin')) throw AppError.forbidden();
      if (d.revokedAt) throw AppError.invalidState('Already revoked');
      await tx.approvalDelegation.update({ where: { id }, data: { revokedAt: new Date() } });
      await this.audit.record(tx, { action: 'approval.delegation.revoked', entityType: 'approval_delegation', entityId: id });
    });
  }
}
