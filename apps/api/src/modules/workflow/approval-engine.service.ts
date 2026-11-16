import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { Prisma, type ApprovalInstance, type ApprovalPolicyStage, type ApprovalTask } from '@prisma/client';
import { APPROVAL_ENTITY_LABELS, type ApprovalDecision, type ApprovalEntityType } from '@kenzo/shared';
import { ENV, type Env } from '../../config/env';
import type { AuthContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { NotificationService } from '../../infrastructure/notifications/notification.service';
import { OutboxService } from '../../infrastructure/outbox/outbox.service';
import { PrismaService, type Tx } from '../../infrastructure/prisma/prisma.service';
import { SegregationOfDutiesService } from '../access-control/segregation-of-duties.service';
import { ApprovalHooksRegistry } from './approval-hooks';
import { POLICY_INCLUDE } from './approval-policy.service';
import { ApproverResolver } from './approver-resolver';
import { assignmentStartCutoff } from '../access-control/access-context.loader';

export interface SubmitForApprovalInput {
  entityType: ApprovalEntityType;
  entityId: string;
  /** Human reference, e.g. PR-2026-27-000123. */
  entityReference?: string | null;
  entitySummary?: string | null;
  amount?: string | null;
  currencyCode?: string | null;
  departmentId?: string | null;
  categoryKey?: string | null;
  /** Defaults to the acting user. */
  requesterId?: string;
  /** Actors who must never approve this instance (maker-checker). */
  excludedUserIds?: string[];
}

type TaskWithStage = ApprovalTask & { stage: ApprovalPolicyStage };

const entityLabel = (t: string) => APPROVAL_ENTITY_LABELS[t as ApprovalEntityType] ?? t;

/**
 * Reusable approval engine (PRD §3.9). Business modules call `submit(tx, …)`
 * inside their own transaction; approvers act through `decide`. All mutations
 * lock the instance row (SELECT … FOR UPDATE) so concurrent decisions on the
 * same request are serialised and can never double-advance a stage.
 */
@Injectable()
export class ApprovalEngine implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('ApprovalEngine');
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: ApproverResolver,
    private readonly hooks: ApprovalHooksRegistry,
    private readonly sod: SegregationOfDutiesService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly outbox: OutboxService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap(): void {
    if (this.env.ESCALATION_POLL_MS > 0) {
      this.timer = setInterval(() => {
        void this.escalateOverdue(null).catch((err: Error) => this.logger.error(`escalation run failed: ${err.message}`));
      }, this.env.ESCALATION_POLL_MS);
      this.timer.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async lockInstance(tx: Tx, instanceId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM approval_instance WHERE id = ${instanceId}::uuid FOR UPDATE`;
  }

  private async event(
    tx: Tx,
    instanceId: string,
    type: string,
    data: { taskId?: string | null; actorId?: string | null; sequence?: number | null; reason?: string | null; metadata?: Record<string, unknown> },
  ) {
    await tx.approvalEvent.create({
      data: {
        instanceId,
        type,
        taskId: data.taskId ?? null,
        actorId: data.actorId ?? null,
        sequence: data.sequence ?? null,
        reason: data.reason ?? null,
        metadata: (data.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  private async notifyAssignees(tx: Tx, instance: ApprovalInstance, tasks: ApprovalTask[]) {
    const users = await tx.user.findMany({ where: { id: { in: tasks.map((t) => t.assigneeId) } }, select: { id: true, email: true, fullName: true } });
    for (const u of users) {
      const title = `Approval needed: ${entityLabel(instance.entityType)}${instance.entityReference ? ` ${instance.entityReference}` : ''}`;
      await this.notifications.notify(tx, {
        companyId: instance.companyId,
        userId: u.id,
        type: 'approval.task.assigned',
        title,
        body: instance.entitySummary ?? undefined,
        link: `/approvals/${instance.id}`,
        entityType: 'approval_instance',
        entityId: instance.id,
        email: {
          to: u.email,
          subject: title,
          text: `Hello ${u.fullName},\n\nYou have a new approval task.\n${this.notifications.appUrl(`/approvals/${instance.id}`)}\n`,
        },
      });
    }
  }

  private async activateStage(tx: Tx, instance: ApprovalInstance, sequence: number, distinct: boolean): Promise<ApprovalTask[]> {
    const tasks = await tx.approvalTask.findMany({ where: { instanceId: instance.id, sequence, status: 'WAITING' }, include: { stage: true } });
    const now = new Date();
    let toActivate = tasks;
    if (distinct) {
      const priorApprovers = new Set(
        (await tx.approvalTask.findMany({ where: { instanceId: instance.id, status: 'APPROVED' }, select: { decidedById: true } })).map((t) => t.decidedById),
      );
      const conflicted = tasks.filter((t) => priorApprovers.has(t.assigneeId));
      const clean = tasks.filter((t) => !priorApprovers.has(t.assigneeId));
      const stage = tasks[0]?.stage;
      const required = stage ? (stage.mode === 'ALL' ? tasks.length : stage.minApprovals) : 1;
      if (conflicted.length > 0 && clean.length >= Math.min(required, tasks.length) && clean.length > 0) {
        await tx.approvalTask.updateMany({
          where: { id: { in: conflicted.map((t) => t.id) } },
          data: { status: 'SKIPPED', reason: 'Approver already approved an earlier stage' },
        });
        toActivate = clean;
      } else if (conflicted.length > 0) {
        await this.event(tx, instance.id, 'reassignment_required', { sequence, metadata: { conflictedTaskIds: conflicted.map((t) => t.id) } });
      }
    }
    for (const t of toActivate) {
      await tx.approvalTask.update({
        where: { id: t.id },
        data: { status: 'PENDING', activatedAt: now, dueAt: t.stage.slaHours ? new Date(now.getTime() + t.stage.slaHours * 3600_000) : null },
      });
    }
    await tx.approvalInstance.update({ where: { id: instance.id }, data: { currentSequence: sequence, version: { increment: 1 } } });
    await this.event(tx, instance.id, 'stage_activated', { sequence, metadata: { tasks: toActivate.length } });
    await this.notifyAssignees(tx, instance, toActivate);
    return toActivate;
  }

  /**
   * Starts an approval. Must be called inside the owning module's transaction.
   * Fails (and therefore rolls back the caller) when no active policy exists or
   * a stage cannot be staffed by an independent approver.
   */
  async submit(tx: Tx, auth: AuthContext, input: SubmitForApprovalInput): Promise<ApprovalInstance> {
    const requesterId = input.requesterId ?? auth.userId;
    const policy = await tx.approvalPolicy.findFirst({
      where: { companyId: auth.companyId, entityType: input.entityType, status: 'ACTIVE' },
      include: POLICY_INCLUDE,
    });
    if (!policy) {
      throw new AppError('APPROVAL_NO_POLICY', `No active approval policy for ${entityLabel(input.entityType)}. An administrator must publish one.`);
    }
    const pending = await tx.approvalInstance.findFirst({
      where: { companyId: auth.companyId, entityType: input.entityType, entityId: input.entityId, status: 'PENDING' },
    });
    if (pending) throw AppError.invalidState('This record already has an approval in progress');

    const requester = await tx.user.findUnique({ where: { id: requesterId }, select: { departmentId: true } });
    const departmentId = input.departmentId ?? requester?.departmentId ?? null;
    const excludedUserIds = [...new Set(input.excludedUserIds ?? [])];
    const chain = await this.resolver.resolve(tx, {
      companyId: auth.companyId,
      policy,
      entityType: input.entityType,
      amount: input.amount ?? null,
      departmentId,
      categoryKey: input.categoryKey ?? null,
      requesterId,
      excludedUserIds,
    });

    const instance = await tx.approvalInstance.create({
      data: {
        companyId: auth.companyId,
        policyId: policy.id,
        entityType: input.entityType,
        entityId: input.entityId,
        entityReference: input.entityReference ?? null,
        entitySummary: input.entitySummary?.slice(0, 300) ?? null,
        amount: input.amount ?? null,
        currencyCode: input.currencyCode ?? null,
        departmentId,
        categoryKey: input.categoryKey ?? null,
        requesterId,
        excludedUserIds,
        status: 'PENDING',
      },
    });
    for (const c of chain) {
      await tx.approvalTask.createMany({
        data: c.approvers.map((a) => ({
          instanceId: instance.id,
          stageId: c.stage.id,
          sequence: c.stage.sequence,
          assigneeId: a.userId,
          delegatedFromId: a.delegatedFromId,
          status: 'WAITING' as const,
        })),
      });
    }
    await this.event(tx, instance.id, 'submitted', {
      actorId: auth.userId,
      metadata: {
        policyId: policy.id,
        policyVersion: policy.policyVersion,
        stages: chain.map((c) => ({ sequence: c.stage.sequence, approvers: c.approvers.length, required: c.required })),
      },
    });
    await this.activateStage(tx, instance, chain[0]!.stage.sequence, policy.distinctApproversAcrossStages);
    await this.audit.record(tx, {
      action: 'approval.submitted',
      entityType: input.entityType,
      entityId: input.entityId,
      after: { instanceId: instance.id, policyVersion: policy.policyVersion, amount: input.amount, departmentId },
    });
    return tx.approvalInstance.findUniqueOrThrow({ where: { id: instance.id } });
  }

  /** Approve / reject / return a task. */
  async decide(auth: AuthContext, taskId: string, decision: ApprovalDecision, reason: string | null | undefined): Promise<ApprovalInstance> {
    if (decision !== 'APPROVE' && !reason?.trim()) {
      throw AppError.validation([{ path: 'reason', message: 'A reason is required to reject or return' }]);
    }
    return this.prisma.tx(async (tx) => {
      const probe = await tx.approvalTask.findUnique({ where: { id: taskId }, select: { instanceId: true } });
      if (!probe) throw AppError.notFound('Approval task');
      await this.lockInstance(tx, probe.instanceId);

      const task = await tx.approvalTask.findUniqueOrThrow({ where: { id: taskId }, include: { stage: true, instance: { include: { policy: true } } } });
      const instance = task.instance;
      if (instance.companyId !== auth.companyId) throw AppError.notFound('Approval task');
      if (task.assigneeId !== auth.userId) throw AppError.forbidden('This approval task is not assigned to you');
      if (instance.status !== 'PENDING') throw AppError.invalidState('This approval is no longer pending');
      if (task.status !== 'PENDING') throw AppError.invalidState(`This task is ${task.status.toLowerCase()}`);

      // Separation of duties — re-checked at decision time, not only at routing.
      if (instance.policy.requireIndependentApproval || instance.policy.excludeInitiatorFromAllStages) {
        this.sod.assert('SELF_APPROVAL', auth.userId, [instance.requesterId]);
      }
      if (instance.excludedUserIds.includes(auth.userId)) {
        const rule =
          instance.entityType === 'payment'
            ? 'PAYMENT_MAKER_CHECKER'
            : instance.entityType === 'vendor_bank_change'
              ? 'BANK_CHANGE_MAKER_CHECKER'
              : 'SELF_APPROVAL';
        this.sod.assert(rule, auth.userId, [auth.userId]);
      }
      if (instance.policy.distinctApproversAcrossStages && decision === 'APPROVE') {
        const earlier = await tx.approvalTask.count({
          where: { instanceId: instance.id, sequence: { lt: task.sequence }, status: 'APPROVED', decidedById: auth.userId },
        });
        if (earlier > 0) this.sod.assert('DISTINCT_STAGE_APPROVERS', auth.userId, [auth.userId]);
      }

      const now = new Date();
      const statusByDecision = { APPROVE: 'APPROVED', REJECT: 'REJECTED', RETURN: 'RETURNED' } as const;
      await tx.approvalTask.update({
        where: { id: task.id },
        data: { status: statusByDecision[decision], decidedById: auth.userId, decidedAt: now, reason: reason?.trim() || null },
      });
      await this.event(tx, instance.id, decision.toLowerCase(), { taskId: task.id, actorId: auth.userId, sequence: task.sequence, reason });
      await this.audit.record(tx, {
        action: `approval.task.${decision.toLowerCase()}`,
        entityType: instance.entityType,
        entityId: instance.entityId,
        after: { instanceId: instance.id, taskId: task.id, stage: task.stage.name, sequence: task.sequence },
        reason,
      });

      if (decision === 'APPROVE') {
        await this.afterApproval(tx, instance, task);
      } else {
        await this.finish(tx, instance, decision === 'REJECT' ? 'REJECTED' : 'RETURNED', reason!.trim(), auth.userId);
      }
      return tx.approvalInstance.findUniqueOrThrow({ where: { id: instance.id } });
    });
  }

  private async afterApproval(tx: Tx, instance: ApprovalInstance & { policy: { distinctApproversAcrossStages: boolean } }, task: TaskWithStage) {
    const stageTasks = await tx.approvalTask.findMany({ where: { instanceId: instance.id, sequence: task.sequence } });
    const approved = stageTasks.filter((t) => t.status === 'APPROVED').length;
    const countable = stageTasks.filter((t) => t.status !== 'SKIPPED' && t.status !== 'CANCELLED' && !t.isEscalation).length;
    const required = task.stage.mode === 'ALL' ? countable : task.stage.minApprovals;
    if (approved < required) return;

    // Stage complete: close any remaining open tasks of this stage.
    await tx.approvalTask.updateMany({
      where: { instanceId: instance.id, sequence: task.sequence, status: { in: ['PENDING', 'WAITING'] } },
      data: { status: 'SKIPPED', reason: 'Stage already approved' },
    });
    await this.event(tx, instance.id, 'stage_completed', { sequence: task.sequence });

    const next = await tx.approvalTask.findFirst({
      where: { instanceId: instance.id, sequence: { gt: task.sequence }, status: 'WAITING' },
      orderBy: { sequence: 'asc' },
      select: { sequence: true },
    });
    if (next) {
      await this.activateStage(tx, instance, next.sequence, instance.policy.distinctApproversAcrossStages);
    } else {
      await this.finish(tx, instance, 'APPROVED', null, task.assigneeId);
    }
  }

  private async finish(tx: Tx, instance: ApprovalInstance, status: 'APPROVED' | 'REJECTED' | 'RETURNED' | 'CANCELLED', reason: string | null, actorId: string) {
    await tx.approvalTask.updateMany({
      where: { instanceId: instance.id, status: { in: ['PENDING', 'WAITING'] } },
      data: { status: 'CANCELLED', reason: `Approval ${status.toLowerCase()}` },
    });
    const updated = await tx.approvalInstance.update({
      where: { id: instance.id },
      data: { status, completedAt: new Date(), outcomeReason: reason, currentSequence: null, version: { increment: 1 } },
    });
    await this.event(tx, instance.id, `instance_${status.toLowerCase()}`, { actorId, reason });

    const handler = this.hooks.get(instance.entityType);
    if (status === 'APPROVED') await handler?.onApproved?.(tx, updated);
    if (status === 'REJECTED') await handler?.onRejected?.(tx, updated, reason ?? '');
    if (status === 'RETURNED') await handler?.onReturned?.(tx, updated, reason ?? '');
    if (status === 'CANCELLED') await handler?.onCancelled?.(tx, updated, reason ?? '');

    await this.outbox.enqueue(tx, {
      companyId: instance.companyId,
      eventType: `approval.${status.toLowerCase()}`,
      aggregateType: instance.entityType,
      aggregateId: instance.entityId,
      payload: { instanceId: instance.id, entityType: instance.entityType, entityId: instance.entityId, status, reason },
    });

    if (status !== 'CANCELLED') {
      const requester = await tx.user.findUniqueOrThrow({ where: { id: instance.requesterId }, select: { id: true, email: true, fullName: true } });
      const title = `${entityLabel(instance.entityType)}${instance.entityReference ? ` ${instance.entityReference}` : ''} ${status.toLowerCase()}`;
      await this.notifications.notify(tx, {
        companyId: instance.companyId,
        userId: requester.id,
        type: `approval.${status.toLowerCase()}`,
        title,
        body: reason ?? undefined,
        link: `/approvals/${instance.id}`,
        entityType: 'approval_instance',
        entityId: instance.id,
        email: {
          to: requester.email,
          subject: title,
          text: `Hello ${requester.fullName},\n\n${title}.${reason ? `\nReason: ${reason}` : ''}\n${this.notifications.appUrl(`/approvals/${instance.id}`)}\n`,
        },
      });
    }
  }

  /** Requester (or the owning module) withdraws a pending approval. */
  async cancel(auth: AuthContext, instanceId: string, reason: string, opts: { asAdmin?: boolean } = {}): Promise<ApprovalInstance> {
    return this.prisma.tx(async (tx) => {
      const instance = await tx.approvalInstance.findFirst({ where: { id: instanceId, companyId: auth.companyId } });
      if (!instance) throw AppError.notFound('Approval');
      await this.lockInstance(tx, instance.id);
      const fresh = await tx.approvalInstance.findUniqueOrThrow({ where: { id: instance.id } });
      if (fresh.status !== 'PENDING') throw AppError.invalidState('Only pending approvals can be cancelled');
      if (!opts.asAdmin && fresh.requesterId !== auth.userId) throw AppError.forbidden('Only the requester can withdraw this approval');
      await this.finish(tx, fresh, 'CANCELLED', reason, auth.userId);
      await this.audit.record(tx, {
        action: 'approval.cancelled',
        entityType: fresh.entityType,
        entityId: fresh.entityId,
        after: { instanceId: fresh.id },
        reason,
      });
      return tx.approvalInstance.findUniqueOrThrow({ where: { id: instance.id } });
    });
  }

  /**
   * Reassigns a pending task. As assignee this is delegation (policy must allow
   * it); as administrator (`approval.delegation.admin`) it is reassignment.
   * The new assignee must be independent and eligible.
   */
  async reassign(auth: AuthContext, taskId: string, toUserId: string, reason: string, mode: 'delegate' | 'admin'): Promise<ApprovalInstance> {
    return this.prisma.tx(async (tx) => {
      const probe = await tx.approvalTask.findUnique({ where: { id: taskId }, select: { instanceId: true } });
      if (!probe) throw AppError.notFound('Approval task');
      await this.lockInstance(tx, probe.instanceId);
      const task = await tx.approvalTask.findUniqueOrThrow({ where: { id: taskId }, include: { instance: { include: { policy: true } } } });
      const instance = task.instance;
      if (instance.companyId !== auth.companyId) throw AppError.notFound('Approval task');
      if (instance.status !== 'PENDING' || !['PENDING', 'WAITING'].includes(task.status)) throw AppError.invalidState('This task can no longer be reassigned');
      if (mode === 'delegate') {
        if (task.assigneeId !== auth.userId) throw AppError.forbidden('This approval task is not assigned to you');
        if (!instance.policy.allowDelegation) throw AppError.invalidState('This approval policy does not allow delegation');
      }
      if (toUserId === task.assigneeId) throw AppError.validation([{ path: 'toUserId', message: 'Choose a different approver' }]);
      if (toUserId === instance.requesterId || instance.excludedUserIds.includes(toUserId)) {
        throw new AppError('SEGREGATION_OF_DUTIES', 'That person is not independent of this request and cannot approve it');
      }
      const eligible = await this.resolver.eligibleApprovers(tx, auth.companyId);
      if (!eligible.has(toUserId)) throw AppError.validation([{ path: 'toUserId', message: 'That person is not an active approver in this company' }]);
      const clash = await tx.approvalTask.count({
        where: { instanceId: instance.id, sequence: task.sequence, assigneeId: toUserId, status: { in: ['PENDING', 'WAITING', 'APPROVED'] } },
      });
      if (clash > 0) throw AppError.validation([{ path: 'toUserId', message: 'That person already has a task in this stage' }]);

      const updated = await tx.approvalTask.update({
        where: { id: task.id },
        data: { assigneeId: toUserId, delegatedFromId: task.delegatedFromId ?? task.assigneeId },
      });
      await this.event(tx, instance.id, mode === 'delegate' ? 'delegated' : 'reassigned', {
        taskId: task.id,
        actorId: auth.userId,
        sequence: task.sequence,
        reason,
        metadata: { from: task.assigneeId, to: toUserId },
      });
      await this.audit.record(tx, {
        action: mode === 'delegate' ? 'approval.task.delegated' : 'approval.task.reassigned',
        entityType: instance.entityType,
        entityId: instance.entityId,
        before: { assigneeId: task.assigneeId },
        after: { assigneeId: toUserId, taskId: task.id },
        reason,
      });
      if (updated.status === 'PENDING') await this.notifyAssignees(tx, instance, [updated]);
      return tx.approvalInstance.findUniqueOrThrow({ where: { id: instance.id } });
    });
  }

  /**
   * Escalates overdue PENDING tasks once: notifies the stage's escalation role
   * and, for ANY-mode stages, adds those users as additional approvers.
   * Idempotent — `escalatedAt` marks handled tasks. `companyId` null = all companies.
   */
  async escalateOverdue(companyId: string | null): Promise<{ escalated: number }> {
    const overdue = await this.prisma.approvalTask.findMany({
      where: {
        status: 'PENDING',
        dueAt: { lt: new Date() },
        escalatedAt: null,
        isEscalation: false,
        instance: { status: 'PENDING', ...(companyId ? { companyId } : {}) },
      },
      include: { stage: true, instance: true },
      take: 200,
    });
    let escalated = 0;
    for (const task of overdue) {
      await this.prisma.tx(async (tx) => {
        await this.lockInstance(tx, task.instanceId);
        const claimed = await tx.approvalTask.updateMany({ where: { id: task.id, escalatedAt: null, status: 'PENDING' }, data: { escalatedAt: new Date() } });
        if (claimed.count !== 1) return;
        const instance = task.instance;
        const added: ApprovalTask[] = [];
        if (task.stage.escalationRoleKey) {
          const now = new Date();
          const holders = await tx.userRoleAssignment.findMany({
            where: {
              companyId: instance.companyId,
              revokedAt: null,
              validFrom: { lte: assignmentStartCutoff(now) },
              OR: [{ validUntil: null }, { validUntil: { gt: now } }],
              role: { key: task.stage.escalationRoleKey },
              user: { status: 'ACTIVE' },
            },
            select: { userId: true },
          });
          const eligible = await this.resolver.eligibleApprovers(tx, instance.companyId);
          const existing = new Set(
            (await tx.approvalTask.findMany({ where: { instanceId: instance.id, sequence: task.sequence }, select: { assigneeId: true } })).map(
              (t) => t.assigneeId,
            ),
          );
          const targets = [...new Set(holders.map((h) => h.userId))].filter(
            (u) => u !== instance.requesterId && !instance.excludedUserIds.includes(u) && !existing.has(u),
          );
          if (task.stage.mode === 'ANY') {
            for (const userId of targets.filter((u) => eligible.has(u))) {
              added.push(
                await tx.approvalTask.create({
                  data: {
                    instanceId: instance.id,
                    stageId: task.stageId,
                    sequence: task.sequence,
                    assigneeId: userId,
                    status: 'PENDING',
                    isEscalation: true,
                    activatedAt: new Date(),
                  },
                }),
              );
            }
            await this.notifyAssignees(tx, instance, added);
          } else {
            // ALL-mode: escalation is informational; the original approver must still act or be reassigned.
            for (const userId of targets) {
              await this.notifications.notify(tx, {
                companyId: instance.companyId,
                userId,
                type: 'approval.task.overdue',
                title: `Overdue approval: ${entityLabel(instance.entityType)} ${instance.entityReference ?? ''}`.trim(),
                link: `/approvals/${instance.id}`,
                entityType: 'approval_instance',
                entityId: instance.id,
              });
            }
          }
        }
        await this.notifications.notify(tx, {
          companyId: instance.companyId,
          userId: task.assigneeId,
          type: 'approval.task.overdue',
          title: `Reminder: approval overdue — ${entityLabel(instance.entityType)} ${instance.entityReference ?? ''}`.trim(),
          link: `/approvals/${instance.id}`,
          entityType: 'approval_instance',
          entityId: instance.id,
        });
        await this.event(tx, instance.id, 'escalated', {
          taskId: task.id,
          sequence: task.sequence,
          metadata: { addedApprovers: added.map((a) => a.assigneeId) },
        });
        await this.audit.record(tx, {
          action: 'approval.task.escalated',
          entityType: instance.entityType,
          entityId: instance.entityId,
          companyId: instance.companyId,
          actorId: null,
          after: { taskId: task.id, addedApprovers: added.length },
        });
        escalated++;
      });
    }
    return { escalated };
  }
}
