import { randomUUID } from 'node:crypto';
import type { ApprovalPolicyInput } from '@kenzo/shared';
import type { AuthContext } from '../../src/common/context/request-context';
import { AccessContextLoader } from '../../src/modules/access-control/access-context.loader';
import { ApprovalEngine, type SubmitForApprovalInput } from '../../src/modules/workflow/approval-engine.service';
import { ApprovalHooksRegistry } from '../../src/modules/workflow/approval-hooks';
import { Harness, type Client, type TestCompany, type TestUser } from './harness';

describe('Approval engine', () => {
  const h = new Harness();
  const outcomes: Array<{ entityId: string; outcome: string }> = [];

  beforeAll(async () => {
    await h.start();
    const hooks = h.app.get(ApprovalHooksRegistry);
    const record = (outcome: string) => async (_tx: unknown, instance: { entityId: string }) => void outcomes.push({ entityId: instance.entityId, outcome });
    // The engine is entity-agnostic, so these tests drive an entity type no module
    // owns. A type owned by a module (purchase_requisition, rfq, vendor…) already
    // has a handler, and the registry refuses a second one.
    hooks.register('purchase_order', {
      onApproved: record('approved'),
      onRejected: record('rejected'),
      onReturned: record('returned'),
      onCancelled: record('cancelled'),
    });
  });
  afterAll(() => h.stop());

  async function ctx(user: TestUser, company: TestCompany): Promise<AuthContext> {
    const access = (await h.app.get(AccessContextLoader).load(user.id, company.id))!;
    return {
      userId: user.id,
      sessionId: randomUUID(),
      email: user.email,
      fullName: 'Test',
      companyId: company.id,
      homeCompanyId: company.id,
      departmentId: null,
      departmentScopeIds: access.departmentScopeIds,
      permissions: access.permissions,
      roleKeys: access.roleKeys,
      mfaEnabled: false,
      mfaVerified: false,
      mfaPending: false,
      companyEnforcesMfa: false,
    };
  }

  async function submit(requester: TestUser, company: TestCompany, input: Partial<SubmitForApprovalInput> = {}) {
    const auth = await ctx(requester, company);
    return h.prisma.tx((tx) =>
      h.app.get(ApprovalEngine).submit(tx, auth, { entityType: 'purchase_order', entityId: randomUUID(), entityReference: 'PO-TEST', ...input }),
    );
  }

  async function publish(admin: Client, policy: ApprovalPolicyInput): Promise<string> {
    const existing = await admin.get(`/approval-policies?entityType=${policy.entityType}`);
    for (const p of existing.body.items.filter((x: { status: string }) => x.status === 'DRAFT')) {
      await h.prisma.approvalPolicyStage.deleteMany({ where: { policyId: p.id } });
      await h.prisma.approvalPolicy.delete({ where: { id: p.id } });
    }
    const draft = await admin.post('/approval-policies', policy);
    expect(draft.status).toBe(201);
    const pub = await admin.post(`/approval-policies/${draft.body.id}/publish`, { reason: 'test' });
    expect(pub.status).toBe(200);
    return draft.body.id as string;
  }

  async function pendingTaskFor(instanceId: string, userId: string) {
    return h.prisma.approvalTask.findFirst({ where: { instanceId, assigneeId: userId, status: 'PENDING' } });
  }

  /** Company with dept head, finance manager, director approver and a requester. */
  async function setup() {
    const company = await h.company();
    const admin = (await h.as(company, ['COMPANY_ADMIN'])).client;
    const head = await h.user(company, ['DEPARTMENT_HEAD'], { departmentId: company.departments.eng });
    await h.prisma.department.update({ where: { id: company.departments.eng }, data: { headUserId: head.id } });
    const finance = await h.user(company, ['FINANCE_MANAGER'], { departmentId: company.departments.fin });
    const director = await h.user(company, ['APPROVER']);
    const requester = await h.user(company, ['REQUESTER'], { departmentId: company.departments.eng, managerId: head.id });
    await publish(admin, {
      entityType: 'purchase_order',
      name: 'PO policy',
      requireIndependentApproval: true,
      distinctApproversAcrossStages: true,
      allowDelegation: true,
      excludeInitiatorFromAllStages: true,
      stages: [
        {
          sequence: 1,
          name: 'Head',
          mode: 'ANY',
          minApprovals: 1,
          approverType: 'DEPARTMENT_HEAD',
          departmentIds: [],
          categoryKeys: [],
          slaHours: 1,
          escalationRoleKey: 'APPROVER',
        },
        {
          sequence: 2,
          name: 'Finance',
          mode: 'ANY',
          minApprovals: 1,
          minAmount: '10000.01',
          approverType: 'ROLE',
          approverRoleKey: 'FINANCE_MANAGER',
          departmentIds: [],
          categoryKeys: [],
        },
        {
          sequence: 3,
          name: 'Director',
          mode: 'ANY',
          minApprovals: 1,
          minAmount: '50000.01',
          approverType: 'ROLE',
          approverRoleKey: 'APPROVER',
          departmentIds: [],
          categoryKeys: [],
        },
      ],
    });
    return { company, admin, head, finance, director, requester };
  }

  it('fails loudly when no active policy exists', async () => {
    const company = await h.company();
    const requester = await h.user(company, ['REQUESTER']);
    await expect(submit(requester, company)).rejects.toMatchObject({ code: 'APPROVAL_NO_POLICY' });
  });

  it('routes by amount threshold (≤10k: head only; >50k: head → finance → director)', async () => {
    const { company, requester } = await setup();
    const small = await submit(requester, company, { amount: '5000.00' });
    const large = await submit(requester, company, { amount: '75000.00' });
    const seq = async (id: string) => [
      ...new Set((await h.prisma.approvalTask.findMany({ where: { instanceId: id }, orderBy: { sequence: 'asc' } })).map((t) => t.sequence)),
    ];
    expect(await seq(small.id)).toEqual([1]);
    expect(await seq(large.id)).toEqual([1, 2, 3]);
  });

  it('runs a full sequential approval to completion and invokes the owning module hook in-transaction', async () => {
    const { company, head, finance, director, requester } = await setup();
    const instance = await submit(requester, company, { amount: '75000.00' });

    // Stage 2 tasks are WAITING until stage 1 completes — finance cannot jump ahead.
    const financeTask = await h.prisma.approvalTask.findFirstOrThrow({ where: { instanceId: instance.id, assigneeId: finance.id } });
    expect(financeTask.status).toBe('WAITING');
    const fClient = await h.login(finance.email);
    expect((await fClient.post(`/approvals/tasks/${financeTask.id}/decision`, { decision: 'APPROVE' })).body.error.code).toBe('INVALID_STATE');

    for (const approver of [head, finance, director]) {
      const task = await pendingTaskFor(instance.id, approver.id);
      expect(task).toBeTruthy();
      const client = await h.login(approver.email);
      const res = await client.post(`/approvals/tasks/${task!.id}/decision`, { decision: 'APPROVE' });
      expect(res.status).toBe(200);
    }
    const done = await h.prisma.approvalInstance.findUniqueOrThrow({ where: { id: instance.id } });
    expect(done.status).toBe('APPROVED');
    expect(outcomes).toContainEqual({ entityId: instance.entityId, outcome: 'approved' });
    const events = await h.prisma.approvalEvent.findMany({ where: { instanceId: instance.id }, orderBy: { occurredAt: 'asc' } });
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['submitted', 'approve', 'stage_completed', 'instance_approved']));
    // Requester notified.
    expect(await h.prisma.notification.count({ where: { userId: requester.id, type: 'approval.approved' } })).toBe(1);
  });

  it('never routes to the requester, and blocks self-approval at decision time', async () => {
    const { company, head } = await setup();
    // The department head raises their own request → routing moves up; with no parent dept there is no eligible head.
    await expect(submit(head, company, { amount: '100.00' })).rejects.toMatchObject({ code: 'APPROVAL_NO_ELIGIBLE_APPROVER' });

    // Force a task onto the requester (simulating data tampering) — decision must still be refused.
    const { requester } = { requester: await h.user(company, ['REQUESTER', 'APPROVER'], { departmentId: company.departments.eng }) };
    const instance = await submit(requester, company, { amount: '100.00' });
    const task = await h.prisma.approvalTask.findFirstOrThrow({ where: { instanceId: instance.id, status: 'PENDING' } });
    await h.prisma.approvalTask.update({ where: { id: task.id }, data: { assigneeId: requester.id } });
    const client = await h.login(requester.email);
    const res = await client.post(`/approvals/tasks/${task.id}/decision`, { decision: 'APPROVE' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SEGREGATION_OF_DUTIES');
  });

  it('excludes maker/creator actors (maker-checker) from routing and decisions', async () => {
    const { company, requester, finance } = await setup();
    const admin = (await h.as(company, ['COMPANY_ADMIN'])).client;
    await publish(admin, {
      entityType: 'payment',
      name: 'Payment',
      requireIndependentApproval: true,
      distinctApproversAcrossStages: true,
      allowDelegation: false,
      excludeInitiatorFromAllStages: true,
      stages: [
        {
          sequence: 1,
          name: 'Checker',
          mode: 'ANY',
          minApprovals: 1,
          approverType: 'ROLE',
          approverRoleKey: 'FINANCE_MANAGER',
          departmentIds: [],
          categoryKeys: [],
        },
      ],
    });
    // The only finance manager is the payment maker → no independent checker.
    await expect(submit(requester, company, { entityType: 'payment', amount: '10.00', excludedUserIds: [finance.id] })).rejects.toMatchObject({
      code: 'APPROVAL_NO_ELIGIBLE_APPROVER',
    });
    const checker = await h.user(company, ['FINANCE_MANAGER']);
    const instance = await submit(requester, company, { entityType: 'payment', amount: '10.00', excludedUserIds: [finance.id] });
    const tasks = await h.prisma.approvalTask.findMany({ where: { instanceId: instance.id } });
    expect(tasks.map((t) => t.assigneeId)).toEqual([checker.id]);
  });

  it('requires a reason to reject, records it, and notifies the requester', async () => {
    const { company, head, requester } = await setup();
    const instance = await submit(requester, company, { amount: '100.00' });
    const task = (await pendingTaskFor(instance.id, head.id))!;
    const client = await h.login(head.email);
    const noReason = await client.post(`/approvals/tasks/${task.id}/decision`, { decision: 'REJECT' });
    expect(noReason.status).toBe(422);
    const res = await client.post(`/approvals/tasks/${task.id}/decision`, { decision: 'REJECT', reason: 'Not budgeted' });
    expect(res.body.status).toBe('REJECTED');
    expect(res.body.outcomeReason).toBe('Not budgeted');
    expect(outcomes).toContainEqual({ entityId: instance.entityId, outcome: 'rejected' });
    const again = await client.post(`/approvals/tasks/${task.id}/decision`, { decision: 'APPROVE' });
    expect(again.body.error.code).toBe('INVALID_STATE');
  });

  it('supports return-for-clarification and resubmission with full history', async () => {
    const { company, head, requester } = await setup();
    const entityId = randomUUID();
    const first = await submit(requester, company, { amount: '100.00', entityId });
    const client = await h.login(head.email);
    await client.post(`/approvals/tasks/${(await pendingTaskFor(first.id, head.id))!.id}/decision`, { decision: 'RETURN', reason: 'Attach quote' });
    expect(outcomes).toContainEqual({ entityId, outcome: 'returned' });
    const second = await submit(requester, company, { amount: '100.00', entityId });
    expect(second.id).not.toBe(first.id);
    expect(await h.prisma.approvalInstance.count({ where: { entityId } })).toBe(2);
  });

  it('allows only one pending approval per record', async () => {
    const { company, requester } = await setup();
    const entityId = randomUUID();
    await submit(requester, company, { amount: '1.00', entityId });
    await expect(submit(requester, company, { amount: '1.00', entityId })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('applies active delegations at routing and supports task delegation', async () => {
    const { company, head, requester } = await setup();
    const deputy = await h.user(company, ['APPROVER']);
    const headClient = await h.login(head.email);
    const now = Date.now();
    const d = await headClient.post('/approvals/delegations', {
      delegateId: deputy.id,
      validFrom: new Date(now - 60_000).toISOString(),
      validUntil: new Date(now + 3600_000).toISOString(),
      entityTypes: ['purchase_order'],
      reason: 'On leave',
    });
    expect(d.status).toBe(201);
    const instance = await submit(requester, company, { amount: '100.00' });
    const task = await h.prisma.approvalTask.findFirstOrThrow({ where: { instanceId: instance.id } });
    expect(task.assigneeId).toBe(deputy.id);
    expect(task.delegatedFromId).toBe(head.id);

    // The deputy delegates onwards — but never to the requester.
    const deputyClient = await h.login(deputy.email);
    const toRequester = await deputyClient.post(`/approvals/tasks/${task.id}/delegate`, { toUserId: requester.id, reason: 'x' });
    expect(toRequester.body.error.code).toBe('SEGREGATION_OF_DUTIES');
  });

  it('enforces distinct approvers across stages', async () => {
    const company = await h.company();
    const admin = (await h.as(company, ['COMPANY_ADMIN'])).client;
    const both = await h.user(company, ['APPROVER', 'FINANCE_MANAGER']);
    const finance2 = await h.user(company, ['FINANCE_MANAGER']);
    const requester = await h.user(company, ['REQUESTER']);
    await publish(admin, {
      entityType: 'purchase_order',
      name: 'Distinct',
      requireIndependentApproval: true,
      distinctApproversAcrossStages: true,
      allowDelegation: false,
      excludeInitiatorFromAllStages: true,
      stages: [
        { sequence: 1, name: 'Approver', mode: 'ANY', minApprovals: 1, approverType: 'ROLE', approverRoleKey: 'APPROVER', departmentIds: [], categoryKeys: [] },
        {
          sequence: 2,
          name: 'Finance',
          mode: 'ANY',
          minApprovals: 1,
          approverType: 'ROLE',
          approverRoleKey: 'FINANCE_MANAGER',
          departmentIds: [],
          categoryKeys: [],
        },
      ],
    });
    const instance = await submit(requester, company, { amount: '1.00' });
    const bothClient = await h.login(both.email);
    await bothClient.post(`/approvals/tasks/${(await pendingTaskFor(instance.id, both.id))!.id}/decision`, { decision: 'APPROVE' });
    // `both` is not routed again in stage 2; finance2 is.
    expect(await pendingTaskFor(instance.id, both.id)).toBeNull();
    expect(await pendingTaskFor(instance.id, finance2.id)).toBeTruthy();
  });

  it('serialises concurrent decisions (ALL-mode stage cannot double-complete)', async () => {
    const company = await h.company();
    const admin = (await h.as(company, ['COMPANY_ADMIN'])).client;
    const f1 = await h.user(company, ['FINANCE_MANAGER']);
    const f2 = await h.user(company, ['FINANCE_MANAGER']);
    const requester = await h.user(company, ['REQUESTER']);
    await publish(admin, {
      entityType: 'purchase_order',
      name: 'Parallel ALL',
      requireIndependentApproval: true,
      distinctApproversAcrossStages: true,
      allowDelegation: false,
      excludeInitiatorFromAllStages: true,
      stages: [
        {
          sequence: 1,
          name: 'Both finance',
          mode: 'ALL',
          minApprovals: 1,
          approverType: 'ROLE',
          approverRoleKey: 'FINANCE_MANAGER',
          departmentIds: [],
          categoryKeys: [],
        },
      ],
    });
    const instance = await submit(requester, company, { amount: '1.00' });
    const [c1, c2] = [await h.login(f1.email), await h.login(f2.email)];
    const [t1, t2] = [(await pendingTaskFor(instance.id, f1.id))!, (await pendingTaskFor(instance.id, f2.id))!];
    const results = await Promise.all([
      c1.post(`/approvals/tasks/${t1.id}/decision`, { decision: 'APPROVE' }),
      c2.post(`/approvals/tasks/${t2.id}/decision`, { decision: 'APPROVE' }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const final = await h.prisma.approvalInstance.findUniqueOrThrow({ where: { id: instance.id } });
    expect(final.status).toBe('APPROVED');
    expect(await h.prisma.approvalEvent.count({ where: { instanceId: instance.id, type: 'instance_approved' } })).toBe(1);
  });

  it('escalates overdue tasks once (idempotent)', async () => {
    const { company, head, director, requester } = await setup();
    const instance = await submit(requester, company, { amount: '100.00' });
    await h.prisma.approvalTask.updateMany({ where: { instanceId: instance.id, assigneeId: head.id }, data: { dueAt: new Date(Date.now() - 1000) } });
    const engine = h.app.get(ApprovalEngine);
    expect((await engine.escalateOverdue(company.id)).escalated).toBe(1);
    expect((await engine.escalateOverdue(company.id)).escalated).toBe(0);
    expect(await pendingTaskFor(instance.id, director.id)).toMatchObject({ isEscalation: true });
  });

  it('versions policies: publishing retires the previous version and in-flight approvals keep theirs', async () => {
    const { company, admin, requester } = await setup();
    const before = await submit(requester, company, { amount: '100.00' });
    const active = (await admin.get('/approval-policies?entityType=purchase_order')).body.items.find((p: { status: string }) => p.status === 'ACTIVE');
    const clone = await admin.post(`/approval-policies/${active.id}/clone`);
    expect(clone.body.policyVersion).toBe(active.policyVersion + 1);
    await admin.post(`/approval-policies/${clone.body.id}/publish`, { reason: 'v2' });
    const statuses = (await admin.get('/approval-policies?entityType=purchase_order')).body.items.map((p: { id: string; status: string }) => [p.id, p.status]);
    expect(statuses).toContainEqual([active.id, 'RETIRED']);
    expect(statuses).toContainEqual([clone.body.id, 'ACTIVE']);
    expect((await h.prisma.approvalInstance.findUniqueOrThrow({ where: { id: before.id } })).policyId).toBe(active.id);
    const editActive = await admin.put(`/approval-policies/${clone.body.id}`, { ...clone.body, version: 99 });
    expect(editActive.status).toBeGreaterThanOrEqual(400);
  });

  it('simulates the chain without creating anything', async () => {
    const { company, admin, requester, head, finance } = await setup();
    const active = (await admin.get('/approval-policies?entityType=purchase_order')).body.items.find((p: { status: string }) => p.status === 'ACTIVE');
    const count = await h.prisma.approvalInstance.count({ where: { companyId: company.id } });
    const sim = await admin.post(`/approval-policies/${active.id}/simulate`, { amount: '20000', requesterId: requester.id });
    expect(sim.body.ok).toBe(true);
    expect(sim.body.stages.map((s: { approvers: Array<{ user: { id: string } }> }) => s.approvers[0]!.user.id)).toEqual([head.id, finance.id]);
    expect(await h.prisma.approvalInstance.count({ where: { companyId: company.id } })).toBe(count);
  });

  it('hides approvals from uninvolved users and other companies', async () => {
    const { company, requester } = await setup();
    const instance = await submit(requester, company, { amount: '100.00' });
    const outsider = (await h.as(company, ['REQUESTER'])).client;
    expect((await outsider.get(`/approvals/instances/${instance.id}`)).status).toBe(404);
    const other = await h.company();
    const foreign = (await h.as(other, ['COMPANY_ADMIN'])).client;
    expect((await foreign.get(`/approvals/instances/${instance.id}`)).status).toBe(404);
    const reqClient = await h.login(requester.email);
    expect((await reqClient.get(`/approvals/instances/${instance.id}`)).status).toBe(200);
  });
});
