import { Harness, type Client, type TestCompany, type TestUser } from './harness';

/**
 * Phase 04 — quotation comparison, weighted evaluation and award.
 *
 * Everything runs through the HTTP API with real roles, so authorisation,
 * separation of duties and the approval engine are exercised as a user meets
 * them. Vendors are inserted directly: their own lifecycle is covered by
 * vendors.spec.ts and is not what these tests are about.
 */
describe('Quotation evaluation and award (Phase 04)', () => {
  const h = new Harness();

  beforeAll(() => h.start());
  afterAll(() => h.stop());

  interface World {
    company: TestCompany;
    admin: Client;
    /** Procurement manager: configures criteria, scores, recommends. */
    mgr: { user: TestUser; client: Client };
    /** A second manager, so an award has someone else to approve it. */
    approver: { user: TestUser; client: Client };
    /** The default award policy adds a finance stage above 500,000. */
    finance: { user: TestUser; client: Client };
    criteriaSetId: string;
    vendors: string[];
    rfqId: string;
    /** RFQ line ids in line order, fetched once when the RFQ is raised. */
    lineIds: string[];
    /** quotationId per vendor, in vendor order. */
    quotations: string[];
  }

  async function publishPolicy(admin: Client, entityType: string) {
    const list = await admin.get(`/approval-policies?entityType=${entityType}`);
    const draft = list.body.items.find((p: { status: string }) => p.status === 'DRAFT');
    expect(draft).toBeTruthy();
    expect((await admin.post(`/approval-policies/${draft.id}/publish`, { reason: 'Published for tests' })).status).toBe(200);
  }

  async function vendor(company: TestCompany, createdById: string, name: string): Promise<string> {
    const v = await h.prisma.vendor.create({
      data: {
        companyId: company.id,
        vendorCode: h.uid('V'),
        legalName: name,
        normalizedName: name.toUpperCase(),
        vendorType: 'GOODS_SUPPLIER',
        category: 'IT Hardware',
        // Unregistered keeps the fixture free of a GSTIN; registration is not what these tests exercise.
        gstRegistrationType: 'UNREGISTERED',
        addressLine1: '1 Test Road',
        city: 'Pune',
        state: 'Maharashtra',
        postalCode: '411001',
        email: `${h.uid('v').toLowerCase()}@vendor.test`,
        status: 'ACTIVE',
        createdById,
      },
    });
    return v.id;
  }

  const deadline = () => new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

  /** Three vendors invited to a two-line RFQ, with a published criteria set. */
  async function world(opts: { allowPartialAward?: boolean; vendorCount?: number } = {}): Promise<World> {
    const company = await h.company();
    const admin = (await h.as(company, ['COMPANY_ADMIN'])).client;
    await publishPolicy(admin, 'rfq_award');

    const mgr = await h.as(company, ['PROCUREMENT_MANAGER']);
    const approver = await h.as(company, ['PROCUREMENT_MANAGER']);
    const finance = await h.as(company, ['FINANCE_MANAGER'], { departmentId: company.departments.fin });

    const set = await mgr.client.post('/evaluation/criteria-sets', {
      name: `Standard ${h.uid('')}`,
      isDefault: false,
      criteria: [
        { key: 'PRICE', label: 'Total landed cost', weightPercent: '70', source: 'AUTO_PRICE', direction: 'LOWER_BETTER' },
        { key: 'DELIVERY', label: 'Delivery lead time', weightPercent: '10', source: 'AUTO_DELIVERY', direction: 'LOWER_BETTER' },
        { key: 'QUALITY', label: 'Quality', weightPercent: '20', source: 'MANUAL', direction: 'HIGHER_BETTER' },
      ],
    });
    expect(set.status).toBe(201);
    expect((await mgr.client.post(`/evaluation/criteria-sets/${set.body.id}/publish`, {})).status).toBe(200);

    const count = opts.vendorCount ?? 3;
    const vendors: string[] = [];
    for (let i = 0; i < count; i++) vendors.push(await vendor(company, mgr.user.id, `Vendor ${i + 1} Pvt Ltd`));

    const rfq = await mgr.client.post('/rfqs', {
      title: 'Laptops and docking stations',
      standaloneReason: 'Replacement cycle approved verbally by the CTO; formal requisition follows.',
      deliveryLocation: 'Pune office',
      responseDeadline: deadline(),
      currency: 'INR',
      allowPartialAward: opts.allowPartialAward ?? false,
      lines: [
        { itemType: 'GOODS', description: 'Laptop 14-inch i7', quantity: '10', uom: 'NOS' },
        { itemType: 'GOODS', description: 'Docking station', quantity: '10', uom: 'NOS' },
      ],
      vendorIds: vendors,
    });
    expect(rfq.status).toBe(201);
    const rfqId = rfq.body.id as string;
    expect((await mgr.client.post(`/rfqs/${rfqId}/approve`, {})).status).toBe(200);
    expect((await mgr.client.post(`/rfqs/${rfqId}/send`, {})).status).toBe(200);

    const lineIds = ((await mgr.client.get(`/rfqs/${rfqId}`)).body.lines as Array<{ id: string }>).map((l) => l.id);
    return { company, admin, mgr, approver, finance, criteriaSetId: set.body.id, vendors, rfqId, lineIds, quotations: [] };
  }

  /** Registers a submitted quotation. `prices` is one unit price per RFQ line. */
  async function quote(
    w: World,
    vendorIndex: number,
    prices: string[],
    opts: {
      deliveryLeadDays?: number;
      quotationDate?: string;
      validUntil?: string;
      taxTreatment?: 'EXCLUSIVE' | 'INCLUSIVE';
      currency?: string;
      freight?: string;
      skipLine?: number;
    } = {},
  ): Promise<string> {
    const lineIds = w.lineIds;
    const lines = lineIds
      .map((rfqLineId, i) => ({ rfqLineId, quantity: '10', unitPrice: prices[i]!, discountPercent: '0', taxRate: '18' }))
      .filter((_, i) => i !== opts.skipLine);
    const res = await w.mgr.client.post(`/rfqs/${w.rfqId}/quotations`, {
      vendorId: w.vendors[vendorIndex],
      quotationDate: opts.quotationDate ?? new Date().toISOString().slice(0, 10),
      validUntil: opts.validUntil ?? new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10),
      currency: opts.currency ?? 'INR',
      taxTreatment: opts.taxTreatment ?? 'EXCLUSIVE',
      deliveryLeadDays: opts.deliveryLeadDays ?? 14,
      paymentTermsDays: 30,
      warranty: '1 year onsite',
      freight: opts.freight ?? '0',
      otherCharges: '0',
      lines,
      submit: true,
    });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  /** Full happy path up to a completed evaluation, cheapest vendor first. */
  async function evaluated(opts: Parameters<typeof world>[0] = {}): Promise<World> {
    const w = await world(opts);
    w.quotations = [await quote(w, 0, ['50000', '5000']), await quote(w, 1, ['60000', '6000']), await quote(w, 2, ['70000', '7000'])];
    expect((await w.mgr.client.post(`/rfqs/${w.rfqId}/evaluation`, { criteriaSetId: w.criteriaSetId })).status).toBe(201);
    await w.mgr.client.post(`/rfqs/${w.rfqId}/evaluation/declarations`, { hasConflict: false });
    for (const [i, q] of w.quotations.entries()) {
      const value = ['90', '80', '70'][i]!;
      expect((await w.mgr.client.post(`/rfqs/${w.rfqId}/evaluation/quotations/${q}/scores`, { scores: [{ criterionKey: 'QUALITY', value }] })).status).toBe(
        200,
      );
    }
    expect((await w.mgr.client.post(`/rfqs/${w.rfqId}/evaluation/complete`, { note: 'All three responses reviewed and scored.' })).status).toBe(200);
    return w;
  }

  // ── Criteria and weights ────────────────────────────────────────────────

  it('refuses a criteria set whose weights do not total 100', async () => {
    const company = await h.company();
    const mgr = await h.as(company, ['PROCUREMENT_MANAGER']);
    const res = await mgr.client.post('/evaluation/criteria-sets', {
      name: 'Lopsided',
      criteria: [
        { key: 'PRICE', label: 'Price', weightPercent: '70', source: 'AUTO_PRICE', direction: 'LOWER_BETTER' },
        { key: 'QUALITY', label: 'Quality', weightPercent: '20', source: 'MANUAL', direction: 'HIGHER_BETTER' },
      ],
    });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toMatch(/exactly 100/);
  });

  it('only a user with evaluation.configure may define criteria', async () => {
    const company = await h.company();
    const exec = await h.as(company, ['PROCUREMENT_EXECUTIVE']);
    const res = await exec.client.post('/evaluation/criteria-sets', {
      name: 'Nope',
      criteria: [{ key: 'PRICE', label: 'Price', weightPercent: '100', source: 'AUTO_PRICE', direction: 'LOWER_BETTER' }],
    });
    expect(res.status).toBe(403);
  });

  it('publishing a new version retires the previous active set', async () => {
    const company = await h.company();
    const mgr = await h.as(company, ['PROCUREMENT_MANAGER']);
    const body = {
      name: 'Repeating',
      criteria: [{ key: 'PRICE', label: 'Price', weightPercent: '100', source: 'AUTO_PRICE', direction: 'LOWER_BETTER' }],
    };
    const first = await mgr.client.post('/evaluation/criteria-sets', body);
    await mgr.client.post(`/evaluation/criteria-sets/${first.body.id}/publish`, {});
    const second = await mgr.client.post('/evaluation/criteria-sets', body);
    await mgr.client.post(`/evaluation/criteria-sets/${second.body.id}/publish`, {});

    const list = await mgr.client.get('/evaluation/criteria-sets');
    const versions = (list.body.items as Array<{ name: string; setVersion: number; status: string }>)
      .filter((s) => s.name === 'Repeating')
      .map((s) => [s.setVersion, s.status]);
    expect(versions).toEqual(
      expect.arrayContaining([
        [1, 'RETIRED'],
        [2, 'ACTIVE'],
      ]),
    );
  });

  it('an evaluation cannot run against an unpublished criteria set', async () => {
    const w = await world();
    await quote(w, 0, ['1000', '100']);
    const draft = await w.mgr.client.post('/evaluation/criteria-sets', {
      name: 'Draft only',
      criteria: [{ key: 'PRICE', label: 'Price', weightPercent: '100', source: 'AUTO_PRICE', direction: 'LOWER_BETTER' }],
    });
    const res = await w.mgr.client.post(`/rfqs/${w.rfqId}/evaluation`, { criteriaSetId: draft.body.id });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toMatch(/published/);
  });

  // ── Comparison ──────────────────────────────────────────────────────────

  it('compares landed cost component by component and marks the lowest', async () => {
    const w = await world();
    const cheap = await quote(w, 0, ['50000', '5000'], { freight: '1000' });
    await quote(w, 1, ['60000', '6000']);

    const c = (await w.mgr.client.get(`/rfqs/${w.rfqId}/comparison`)).body;
    const col = c.columns.find((x: { quotationId: string }) => x.quotationId === cheap);
    // 10 × 50000 + 10 × 5000 = 550000, +18 % tax = 649000, + 1000 freight.
    expect(col.landedCost).toMatchObject({
      subtotal: '550000.00',
      discountTotal: '0.00',
      taxableTotal: '550000.00',
      taxTotal: '99000.00',
      freight: '1000.00',
      grandTotal: '650000.00',
    });
    expect(c.indicators.lowestTotalQuotationId).toBe(cheap);
    expect(c.caveats.comparable).toBe(true);
  });

  it('reports an incomplete response instead of treating a missing item as zero', async () => {
    const w = await world();
    const partial = await quote(w, 0, ['50000', '5000'], { skipLine: 1 });
    await quote(w, 1, ['60000', '6000']);

    const c = (await w.mgr.client.get(`/rfqs/${w.rfqId}/comparison`)).body;
    const col = c.columns.find((x: { quotationId: string }) => x.quotationId === partial);
    expect(col.blockers).toContain('INCOMPLETE_RESPONSE');
    expect(col.linesMissing).toBe(1);
    expect(col.lines.find((l: { quoted: boolean }) => !l.quoted)).toBeTruthy();
    expect(JSON.stringify(c.insights)).toMatch(/did not price every/);
  });

  it('refuses to convert a foreign-currency quotation with no approved rate', async () => {
    const w = await world();
    const usd = await quote(w, 0, ['600', '60'], { currency: 'USD' });
    await quote(w, 1, ['60000', '6000']);

    const before = (await w.mgr.client.get(`/rfqs/${w.rfqId}/comparison`)).body;
    const col = before.columns.find((x: { quotationId: string }) => x.quotationId === usd);
    expect(col.comparableTotal).toBeNull();
    expect(col.blockers).toContain('MIXED_CURRENCY_NO_RATE');
    expect(before.caveats.comparable).toBe(false);
    // The cheaper face value must not win the lowest-price marker.
    expect(before.indicators.lowestTotalQuotationId).not.toBe(usd);
  });

  it('converts once an approved rate exists, and records which rate was used', async () => {
    const w = await world();
    const usd = await quote(w, 0, ['600', '60'], { currency: 'USD' });
    await quote(w, 1, ['60000', '6000']);

    expect(
      (
        await w.mgr.client.post('/evaluation/exchange-rates', {
          baseCurrency: 'INR',
          quoteCurrency: 'USD',
          rate: '83.25',
          source: 'RBI reference rate',
          rateTimestamp: new Date().toISOString(),
        })
      ).status,
    ).toBe(201);

    const after = (await w.mgr.client.get(`/rfqs/${w.rfqId}/comparison`)).body;
    const col = after.columns.find((x: { quotationId: string }) => x.quotationId === usd);
    // 10 × 600 + 10 × 60 = 6600 USD, +18 % = 7788 USD × 83.25.
    expect(col.comparableTotal).toBe('648351.00');
    expect(col.blockers).not.toContain('MIXED_CURRENCY_NO_RATE');
    expect(after.rates[0]).toMatchObject({ baseCurrency: 'INR', quoteCurrency: 'USD', source: 'RBI reference rate' });
  });

  it('flags a mixed tax basis rather than comparing the totals as equivalent', async () => {
    const w = await world();
    await quote(w, 0, ['50000', '5000'], { taxTreatment: 'EXCLUSIVE' });
    const inclusive = await quote(w, 1, ['50000', '5000'], { taxTreatment: 'INCLUSIVE' });

    const c = (await w.mgr.client.get(`/rfqs/${w.rfqId}/comparison`)).body;
    expect(c.caveats.taxTreatments.sort()).toEqual(['EXCLUSIVE', 'INCLUSIVE']);
    for (const col of c.columns) expect(col.blockers).toContain('MIXED_TAX_TREATMENT');
    // The inclusive quote really is cheaper, but it is not comparable on its face.
    const inc = c.columns.find((x: { quotationId: string }) => x.quotationId === inclusive);
    expect(inc.landedCost.grandTotal).toBe('550000.00');
    expect(c.indicators.lowestTotalQuotationId).toBeNull();
  });

  it('exports the comparison as PDF and as a spreadsheet', async () => {
    const w = await world();
    await quote(w, 0, ['50000', '5000']);
    const pdf = await w.mgr.client.get(`/rfqs/${w.rfqId}/comparison/report?format=pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');

    const csv = await w.mgr.client.get(`/rfqs/${w.rfqId}/comparison/report?format=csv`);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text ?? csv.body.toString()).toMatch(/Comparable total/);
  });

  // ── Scoring ─────────────────────────────────────────────────────────────

  it('scores every quotation and shows the working behind each score', async () => {
    const w = await evaluated();
    const e = (await w.mgr.client.get(`/rfqs/${w.rfqId}/evaluation`)).body;

    expect(e.status).toBe('COMPLETED');
    expect(e.formulaVersion).toBe('weighted-sum-v1');
    expect(e.ranking[0]).toBe(w.quotations[0]); // cheapest and best quality
    const best = e.quotations.find((q: { quotationId: string }) => q.quotationId === w.quotations[0]);
    expect(best.totalScore).toBe('100.0000');

    const price = best.scores.find((s: { criterionKey: string }) => s.criterionKey === 'PRICE');
    expect(price).toMatchObject({ source: 'AUTO_PRICE', weightPercent: '70.00', normalizedScore: '100.0000', weightedScore: '70.0000', missing: false });
    expect(price.rawValue).toBe(best.comparableTotal);

    const quality = best.scores.find((s: { criterionKey: string }) => s.criterionKey === 'QUALITY');
    expect(quality).toMatchObject({ source: 'MANUAL', rawValue: '90' });
    expect(quality.scoredBy.id).toBe(w.mgr.user.id);
  });

  it('refuses a manual score for a criterion the quotation supplies automatically', async () => {
    const w = await world();
    const q = await quote(w, 0, ['50000', '5000']);
    await w.mgr.client.post(`/rfqs/${w.rfqId}/evaluation`, { criteriaSetId: w.criteriaSetId });
    await w.mgr.client.post(`/rfqs/${w.rfqId}/evaluation/declarations`, { hasConflict: false });

    const res = await w.mgr.client.post(`/rfqs/${w.rfqId}/evaluation/quotations/${q}/scores`, { scores: [{ criterionKey: 'PRICE', value: '100' }] });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toMatch(/not a reviewer-scored criterion/);
  });

  it('rejects a manual score outside 0–100', async () => {
    const w = await world();
    const q = await quote(w, 0, ['50000', '5000']);
    await w.mgr.client.post(`/rfqs/${w.rfqId}/evaluation`, { criteriaSetId: w.criteriaSetId });
    await w.mgr.client.post(`/rfqs/${w.rfqId}/evaluation/declarations`, { hasConflict: false });
    expect(
      (await w.mgr.client.post(`/rfqs/${w.rfqId}/evaluation/quotations/${q}/scores`, { scores: [{ criterionKey: 'QUALITY', value: '140' }] })).status,
    ).toBe(422);
  });

  it('requires a conflict-of-interest declaration before scoring, and bars anyone who declares one', async () => {
    const w = await world();
    const q = await quote(w, 0, ['50000', '5000']);
    await w.mgr.client.post(`/rfqs/${w.rfqId}/evaluation`, { criteriaSetId: w.criteriaSetId });
    await w.mgr.client.post(`/rfqs/${w.rfqId}/evaluation/declarations`, { hasConflict: false });

    const undeclared = await h.as(w.company, ['PROCUREMENT_MANAGER']);
    const blocked = await undeclared.client.post(`/rfqs/${w.rfqId}/evaluation/quotations/${q}/scores`, { scores: [{ criterionKey: 'QUALITY', value: '50' }] });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('CONFLICT_DECLARATION_REQUIRED');

    await undeclared.client.post(`/rfqs/${w.rfqId}/evaluation/declarations`, { hasConflict: true, details: 'My brother-in-law is a director of Vendor 1.' });
    const conflicted = await undeclared.client.post(`/rfqs/${w.rfqId}/evaluation/quotations/${q}/scores`, {
      scores: [{ criterionKey: 'QUALITY', value: '50' }],
    });
    expect(conflicted.status).toBe(403);
    expect(conflicted.body.error.code).toBe('SEGREGATION_OF_DUTIES');
  });

  it('a declared conflict needs details', async () => {
    const w = await world();
    await quote(w, 0, ['50000', '5000']);
    await w.mgr.client.post(`/rfqs/${w.rfqId}/evaluation`, { criteriaSetId: w.criteriaSetId });
    await w.mgr.client.post(`/rfqs/${w.rfqId}/evaluation/declarations`, { hasConflict: false });
    const other = await h.as(w.company, ['PROCUREMENT_MANAGER']);
    expect((await other.client.post(`/rfqs/${w.rfqId}/evaluation/declarations`, { hasConflict: true })).status).toBe(422);
  });

  it('excludes a quotation with a recorded reason and keeps it out of the ranking', async () => {
    const w = await evaluated();
    const res = await w.mgr.client.post(`/rfqs/${w.rfqId}/evaluation/quotations/${w.quotations[0]}/exclude`, {
      reason: 'Specification does not meet the technical minimum',
    });
    expect(res.status).toBe(409); // the round is complete
    const w2 = await world();
    w2.quotations = [await quote(w2, 0, ['50000', '5000']), await quote(w2, 1, ['60000', '6000'])];
    await w2.mgr.client.post(`/rfqs/${w2.rfqId}/evaluation`, { criteriaSetId: w2.criteriaSetId });
    await w2.mgr.client.post(`/rfqs/${w2.rfqId}/evaluation/declarations`, { hasConflict: false });
    expect(
      (await w2.mgr.client.post(`/rfqs/${w2.rfqId}/evaluation/quotations/${w2.quotations[0]}/exclude`, { reason: 'Does not meet the technical minimum' }))
        .status,
    ).toBe(200);

    const e = (await w2.mgr.client.get(`/rfqs/${w2.rfqId}/evaluation`)).body;
    const excluded = e.quotations.find((q: { quotationId: string }) => q.quotationId === w2.quotations[0]);
    expect(excluded).toMatchObject({ excluded: true, exclusionReason: 'Does not meet the technical minimum' });
    expect(e.ranking).not.toContain(w2.quotations[0]);
  });

  it('produces an evaluation report in both formats', async () => {
    const w = await evaluated();
    const pdf = await w.mgr.client.get(`/rfqs/${w.rfqId}/evaluation/report`);
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
    const csv = await w.mgr.client.get(`/rfqs/${w.rfqId}/evaluation/report?format=csv`);
    expect(csv.text ?? csv.body.toString()).toMatch(/Criterion/);
  });

  // ── Award ───────────────────────────────────────────────────────────────

  async function recommendAll(w: World, quotationId: string, extra: Record<string, unknown> = {}) {
    const lineIds = w.lineIds;
    return w.mgr.client.post(`/rfqs/${w.rfqId}/evaluation/award`, {
      lines: lineIds.map((rfqLineId) => ({ rfqLineId, quotationId })),
      rationale: 'Lowest comparable landed cost and the highest quality score of the three responses.',
      ...extra,
    });
  }

  /** The pending approval task on this award for `who`, if they have one. */
  async function taskFor(w: World, awardId: string, who: 'approver' | 'finance') {
    const tasks = (await w[who].client.get('/approvals/tasks')).body.items as Array<{ id: string; instance: { entityId: string } }>;
    return tasks.find((t) => t.instance.entityId === awardId);
  }

  /** Decides the first stage of an award as `who`. */
  async function decide(w: World, awardId: string, who: 'approver' | 'finance', decision: 'APPROVE' | 'REJECT' | 'RETURN', reason: string) {
    const task = await taskFor(w, awardId, who);
    expect(task).toBeTruthy();
    return w[who].client.post(`/approvals/tasks/${task!.id}/decision`, { decision, reason });
  }

  /**
   * Walks an award through every stage the policy raises — procurement, then
   * finance above the threshold — so a change to the default policy does not
   * have to be mirrored in each test.
   */
  async function approveAward(w: World, awardId: string) {
    for (const who of ['approver', 'finance'] as const) {
      const task = await taskFor(w, awardId, who);
      if (!task) continue;
      expect((await w[who].client.post(`/approvals/tasks/${task.id}/decision`, { decision: 'APPROVE', reason: 'Within budget' })).status).toBe(200);
    }
    const award = (await w.mgr.client.get(`/awards/${awardId}`)).body;
    expect(award.status).toBe('APPROVED');
    return award;
  }

  it('runs recommendation → approval → award and freezes the commercial snapshot', async () => {
    const w = await evaluated();
    const rec = await recommendAll(w, w.quotations[0]!);
    expect(rec.status).toBe(201);
    expect(rec.body).toMatchObject({ status: 'PENDING_APPROVAL', awardType: 'FULL', currency: 'INR' });
    expect(rec.body.awardNo).toMatch(/^AWD-/);
    expect(rec.body.totalAwardedValue).toBe('649000.00');

    // The recommender cannot approve their own recommendation.
    // The recommender is barred from deciding their own recommendation.
    expect(await taskFor(w, rec.body.id, 'approver')).toBeTruthy();
    const approved = await approveAward(w, rec.body.id);
    expect(approved.approvedAt).toBeTruthy();
    expect(approved.snapshot).toBeNull();

    const issued = (await w.mgr.client.post(`/awards/${rec.body.id}/issue`, {})).body;
    expect(issued.status).toBe('AWARDED');
    expect(issued.snapshot.lines).toHaveLength(2);
    expect(issued.snapshot.lines[0]).toMatchObject({ quantity: '10.0000', unitPrice: '50000.0000', taxTreatment: 'EXCLUSIVE' });
    expect(issued.snapshot.totalAwardedValue).toBe('649000.00');

    // The RFQ closes and the quotations take their outcome.
    expect((await w.mgr.client.get(`/rfqs/${w.rfqId}`)).body.status).toBe('AWARDED');
    const quotes = (await w.mgr.client.get(`/rfqs/${w.rfqId}/quotations`)).body.items as Array<{ id: string; status: string }>;
    expect(quotes.find((q) => q.id === w.quotations[0])!.status).toBe('ACCEPTED');
    expect(quotes.filter((q) => q.id !== w.quotations[0]).map((q) => q.status)).toEqual(['REJECTED', 'REJECTED']);
  });

  it('will not recommend before the evaluation is complete', async () => {
    const w = await world();
    w.quotations = [await quote(w, 0, ['50000', '5000'])];
    await w.mgr.client.post(`/rfqs/${w.rfqId}/evaluation`, { criteriaSetId: w.criteriaSetId });
    await w.mgr.client.post(`/rfqs/${w.rfqId}/evaluation/declarations`, { hasConflict: false });
    const res = await recommendAll(w, w.quotations[0]!);
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/Complete the evaluation/);
  });

  it('refuses to award a quotation from another RFQ', async () => {
    const a = await evaluated();
    const b = await evaluated();
    const res = await recommendAll(a, b.quotations[0]!);
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toMatch(/does not belong to this RFQ/);
  });

  it('refuses to award an expired quotation without a recorded exception, and allows it with one', async () => {
    const w = await world();
    // Quoted two months ago and valid for one: already lapsed when it is
    // evaluated. A submitted version is immutable by trigger, so the fixture
    // creates it expired rather than editing it afterwards.
    const q = await quote(w, 0, ['50000', '5000'], {
      quotationDate: new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString().slice(0, 10),
      validUntil: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10),
    });
    await w.mgr.client.post(`/rfqs/${w.rfqId}/evaluation`, { criteriaSetId: w.criteriaSetId });
    await w.mgr.client.post(`/rfqs/${w.rfqId}/evaluation/declarations`, { hasConflict: false });
    await w.mgr.client.post(`/rfqs/${w.rfqId}/evaluation/quotations/${q}/scores`, { scores: [{ criterionKey: 'QUALITY', value: '80' }] });
    await w.mgr.client.post(`/rfqs/${w.rfqId}/evaluation/complete`, { note: 'Single compliant response received.' });

    w.quotations = [q];

    const refused = await recommendAll(w, q);
    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.body)).toMatch(/expired on .* record an exception/);

    const allowed = await recommendAll(w, q, { expiredQuotationException: 'Vendor confirmed the price holds in writing; CFO approved the extension.' });
    expect(allowed.status).toBe(201);
    expect(allowed.body.expiredException).toMatch(/CFO approved/);
  });

  it('refuses a partial award unless the RFQ permits one', async () => {
    const w = await evaluated();
    const lineIds = w.lineIds;
    const res = await w.mgr.client.post(`/rfqs/${w.rfqId}/evaluation/award`, {
      lines: [{ rfqLineId: lineIds[0], quotationId: w.quotations[0] }],
      rationale: 'Only the laptops are needed this quarter; docking stations deferred.',
    });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/does not permit a partial award/);
  });

  it('refuses to split lines across vendors unless the RFQ permits it', async () => {
    const w = await evaluated();
    const lineIds = w.lineIds;
    const res = await w.mgr.client.post(`/rfqs/${w.rfqId}/evaluation/award`, {
      lines: [
        { rfqLineId: lineIds[0], quotationId: w.quotations[0] },
        { rfqLineId: lineIds[1], quotationId: w.quotations[1] },
      ],
      rationale: 'Each vendor is cheapest on one of the two items.',
    });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/splitting items across vendors/);
  });

  it('splits lines across vendors when the RFQ allows a partial award', async () => {
    const w = await evaluated({ allowPartialAward: true });
    const lineIds = w.lineIds;
    const res = await w.mgr.client.post(`/rfqs/${w.rfqId}/evaluation/award`, {
      lines: [
        { rfqLineId: lineIds[0], quotationId: w.quotations[0] },
        { rfqLineId: lineIds[1], quotationId: w.quotations[1] },
      ],
      rationale: 'Each vendor is cheapest on one of the two items and both meet the technical minimum.',
    });
    expect(res.status).toBe(201);
    expect(res.body.awardType).toBe('PARTIAL');
    // 10 × 50000 × 1.18  +  10 × 6000 × 1.18
    expect(res.body.totalAwardedValue).toBe('660800.00');
    expect(new Set((res.body.lines as Array<{ vendor: { id: string } }>).map((l) => l.vendor.id)).size).toBe(2);
  });

  it('serialises concurrent recommendations so only one award is raised', async () => {
    const w = await evaluated();
    const lineIds = w.lineIds;
    const body = (quotationId: string) => ({
      lines: lineIds.map((rfqLineId) => ({ rfqLineId, quotationId })),
      rationale: 'Lowest comparable landed cost among the compliant responses received.',
    });
    const [a, b] = await Promise.all([
      w.mgr.client.post(`/rfqs/${w.rfqId}/evaluation/award`, body(w.quotations[0]!)),
      w.mgr.client.post(`/rfqs/${w.rfqId}/evaluation/award`, body(w.quotations[1]!)),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const awards = (await w.mgr.client.get(`/rfqs/${w.rfqId}/evaluation/award`)).body.items;
    expect(awards).toHaveLength(1);
  });

  it('an issued award is immutable and cannot be cancelled', async () => {
    const w = await evaluated();
    const rec = await recommendAll(w, w.quotations[0]!);
    await approveAward(w, rec.body.id);
    await w.mgr.client.post(`/awards/${rec.body.id}/issue`, {});

    const cancel = await w.mgr.client.post(`/awards/${rec.body.id}/cancel`, { reason: 'Changed our minds about the purchase' });
    expect(cancel.status).toBe(409);
    expect(JSON.stringify(cancel.body)).toMatch(/cancellation document/);
    await expect(h.prisma.rfqAward.update({ where: { id: rec.body.id }, data: { rationale: 'rewritten' } })).rejects.toThrow(/awarded and immutable/);
  });

  it('a rejected recommendation ends the award and leaves the RFQ open', async () => {
    const w = await evaluated();
    const rec = await recommendAll(w, w.quotations[0]!);
    expect((await decide(w, rec.body.id, 'approver', 'REJECT', 'Re-tender: the scope has changed materially')).status).toBe(200);

    const award = (await w.mgr.client.get(`/awards/${rec.body.id}`)).body;
    expect(award.status).toBe('REJECTED');
    expect((await w.mgr.client.get(`/rfqs/${w.rfqId}`)).body.status).toBe('EVALUATION');
    // The RFQ is free to take a fresh recommendation.
    expect((await recommendAll(w, w.quotations[1]!)).status).toBe(201);
  });

  it('a returned recommendation can be resubmitted', async () => {
    const w = await evaluated();
    const rec = await recommendAll(w, w.quotations[0]!);
    await decide(w, rec.body.id, 'approver', 'RETURN', 'Attach the technical evaluation sheet');
    expect((await w.mgr.client.get(`/awards/${rec.body.id}`)).body.status).toBe('RETURNED');
    expect((await w.mgr.client.post(`/awards/${rec.body.id}/resubmit`, {})).body.status).toBe('PENDING_APPROVAL');
  });

  it('preserves the evaluated version: a revision after scoring blocks the award until re-run', async () => {
    const w = await evaluated();
    // The vendor revises after being evaluated.
    const revision = await w.mgr.client.post(`/quotations/${w.quotations[0]}/revisions`, {
      quotationDate: new Date().toISOString().slice(0, 10),
      validUntil: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10),
      currency: 'INR',
      deliveryLeadDays: 14,
      freight: '0',
      otherCharges: '0',
      lines: w.lineIds.map((rfqLineId) => ({
        rfqLineId,
        quantity: '10',
        unitPrice: '45000',
        discountPercent: '0',
        taxRate: '18',
      })),
    });
    expect(revision.status).toBe(201);
    await w.mgr.client.post(`/quotations/${w.quotations[0]}/draft/submit`, { changeSummary: 'Price reduced after negotiation' });

    const res = await recommendAll(w, w.quotations[0]!);
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/revised after it was evaluated/);

    // The earlier scored version is still on record.
    const e = (await w.mgr.client.get(`/rfqs/${w.rfqId}/evaluation`)).body;
    expect(e.quotations.find((q: { quotationId: string }) => q.quotationId === w.quotations[0]).versionNo).toBe(1);
  });

  it('requires quotation.award to recommend, and quotation.read to view', async () => {
    const w = await evaluated();
    const exec = await h.as(w.company, ['PROCUREMENT_EXECUTIVE']); // has quotation.manage, not .award
    const lineIds = w.lineIds;
    const res = await exec.client.post(`/rfqs/${w.rfqId}/evaluation/award`, {
      lines: lineIds.map((rfqLineId) => ({ rfqLineId, quotationId: w.quotations[0] })),
      rationale: 'Attempting to award without the award permission.',
    });
    expect(res.status).toBe(403);
    expect((await exec.client.get(`/rfqs/${w.rfqId}/comparison`)).status).toBe(200);
  });

  it('keeps every award out of reach of another company', async () => {
    const w = await evaluated();
    const rec = await recommendAll(w, w.quotations[0]!);
    const other = await h.company();
    const stranger = await h.as(other, ['PROCUREMENT_MANAGER']);
    expect((await stranger.client.get(`/awards/${rec.body.id}`)).status).toBe(404);
    expect((await stranger.client.get(`/rfqs/${w.rfqId}/comparison`)).status).toBe(404);
  });

  it('produces the recommendation, approval and final award documents', async () => {
    const w = await evaluated();
    const rec = await recommendAll(w, w.quotations[0]!);
    const id = rec.body.id as string;

    expect((await w.mgr.client.get(`/awards/${id}/recommendation`)).body.subarray(0, 5).toString()).toBe('%PDF-');
    // The final award document exists only once the award is issued.
    expect((await w.mgr.client.get(`/awards/${id}/document`)).status).toBe(409);

    await approveAward(w, id);
    await w.mgr.client.post(`/awards/${id}/issue`, {});

    expect((await w.mgr.client.get(`/awards/${id}/approval-report`)).body.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await w.mgr.client.get(`/awards/${id}/document`)).body.subarray(0, 5).toString()).toBe('%PDF-');
    const csv = await w.mgr.client.get(`/awards/${id}/export`);
    expect(csv.text ?? csv.body.toString()).toMatch(/Vendor code/);
  });

  it('records the whole award trail with actors and timestamps', async () => {
    const w = await evaluated();
    const rec = await recommendAll(w, w.quotations[0]!);
    await approveAward(w, rec.body.id);
    await w.mgr.client.post(`/awards/${rec.body.id}/issue`, {});

    const award = (await w.mgr.client.get(`/awards/${rec.body.id}`)).body;
    expect((award.events as Array<{ toStatus: string }>).map((e) => e.toStatus)).toEqual(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'AWARDED']);
    expect(award.events.every((e: { occurredAt: string }) => !!e.occurredAt)).toBe(true);
    // The last approver on record decided the award, not the recommender.
    expect(award.events[2].actor.id).not.toBe(w.mgr.user.id);
    await expect(h.prisma.rfqAwardEvent.deleteMany({ where: { awardId: rec.body.id } })).rejects.toThrow();
  });
});
