import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import {
  APPROVAL_ENTITY_TYPES,
  APPROVAL_INSTANCE_STATUSES,
  approvalDecisionSchema,
  approvalPolicySchema,
  cancelApprovalSchema,
  createDelegationSchema,
  delegateTaskSchema,
  paginationQuery,
  simulatePolicySchema,
} from '@kenzo/shared';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../../common/decorators/auth.decorators';
import type { AuthContext } from '../../common/context/request-context';
import { zod } from '../../common/pipes/zod-validation.pipe';
import { AuthorizationService } from '../access-control/authorization.service';
import { ApprovalEngine } from './approval-engine.service';
import { ApprovalPolicyService } from './approval-policy.service';
import { ApprovalQueryService } from './approval-query.service';

const policyListQuery = z.object({ entityType: z.enum(APPROVAL_ENTITY_TYPES).optional() });
const updatePolicySchema = approvalPolicySchema.and(z.object({ version: z.number().int().nonnegative() }));
const publishSchema = z.object({ reason: z.string().trim().min(1, 'Reason is required').max(500) });
const tasksQuery = paginationQuery.extend({ status: z.enum(['PENDING', 'DECIDED']).default('PENDING') });
const instancesQuery = paginationQuery.extend({
  status: z.enum(APPROVAL_INSTANCE_STATUSES).optional(),
  entityType: z.enum(APPROVAL_ENTITY_TYPES).optional(),
  mine: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

@Controller()
export class WorkflowController {
  constructor(
    private readonly policies: ApprovalPolicyService,
    private readonly engine: ApprovalEngine,
    private readonly queries: ApprovalQueryService,
    private readonly authz: AuthorizationService,
  ) {}

  // ── Policies ─────────────────────────────────────────────────────────────
  @Get('approval-policies')
  @RequirePermissions('approval.policy.read')
  listPolicies(@CurrentAuth() auth: AuthContext, @Query(zod(policyListQuery)) q: z.infer<typeof policyListQuery>) {
    return this.policies.list(auth, q.entityType);
  }

  @Get('approval-policies/:id')
  @RequirePermissions('approval.policy.read')
  getPolicy(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.policies.get(auth, id);
  }

  @Post('approval-policies')
  @RequirePermissions('approval.policy.manage')
  createPolicy(@CurrentAuth() auth: AuthContext, @Body(zod(approvalPolicySchema)) body: z.infer<typeof approvalPolicySchema>) {
    return this.policies.createDraft(auth, body);
  }

  @Put('approval-policies/:id')
  @RequirePermissions('approval.policy.manage')
  updatePolicy(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(updatePolicySchema)) body: z.infer<typeof updatePolicySchema>,
  ) {
    return this.policies.updateDraft(auth, id, body);
  }

  @Post('approval-policies/:id/publish')
  @HttpCode(200)
  @RequirePermissions('approval.policy.manage')
  publish(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(zod(publishSchema)) body: z.infer<typeof publishSchema>) {
    return this.policies.publish(auth, id, body.reason);
  }

  @Post('approval-policies/:id/clone')
  @RequirePermissions('approval.policy.manage')
  clone(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.policies.cloneToDraft(auth, id);
  }

  @Post('approval-policies/:id/simulate')
  @HttpCode(200)
  @RequirePermissions('approval.policy.read')
  simulate(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(simulatePolicySchema)) body: z.infer<typeof simulatePolicySchema>,
  ) {
    return this.policies.simulate(auth, id, body);
  }

  // ── Tasks & instances ────────────────────────────────────────────────────
  @Get('approvals/tasks')
  @RequirePermissions('approval.task.act')
  myTasks(@CurrentAuth() auth: AuthContext, @Query(zod(tasksQuery)) q: z.infer<typeof tasksQuery>) {
    return this.queries.myTasks(auth, q);
  }

  @Get('approvals/summary')
  summary(@CurrentAuth() auth: AuthContext) {
    return this.authz.has(auth, 'approval.task.act') ? this.queries.pendingCount(auth) : { pending: 0, overdue: 0 };
  }

  @Get('approvals/eligible-approvers')
  @RequirePermissions('approval.task.act')
  eligible(@CurrentAuth() auth: AuthContext, @Query(zod(paginationQuery)) q: z.infer<typeof paginationQuery>) {
    return this.queries.eligibleApprovers(auth, q.q);
  }

  @Get('approvals/instances')
  instances(@CurrentAuth() auth: AuthContext, @Query(zod(instancesQuery)) q: z.infer<typeof instancesQuery>) {
    return this.queries.listInstances(auth, q);
  }

  @Get('approvals/instances/:id')
  instance(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.queries.getInstance(auth, id);
  }

  @Post('approvals/tasks/:id/decision')
  @HttpCode(200)
  @RequirePermissions('approval.task.act')
  decide(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(approvalDecisionSchema)) body: z.infer<typeof approvalDecisionSchema>,
  ) {
    return this.engine.decide(auth, id, body.decision, body.reason);
  }

  @Post('approvals/tasks/:id/delegate')
  @HttpCode(200)
  @RequirePermissions('approval.task.act', 'approval.delegation.manage')
  delegate(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(zod(delegateTaskSchema)) body: z.infer<typeof delegateTaskSchema>) {
    return this.engine.reassign(auth, id, body.toUserId, body.reason, 'delegate');
  }

  @Post('approvals/tasks/:id/reassign')
  @HttpCode(200)
  @RequirePermissions('approval.delegation.admin')
  reassign(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(zod(delegateTaskSchema)) body: z.infer<typeof delegateTaskSchema>) {
    return this.engine.reassign(auth, id, body.toUserId, body.reason, 'admin');
  }

  @Post('approvals/instances/:id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(cancelApprovalSchema)) body: z.infer<typeof cancelApprovalSchema>,
  ) {
    return this.engine.cancel(auth, id, body.reason, { asAdmin: this.authz.has(auth, 'approval.delegation.admin') });
  }

  @Post('approvals/escalations/run')
  @HttpCode(200)
  @RequirePermissions('approval.delegation.admin')
  escalate(@CurrentAuth() auth: AuthContext) {
    return this.engine.escalateOverdue(auth.companyId);
  }

  // ── Delegations ──────────────────────────────────────────────────────────
  @Get('approvals/delegations')
  @RequirePermissions('approval.delegation.manage')
  delegations(@CurrentAuth() auth: AuthContext) {
    return this.queries.listDelegations(auth);
  }

  @Post('approvals/delegations')
  @RequirePermissions('approval.delegation.manage')
  createDelegation(@CurrentAuth() auth: AuthContext, @Body(zod(createDelegationSchema)) body: z.infer<typeof createDelegationSchema>) {
    return this.queries.createDelegation(auth, body);
  }

  @Post('approvals/delegations/:id/revoke')
  @HttpCode(204)
  @RequirePermissions('approval.delegation.manage')
  async revokeDelegation(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.queries.revokeDelegation(auth, id);
  }
}
