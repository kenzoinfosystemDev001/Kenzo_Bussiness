import { totp } from '../../src/infrastructure/crypto/totp';
import { Harness, ORIGIN, PASSWORD, type TestCompany } from './harness';

describe('Authentication & sessions', () => {
  const h = new Harness();
  let company: TestCompany;

  beforeAll(async () => {
    await h.start();
    company = await h.company();
  });
  afterAll(() => h.stop());

  it('logs in with an HttpOnly, SameSite session cookie and returns a CSRF token', async () => {
    const user = await h.user(company, ['REQUESTER']);
    const res = await h.http.post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mfaRequired: false, csrfToken: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const session = cookies.find((c) => c.startsWith('kk_session='))!;
    expect(session).toMatch(/HttpOnly/);
    expect(session).toMatch(/SameSite=Lax/);
    expect(cookies.find((c) => c.startsWith('kk_csrf='))).not.toMatch(/HttpOnly/);
    // The raw token is never stored — only its hash.
    const token = session.split(';')[0]!.split('=')[1]!;
    expect(await h.prisma.session.count({ where: { tokenHash: token } })).toBe(0);
  });

  it('returns an identical error for unknown email and wrong password (no enumeration)', async () => {
    const user = await h.user(company, ['REQUESTER']);
    const a = await h.http.post('/api/v1/auth/login').send({ email: user.email, password: 'wrong-password-123' });
    const b = await h.http.post('/api/v1/auth/login').send({ email: 'nobody@example.test', password: 'wrong-password-123' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(a.body.error.message).toBe(b.body.error.message);
    expect(a.body.error.correlationId).toBeTruthy();
  });

  it('locks the account after repeated failures and audits it', async () => {
    const user = await h.user(company, ['REQUESTER']);
    for (let i = 0; i < 5; i++) await h.http.post('/api/v1/auth/login').send({ email: user.email, password: 'wrong-password-123' });
    const res = await h.http.post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(423);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(await h.prisma.auditEvent.count({ where: { entityId: user.id, action: 'auth.account.locked' } })).toBe(1);
  });

  it('rejects inactive and invited users with the generic credential error', async () => {
    const invited = await h.user(company, ['REQUESTER'], { status: 'INVITED' });
    const res = await h.http.post('/api/v1/auth/login').send({ email: invited.email, password: PASSWORD });
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('requires authentication on protected routes', async () => {
    const res = await h.http.get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('requires a valid CSRF token for authenticated state-changing requests', async () => {
    const { client } = await h.as(company, ['REQUESTER']);
    const noToken = await client.agent.post('/api/v1/auth/sessions/revoke-others').send({});
    expect(noToken.status).toBe(403);
    expect(noToken.body.error.code).toBe('CSRF_INVALID');
    const badToken = await client.agent.post('/api/v1/auth/sessions/revoke-others').set('x-csrf-token', 'a'.repeat(64)).send({});
    expect(badToken.body.error.code).toBe('CSRF_INVALID');
    const ok = await client.post('/auth/sessions/revoke-others');
    expect(ok.status).toBe(201);
  });

  it('rejects state-changing requests from a foreign Origin, including login', async () => {
    const user = await h.user(company, ['REQUESTER']);
    const res = await h.http.post('/api/v1/auth/login').set('Origin', 'https://evil.example').send({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
    const ok = await h.http.post('/api/v1/auth/login').set('Origin', ORIGIN).send({ email: user.email, password: PASSWORD });
    expect(ok.status).toBe(200);
  });

  it('exposes the effective permission set on /auth/me', async () => {
    const { client } = await h.as(company, ['FINANCE_EXECUTIVE']);
    const me = await client.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.roleKeys).toEqual(['FINANCE_EXECUTIVE']);
    expect(me.body.permissions['payment.create']).toBe('COMPANY');
    expect(me.body.permissions['payment.release']).toBeUndefined();
  });

  it('logout revokes the server-side session', async () => {
    const { client } = await h.as(company, ['REQUESTER']);
    expect((await client.post('/auth/logout')).status).toBe(204);
    const after = await client.get('/auth/me');
    expect(after.status).toBe(401);
  });

  it('lists and revokes own sessions', async () => {
    const user = await h.user(company, ['REQUESTER']);
    const first = await h.login(user.email);
    const second = await h.login(user.email);
    const list = await first.get('/auth/sessions');
    expect(list.body.items).toHaveLength(2);
    const other = list.body.items.find((s: { current: boolean }) => !s.current);
    expect((await first.delete(`/auth/sessions/${other.id}`)).status).toBe(204);
    expect((await second.get('/auth/me')).status).toBe(401);
    expect((await first.get('/auth/me')).status).toBe(200);
  });

  it('resets a password via a single-use emailed token and revokes all sessions', async () => {
    const user = await h.user(company, ['REQUESTER']);
    const existing = await h.login(user.email);
    const res = await h.http.post('/api/v1/auth/password/forgot').send({ email: user.email });
    expect(res.status).toBe(202);
    // Unknown email gets the same response.
    const unknown = await h.http.post('/api/v1/auth/password/forgot').send({ email: 'ghost@example.test' });
    expect(unknown.status).toBe(202);
    expect(unknown.body).toEqual(res.body);

    await h.flushOutbox();
    const mail = h.mail.sent.filter((m) => m.to === user.email && m.template === 'auth.password_reset').pop()!;
    const token = /token=([A-Za-z0-9_-]+)/.exec(mail.text)![1]!;

    const newPassword = 'Another-Strong-Pass-42';
    expect((await h.http.post('/api/v1/auth/password/reset').send({ token, password: newPassword })).status).toBe(204);
    expect((await existing.get('/auth/me')).status).toBe(401);
    const reuse = await h.http.post('/api/v1/auth/password/reset').send({ token, password: 'Yet-Another-Pass-77' });
    expect(reuse.body.error.code).toBe('TOKEN_INVALID');
    await h.login(user.email, newPassword);
  });

  it('enforces the password policy server-side', async () => {
    const { client } = await h.as(company, ['REQUESTER']);
    const res = await client.post('/auth/password/change', { currentPassword: PASSWORD, newPassword: 'short' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.fieldErrors[0].path).toBe('newPassword');
  });

  it('enrols TOTP MFA and then requires the second factor at login', async () => {
    const { user, client } = await h.as(company, ['COMPANY_ADMIN']);
    const setup = await client.post('/auth/mfa/totp/setup');
    expect(setup.status).toBe(201);
    expect(setup.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    const bad = await client.post('/auth/mfa/totp/confirm', { code: '000000' });
    expect(bad.body.error.code).toBe('MFA_INVALID');
    expect((await client.post('/auth/mfa/totp/confirm', { code: totp(setup.body.secret) })).status).toBe(204);
    // Secret is stored encrypted, never in clear.
    const row = await h.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.mfaSecretEnc).toMatch(/^v1\./);
    expect(row.mfaSecretEnc).not.toContain(setup.body.secret);

    const second = await h.login(user.email);
    const me = await second.get('/auth/me');
    expect(me.body.mfa.pending).toBe(true);
    const blocked = await second.get('/users');
    expect(blocked.body.error.code).toBe('MFA_REQUIRED');
    expect((await second.post('/auth/mfa/verify', { code: totp(setup.body.secret) })).status).toBe(204);
    expect((await second.get('/users')).status).toBe(200);
  });

  it('blocks privileged permissions without MFA when the company enforces it', async () => {
    const c2 = await h.company();
    await h.prisma.company.update({ where: { id: c2.id }, data: { enforceMfaForPrivileged: true } });
    const { client } = await h.as(c2, ['COMPANY_ADMIN']);
    // role.manage requires MFA; role.read does not.
    expect((await client.get('/roles')).status).toBe(200);
    const res = await client.post('/roles', { key: 'CUSTOM_X', name: 'X', permissions: [] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MFA_REQUIRED');
  });

  it('accepts an invitation once and activates the account', async () => {
    const { client } = await h.as(company, ['COMPANY_ADMIN']);
    const email = `${h.uid('inv').toLowerCase()}@example.test`;
    const invite = await client.post('/users/invitations', {
      email,
      fullName: 'Invited Person',
      roleAssignments: [{ roleId: company.roleIds.get('REQUESTER') }],
    });
    expect(invite.status).toBe(201);
    expect(invite.body.status).toBe('INVITED');
    await h.flushOutbox();
    const mail = h.mail.sent.filter((m) => m.to === email).pop()!;
    const token = /token=([A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
    const describe = await h.http.post('/api/v1/auth/tokens/describe').send({ token, type: 'INVITATION' });
    expect(describe.body.email).toBe(email);
    expect((await h.http.post('/api/v1/auth/invitations/accept').send({ token, password: 'Fresh-Strong-Pass-11' })).status).toBe(204);
    expect((await h.http.post('/api/v1/auth/invitations/accept').send({ token, password: 'Fresh-Strong-Pass-11' })).body.error.code).toBe('TOKEN_INVALID');
    await h.login(email, 'Fresh-Strong-Pass-11');
  });

  it('deactivation immediately revokes sessions and blocks login', async () => {
    const { client: admin } = await h.as(company, ['COMPANY_ADMIN']);
    const { user, client } = await h.as(company, ['REQUESTER']);
    const res = await admin.post(`/users/${user.id}/deactivate`, { reason: 'Left the company' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('DEACTIVATED');
    expect((await client.get('/auth/me')).status).toBe(401);
    const login = await h.http.post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD });
    expect(login.status).toBe(401);
    const audit = await h.prisma.auditEvent.findFirst({ where: { entityId: user.id, action: 'user.deactivated' } });
    expect(audit?.reason).toBe('Left the company');
  });

  it('prevents an administrator from deactivating themselves', async () => {
    const { user, client } = await h.as(company, ['COMPANY_ADMIN']);
    const res = await client.post(`/users/${user.id}/deactivate`, { reason: 'test' });
    expect(res.body.error.code).toBe('INVALID_STATE');
  });
});
