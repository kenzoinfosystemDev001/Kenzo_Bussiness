import { randomUUID } from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { ApprovalInstance, Prisma, PurchaseRequisition } from '@prisma/client';
import { computeDocumentTotals, taxRateFor, type RequisitionInput } from '@kenzo/shared';
import type { AuthContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { NotificationService } from '../../infrastructure/notifications/notification.service';
import { NumberingService } from '../../infrastructure/numbering/numbering.service';
import { PrismaService, type Db, type Tx } from '../../infrastructure/prisma/prisma.service';
import { AuthorizationService } from '../access-control/authorization.service';
import { SegregationOfDutiesService } from '../access-control/segregation-of-duties.service';
import { DocumentsService } from '../documents/documents.service';
import { ApprovalEngine } from '../workflow/approval-engine.service';
import { ApprovalHooksRegistry } from '../workflow/approval-hooks';
import { dec, SourcingCommon } from './sourcing-common';

const EDITABLE = ['DRAFT', 'RETURNED', 'WITHDRAWN'] as const;

@Injectable()
export class RequisitionsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly common: SourcingCommon,
    private readonly numbering: NumberingService,
    private readonly engine: ApprovalEngine,
    private readonly hooks: ApprovalHooksRegistry,
    private readonly authz: AuthorizationService,
    private readonly sod: SegregationOfDutiesService,
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit(): void {
    this.hooks.register('purchase_requisition', {
      onApproved: (tx, i) => this.onOutcome(tx, i, 'APPROVED', 'All approval stages approved'),
      onRejected: (tx, i, reason) => this.onOutcome(tx, i, 'REJECTED', reason),
      onReturned: (tx, i, reason) => this.onOutcome(tx, i, 'RETURNED', reason),
      onCancelled: (tx, i, reason) => this.onOutcome(tx, i, 'WITHDRAWN', reason),
    });
    this.documents.registerLinkAccess('purchase_requisition', async (db, auth, id) => {
      const r = await db.purchaseRequisition.findFirst({ where: { id, companyId: auth.companyId } });
      return !!r && (await this.canRead(db, auth, r));
    });
  }

  private async onOutcome(tx: Tx, instance: ApprovalInstance, to: 'APPROVED' | 'REJECTED' | 'RETURNED' | 'WITHDRAWN', reason: string) {
    const r = await tx.purchaseRequisition.findUniqueOrThrow({ where: { id: instance.entityId } });
    const decider = await tx.approvalTask.findFirst({
      where: { instanceId: instance.id, status: { in: ['APPROVED', 'REJECTED', 'RETURNED'] } },
      orderBy: { decidedAt: 'desc' },
    });
    await this.common.transitionRequisition(tx, r, to, {
      actorId: to === 'WITHDRAWN' ? r.requesterId : (decider?.decidedById ?? null),
      reason,
      data: to === 'APPROVED' ? { approvedAt: new Date() } : {},
    });
  }

  /** Requesters see their own, scoped readers their department/company, approvers what they act on. */
  async canRead(db: Db, auth: AuthContext, r: PurchaseRequisition): Promise<boolean> {
    if (this.authz.can(auth, 'requisition.read', { companyId: r.companyId, departmentId: r.departmentId, ownerId: r.requesterId })) return true;
    if (r.requesterId === auth.userId) return true;
    const task = await db.approvalTask.count({
      where: { OR: [{ assigneeId: auth.userId }, { delegatedFromId: auth.userId }], instance: { companyId: auth.companyId, entityType: 'purchase_requisition', entityId: r.id } },
    });
    return task > 0;
  }

  private async assertReadable(db: Db, auth: AuthContext, r: PurchaseRequisition) {
    if (!(await this.canRead(db, auth, r))) throw AppError.notFound('Requisition');
  }

  /** Validates references and computes line + header totals with exact decimals. */
  private async buildLines(db: Db, auth: AuthContext, input: RequisitionInput) {
    const dept = await db.department.findFirst({ where: { id: input.departmentId, companyId: auth.companyId, isActive: true } });
    if (!dept) throw AppError.validation([{ path: 'departmentId', message: 'Department not found or inactive' }]);
    if (input.costCentreId) {
      const cc = await db.costCentre.findFirst({ where: { id: input.costCentreId, companyId: auth.companyId, isActive: true } });
      if (!cc) throw AppError.validation([{ path: 'costCentreId', message: 'Cost centre not found or inactive' }]);
    }
    const vendorIds = [...new Set(input.lines.map((l) => l.preferredVendorId).filter((v): v is string => !!v))];
    if (vendorIds.length) {
      const ok = await db.vendor.count({ where: { id: { in: vendorIds }, companyId: auth.companyId, status: { in: ['ACTIVE', 'APPROVED'] } } });
      if (ok !== vendorIds.length) throw AppError.validation([{ path: 'lines', message: 'A preferred vendor is not an approved/active vendor' }]);
    }
    const rates = input.lines.map((l) => taxRateFor(l.taxCategory)!);
    const totals = computeDocumentTotals(input.lines.map((l, i) => ({ quantity: l.quantity, unitPrice: l.estimatedUnitPrice, taxRate: rates[i]! })));
    const lines = input.lines.map((l, i) => ({
      companyId: auth.companyId,
      lineNo: i + 1,
      itemType: l.itemType,
      description: l.description,
      quantity: l.quantity,
      uom: l.uom,
      estimatedUnitPrice: l.estimatedUnitPrice,
      taxCategory: l.taxCategory,
      taxRate: rates[i]!,
      lineSubtotal: totals.lines[i]!.taxable,
      lineTax: totals.lines[i]!.tax,
      lineTotal: totals.lines[i]!.total,
      preferredVendorId: l.preferredVendorId ?? null,
    }));
    return { lines, header: { estimatedSubtotal: totals.taxableTotal, estimatedTax: totals.taxTotal, estimatedTotal: Dec2(totals.taxableTotal, totals.taxTotal) } };
  }

  async create(auth: AuthContext, input: RequisitionInput) {
    const id = await this.prisma.tx(async (tx) => {
      const { lines, header } = await this.buildLines(tx, auth, input);
      const reqId = randomUUID();
      const no = await this.numbering.next(tx, { companyId: auth.companyId, documentType: 'purchase_requisition', entityId: reqId, issuedById: auth.userId });
      await tx.purchaseRequisition.create({
        data: {
          id: reqId,
          companyId: auth.companyId,
          requisitionNo: no,
          title: input.title,
          requesterId: auth.userId,
          departmentId: input.departmentId,
          costCentreId: input.costCentreId ?? null,
          justification: input.justification,
          requiredBy: new Date(`${input.requiredBy}T00:00:00Z`),
          deliveryLocation: input.deliveryLocation,
          priority: input.priority,
          ...header,
          updatedById: auth.userId,
          lines: { create: lines.map(({ companyId: _c, ...l }) => l) },
        },
      });
      await tx.requisitionStatusHistory.create({ data: { requisitionId: reqId, fromStatus: null, toStatus: 'DRAFT', actorId: auth.userId, reason: 'Requisition drafted' } });
      await this.audit.record(tx, {
        action: 'requisition.created',
        entityType: 'purchase_requisition',
        entityId: reqId,
        after: { requisitionNo: no, title: input.title, lines: lines.length, estimatedTotal: header.estimatedTotal },
      });
      return reqId;
    });
    return this.detail(auth, id);
  }

  async update(auth: AuthContext, id: string, input: RequisitionInput & { version: number }) {
    await this.prisma.tx(async (tx) => {
      await this.common.lockRequisition(tx, id);
      const r = await this.common.loadRequisition(tx, auth, id);
      if (r.requesterId !== auth.userId) throw AppError.forbidden('Only the requester can edit this requisition');
      if (!(EDITABLE as readonly string[]).includes(r.status)) throw AppError.invalidState('Only draft, returned or withdrawn requisitions can be edited');
      const { lines, header } = await this.buildLines(tx, auth, input);
      const res = await tx.purchaseRequisition.updateMany({
        where: { id, version: input.version },
        data: {
          title: input.title,
          departmentId: input.departmentId,
          costCentreId: input.costCentreId ?? null,
          justification: input.justification,
          requiredBy: new Date(`${input.requiredBy}T00:00:00Z`),
          deliveryLocation: input.deliveryLocation,
          priority: input.priority,
          ...header,
          updatedById: auth.userId,
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) throw AppError.versionConflict();
      await tx.requisitionLine.deleteMany({ where: { requisitionId: id } });
      await tx.requisitionLine.createMany({ data: lines.map((l) => ({ ...l, requisitionId: id })) });
      await this.audit.record(tx, {
        action: 'requisition.updated',
        entityType: 'purchase_requisition',
        entityId: id,
        before: { estimatedTotal: dec(r.estimatedTotal) },
        after: { estimatedTotal: header.estimatedTotal, lines: lines.length },
      });
    });
    return this.detail(auth, id);
  }

  /** DRAFT/RETURNED/WITHDRAWN → SUBMITTED → PENDING_APPROVAL via the shared approval engine. */
  async submit(auth: AuthContext, id: string, note?: string | null) {
    await this.prisma.tx(async (tx) => {
      await this.common.lockRequisition(tx, id);
      let r = await this.common.loadRequisition(tx, auth, id);
      if (r.requesterId !== auth.userId) throw AppError.forbidden('Only the requester can submit this requisition');
      if (new Date(r.requiredBy) < new Date(new Date().toISOString().slice(0, 10))) {
        throw AppError.validation([{ path: 'requiredBy', message: 'Required-by date has passed — update it before submitting' }]);
      }
      r = await this.common.transitionRequisition(tx, r, 'SUBMITTED', { actorId: auth.userId, reason: note ?? 'Submitted for approval', data: { submittedAt: new Date() } });
      await this.engine.submit(tx, auth, {
        entityType: 'purchase_requisition',
        entityId: r.id,
        entityReference: r.requisitionNo,
        entitySummary: `${r.title} · ${r.priority.toLowerCase()} priority`,
        amount: dec(r.estimatedTotal),
        currencyCode: r.currency,
        departmentId: r.departmentId,
        requesterId: r.requesterId,
      });
      await this.common.transitionRequisition(tx, r, 'PENDING_APPROVAL', { actorId: auth.userId, reason: 'Routed to approvers by policy' });
    });
    return this.detail(auth, id);
  }

  async withdraw(auth: AuthContext, id: string, reason: string) {
    const r = await this.common.loadRequisition(this.prisma, auth, id);
    if (r.requesterId !== auth.userId) throw AppError.forbidden('Only the requester can withdraw this requisition');
    if (r.status !== 'PENDING_APPROVAL') throw AppError.invalidState('Only requisitions pending approval can be withdrawn');
    const instance = await this.prisma.approvalInstance.findFirst({ where: { companyId: auth.companyId, entityType: 'purchase_requisition', entityId: id, status: 'PENDING' } });
    if (!instance) throw AppError.invalidState('No pending approval found');
    await this.engine.cancel(auth, instance.id, reason);
    return this.detail(auth, id);
  }

  async cancel(auth: AuthContext, id: string, reason: string) {
    await this.prisma.tx(async (tx) => {
      await this.common.lockRequisition(tx, id);
      const r = await this.common.loadRequisition(tx, auth, id);
      const isRequester = r.requesterId === auth.userId;
      if (r.status === 'APPROVED') {
        if (!isRequester && !this.authz.has(auth, 'rfq.manage')) throw AppError.forbidden();
        if (r.sourcingRoute !== 'NONE') throw AppError.invalidState('Sourcing has started — cancel the RFQ first');
      } else if (!isRequester) {
        throw AppError.forbidden('Only the requester can cancel this requisition');
      }
      await this.common.transitionRequisition(tx, r, 'CANCELLED', { actorId: auth.userId, reason });
    });
    return this.detail(auth, id);
  }

  /** Authorized direct-purchase path for an approved requisition (no RFQ). PO creation follows in Phase 04. */
  async chooseDirectPurchase(auth: AuthContext, id: string, vendorId: string, reason: string) {
    await this.prisma.tx(async (tx) => {
      await this.common.lockRequisition(tx, id);
      const r = await this.common.loadRequisition(tx, auth, id);
      if (r.status !== 'APPROVED') throw AppError.invalidState('Only approved requisitions can be sourced');
      if (r.sourcingRoute !== 'NONE') throw AppError.invalidState(`Sourcing route already chosen (${r.sourcingRoute})`);
      this.sod.assert('SELF_APPROVAL', auth.userId, [r.requesterId]);
      const vendor = await this.common.eligibleVendor(tx, auth.companyId, vendorId, 'direct purchase');
      await tx.purchaseRequisition.update({
        where: { id },
        data: { sourcingRoute: 'DIRECT', directVendorId: vendor.id, directReason: reason, updatedById: auth.userId, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        action: 'requisition.direct_purchase_chosen',
        entityType: 'purchase_requisition',
        entityId: id,
        after: { vendorId: vendor.id, vendorCode: vendor.vendorCode },
        reason,
      });
      await this.notifications.notify(tx, {
        companyId: auth.companyId,
        userId: r.requesterId,
        type: 'requisition.direct_purchase',
        title: `${r.requisitionNo} will be purchased directly from ${vendor.legalName}`,
        body: reason,
        link: `/requisitions/${id}`,
        entityType: 'purchase_requisition',
        entityId: id,
      });
    });
    return this.detail(auth, id);
  }

  async addAttachment(auth: AuthContext, id: string, file: { originalname: string; buffer: Buffer; size: number }) {
    const r = await this.common.loadRequisition(this.prisma, auth, id);
    if (r.requesterId !== auth.userId && !this.authz.has(auth, 'rfq.manage')) throw AppError.forbidden();
    if (['CANCELLED', 'REJECTED'].includes(r.status)) throw AppError.invalidState('Closed requisitions cannot receive attachments');
    const doc = await this.documents.upload(auth, file, { entityType: 'purchase_requisition', entityId: id });
    return { id: doc.id, originalName: doc.originalName, mimeType: doc.mimeType, sizeBytes: doc.sizeBytes, createdAt: doc.createdAt };
  }

  async list(
    auth: AuthContext,
    q: {
      page: number;
      pageSize: number;
      q?: string;
      status: string[];
      scope: 'mine' | 'all';
      departmentId?: string;
      priority?: string;
      sourcing?: 'ready' | 'rfq' | 'direct';
      sort: string;
      order: 'asc' | 'desc';
    },
  ) {
    const and: Prisma.PurchaseRequisitionWhereInput[] = [{ companyId: auth.companyId }];
    const scope = this.authz.scopeFilter(auth, 'requisition.read', { department: 'departmentId', owner: 'requesterId' });
    if (q.scope === 'mine' || !scope) and.push({ requesterId: auth.userId });
    else and.push(scope as Prisma.PurchaseRequisitionWhereInput);
    if (q.status.length) and.push({ status: { in: q.status as PurchaseRequisition['status'][] } });
    if (q.departmentId) and.push({ departmentId: q.departmentId });
    if (q.priority) and.push({ priority: q.priority as PurchaseRequisition['priority'] });
    if (q.sourcing === 'ready') and.push({ status: 'APPROVED', sourcingRoute: 'NONE' });
    if (q.sourcing === 'rfq') and.push({ sourcingRoute: 'RFQ' });
    if (q.sourcing === 'direct') and.push({ sourcingRoute: 'DIRECT' });
    if (q.q) {
      and.push({
        OR: [
          { requisitionNo: { contains: q.q, mode: 'insensitive' } },
          { title: { contains: q.q, mode: 'insensitive' } },
          { lines: { some: { description: { contains: q.q, mode: 'insensitive' } } } },
        ],
      });
    }
    const where: Prisma.PurchaseRequisitionWhereInput = { AND: and };
    const [total, items] = await Promise.all([
      this.prisma.purchaseRequisition.count({ where }),
      this.prisma.purchaseRequisition.findMany({
        where,
        include: {
          requester: { select: { id: true, fullName: true } },
          department: { select: { id: true, name: true } },
          _count: { select: { lines: true } },
        },
        orderBy: [{ [q.sort]: q.order }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return { total, page: q.page, pageSize: q.pageSize, items: items.map((r) => this.headerView(r)) };
  }

  private headerView<T extends PurchaseRequisition>(r: T) {
    return { ...r, estimatedSubtotal: dec(r.estimatedSubtotal), estimatedTax: dec(r.estimatedTax), estimatedTotal: dec(r.estimatedTotal) };
  }

  /** Requisition dashboard: live counts for the viewer's scope. */
  async stats(auth: AuthContext) {
    const scope = this.authz.scopeFilter(auth, 'requisition.read', { department: 'departmentId', owner: 'requesterId' }) ?? { companyId: auth.companyId, requesterId: auth.userId };
    const where = scope as Prisma.PurchaseRequisitionWhereInput;
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const [byStatus, mine, readyForSourcing, approvedValue, pendingMyApproval, recent] = await Promise.all([
      this.prisma.purchaseRequisition.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.purchaseRequisition.groupBy({ by: ['status'], where: { companyId: auth.companyId, requesterId: auth.userId }, _count: { _all: true } }),
      this.prisma.purchaseRequisition.count({ where: { ...where, status: 'APPROVED', sourcingRoute: 'NONE' } }),
      this.prisma.purchaseRequisition.aggregate({ where: { ...where, status: 'APPROVED', approvedAt: { gte: monthStart } }, _sum: { estimatedTotal: true }, _count: { _all: true } }),
      this.prisma.approvalTask.count({ where: { assigneeId: auth.userId, status: 'PENDING', instance: { companyId: auth.companyId, entityType: 'purchase_requisition' } } }),
      this.prisma.purchaseRequisition.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: 8,
        select: { id: true, requisitionNo: true, title: true, status: true, priority: true, estimatedTotal: true, requiredBy: true, updatedAt: true, requester: { select: { fullName: true } } },
      }),
    ]);
    const count = (rows: Array<{ status: string; _count: { _all: number } }>) => Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
    return {
      byStatus: count(byStatus),
      mine: count(mine),
      readyForSourcing,
      pendingMyApproval,
      approvedThisMonth: { count: approvedValue._count._all, value: dec(approvedValue._sum.estimatedTotal) ?? '0.00' },
      recent: recent.map((r) => ({ ...r, estimatedTotal: dec(r.estimatedTotal) })),
    };
  }

  async detail(auth: AuthContext, id: string) {
    const r = await this.prisma.purchaseRequisition.findFirst({
      where: { id, companyId: auth.companyId },
      include: {
        requester: { select: { id: true, fullName: true, email: true } },
        department: { select: { id: true, name: true, code: true } },
        costCentre: { select: { id: true, code: true, name: true } },
        directVendor: { select: { id: true, vendorCode: true, legalName: true } },
        lines: { orderBy: { lineNo: 'asc' }, include: { preferredVendor: { select: { id: true, vendorCode: true, legalName: true } } } },
        statusHistory: { orderBy: { occurredAt: 'asc' }, include: { actor: { select: { id: true, fullName: true } } } },
        rfqs: { select: { id: true, rfqNo: true, title: true, status: true, responseDeadline: true }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!r) throw AppError.notFound('Requisition');
    await this.assertReadable(this.prisma, auth, r);
    const [approvals, attachments] = await Promise.all([
      this.prisma.approvalInstance.findMany({
        where: { companyId: auth.companyId, entityType: 'purchase_requisition', entityId: id },
        include: {
          tasks: { include: { assignee: { select: { id: true, fullName: true } }, stage: { select: { name: true } } }, orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }] },
          policy: { select: { name: true, policyVersion: true } },
        },
        orderBy: { submittedAt: 'desc' },
      }),
      this.prisma.documentLink.findMany({
        where: { entityType: 'purchase_requisition', entityId: id, document: { deletedAt: null, companyId: auth.companyId } },
        include: { document: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true } } },
      }),
    ]);
    const pending = approvals.find((a) => a.status === 'PENDING');
    return {
      ...this.headerView(r),
      lines: r.lines.map((l) => ({
        ...l,
        quantity: dec(l.quantity, 4),
        estimatedUnitPrice: dec(l.estimatedUnitPrice, 4),
        taxRate: dec(l.taxRate),
        lineSubtotal: dec(l.lineSubtotal),
        lineTax: dec(l.lineTax),
        lineTotal: dec(l.lineTotal),
      })),
      approvals: approvals.map((a) => ({ ...a, amount: dec(a.amount) })),
      attachments: attachments.map((a) => a.document),
      viewer: {
        isRequester: r.requesterId === auth.userId,
        canEdit: r.requesterId === auth.userId && (EDITABLE as readonly string[]).includes(r.status),
        canCreateRfq: this.authz.has(auth, 'rfq.manage') && r.status === 'APPROVED' && r.sourcingRoute === 'NONE',
        canChooseDirect: this.authz.has(auth, 'po.create') && r.status === 'APPROVED' && r.sourcingRoute === 'NONE' && r.requesterId !== auth.userId,
        pendingTaskId: pending?.tasks.find((t) => t.assigneeId === auth.userId && t.status === 'PENDING')?.id ?? null,
      },
    };
  }
}

function Dec2(a: string, b: string): string {
  // Exact sum of two 2-dp decimal strings via the shared totals helper semantics.
  const [ai, af = '0'] = a.split('.');
  const [bi, bf = '0'] = b.split('.');
  const cents = BigInt(ai!) * 100n + BigInt(af.padEnd(2, '0').slice(0, 2)) + BigInt(bi!) * 100n + BigInt(bf.padEnd(2, '0').slice(0, 2));
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}
