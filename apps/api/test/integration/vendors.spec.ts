import { randomInt } from 'node:crypto';
import { gstinWithChecksum } from '@kenzo/shared';
import { VendorDocumentsService } from '../../src/modules/vendors/vendor-documents.service';
import { Harness, type Client, type TestCompany, type TestUser } from './harness';

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(300, 0x20), Buffer.from('\n%%EOF')]);
const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function randomPan(): string {
  const letters = Array.from({ length: 5 }, () => L[randomInt(26)]).join('');
  return `${letters}${String(randomInt(10000)).padStart(4, '0')}${L[randomInt(26)]}`;
}
function gstinFor(pan: string, stateCode = '29'): string {
  return gstinWithChecksum(`${stateCode}${pan}1Z`);
}
function accountNo(): string {
  return `${randomInt(100000, 999999)}${randomInt(100000, 999999)}`;
}
const isoIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

interface World {
  company: TestCompany;
  admin: Client;
  exec: { user: TestUser; client: Client };
  mgr: { user: TestUser; client: Client };
  fin: { user: TestUser; client: Client };
}

describe('Vendor management (Phase 02)', () => {
  const h = new Harness();

  beforeAll(() => h.start());
  afterAll(() => h.stop());

  async function publishPolicy(admin: Client, entityType: string) {
    const list = await admin.get(`/approval-policies?entityType=${entityType}`);
    const draft = list.body.items.find((p: { status: string }) => p.status === 'DRAFT');
    expect(draft).toBeTruthy();
    expect((await admin.post(`/approval-policies/${draft.id}/publish`, { reason: 'Approved by finance for tests' })).status).toBe(200);
  }

  async function world(): Promise<World> {
    const company = await h.company();
    const admin = (await h.as(company, ['COMPANY_ADMIN'])).client;
    await publishPolicy(admin, 'vendor');
    await publishPolicy(admin, 'vendor_bank_change');
    return {
      company,
      admin,
      exec: await h.as(company, ['PROCUREMENT_EXECUTIVE']),
      mgr: await h.as(company, ['PROCUREMENT_MANAGER']),
      fin: await h.as(company, ['FINANCE_MANAGER']),
    };
  }

  function vendorInput(overrides: Record<string, unknown> = {}) {
    const pan = randomPan();
    return {
      legalName: `Acme ${h.uid()} Technologies Pvt Ltd`,
      tradeName: 'Acme',
      vendorType: 'GOODS_SUPPLIER',
      category: 'IT hardware',
      gstRegistrationType: 'REGISTERED',
      gstin: gstinFor(pan),
      pan,
      addressLine1: '12 MG Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560001',
      country: 'IN',
      paymentTermsDays: 45,
      preferredCurrency: 'INR',
      email: 'accounts@acme.example',
      contacts: [{ name: 'Priya Sharma', email: 'priya@acme.example', phone: '+91 98450 00000', isPrimary: true }],
      ...overrides,
    };
  }

  const bank = (n = accountNo()) => ({
    accountHolderName: 'Acme Technologies',
    bankName: 'HDFC Bank',
    ifsc: 'HDFC0001234',
    accountType: 'CURRENT',
    accountNumber: n,
  });

  async function upload(client: Client, vendorId: string, documentType: string, extra: Record<string, string> = {}) {
    let req = client.agent.post(`/api/v1/vendors/${vendorId}/documents`).set('x-csrf-token', client.csrf).attach('file', PDF, `${documentType}.pdf`);
    req = req.field('documentType', documentType).field('title', documentType.replace(/_/g, ' '));
    for (const [k, v] of Object.entries(extra)) req = req.field(k, v);
    return req;
  }

  async function taskFor(vendorOrRequestId: string, userId: string) {
    return h.prisma.approvalTask.findFirst({ where: { assigneeId: userId, status: 'PENDING', instance: { entityId: vendorOrRequestId } } });
  }

  /** Creates a vendor with docs + bank, submits it, and runs both approval stages. */
  async function approvedVendor(w: World, input = vendorInput(), withBank = true) {
    const created = await w.exec.client.post('/vendors', { ...input, ...(withBank ? { bankAccount: bank() } : {}) });
    expect(created.status).toBe(201);
    const id = created.body.vendor.id as string;
    for (const t of ['PAN_CARD', 'GST_CERTIFICATE', ...(withBank ? ['BANK_PROOF'] : [])]) expect((await upload(w.exec.client, id, t)).status).toBe(201);
    expect((await w.exec.client.post(`/vendors/${id}/submit`, {})).status).toBe(200);
    for (const approver of [w.mgr, w.fin]) {
      const task = await taskFor(id, approver.user.id);
      expect(task).toBeTruthy();
      expect((await approver.client.post(`/approvals/tasks/${task!.id}/decision`, { decision: 'APPROVE' })).status).toBe(200);
    }
    return id;
  }

  async function verifyAll(verifier: Client, vendorId: string) {
    const v = await verifier.get(`/vendors/${vendorId}`);
    for (const d of v.body.documents.filter((x: { isCurrent: boolean; verificationStatus: string }) => x.isCurrent && x.verificationStatus === 'PENDING')) {
      expect((await verifier.post(`/vendors/${vendorId}/documents/${d.id}/verify`, { decision: 'VERIFIED' })).status).toBe(200);
    }
  }

  // ── Creation & validation ────────────────────────────────────────────────
  it('creates a draft vendor with a generated code, normalised name and encrypted PAN', async () => {
    const w = await world();
    // Unregistered vendor: the PAN appears nowhere else (a GSTIN legally embeds the PAN).
    const input = vendorInput({ gstRegistrationType: 'UNREGISTERED', gstin: null });
    const res = await w.exec.client.post('/vendors', input);
    expect(res.status).toBe(201);
    expect(res.body.vendor).toMatchObject({ status: 'DRAFT', gstin: null, stateCode: '29', panMasked: expect.stringMatching(/^•+/) });
    expect(res.body.vendor.vendorCode).toMatch(/^VEN-\d{4}-\d{2}-\d{6}$/);
    expect(JSON.stringify(res.body)).not.toContain(input.pan);
    const row = await h.prisma.vendor.findUniqueOrThrow({ where: { id: res.body.vendor.id } });
    expect(row.normalizedName).toMatch(/^acme .* technologies$/);
    expect(row.panEnc).toMatch(/^v1\./);
    expect(row.panEnc).not.toContain(input.pan);
    const history = await h.prisma.vendorStatusHistory.findMany({ where: { vendorId: row.id } });
    expect(history).toHaveLength(1);
  });

  it('enforces required and conditional fields server-side', async () => {
    const w = await world();
    const missing = await w.exec.client.post('/vendors', vendorInput({ gstin: null }));
    expect(missing.status).toBe(422);
    expect(missing.body.error.fieldErrors.map((f: { path: string }) => f.path)).toContain('gstin');

    const pan = randomPan();
    const badChecksum = gstinFor(pan).slice(0, 14) + (gstinFor(pan).endsWith('A') ? 'B' : 'A');
    expect((await w.exec.client.post('/vendors', vendorInput({ pan, gstin: badChecksum }))).body.error.fieldErrors[0].message).toMatch(/check digit/);

    const mismatch = await w.exec.client.post('/vendors', vendorInput({ gstin: gstinFor(randomPan()) }));
    expect(mismatch.body.error.fieldErrors.map((f: { path: string }) => f.path)).toContain('pan');

    const wrongState = await w.exec.client.post('/vendors', vendorInput({ state: 'Maharashtra' }));
    expect(wrongState.body.error.fieldErrors[0].message).toMatch(/state code 29/);

    const overseasWithGst = await w.exec.client.post('/vendors', vendorInput({ gstRegistrationType: 'OVERSEAS', country: 'SG' }));
    expect(overseasWithGst.body.error.fieldErrors.map((f: { path: string }) => f.path)).toContain('gstin');

    const overseas = await w.exec.client.post(
      '/vendors',
      vendorInput({
        gstRegistrationType: 'OVERSEAS',
        gstin: null,
        pan: null,
        country: 'SG',
        state: 'Singapore',
        postalCode: '018989',
        preferredCurrency: 'USD',
      }),
    );
    expect(overseas.status).toBe(201);

    const msme = await w.exec.client.post('/vendors', vendorInput({ msmeRegistered: true, msmeNumber: 'BAD' }));
    expect(msme.body.error.fieldErrors.map((f: { path: string }) => f.path)).toContain('msmeNumber');

    const badBank = await w.exec.client.post('/vendors', vendorInput({ bankAccount: { ...bank(), ifsc: 'XX12', accountNumber: '12' } }));
    expect([...new Set(badBank.body.error.fieldErrors.map((f: { path: string }) => f.path))].sort()).toEqual(['bankAccount.accountNumber', 'bankAccount.ifsc']);
  });

  it('restricts vendor access by role', async () => {
    const w = await world();
    const { client: requester } = await h.as(w.company, ['REQUESTER']);
    expect((await requester.get('/vendors')).status).toBe(403);
    expect((await requester.post('/vendors', vendorInput())).status).toBe(403);
    const { client: auditor } = await h.as(w.company, ['AUDITOR']);
    expect((await auditor.get('/vendors')).status).toBe(200);
    expect((await auditor.post('/vendors', vendorInput())).status).toBe(403);
    const { client: finExec } = await h.as(w.company, ['FINANCE_EXECUTIVE']);
    expect((await finExec.post('/vendors', vendorInput())).status).toBe(403);
  });

  // ── Duplicate detection ──────────────────────────────────────────────────
  it('detects duplicates by GSTIN, PAN, bank account and name — and never merges', async () => {
    const w = await world();
    const pan = randomPan();
    const acct = accountNo();
    const first = await w.exec.client.post(
      '/vendors',
      vendorInput({ pan, gstin: gstinFor(pan), legalName: 'Zenith Logistics Private Limited', bankAccount: bank(acct) }),
    );
    expect(first.status).toBe(201);

    const check = await w.exec.client.post('/vendors/duplicate-check', { legalName: 'ZENITH LOGISTICS PVT. LTD.', pan, accountNumber: acct });
    const match = check.body.matches[0];
    expect(match.vendorId).toBe(first.body.vendor.id);
    expect(match.reasons.sort()).toEqual(['BANK_ACCOUNT', 'NAME_EXACT', 'PAN']);
    expect(match.strong).toBe(true);

    const similar = await w.exec.client.post('/vendors/duplicate-check', { legalName: 'Zenith Logistic Pvt Ltd' });
    expect(similar.body.matches[0]?.reasons).toContain('NAME_SIMILAR');

    // Same PAN, different state GSTIN → blocked without an override reason…
    const otherState = vendorInput({ pan, gstin: gstinFor(pan, '27'), state: 'Maharashtra', postalCode: '400001', legalName: 'Zenith West' });
    const blocked = await w.exec.client.post('/vendors', otherState);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.details.duplicates[0].reasons).toContain('PAN');
    // …allowed with a recorded reason (branch registration), never merged.
    const allowed = await w.exec.client.post('/vendors', { ...otherState, duplicateOverrideReason: 'Separate GST registration for the Mumbai branch' });
    expect(allowed.status).toBe(201);
    expect(await h.prisma.vendor.count({ where: { companyId: w.company.id, panFingerprint: { not: null }, legalName: { startsWith: 'Zenith' } } })).toBe(2);
    expect(await h.prisma.auditEvent.count({ where: { entityId: allowed.body.vendor.id, action: 'vendor.duplicate_override' } })).toBe(1);

    // An identical live GSTIN is never allowed, even with an override.
    const sameGstin = await w.exec.client.post(
      '/vendors',
      vendorInput({ pan, gstin: gstinFor(pan), legalName: 'Other Name', duplicateOverrideReason: 'trying' }),
    );
    expect(sameGstin.status).toBe(409);
  });

  // ── Lifecycle ────────────────────────────────────────────────────────────
  it('runs the full lifecycle with permission, state, actor, reason, history and audit on every transition', async () => {
    const w = await world();
    const created = await w.exec.client.post('/vendors', { ...vendorInput(), bankAccount: bank() });
    const id = created.body.vendor.id as string;

    // Submission requires the required documents.
    const early = await w.exec.client.post(`/vendors/${id}/submit`, {});
    expect(early.status).toBe(422);
    expect(early.body.error.fieldErrors.map((f: { path: string }) => f.path).sort()).toEqual([
      'documents.BANK_PROOF',
      'documents.GST_CERTIFICATE',
      'documents.PAN_CARD',
    ]);
    for (const t of ['PAN_CARD', 'GST_CERTIFICATE', 'BANK_PROOF']) await upload(w.exec.client, id, t);
    expect((await w.exec.client.post(`/vendors/${id}/submit`, {})).body.status).toBe('SUBMITTED');

    // Under review: profile is frozen; creator is excluded from approving.
    expect((await w.exec.client.patch(`/vendors/${id}`, { paymentTermsDays: 60, version: 99 })).body.error.code).toBe('INVALID_STATE');
    expect(await taskFor(id, w.exec.user.id)).toBeNull();
    expect((await w.mgr.client.post(`/vendors/${id}/start-review`)).body.status).toBe('UNDER_REVIEW');

    // Invalid transition is refused.
    expect((await w.mgr.client.post(`/vendors/${id}/activate`, {})).body.error.code).toBe('INVALID_STATE');

    for (const approver of [w.mgr, w.fin]) {
      const task = await taskFor(id, approver.user.id);
      await approver.client.post(`/approvals/tasks/${task!.id}/decision`, { decision: 'APPROVE' });
    }
    let v = (await w.mgr.client.get(`/vendors/${id}`)).body;
    expect(v.vendor.status).toBe('APPROVED');
    expect(v.bank.accounts[0]).toMatchObject({ status: 'ACTIVE', verifiedBy: { id: w.fin.user.id } });

    // Activation needs verified documents; the uploader cannot verify their own.
    expect((await w.mgr.client.post(`/vendors/${id}/activate`, {})).status).toBe(422);
    const docId = v.documents[0].id;
    const self = await w.exec.client.post(`/vendors/${id}/documents/${docId}/verify`, { decision: 'VERIFIED' });
    expect(self.status).toBe(403);
    await verifyAll(w.mgr.client, id);
    expect((await w.exec.client.post(`/vendors/${id}/activate`, {})).status).toBe(403); // no vendor.approve
    expect((await w.mgr.client.post(`/vendors/${id}/activate`, {})).body.status).toBe('ACTIVE');

    // Reasons are mandatory for suspension; history captures actor + reason.
    expect((await w.mgr.client.post(`/vendors/${id}/suspend`, {})).status).toBe(422);
    expect((await w.mgr.client.post(`/vendors/${id}/suspend`, { reason: 'Quality incident under investigation' })).body.status).toBe('SUSPENDED');
    expect((await w.mgr.client.post(`/vendors/${id}/reactivate`, { reason: 'Investigation closed, no fault found' })).body.status).toBe('ACTIVE');
    expect((await w.mgr.client.post(`/vendors/${id}/archive`, { reason: 'Contract ended permanently' })).body.status).toBe('ARCHIVED');
    expect((await w.mgr.client.post(`/vendors/${id}/reactivate`, { reason: 'Trying again' })).body.error.code).toBe('INVALID_STATE');

    v = (await w.mgr.client.get(`/vendors/${id}`)).body;
    const path = v.statusHistory.map((s: { toStatus: string }) => s.toStatus);
    expect(path).toEqual(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'ACTIVE', 'ARCHIVED']);
    const suspended = v.statusHistory.find((s: { toStatus: string }) => s.toStatus === 'SUSPENDED');
    expect(suspended).toMatchObject({ reason: 'Quality incident under investigation', actor: { id: w.mgr.user.id } });
    expect(await h.prisma.auditEvent.count({ where: { entityId: id, action: { startsWith: 'vendor.status.' } } })).toBe(7);
    await expect(h.prisma.vendorStatusHistory.deleteMany({ where: { vendorId: id } })).rejects.toThrow(/append-only/);
  });

  it('handles return for clarification, rejection and reopening', async () => {
    const w = await world();
    const created = await w.exec.client.post('/vendors', vendorInput());
    const id = created.body.vendor.id as string;
    for (const t of ['PAN_CARD', 'GST_CERTIFICATE']) await upload(w.exec.client, id, t);
    await w.exec.client.post(`/vendors/${id}/submit`, {});
    const t1 = await taskFor(id, w.mgr.user.id);
    await w.mgr.client.post(`/approvals/tasks/${t1!.id}/decision`, { decision: 'RETURN', reason: 'Add the registered office address' });
    let v = (await w.exec.client.get(`/vendors/${id}`)).body.vendor;
    expect(v.status).toBe('DRAFT');
    expect(v.statusReason).toMatch(/registered office/);

    await w.exec.client.post(`/vendors/${id}/submit`, {});
    const t2 = await taskFor(id, w.mgr.user.id);
    await w.mgr.client.post(`/approvals/tasks/${t2!.id}/decision`, { decision: 'REJECT', reason: 'Vendor failed background check' });
    v = (await w.exec.client.get(`/vendors/${id}`)).body.vendor;
    expect(v.status).toBe('REJECTED');
    expect((await w.exec.client.post(`/vendors/${id}/reopen`, { reason: 'New ownership documents received' })).body.status).toBe('DRAFT');
    expect(await h.prisma.notification.count({ where: { userId: w.exec.user.id, type: { in: ['vendor.returned', 'vendor.rejected'] } } })).toBe(2);
  });

  it('locks legal/tax identity after approval but allows operational edits', async () => {
    const w = await world();
    const id = await approvedVendor(w);
    const v = (await w.exec.client.get(`/vendors/${id}`)).body.vendor;
    const locked = await w.exec.client.patch(`/vendors/${id}`, { legalName: 'Renamed Ltd', version: v.version });
    expect(locked.body.error.details.lockedFields).toEqual(['legalName']);
    const ok = await w.exec.client.patch(`/vendors/${id}`, { paymentTermsDays: 60, website: 'https://acme.example', version: v.version });
    expect(ok.status).toBe(200);
    expect(ok.body.paymentTermsDays).toBe(60);
    const stale = await w.exec.client.patch(`/vendors/${id}`, { paymentTermsDays: 15, version: v.version });
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
  });

  // ── Bank security ────────────────────────────────────────────────────────
  it('masks bank data, encrypts it at rest and audits every reveal', async () => {
    const w = await world();
    const acct = accountNo();
    const created = await w.exec.client.post('/vendors', { ...vendorInput(), bankAccount: bank(acct) });
    const id = created.body.vendor.id as string;
    const view = await w.exec.client.get(`/vendors/${id}`);
    expect(JSON.stringify(view.body)).not.toContain(acct);
    expect(view.body.bank.accounts[0].accountMasked).toBe(`•••• •••• ${acct.slice(-4)}`);
    expect(view.body.bank.canReveal).toBe(false);

    const row = await h.prisma.vendorBankAccount.findFirstOrThrow({ where: { vendorId: id } });
    expect(row.accountNumberEnc).not.toContain(acct);

    const accountId = view.body.bank.accounts[0].id;
    expect((await w.exec.client.post(`/vendors/${id}/bank-accounts/${accountId}/reveal`, { reason: 'Need it' })).status).toBe(403);
    expect((await w.fin.client.post(`/vendors/${id}/bank-accounts/${accountId}/reveal`, {})).status).toBe(422);
    const reveal = await w.fin.client.post(`/vendors/${id}/bank-accounts/${accountId}/reveal`, { reason: 'Verifying against cancelled cheque' });
    expect(reveal.body.accountNumber).toBe(acct);
    const audit = await h.prisma.auditEvent.findFirstOrThrow({ where: { entityId: id, action: 'vendor.bank.revealed' } });
    expect(audit).toMatchObject({ actorId: w.fin.user.id, reason: 'Verifying against cancelled cheque' });
    const allAudit = await h.prisma.auditEvent.findMany({ where: { entityId: id } });
    expect(JSON.stringify(allAudit)).not.toContain(acct);

    const pan = await w.fin.client.post(`/vendors/${id}/pan/reveal`, { reason: 'TDS certificate preparation' });
    expect(pan.body.pan).toMatch(/^[A-Z]{5}\d{4}[A-Z]$/);
  });

  it('changes bank details only through maker-checker approval with history preserved', async () => {
    const w = await world();
    const id = await approvedVendor(w);
    const before = (await w.mgr.client.get(`/vendors/${id}`)).body.bank.accounts.find((a: { status: string }) => a.status === 'ACTIVE');

    // Bank details of an approved vendor cannot be overwritten directly.
    expect((await w.exec.client.post(`/vendors/${id}/bank-account`, bank())).body.error.code).toBe('INVALID_STATE');
    const newAcct = accountNo();
    const req = await w.exec.client.post(`/vendors/${id}/bank-change-requests`, { ...bank(newAcct), reason: 'Vendor moved to ICICI Bank' });
    expect(req.status).toBe(201);
    expect(JSON.stringify(req.body)).not.toContain(newAcct);
    // Second concurrent request is refused.
    expect((await w.exec.client.post(`/vendors/${id}/bank-change-requests`, { ...bank(), reason: 'Another change' })).body.error.code).toBe('INVALID_STATE');

    // Requester (= vendor creator) has no task; reviewers approve.
    expect(await taskFor(req.body.id, w.exec.user.id)).toBeNull();
    for (const approver of [w.mgr, w.fin]) {
      const task = await taskFor(req.body.id, approver.user.id);
      expect((await approver.client.post(`/approvals/tasks/${task!.id}/decision`, { decision: 'APPROVE' })).status).toBe(200);
    }
    const after = (await w.mgr.client.get(`/vendors/${id}`)).body.bank;
    expect(after.accounts.find((a: { id: string }) => a.id === before.id).status).toBe('SUPERSEDED');
    expect(after.accounts.find((a: { status: string }) => a.status === 'ACTIVE').accountLast4).toBe(newAcct.slice(-4));
    expect(after.changeRequests[0].status).toBe('APPROVED');
  });

  it('never lets the vendor creator be the sole approver of a bank change, and blocks accounts of other vendors', async () => {
    const w = await world();
    // Vendor created by the only Procurement Manager.
    const input = vendorInput();
    const created = await w.mgr.client.post('/vendors', { ...input, bankAccount: bank() });
    const id = created.body.vendor.id as string;
    for (const t of ['PAN_CARD', 'GST_CERTIFICATE', 'BANK_PROOF']) await upload(w.mgr.client, id, t);
    await w.mgr.client.post(`/vendors/${id}/submit`, {});
    // Creator excluded → no eligible procurement reviewer.
    expect(await taskFor(id, w.mgr.user.id)).toBeNull();

    const w2 = await world();
    const vid = await approvedVendor(w2);
    const otherAcct = accountNo();
    const other = await w2.exec.client.post('/vendors', vendorInput({ bankAccount: bank(otherAcct) }));
    expect(other.status).toBe(201);
    const clash = await w2.exec.client.post(`/vendors/${vid}/bank-change-requests`, { ...bank(otherAcct), reason: 'Switch account' });
    expect(clash.status).toBe(409);
    expect(clash.body.error.details.reason).toBe('BANK_ACCOUNT_IN_USE');
  });

  // ── Documents ────────────────────────────────────────────────────────────
  it('versions documents, validates uploads and keeps storage private', async () => {
    const w = await world();
    const created = await w.exec.client.post('/vendors', vendorInput());
    const id = created.body.vendor.id as string;
    const v1 = await upload(w.exec.client, id, 'GST_CERTIFICATE', { expiryDate: isoIn(400) });
    const v2 = await upload(w.exec.client, id, 'GST_CERTIFICATE', { replacesId: v1.body.id });
    expect(v2.body).toMatchObject({ versionNo: 2, previousVersionId: v1.body.id, isCurrent: true });
    expect((await h.prisma.vendorDocument.findUniqueOrThrow({ where: { id: v1.body.id } })).isCurrent).toBe(false);

    const fake = await w.exec.client.agent
      .post(`/api/v1/vendors/${id}/documents`)
      .set('x-csrf-token', w.exec.client.csrf)
      .attach('file', Buffer.from('MZ\x90\x00'), 'gst.pdf')
      .field('documentType', 'GST_CERTIFICATE')
      .field('title', 'x');
    expect(fake.status).toBe(415);
    const badDates = await upload(w.exec.client, id, 'CONTRACT', { issueDate: isoIn(10), expiryDate: isoIn(1) });
    expect(badDates.status).toBe(422);

    // Download: signed URL for vendor readers; non-vendor users cannot see vendor documents.
    const docId = v2.body.documentId;
    const signed = await w.fin.client.get(`/documents/${docId}/download-url`);
    expect(signed.status).toBe(200);
    expect((await w.fin.client.agent.get(signed.body.url)).status).toBe(200);
    const { client: requester } = await h.as(w.company, ['REQUESTER']);
    expect((await requester.get(`/documents/${docId}/download-url`)).status).toBe(404);
  });

  it('sends expiry notifications once (idempotent) and surfaces them in queues', async () => {
    const w = await world();
    const created = await w.exec.client.post('/vendors', vendorInput());
    const id = created.body.vendor.id as string;
    await upload(w.exec.client, id, 'GST_CERTIFICATE', { expiryDate: isoIn(10) });
    await upload(w.exec.client, id, 'COMPLIANCE_CERTIFICATE', { issueDate: isoIn(-400), expiryDate: isoIn(-1) });

    const scanner = h.app.get(VendorDocumentsService);
    expect(await scanner.runExpiryScan(w.company.id)).toEqual({ warned: 1, expired: 1 });
    expect(await scanner.runExpiryScan(w.company.id)).toEqual({ warned: 0, expired: 0 });
    const notes = await h.prisma.notification.findMany({ where: { userId: w.mgr.user.id, entityId: id } });
    expect(notes.map((n) => n.type).sort()).toEqual(['vendor.document.expired', 'vendor.document.expiring']);
    expect(notes.find((n) => n.type === 'vendor.document.expiring')!.title).toMatch(/expires in 10 days/);

    const expiring = await w.mgr.client.get('/vendors/documents/queue?filter=expiring');
    expect(expiring.body.items.map((d: { vendor: { id: string } }) => d.vendor.id)).toContain(id);
    const listed = await w.mgr.client.get('/vendors?documentAlert=expired');
    expect(listed.body.items.map((x: { id: string }) => x.id)).toEqual([id]);
  });

  // ── Vendor 360 & isolation ───────────────────────────────────────────────
  it('assembles Vendor 360 from real records and is honest about future modules', async () => {
    const w = await world();
    const id = await approvedVendor(w);
    const v = (await w.mgr.client.get(`/vendors/${id}`)).body;
    expect(v.contacts).toHaveLength(1);
    expect(v.documents.length).toBe(3);
    expect(v.approvals[0]).toMatchObject({ entityType: 'vendor', status: 'APPROVED' });
    expect(v.compliance.requirements).toHaveLength(3);
    expect(v.relations.every((r: { available: boolean }) => r.available === false)).toBe(true);
    const ind = Object.fromEntries(v.performance.indicators.map((i: { key: string }) => [i.key, i]));
    expect(ind.bank_verification.score).toBe(100);
    expect(ind.on_time_delivery).toMatchObject({ status: 'not_available', score: null, availableInPhase: 4 });
    expect(ind.document_compliance.inputs).toBeDefined();

    const stats = (await w.mgr.client.get('/vendors/stats')).body;
    expect(stats.byStatus.APPROVED).toBe(1);
    expect(stats.trend.created.reduce((a: number, b: number) => a + b, 0)).toBe(1);
  });

  it('isolates vendors between companies everywhere', async () => {
    const a = await world();
    const b = await world();
    const pan = randomPan();
    const created = await a.exec.client.post('/vendors', vendorInput({ pan, gstin: gstinFor(pan), legalName: 'Isolation Test Traders' }));
    const id = created.body.vendor.id as string;
    expect((await b.mgr.client.get(`/vendors/${id}`)).status).toBe(404);
    expect((await b.mgr.client.patch(`/vendors/${id}`, { paymentTermsDays: 1, version: 0 })).status).toBe(404);
    expect((await b.mgr.client.post(`/vendors/${id}/archive`, { reason: 'cross-tenant attempt' })).status).toBe(404);
    expect((await b.mgr.client.get('/vendors?q=Isolation')).body.total).toBe(0);
    expect((await b.mgr.client.post('/vendors/duplicate-check', { pan, legalName: 'Isolation Test Traders' })).body.matches).toEqual([]);
    // Same GSTIN may exist in another company (separate tenant).
    expect((await b.exec.client.post('/vendors', vendorInput({ pan, gstin: gstinFor(pan) }))).status).toBe(201);
  });

  it('lists with filters, sorting and pagination', async () => {
    const w = await world();
    for (const name of ['Charlie Corp', 'Alpha Supplies', 'Bravo Services']) {
      await w.exec.client.post(
        '/vendors',
        vendorInput({ legalName: `${name} ${h.uid()}`, vendorType: name.startsWith('Bravo') ? 'SERVICE_PROVIDER' : 'GOODS_SUPPLIER' }),
      );
    }
    const sorted = await w.mgr.client.get('/vendors?sort=legalName&order=asc&pageSize=5');
    expect(sorted.body.items.map((v: { legalName: string }) => v.legalName[0])).toEqual(['A', 'B', 'C']);
    const paged = await w.mgr.client.get('/vendors?sort=legalName&order=asc&pageSize=5&page=2');
    expect(paged.body.items).toHaveLength(0);
    expect(paged.body.total).toBe(3);
    const services = await w.mgr.client.get('/vendors?vendorType=SERVICE_PROVIDER');
    expect(services.body.total).toBe(1);
    const search = await w.mgr.client.get('/vendors?q=priya');
    expect(search.body.total).toBe(3);
    const bad = await w.mgr.client.get('/vendors?sort=passwordHash');
    expect(bad.status).toBe(422);
  });
});
