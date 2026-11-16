import { Harness, type TestCompany } from './harness';

describe('RBAC, company isolation and anti-escalation', () => {
  const h = new Harness();
  let a: TestCompany;
  let b: TestCompany;

  beforeAll(async () => {
    await h.start();
    [a, b] = [await h.company(), await h.company()];
  });
  afterAll(() => h.stop());

  it('denies routes without the required permission and audits the denial', async () => {
    const { user, client } = await h.as(a, ['REQUESTER']);
    for (const path of ['/users', '/roles', '/audit-events', '/approval-policies', '/integrations']) {
      const res = await client.get(path);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    const denials = await h.prisma.auditEvent.count({ where: { actorId: user.id, action: 'authz.denied', outcome: 'DENIED' } });
    expect(denials).toBe(5);
  });

  it('an auditor can read but cannot write', async () => {
    const { client } = await h.as(a, ['AUDITOR']);
    expect((await client.get('/audit-events')).status).toBe(200);
    expect((await client.get('/users')).status).toBe(200);
    expect((await client.post('/departments', { code: 'X1', name: 'X' })).status).toBe(403);
    expect((await client.post('/users/invitations', { email: 'x@example.test', fullName: 'X' })).status).toBe(403);
  });

  it('never returns another company’s records (lists and direct IDs)', async () => {
    const { client: adminA } = await h.as(a, ['COMPANY_ADMIN']);
    const userB = await h.user(b, ['REQUESTER']);
    const deptB = b.departments.eng;

    const list = await adminA.get('/users?limit=100');
    expect(list.body.items.map((u: { id: string }) => u.id)).not.toContain(userB.id);
    const direct = await adminA.get(`/users/${userB.id}`);
    expect(direct.status).toBe(404);
    expect((await adminA.patch(`/departments/${deptB}`, { name: 'Hijacked', version: 0 })).status).toBe(404);
    expect((await adminA.post(`/users/${userB.id}/deactivate`, { reason: 'x' })).status).toBe(404);
    const roleB = b.roleIds.get('REQUESTER')!;
    expect((await adminA.get(`/roles/${roleB}`)).status).toBe(404);
    const depts = await adminA.get('/departments');
    expect(depts.body.items.every((d: { companyId: string }) => d.companyId === a.id)).toBe(true);
  });

  it('cannot switch into a company without an active assignment', async () => {
    const { client } = await h.as(a, ['COMPANY_ADMIN']);
    const res = await client.post('/auth/switch-company', { companyId: b.id });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('COMPANY_ACCESS_DENIED');
  });

  it('switches company when assigned to both, and permissions follow the active company', async () => {
    const user = await h.user(a, ['COMPANY_ADMIN']);
    await h.prisma.userRoleAssignment.create({ data: { companyId: b.id, userId: user.id, roleId: b.roleIds.get('REQUESTER')! } });
    const client = await h.login(user.email);
    expect((await client.get('/users')).status).toBe(200);
    expect((await client.post('/auth/switch-company', { companyId: b.id })).status).toBe(204);
    const me = await client.get('/auth/me');
    expect(me.body.company.id).toBe(b.id);
    expect((await client.get('/users')).status).toBe(403);
  });

  it('applies DEPARTMENT scope to user listings', async () => {
    const head = await h.user(a, ['DEPARTMENT_HEAD'], { departmentId: a.departments.eng });
    const engMember = await h.user(a, ['REQUESTER'], { departmentId: a.departments.eng });
    const finMember = await h.user(a, ['REQUESTER'], { departmentId: a.departments.fin });
    const client = await h.login(head.email);
    const ids = (await client.get('/users?limit=100')).body.items.map((u: { id: string }) => u.id);
    expect(ids).toContain(engMember.id);
    expect(ids).not.toContain(finMember.id);
    expect((await client.get(`/users/${finMember.id}`)).status).toBe(403);
  });

  it('expired time-bound assignments grant nothing', async () => {
    const user = await h.user(a, []);
    await h.prisma.userRoleAssignment.create({
      data: {
        companyId: a.id,
        userId: user.id,
        roleId: a.roleIds.get('AUDITOR')!,
        validFrom: new Date(Date.now() - 7200_000),
        validUntil: new Date(Date.now() - 3600_000),
      },
    });
    await h.prisma.userRoleAssignment.create({ data: { companyId: a.id, userId: user.id, roleId: a.roleIds.get('REQUESTER')! } });
    const client = await h.login(user.email);
    expect((await client.get('/audit-events')).status).toBe(403);
  });

  it('prevents privilege escalation: administrative power cannot be granted beyond your own', async () => {
    const { client } = await h.as(a, ['COMPANY_ADMIN']);
    const target = await h.user(a, ['REQUESTER']);
    const superAdmin = await client.post(`/users/${target.id}/role-assignments`, { roleId: a.roleIds.get('SUPER_ADMIN') });
    expect(superAdmin.status).toBe(403);
    expect(superAdmin.body.error.details.permissions).toContain('platform.company.create');
    // Business roles are assignable by role.assign holders — and the grant is audited.
    const finance = await client.post(`/users/${target.id}/role-assignments`, { roleId: a.roleIds.get('FINANCE_MANAGER') });
    expect(finance.status).toBe(201);
    expect(await h.prisma.auditEvent.count({ where: { entityId: target.id, action: 'role.assigned' } })).toBe(1);

    // A Department Head (no role.assign) cannot assign anything.
    const { client: head } = await h.as(a, ['DEPARTMENT_HEAD']);
    expect((await head.post(`/users/${target.id}/role-assignments`, { roleId: a.roleIds.get('AUDITOR') })).status).toBe(403);
  });

  it('nobody can change their own role assignments', async () => {
    const { user, client } = await h.as(a, ['SUPER_ADMIN']);
    const res = await client.post(`/users/${user.id}/role-assignments`, { roleId: a.roleIds.get('AUDITOR') });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SEGREGATION_OF_DUTIES');
  });

  it('custom roles cannot include administrative permissions the creator lacks; system roles are immutable', async () => {
    const { client } = await h.as(a, ['COMPANY_ADMIN']);
    const bad = await client.post('/roles', { key: 'PLATFORM_X', name: 'Platform', permissions: [{ key: 'platform.company.create', scope: 'COMPANY' }] });
    expect(bad.status).toBe(403);
    const good = await client.post('/roles', { key: 'ORG_EDITOR', name: 'Org editor', permissions: [{ key: 'org.department.manage', scope: 'COMPANY' }] });
    expect(good.status).toBe(201);
    const sys = await client.patch(`/roles/${a.roleIds.get('REQUESTER')}`, { name: 'Renamed', reason: 'x' });
    expect(sys.body.error.code).toBe('INVALID_STATE');
  });

  it('keeps at least one Super Admin per company', async () => {
    const fresh = await h.company();
    const only = await h.user(fresh, ['SUPER_ADMIN']);
    const { client } = await h.as(fresh, ['COMPANY_ADMIN']);
    const assignment = await h.prisma.userRoleAssignment.findFirstOrThrow({ where: { userId: only.id, role: { key: 'SUPER_ADMIN' } } });
    const res = await client.post(`/users/role-assignments/${assignment.id}/revoke`, { reason: 'test' });
    expect(res.body.error.code).toBe('INVALID_STATE');
  });

  it('records audit events for administrative changes with before/after hashes', async () => {
    const { client } = await h.as(a, ['COMPANY_ADMIN']);
    const res = await client.post('/departments', { code: h.uid('D'), name: 'Audit Dept' });
    expect(res.status).toBe(201);
    const ev = await h.prisma.auditEvent.findFirstOrThrow({ where: { entityId: res.body.id, action: 'department.created' } });
    expect(ev.companyId).toBe(a.id);
    expect(ev.afterHash).toMatch(/^[a-f0-9]{64}$/);
    expect(ev.correlationId).toBeTruthy();
  });

  it('uses optimistic concurrency for edits', async () => {
    const { client } = await h.as(a, ['COMPANY_ADMIN']);
    const dept = (await client.post('/departments', { code: h.uid('C'), name: 'Concurrent' })).body;
    expect((await client.patch(`/departments/${dept.id}`, { name: 'First', version: 0 })).status).toBe(200);
    const stale = await client.patch(`/departments/${dept.id}`, { name: 'Second', version: 0 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('strips unknown fields (no mass assignment of companyId/status)', async () => {
    const { client } = await h.as(a, ['COMPANY_ADMIN']);
    const res = await client.post('/departments', { code: h.uid('M'), name: 'Mass', companyId: b.id, isActive: false });
    expect(res.status).toBe(201);
    expect(res.body.companyId).toBe(a.id);
  });
});
