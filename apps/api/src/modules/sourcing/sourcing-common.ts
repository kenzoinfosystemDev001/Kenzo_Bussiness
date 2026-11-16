import { Injectable } from '@nestjs/common';
import { Prisma, type PurchaseRequisition, type Rfq, type Vendor } from '@prisma/client';
import { REQUISITION_STATUS_LABELS, REQUISITION_TRANSITIONS, RFQ_STATUS_LABELS, RFQ_TRANSITIONS, type RequisitionStatus, type RfqStatus } from '@kenzo/shared';
import type { AuthContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { AuditService } from '../../infrastructure/audit/audit.service';
import type { Db, Tx } from '../../infrastructure/prisma/prisma.service';

/** Prisma Decimal → canonical string (never a JS float). */
export const dec = (d: Prisma.Decimal | null | undefined, scale = 2): string | null => (d === null || d === undefined ? null : d.toFixed(scale));

export const todayUtc = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

@Injectable()
export class SourcingCommon {
  constructor(private readonly audit: AuditService) {}

  async lockRequisition(tx: Tx, id: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM purchase_requisition WHERE id = ${id}::uuid FOR UPDATE`;
  }
  async lockRfq(tx: Tx, id: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM rfq WHERE id = ${id}::uuid FOR UPDATE`;
  }
  async lockQuotation(tx: Tx, id: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM quotation WHERE id = ${id}::uuid FOR UPDATE`;
  }

  async loadRequisition(db: Db, auth: AuthContext, id: string): Promise<PurchaseRequisition> {
    const r = await db.purchaseRequisition.findFirst({ where: { id, companyId: auth.companyId } });
    if (!r) throw AppError.notFound('Requisition');
    return r;
  }

  async loadRfq(db: Db, auth: AuthContext, id: string): Promise<Rfq> {
    const r = await db.rfq.findFirst({ where: { id, companyId: auth.companyId } });
    if (!r) throw AppError.notFound('RFQ');
    return r;
  }

  async transitionRequisition(
    tx: Tx,
    r: PurchaseRequisition,
    to: RequisitionStatus,
    opts: { actorId: string | null; reason?: string | null; data?: Prisma.PurchaseRequisitionUncheckedUpdateInput },
  ): Promise<PurchaseRequisition> {
    if (!REQUISITION_TRANSITIONS[r.status].includes(to)) {
      throw AppError.invalidState(`A ${REQUISITION_STATUS_LABELS[r.status].toLowerCase()} requisition cannot become ${REQUISITION_STATUS_LABELS[to].toLowerCase()}`, {
        from: r.status,
        to,
      });
    }
    const res = await tx.purchaseRequisition.updateMany({
      where: { id: r.id, status: r.status, version: r.version },
      data: { status: to, statusReason: opts.reason ?? null, updatedById: opts.actorId, version: { increment: 1 }, ...(opts.data ?? {}) },
    });
    if (res.count !== 1) throw AppError.versionConflict();
    await tx.requisitionStatusHistory.create({ data: { requisitionId: r.id, fromStatus: r.status, toStatus: to, actorId: opts.actorId, reason: opts.reason ?? null } });
    await this.audit.record(tx, {
      action: `requisition.status.${to.toLowerCase()}`,
      entityType: 'purchase_requisition',
      entityId: r.id,
      companyId: r.companyId,
      actorId: opts.actorId,
      before: { status: r.status },
      after: { status: to },
      reason: opts.reason ?? null,
    });
    return tx.purchaseRequisition.findUniqueOrThrow({ where: { id: r.id } });
  }

  async transitionRfq(tx: Tx, r: Rfq, to: RfqStatus, opts: { actorId: string | null; reason?: string | null; data?: Prisma.RfqUncheckedUpdateInput }): Promise<Rfq> {
    if (!RFQ_TRANSITIONS[r.status].includes(to)) {
      throw AppError.invalidState(`A ${RFQ_STATUS_LABELS[r.status].toLowerCase()} RFQ cannot move to ${RFQ_STATUS_LABELS[to].toLowerCase()}`, { from: r.status, to });
    }
    const res = await tx.rfq.updateMany({
      where: { id: r.id, status: r.status, version: r.version },
      data: { status: to, statusReason: opts.reason ?? null, updatedById: opts.actorId, version: { increment: 1 }, ...(opts.data ?? {}) },
    });
    if (res.count !== 1) throw AppError.versionConflict();
    await tx.rfqStatusHistory.create({ data: { rfqId: r.id, fromStatus: r.status, toStatus: to, actorId: opts.actorId, reason: opts.reason ?? null } });
    await this.audit.record(tx, {
      action: `rfq.status.${to.toLowerCase()}`,
      entityType: 'rfq',
      entityId: r.id,
      companyId: r.companyId,
      actorId: opts.actorId,
      before: { status: r.status },
      after: { status: to },
      reason: opts.reason ?? null,
    });
    return tx.rfq.findUniqueOrThrow({ where: { id: r.id } });
  }

  /** Vendors that may be sourced from: ACTIVE in the company. */
  async eligibleVendor(db: Db, companyId: string, vendorId: string, purpose: string): Promise<Vendor> {
    const v = await db.vendor.findFirst({ where: { id: vendorId, companyId } });
    if (!v) throw AppError.validation([{ path: 'vendorId', message: 'Vendor not found' }]);
    if (v.status !== 'ACTIVE') {
      throw AppError.validation([{ path: 'vendorId', message: `${v.legalName} is ${v.status.toLowerCase()} — only active vendors can be used for ${purpose}` }]);
    }
    return v;
  }

  /** Best address for RFQ correspondence: primary contact email, vendor email, then any contact email. */
  async vendorEmail(db: Db, vendor: Vendor): Promise<string | null> {
    const contacts = await db.vendorContact.findMany({ where: { vendorId: vendor.id, email: { not: null } }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] });
    return contacts.find((c) => c.isPrimary)?.email ?? vendor.email ?? contacts[0]?.email ?? null;
  }
}
