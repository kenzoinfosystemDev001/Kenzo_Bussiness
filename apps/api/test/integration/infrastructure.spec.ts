import { NumberingService } from '../../src/infrastructure/numbering/numbering.service';
import { OutboxService } from '../../src/infrastructure/outbox/outbox.service';
import { Harness, type TestCompany } from './harness';

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(200, 0x20), Buffer.from('\n%%EOF')]);

describe('Shared infrastructure', () => {
  const h = new Harness();
  let company: TestCompany;

  beforeAll(async () => {
    await h.start();
    company = await h.company();
  });
  afterAll(() => h.stop());

  describe('audit trail', () => {
    it('is append-only at the database level', async () => {
      const ev = await h.prisma.auditEvent.create({ data: { companyId: company.id, action: 'test.event', entityType: 'test' } });
      await expect(h.prisma.auditEvent.update({ where: { id: ev.id }, data: { action: 'tampered' } })).rejects.toThrow(/append-only/);
      await expect(h.prisma.auditEvent.delete({ where: { id: ev.id } })).rejects.toThrow(/append-only/);
      await expect(h.prisma.$executeRawUnsafe('TRUNCATE audit_event')).rejects.toThrow(/append-only/);
    });

    it('is readable only within the active company', async () => {
      const other = await h.company();
      await h.prisma.auditEvent.create({ data: { companyId: other.id, action: 'secret.other', entityType: 'test' } });
      const { client } = await h.as(company, ['AUDITOR']);
      const res = await client.get('/audit-events?limit=100');
      expect(res.status).toBe(200);
      expect(res.body.items.some((e: { action: string }) => e.action === 'secret.other')).toBe(false);
    });

    it('paginates with a stable cursor', async () => {
      const { client } = await h.as(company, ['AUDITOR']);
      for (let i = 0; i < 5; i++) await h.prisma.auditEvent.create({ data: { companyId: company.id, action: 'page.test', entityType: 'test' } });
      const p1 = await client.get('/audit-events?action=page.test&limit=3');
      const p2 = await client.get(`/audit-events?action=page.test&limit=3&cursor=${p1.body.nextCursor}`);
      expect(p1.body.items).toHaveLength(3);
      expect(p2.body.items).toHaveLength(2);
      expect(p2.body.nextCursor).toBeNull();
      const ids = [...p1.body.items, ...p2.body.items].map((e: { id: string }) => e.id);
      expect(new Set(ids).size).toBe(5);
    });
  });

  describe('numbering', () => {
    it('issues unique, gap-free numbers under concurrency', async () => {
      const numbering = h.app.get(NumberingService);
      const numbers = await Promise.all(
        Array.from({ length: 20 }, () => h.prisma.tx((tx) => numbering.next(tx, { companyId: company.id, documentType: 'purchase_order' }))),
      );
      expect(new Set(numbers).size).toBe(20);
      const seqs = numbers.map((n) => Number(n.split('-').pop())).sort((x, y) => x - y);
      expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
      expect(numbers[0]).toMatch(/^PO-\d{4}-\d{2}-\d{6}$/);
    });

    it('rolls a number back with its transaction', async () => {
      const numbering = h.app.get(NumberingService);
      const c = await h.company();
      await expect(
        h.prisma.tx(async (tx) => {
          await numbering.next(tx, { companyId: c.id, documentType: 'payment' });
          throw new Error('business failure');
        }),
      ).rejects.toThrow('business failure');
      const n = await h.prisma.tx((tx) => numbering.next(tx, { companyId: c.id, documentType: 'payment' }));
      expect(n.endsWith('000001')).toBe(true);
    });

    it('lets administrators change the format without resetting counters', async () => {
      const { client } = await h.as(company, ['COMPANY_ADMIN']);
      const list = await client.get('/numbering-series');
      const po = list.body.items.find((s: { documentType: string }) => s.documentType === 'purchase_order');
      const res = await client.put('/numbering-series/purchase_order', {
        prefix: 'KPO',
        pattern: '{PREFIX}/{FYS}/{SEQ}',
        padding: 5,
        resetPolicy: 'FISCAL_YEAR',
        version: po.version,
      });
      expect(res.status).toBe(200);
      const next = await h.prisma.tx((tx) => h.app.get(NumberingService).next(tx, { companyId: company.id, documentType: 'purchase_order' }));
      expect(next).toMatch(/^KPO\/\d{4}\/00021$/);
      const bad = await client.put('/numbering-series/purchase_order', {
        prefix: 'X',
        pattern: '<script>',
        padding: 5,
        resetPolicy: 'NEVER',
        version: po.version + 1,
      });
      expect(bad.status).toBe(422);
    });
  });

  describe('outbox', () => {
    it('retries failed handlers with backoff and never loses the event', async () => {
      const outbox = h.app.get(OutboxService);
      let calls = 0;
      const eventType = `test.flaky.${h.uid()}`;
      outbox.on(eventType, async () => {
        calls++;
        if (calls === 1) throw new Error('provider down');
      });
      const drainUntil = async (done: () => Promise<boolean>) => {
        for (let i = 0; i < 100 && !(await done()); i++) await outbox.dispatchOnce();
      };
      await h.prisma.tx((tx) => outbox.enqueue(tx, { companyId: company.id, eventType, aggregateType: 'test', aggregateId: 'x', payload: {} }));
      await drainUntil(async () => (await h.prisma.outboxEvent.findFirstOrThrow({ where: { eventType } })).status !== 'PENDING');
      const failed = await h.prisma.outboxEvent.findFirstOrThrow({ where: { eventType } });
      expect(failed.status).toBe('FAILED');
      expect(failed.lastError).toBe('provider down');
      await h.prisma.outboxEvent.update({ where: { id: failed.id }, data: { availableAt: new Date() } });
      await drainUntil(async () => (await h.prisma.outboxEvent.findUniqueOrThrow({ where: { id: failed.id } })).status === 'PUBLISHED');
      const ok = await h.prisma.outboxEvent.findFirstOrThrow({ where: { id: failed.id } });
      expect(ok.status).toBe('PUBLISHED');
      expect(calls).toBe(2);
    });

    it('does not publish events from rolled-back transactions', async () => {
      const outbox = h.app.get(OutboxService);
      const eventType = `test.ghost.${h.uid()}`;
      await expect(
        h.prisma.tx(async (tx) => {
          await outbox.enqueue(tx, { eventType, aggregateType: 't', aggregateId: 'g', payload: {} });
          throw new Error('rollback');
        }),
      ).rejects.toThrow();
      expect(await h.prisma.outboxEvent.count({ where: { eventType } })).toBe(0);
    });
  });

  describe('documents', () => {
    it('stores a valid upload privately and serves it only via a signed, user-bound URL', async () => {
      const { client } = await h.as(company, ['REQUESTER']);
      const up = await client.agent.post('/api/v1/documents').set('x-csrf-token', client.csrf).attach('file', PDF, 'invoice.pdf');
      expect(up.status).toBe(201);
      expect(up.body).toMatchObject({ mimeType: 'application/pdf', scanStatus: 'SKIPPED' });
      expect(up.body.objectKey).toBeUndefined();

      const meta = await client.get(`/documents/${up.body.id}`);
      expect(meta.body.objectKey).toBeUndefined();
      const signed = await client.get(`/documents/${up.body.id}/download-url`);
      const ok = await client.agent.get(signed.body.url);
      expect(ok.status).toBe(200);
      expect(ok.headers['content-disposition']).toMatch(/^attachment/);
      expect(ok.headers['x-content-type-options']).toBe('nosniff');
      expect(Buffer.compare(ok.body as Buffer, PDF)).toBe(0);

      const tampered = await client.agent.get(signed.body.url.replace(/sig=[a-f0-9]/, 'sig=0'));
      expect(tampered.status).toBe(403);
      // Another user in the same company cannot reuse the link, nor read the document (OWN scope).
      const { client: other } = await h.as(company, ['REQUESTER']);
      expect((await other.agent.get(signed.body.url)).status).toBe(403);
      expect((await other.get(`/documents/${up.body.id}`)).status).toBe(404);
      // Unauthenticated access is refused even with a valid signature.
      expect((await h.http.get(signed.body.url)).status).toBe(401);
    });

    it('rejects files whose content does not match their extension', async () => {
      const { client } = await h.as(company, ['REQUESTER']);
      const fake = await client.agent
        .post('/api/v1/documents')
        .set('x-csrf-token', client.csrf)
        .attach('file', Buffer.from('MZ\x90\x00 executable'), 'invoice.pdf');
      expect(fake.status).toBe(415);
      const exe = await client.agent.post('/api/v1/documents').set('x-csrf-token', client.csrf).attach('file', Buffer.from('MZ'), 'tool.exe');
      expect(exe.status).toBe(415);
    });

    it('rejects oversized files', async () => {
      const { client } = await h.as(company, ['REQUESTER']);
      const big = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(1024 * 1024 + 10)]);
      const res = await client.agent.post('/api/v1/documents').set('x-csrf-token', client.csrf).attach('file', big, 'big.pdf');
      expect(res.status).toBe(413);
    });

    it('isolates documents between companies', async () => {
      const { client } = await h.as(company, ['COMPANY_ADMIN']);
      const up = await client.agent.post('/api/v1/documents').set('x-csrf-token', client.csrf).attach('file', PDF, 'a.pdf');
      const other = await h.company();
      const { client: foreign } = await h.as(other, ['SUPER_ADMIN']);
      expect((await foreign.get(`/documents/${up.body.id}`)).status).toBe(404);
      expect((await foreign.get(`/documents/${up.body.id}/download-url`)).status).toBe(404);
    });
  });

  describe('integrations', () => {
    it('refuses to store secret values in configuration', async () => {
      const { client } = await h.as(company, ['SUPER_ADMIN']);
      const bad = await client.post('/integrations', {
        kind: 'EMAIL',
        provider: 'ses',
        name: 'SES',
        enabled: false,
        settings: { region: 'ap-south-1', apiKey: 'AKIA…' },
      });
      expect(bad.status).toBe(422);
      const ok = await client.post('/integrations', {
        kind: 'EMAIL',
        provider: 'ses',
        name: 'SES',
        enabled: false,
        settings: { region: 'ap-south-1' },
        secretRef: 'prod/ses/credentials',
      });
      expect(ok.status).toBe(201);
    });
  });

  describe('HTTP conventions', () => {
    it('returns the standard error envelope with a correlation id and security headers', async () => {
      const res = await h.http.get('/api/v1/does-not-exist').set('x-correlation-id', 'test-corr-12345');
      expect(res.status).toBe(404);
      expect(res.body.error).toMatchObject({ code: 'NOT_FOUND', correlationId: 'test-corr-12345' });
      expect(res.headers['x-correlation-id']).toBe('test-corr-12345');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBeDefined();
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('validates input server-side with field errors', async () => {
      const { client } = await h.as(company, ['COMPANY_ADMIN']);
      const res = await client.post('/departments', { code: 'bad code!', name: '' });
      expect(res.status).toBe(422);
      expect(res.body.error.fieldErrors.map((f: { path: string }) => f.path).sort()).toEqual(['code', 'name']);
    });

    it('exposes liveness and readiness', async () => {
      expect((await h.http.get('/api/v1/health')).body).toEqual({ status: 'ok' });
      expect((await h.http.get('/api/v1/health/ready')).body).toMatchObject({ status: 'ready' });
    });
  });
});
