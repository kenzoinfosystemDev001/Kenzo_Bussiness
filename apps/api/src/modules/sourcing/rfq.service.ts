import { randomUUID } from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Prisma, type ApprovalInstance, type Rfq, type RfqInvitation } from '@prisma/client';
import { RFQ_STATUS_LABELS, type RfqInput } from '@kenzo/shared';
import type { AuthContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { NotificationService } from '../../infrastructure/notifications/notification.service';
import { NumberingService } from '../../infrastructure/numbering/numbering.service';
import { renderPdf, type PdfBlock } from '../../infrastructure/pdf/simple-pdf';
import { PrismaService, type Db, type Tx } from '../../infrastructure/prisma/prisma.service';
import { AuthorizationService } from '../access-control/authorization.service';
import { DocumentsService } from '../documents/documents.service';
import { ApprovalEngine } from '../workflow/approval-engine.service';
import { ApprovalHooksRegistry } from '../workflow/approval-hooks';
import { dec, SourcingCommon } from './sourcing-common';

/** Statuses in which an RFQ still accepts quotations. */
const OPEN_FOR_RESPONSES = ['SENT', 'PARTIALLY_RESPONDED', 'RESPONSES_RECEIVED'] as const;

@Injectable()
export class RfqService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly common: SourcingCommon,
    private readonly numbering: NumberingService,
    private readonly engine: ApprovalEngine,
    private readonly hooks: ApprovalHooksRegistry,
    private readonly authz: AuthorizationService,
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit(): void {
    // Standalone RFQs need authorisation before they may be sent to vendors.
    this.hooks.register('rfq', {
      onApproved: (tx, i) => this.onApprovalOutcome(tx, i, 'APPROVED', 'Standalone RFQ approved'),
      onRejected: (tx, i, reason) => this.onApprovalOutcome(tx, i, 'CANCELLED', reason),
      onReturned: (tx, i, reason) => this.onApprovalOutcome(tx, i, 'DRAFT', `Returned for clarification: ${reason}`),
      onCancelled: (tx, i, reason) => this.onApprovalOutcome(tx, i, 'DRAFT', `Withdrawn: ${reason}`),
    });
    this.documents.registerLinkAccess('rfq', async (db, auth, id) => {
      if (!this.authz.has(auth, 'rfq.read')) return false;
      return (await db.rfq.count({ where: { id, companyId: auth.companyId } })) === 1;
    });
  }

  private async onApprovalOutcome(tx: Tx, instance: ApprovalInstance, to: 'APPROVED' | 'CANCELLED' | 'DRAFT', reason: string) {
    const rfq = await tx.rfq.findUniqueOrThrow({ where: { id: instance.entityId } });
    const decider = await tx.approvalTask.findFirst({
      where: { instanceId: instance.id, status: { in: ['APPROVED', 'REJECTED', 'RETURNED'] } },
      orderBy: { decidedAt: 'desc' },
    });
    await this.common.transitionRfq(tx, rfq, to, { actorId: decider?.decidedById ?? null, reason });
  }

  // ── Creation ─────────────────────────────────────────────────────────────

  async create(auth: AuthContext, input: RfqInput) {
    const id = await this.prisma.tx(async (tx) => {
      const rfqId = randomUUID();
      let lines: Prisma.RfqLineCreateManyRfqInput[];
      let deliveryLocation = input.deliveryLocation;

      if (input.requisitionId) {
        const req = await this.common.loadRequisition(tx, auth, input.requisitionId);
        await this.common.lockRequisition(tx, req.id);
        if (req.status !== 'APPROVED') throw AppError.invalidState('Only an approved requisition can source an RFQ');
        if (req.sourcingRoute === 'DIRECT') throw AppError.invalidState('This requisition is being bought directly from a vendor');
        const live = await tx.rfq.findFirst({ where: { requisitionId: req.id, status: { not: 'CANCELLED' } } });
        if (live) throw AppError.invalidState(`RFQ ${live.rfqNo} already sources this requisition`);

        const reqLines = await tx.requisitionLine.findMany({ where: { requisitionId: req.id }, orderBy: { lineNo: 'asc' } });
        const chosen = input.requisitionLineIds?.length ? reqLines.filter((l) => input.requisitionLineIds!.includes(l.id)) : reqLines;
        if (chosen.length === 0) throw AppError.validation([{ path: 'requisitionLineIds', message: 'Select at least one requisition line' }]);
        lines = chosen.map((l, i) => ({
          lineNo: i + 1,
          requisitionLineId: l.id,
          itemType: l.itemType,
          description: l.description,
          specification: null,
          quantity: l.quantity,
          uom: l.uom,
        }));
        deliveryLocation = input.deliveryLocation || req.deliveryLocation;
        await tx.purchaseRequisition.update({ where: { id: req.id }, data: { sourcingRoute: 'RFQ', updatedById: auth.userId, version: { increment: 1 } } });
      } else {
        this.authz.assertCan(auth, 'rfq.standalone');
        lines = (input.lines ?? []).map((l, i) => ({
          lineNo: i + 1,
          requisitionLineId: null,
          itemType: l.itemType,
          description: l.description,
          specification: l.specification ?? null,
          quantity: l.quantity,
          uom: l.uom,
        }));
      }

      const rfqNo = await this.numbering.next(tx, { companyId: auth.companyId, documentType: 'rfq', entityId: rfqId, issuedById: auth.userId });
      await tx.rfq.create({
        data: {
          id: rfqId,
          companyId: auth.companyId,
          rfqNo,
          requisitionId: input.requisitionId ?? null,
          title: input.title,
          description: input.description ?? null,
          deliveryRequirements: input.deliveryRequirements ?? null,
          deliveryLocation,
          responseDeadline: new Date(input.responseDeadline),
          submissionInstructions: input.submissionInstructions ?? null,
          termsAndConditions: input.termsAndConditions ?? null,
          currency: input.currency,
          isStandalone: !input.requisitionId,
          allowPartialAward: input.allowPartialAward,
          standaloneReason: input.requisitionId ? null : (input.standaloneReason ?? null),
          createdById: auth.userId,
          updatedById: auth.userId,
          lines: { createMany: { data: lines } },
        },
      });
      await tx.rfqStatusHistory.create({ data: { rfqId, fromStatus: null, toStatus: 'DRAFT', actorId: auth.userId, reason: 'RFQ drafted' } });
      await this.audit.record(tx, {
        action: 'rfq.created',
        entityType: 'rfq',
        entityId: rfqId,
        after: { rfqNo, requisitionId: input.requisitionId ?? null, standalone: !input.requisitionId, lines: lines.length },
      });
      for (const vendorId of [...new Set(input.vendorIds)]) await this.inviteOne(tx, auth, rfqId, vendorId, false);
      return rfqId;
    });
    return this.detail(auth, id);
  }

  async update(auth: AuthContext, id: string, input: Record<string, unknown> & { version: number }) {
    await this.prisma.tx(async (tx) => {
      await this.common.lockRfq(tx, id);
      const rfq = await this.common.loadRfq(tx, auth, id);
      if (rfq.status !== 'DRAFT') throw AppError.invalidState('Only a draft RFQ can be edited');
      const { version, ...changes } = input;
      if (changes.responseDeadline) changes.responseDeadline = new Date(changes.responseDeadline as string);
      const res = await tx.rfq.updateMany({ where: { id, version }, data: { ...changes, updatedById: auth.userId, version: { increment: 1 } } });
      if (res.count !== 1) throw AppError.versionConflict();
      await this.audit.record(tx, { action: 'rfq.updated', entityType: 'rfq', entityId: id, after: changes });
    });
    return this.detail(auth, id);
  }

  /** Standalone RFQs go through approval; requisition-sourced ones are already authorised. */
  async submitForApproval(auth: AuthContext, id: string) {
    await this.prisma.tx(async (tx) => {
      await this.common.lockRfq(tx, id);
      const rfq = await this.common.loadRfq(tx, auth, id);
      if (rfq.status !== 'DRAFT') throw AppError.invalidState('Only a draft RFQ can be submitted');
      if (!rfq.isStandalone) throw AppError.invalidState('This RFQ is sourced from an approved requisition — approve and send it directly');
      await this.assertSendable(tx, rfq);
      await this.engine.submit(tx, auth, {
        entityType: 'rfq',
        entityId: rfq.id,
        entityReference: rfq.rfqNo,
        entitySummary: `${rfq.title} (standalone RFQ)`,
        requesterId: auth.userId,
      });
      await this.common.transitionRfq(tx, rfq, 'PENDING_APPROVAL', { actorId: auth.userId, reason: rfq.standaloneReason });
    });
    return this.detail(auth, id);
  }

  async approve(auth: AuthContext, id: string, reason?: string | null) {
    await this.prisma.tx(async (tx) => {
      await this.common.lockRfq(tx, id);
      const rfq = await this.common.loadRfq(tx, auth, id);
      if (rfq.isStandalone && rfq.status === 'PENDING_APPROVAL') {
        throw AppError.invalidState('This RFQ is awaiting a decision in the approval inbox');
      }
      await this.assertSendable(tx, rfq);
      await this.common.transitionRfq(tx, rfq, 'APPROVED', { actorId: auth.userId, reason: reason ?? 'Approved for issue' });
    });
    return this.detail(auth, id);
  }

  private async assertSendable(tx: Tx, rfq: Rfq) {
    const [lines, invitations] = await Promise.all([
      tx.rfqLine.count({ where: { rfqId: rfq.id } }),
      tx.rfqInvitation.count({ where: { rfqId: rfq.id, status: { not: 'WITHDRAWN' } } }),
    ]);
    const problems: Array<{ path: string; message: string }> = [];
    if (lines === 0) problems.push({ path: 'lines', message: 'Add at least one item' });
    if (invitations === 0) problems.push({ path: 'vendorIds', message: 'Invite at least one vendor' });
    if (rfq.responseDeadline <= new Date()) problems.push({ path: 'responseDeadline', message: 'The response deadline has passed — extend it first' });
    if (problems.length) throw AppError.validation(problems, 'The RFQ is not ready to send');
  }

  // ── Invitations ──────────────────────────────────────────────────────────

  private async inviteOne(tx: Tx, auth: AuthContext, rfqId: string, vendorId: string, sendNow: boolean): Promise<RfqInvitation> {
    const vendor = await this.common.eligibleVendor(tx, auth.companyId, vendorId, 'RFQ invitations');
    const existing = await tx.rfqInvitation.findFirst({ where: { rfqId, vendorId } });
    if (existing && existing.status !== 'WITHDRAWN') throw new AppError('CONFLICT', `${vendor.legalName} is already invited`);
    const email = await this.common.vendorEmail(tx, vendor);
    if (!email) throw AppError.validation([{ path: 'vendorIds', message: `${vendor.legalName} has no contact email — add one before inviting` }]);

    const invitation = existing
      ? await tx.rfqInvitation.update({
          where: { id: existing.id },
          data: { status: 'PENDING', recipientEmail: email, invitedById: auth.userId, invitedAt: new Date(), declineReason: null },
        })
      : await tx.rfqInvitation.create({ data: { companyId: auth.companyId, rfqId, vendorId, recipientEmail: email, invitedById: auth.userId } });
    await this.audit.record(tx, {
      action: 'rfq.vendor_invited',
      entityType: 'rfq',
      entityId: rfqId,
      after: { vendorId, vendorCode: vendor.vendorCode, email },
    });
    if (sendNow) await this.dispatchInvitation(tx, auth, rfqId, invitation.id);
    return invitation;
  }

  async invite(auth: AuthContext, rfqId: string, vendorIds: string[]) {
    await this.prisma.tx(async (tx) => {
      await this.common.lockRfq(tx, rfqId);
      const rfq = await this.common.loadRfq(tx, auth, rfqId);
      if (!['DRAFT', 'APPROVED', ...OPEN_FOR_RESPONSES].includes(rfq.status))
        throw AppError.invalidState(`Cannot invite vendors to a ${RFQ_STATUS_LABELS[rfq.status].toLowerCase()} RFQ`);
      for (const vendorId of [...new Set(vendorIds)]) await this.inviteOne(tx, auth, rfqId, vendorId, rfq.status !== 'DRAFT');
    });
    return this.detail(auth, rfqId);
  }

  async withdrawInvitation(auth: AuthContext, rfqId: string, invitationId: string, reason: string) {
    await this.prisma.tx(async (tx) => {
      await this.common.lockRfq(tx, rfqId);
      const inv = await tx.rfqInvitation.findFirst({
        where: { id: invitationId, rfqId, companyId: auth.companyId },
        include: { vendor: { select: { legalName: true } } },
      });
      if (!inv) throw AppError.notFound('Invitation');
      if (inv.status === 'RESPONDED') throw AppError.invalidState('This vendor has already responded');
      await tx.rfqInvitation.update({ where: { id: inv.id }, data: { status: 'WITHDRAWN', declineReason: reason } });
      await tx.rfqCommunication.create({
        data: {
          companyId: auth.companyId,
          rfqId,
          invitationId: inv.id,
          kind: 'INVITATION_WITHDRAWN',
          direction: 'INTERNAL',
          subject: `Invitation withdrawn: ${inv.vendor.legalName}`,
          body: reason,
          actorId: auth.userId,
        },
      });
      await this.audit.record(tx, { action: 'rfq.invitation_withdrawn', entityType: 'rfq', entityId: rfqId, before: { vendorId: inv.vendorId }, reason });
    });
    return this.detail(auth, rfqId);
  }

  /** Records a response received outside the system (email, portal, post). */
  async recordDecline(auth: AuthContext, rfqId: string, invitationId: string, reason: string) {
    await this.prisma.tx(async (tx) => {
      const inv = await tx.rfqInvitation.findFirst({
        where: { id: invitationId, rfqId, companyId: auth.companyId },
        include: { vendor: { select: { legalName: true } } },
      });
      if (!inv) throw AppError.notFound('Invitation');
      if (inv.status === 'RESPONDED') throw AppError.invalidState('This vendor has already submitted a quotation');
      await tx.rfqInvitation.update({ where: { id: inv.id }, data: { status: 'DECLINED', declineReason: reason, respondedAt: new Date() } });
      await tx.rfqCommunication.create({
        data: {
          companyId: auth.companyId,
          rfqId,
          invitationId: inv.id,
          kind: 'VENDOR_DECLINED',
          direction: 'INBOUND',
          subject: `${inv.vendor.legalName} declined to quote`,
          body: reason,
          actorId: auth.userId,
        },
      });
      await this.audit.record(tx, { action: 'rfq.vendor_declined', entityType: 'rfq', entityId: rfqId, after: { vendorId: inv.vendorId }, reason });
      await this.refreshResponseStatus(tx, rfqId, auth.userId);
    });
    return this.detail(auth, rfqId);
  }

  // ── Sending & reminders ──────────────────────────────────────────────────

  /** Builds the RFQ document vendors receive; its SHA-256 becomes part of the delivery evidence. */
  private async buildRfqPdf(db: Db, rfq: Rfq): Promise<Buffer> {
    const [company, lines] = await Promise.all([
      db.company.findUniqueOrThrow({ where: { id: rfq.companyId } }),
      db.rfqLine.findMany({ where: { rfqId: rfq.id }, orderBy: { lineNo: 'asc' } }),
    ]);
    const blocks: PdfBlock[] = [
      { text: company.legalName, style: 'small' },
      { text: `Request for Quotation ${rfq.rfqNo}`, style: 'title' },
      { text: rfq.title, style: 'heading' },
      { text: `Response deadline: ${rfq.responseDeadline.toISOString().replace('T', ' ').slice(0, 16)} UTC`, style: 'body', spaceBefore: 6 },
      { text: `Delivery location: ${rfq.deliveryLocation}`, style: 'body' },
      { text: `Quote in: ${rfq.currency}`, style: 'body' },
    ];
    if (rfq.description) blocks.push({ text: 'Scope', style: 'heading', spaceBefore: 10 }, { text: rfq.description, style: 'body' });
    blocks.push({ text: 'Items requested', style: 'heading', spaceBefore: 10 });
    for (const l of lines) {
      blocks.push({ text: `${l.lineNo}. ${l.description}`, style: 'body' });
      blocks.push({ text: `    Quantity: ${l.quantity.toFixed(4).replace(/\.?0+$/, '')} ${l.uom}   Type: ${l.itemType}`, style: 'mono' });
      if (l.specification) blocks.push({ text: `    Specification: ${l.specification}`, style: 'small' });
    }
    if (rfq.deliveryRequirements)
      blocks.push({ text: 'Delivery requirements', style: 'heading', spaceBefore: 10 }, { text: rfq.deliveryRequirements, style: 'body' });
    if (rfq.submissionInstructions)
      blocks.push({ text: 'How to respond', style: 'heading', spaceBefore: 10 }, { text: rfq.submissionInstructions, style: 'body' });
    if (rfq.termsAndConditions)
      blocks.push({ text: 'Terms and conditions', style: 'heading', spaceBefore: 10 }, { text: rfq.termsAndConditions, style: 'small' });
    blocks.push({
      text: 'This document is a request for quotation. It is not an order and creates no commitment to purchase.',
      style: 'small',
      spaceBefore: 14,
    });
    return renderPdf(blocks, { title: `RFQ ${rfq.rfqNo}`, footer: `${company.legalName} - RFQ ${rfq.rfqNo}` });
  }

  private async dispatchInvitation(tx: Tx, auth: AuthContext, rfqId: string, invitationId: string, isReminder = false, note?: string | null) {
    const rfq = await tx.rfq.findUniqueOrThrow({ where: { id: rfqId } });
    const inv = await tx.rfqInvitation.findUniqueOrThrow({ where: { id: invitationId }, include: { vendor: true } });
    const deadline = rfq.responseDeadline.toISOString().replace('T', ' ').slice(0, 16);
    const subject = isReminder ? `Reminder - quotation due ${deadline} UTC: RFQ ${rfq.rfqNo}` : `Request for quotation ${rfq.rfqNo}: ${rfq.title}`;
    const body = [
      `Dear ${inv.vendor.legalName},`,
      '',
      isReminder ? 'We have not yet received your quotation for the request below.' : 'You are invited to submit a quotation for the request below.',
      '',
      `RFQ number:        ${rfq.rfqNo}`,
      `Title:             ${rfq.title}`,
      `Response deadline: ${deadline} UTC`,
      `Delivery location: ${rfq.deliveryLocation}`,
      `Quote currency:    ${rfq.currency}`,
      ...(note ? ['', note] : []),
      ...(rfq.submissionInstructions ? ['', 'How to respond:', rfq.submissionInstructions] : []),
      '',
      'The full request is attached to this record in our procurement system.',
    ].join('\n');

    // The outbox event id is the delivery reference: it survives retries and ties
    // the communication log to the actual send attempt.
    const deliveryReference = await this.notifications.queueEmail(tx, {
      to: inv.recipientEmail,
      subject,
      text: body,
      template: isReminder ? 'rfq.reminder' : 'rfq.invitation',
      companyId: rfq.companyId,
      aggregateId: inv.id,
    });
    await tx.rfqCommunication.create({
      data: {
        companyId: rfq.companyId,
        rfqId,
        invitationId: inv.id,
        kind: isReminder ? 'REMINDER' : 'INVITATION',
        direction: 'OUTBOUND',
        subject,
        body,
        recipient: inv.recipientEmail,
        deliveryReference,
        evidenceDocumentId: rfq.rfqDocumentId,
        actorId: auth.userId,
      },
    });
    await tx.rfqInvitation.update({
      where: { id: inv.id },
      data: isReminder
        ? { lastReminderAt: new Date(), reminderCount: { increment: 1 } }
        : { status: inv.status === 'PENDING' ? 'SENT' : inv.status, sentAt: new Date() },
    });
  }

  /** APPROVED → SENT: generates the RFQ document and mails every pending invitation. */
  async send(auth: AuthContext, id: string) {
    const pdfOwner = await this.prisma.rfq.findFirst({ where: { id, companyId: auth.companyId } });
    if (!pdfOwner) throw AppError.notFound('RFQ');
    if (pdfOwner.status !== 'APPROVED') throw AppError.invalidState('Only an approved RFQ can be sent');
    // Generate outside the transaction: it writes to object storage.
    const pdf = await this.buildRfqPdf(this.prisma, pdfOwner);
    const stored = await this.documents.upload(
      auth,
      { originalname: `${pdfOwner.rfqNo}.pdf`, buffer: pdf, size: pdf.length },
      { entityType: 'rfq', entityId: id, linkType: 'RFQ_DOCUMENT' },
    );

    await this.prisma.tx(async (tx) => {
      await this.common.lockRfq(tx, id);
      const rfq = await this.common.loadRfq(tx, auth, id);
      if (rfq.status !== 'APPROVED') throw AppError.invalidState('Only an approved RFQ can be sent');
      await this.assertSendable(tx, rfq);
      const sent = await this.common.transitionRfq(tx, rfq, 'SENT', {
        actorId: auth.userId,
        reason: 'Issued to invited vendors',
        data: { sentAt: new Date(), rfqDocumentId: stored.id },
      });
      const pending = await tx.rfqInvitation.findMany({ where: { rfqId: id, status: 'PENDING' } });
      for (const inv of pending) await this.dispatchInvitation(tx, auth, id, inv.id);
      await this.audit.record(tx, {
        action: 'rfq.sent',
        entityType: 'rfq',
        entityId: id,
        after: { invitations: pending.length, documentId: stored.id, sha256: stored.sha256 },
      });
      return sent;
    });
    return this.detail(auth, id);
  }

  async remind(auth: AuthContext, id: string, invitationIds: string[] | undefined, message: string | null | undefined) {
    const result = await this.prisma.tx(async (tx) => {
      await this.common.lockRfq(tx, id);
      const rfq = await this.common.loadRfq(tx, auth, id);
      if (!(OPEN_FOR_RESPONSES as readonly string[]).includes(rfq.status)) throw AppError.invalidState('Reminders apply to an RFQ that is open for responses');
      const targets = await tx.rfqInvitation.findMany({
        where: { rfqId: id, status: { in: ['SENT', 'DELIVERED'] }, ...(invitationIds?.length ? { id: { in: invitationIds } } : {}) },
      });
      if (targets.length === 0) throw AppError.invalidState('No invited vendor is still awaiting a response');
      for (const inv of targets) await this.dispatchInvitation(tx, auth, id, inv.id, true, message);
      await this.audit.record(tx, { action: 'rfq.reminders_sent', entityType: 'rfq', entityId: id, after: { count: targets.length } });
      return targets.length;
    });
    return { reminded: result };
  }

  async extendDeadline(auth: AuthContext, id: string, responseDeadline: string, reason: string) {
    await this.prisma.tx(async (tx) => {
      await this.common.lockRfq(tx, id);
      const rfq = await this.common.loadRfq(tx, auth, id);
      if (['AWARDED', 'CANCELLED', 'CLOSED'].includes(rfq.status)) throw AppError.invalidState('This RFQ is closed');
      const next = new Date(responseDeadline);
      if (next <= rfq.responseDeadline)
        throw AppError.validation([{ path: 'responseDeadline', message: 'The new deadline must be later than the current one' }]);
      await tx.rfq.update({ where: { id }, data: { responseDeadline: next, updatedById: auth.userId, version: { increment: 1 } } });
      await tx.rfqCommunication.create({
        data: {
          companyId: auth.companyId,
          rfqId: id,
          kind: 'DEADLINE_EXTENDED',
          direction: 'INTERNAL',
          subject: `Deadline extended to ${next.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
          body: reason,
          actorId: auth.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'rfq.deadline_extended',
        entityType: 'rfq',
        entityId: id,
        before: { responseDeadline: rfq.responseDeadline },
        after: { responseDeadline: next },
        reason,
      });
      const open = await tx.rfqInvitation.findMany({ where: { rfqId: id, status: { in: ['SENT', 'DELIVERED'] } } });
      for (const inv of open) await this.dispatchInvitation(tx, auth, id, inv.id, true, `The response deadline has been extended. ${reason}`);
    });
    return this.detail(auth, id);
  }

  /** Keeps SENT / PARTIALLY_RESPONDED / RESPONSES_RECEIVED in step with the invitations. */
  async refreshResponseStatus(tx: Tx, rfqId: string, actorId: string | null) {
    const rfq = await tx.rfq.findUniqueOrThrow({ where: { id: rfqId } });
    if (!(OPEN_FOR_RESPONSES as readonly string[]).includes(rfq.status)) return;
    const invitations = await tx.rfqInvitation.findMany({ where: { rfqId, status: { not: 'WITHDRAWN' } } });
    const awaiting = invitations.filter((i) => i.status === 'SENT' || i.status === 'DELIVERED').length;
    const responded = invitations.filter((i) => i.status === 'RESPONDED').length;
    const target = awaiting === 0 ? 'RESPONSES_RECEIVED' : responded > 0 ? 'PARTIALLY_RESPONDED' : 'SENT';
    if (target !== rfq.status) {
      await this.common.transitionRfq(tx, rfq, target, { actorId, reason: `${responded} of ${invitations.length} invited vendors have responded` });
    }
  }

  async startEvaluation(auth: AuthContext, id: string) {
    await this.prisma.tx(async (tx) => {
      await this.common.lockRfq(tx, id);
      const rfq = await this.common.loadRfq(tx, auth, id);
      const quotations = await tx.quotation.count({ where: { rfqId: id, status: { notIn: ['DRAFT'] } } });
      if (quotations === 0) throw AppError.invalidState('Register at least one submitted quotation before evaluating');
      await this.common.transitionRfq(tx, rfq, 'EVALUATION', { actorId: auth.userId, reason: `Evaluating ${quotations} quotation(s)` });
      await tx.quotation.updateMany({ where: { rfqId: id, status: 'SUBMITTED' }, data: { status: 'UNDER_EVALUATION' } });
    });
    return this.detail(auth, id);
  }

  async cancel(auth: AuthContext, id: string, reason: string) {
    await this.prisma.tx(async (tx) => {
      await this.common.lockRfq(tx, id);
      const rfq = await this.common.loadRfq(tx, auth, id);
      if (rfq.status === 'PENDING_APPROVAL') {
        const instance = await tx.approvalInstance.findFirst({ where: { companyId: auth.companyId, entityType: 'rfq', entityId: id, status: 'PENDING' } });
        if (instance) throw AppError.invalidState('Withdraw the approval request first');
      }
      await this.common.transitionRfq(tx, rfq, 'CANCELLED', { actorId: auth.userId, reason });
      if (rfq.requisitionId) {
        await tx.purchaseRequisition.updateMany({
          where: { id: rfq.requisitionId, sourcingRoute: 'RFQ' },
          data: { sourcingRoute: 'NONE', version: { increment: 1 } },
        });
      }
      const open = await tx.rfqInvitation.findMany({ where: { rfqId: id, status: { in: ['SENT', 'DELIVERED', 'PENDING'] } } });
      for (const inv of open) {
        await this.notifications.queueEmail(tx, {
          to: inv.recipientEmail,
          subject: `RFQ ${rfq.rfqNo} has been cancelled`,
          text: `The request for quotation ${rfq.rfqNo} (${rfq.title}) has been cancelled. No quotation is required.\n\nReason: ${reason}`,
          template: 'rfq.cancelled',
          companyId: rfq.companyId,
          aggregateId: inv.id,
        });
      }
    });
    return this.detail(auth, id);
  }

  async close(auth: AuthContext, id: string, reason: string) {
    await this.prisma.tx(async (tx) => {
      await this.common.lockRfq(tx, id);
      const rfq = await this.common.loadRfq(tx, auth, id);
      await this.common.transitionRfq(tx, rfq, 'CLOSED', { actorId: auth.userId, reason, data: { closedAt: new Date() } });
      await tx.quotation.updateMany({
        where: { rfqId: id, status: { in: ['SUBMITTED', 'UNDER_EVALUATION', 'CLARIFICATION_REQUESTED', 'REVISED'] } },
        data: { status: 'REJECTED', statusReason: 'RFQ closed' },
      });
    });
    return this.detail(auth, id);
  }

  async addAttachment(auth: AuthContext, id: string, file: { originalname: string; buffer: Buffer; size: number }) {
    const rfq = await this.common.loadRfq(this.prisma, auth, id);
    if (['CANCELLED', 'CLOSED'].includes(rfq.status)) throw AppError.invalidState('This RFQ is closed');
    const doc = await this.documents.upload(auth, file, { entityType: 'rfq', entityId: id });
    return { id: doc.id, originalName: doc.originalName, mimeType: doc.mimeType, sizeBytes: doc.sizeBytes, createdAt: doc.createdAt };
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  async list(auth: AuthContext, q: { page: number; pageSize: number; q?: string; status: string[]; sort: string; order: 'asc' | 'desc' }) {
    const and: Prisma.RfqWhereInput[] = [{ companyId: auth.companyId }];
    if (q.status.length) and.push({ status: { in: q.status as Rfq['status'][] } });
    if (q.q) {
      and.push({
        OR: [
          { rfqNo: { contains: q.q, mode: 'insensitive' } },
          { title: { contains: q.q, mode: 'insensitive' } },
          { lines: { some: { description: { contains: q.q, mode: 'insensitive' } } } },
          { invitations: { some: { vendor: { legalName: { contains: q.q, mode: 'insensitive' } } } } },
        ],
      });
    }
    const where: Prisma.RfqWhereInput = { AND: and };
    const [total, items] = await Promise.all([
      this.prisma.rfq.count({ where }),
      this.prisma.rfq.findMany({
        where,
        include: {
          requisition: { select: { id: true, requisitionNo: true } },
          createdBy: { select: { id: true, fullName: true } },
          _count: { select: { lines: true, invitations: true, quotations: true } },
          invitations: { select: { status: true } },
        },
        orderBy: [{ [q.sort]: q.order }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    const now = new Date();
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: items.map(({ invitations, ...r }) => ({
        ...r,
        responded: invitations.filter((i) => i.status === 'RESPONDED').length,
        invited: invitations.filter((i) => i.status !== 'WITHDRAWN').length,
        overdue: r.responseDeadline < now && (OPEN_FOR_RESPONSES as readonly string[]).includes(r.status),
      })),
    };
  }

  async stats(auth: AuthContext) {
    const now = new Date();
    const soon = new Date(now.getTime() + 3 * 86_400_000);
    const [byStatus, overdue, closingSoon, awaiting, recent] = await Promise.all([
      this.prisma.rfq.groupBy({ by: ['status'], where: { companyId: auth.companyId }, _count: { _all: true } }),
      this.prisma.rfq.count({ where: { companyId: auth.companyId, status: { in: [...OPEN_FOR_RESPONSES] }, responseDeadline: { lt: now } } }),
      this.prisma.rfq.count({ where: { companyId: auth.companyId, status: { in: [...OPEN_FOR_RESPONSES] }, responseDeadline: { gte: now, lte: soon } } }),
      this.prisma.rfqInvitation.count({ where: { companyId: auth.companyId, status: { in: ['SENT', 'DELIVERED'] } } }),
      this.prisma.rfq.findMany({
        where: { companyId: auth.companyId },
        orderBy: { updatedAt: 'desc' },
        take: 8,
        select: {
          id: true,
          rfqNo: true,
          title: true,
          status: true,
          responseDeadline: true,
          updatedAt: true,
          _count: { select: { quotations: true, invitations: true } },
        },
      }),
    ]);
    return {
      byStatus: Object.fromEntries(byStatus.map((b) => [b.status, b._count._all])),
      overdue,
      closingSoon,
      awaitingResponses: awaiting,
      recent,
    };
  }

  async detail(auth: AuthContext, id: string) {
    const rfq = await this.prisma.rfq.findFirst({
      where: { id, companyId: auth.companyId },
      include: {
        requisition: { select: { id: true, requisitionNo: true, title: true, status: true, requester: { select: { id: true, fullName: true } } } },
        createdBy: { select: { id: true, fullName: true } },
        lines: { orderBy: { lineNo: 'asc' }, include: { requisitionLine: { select: { id: true, lineNo: true, estimatedUnitPrice: true } } } },
        invitations: {
          orderBy: { invitedAt: 'asc' },
          include: {
            vendor: { select: { id: true, vendorCode: true, legalName: true, status: true, email: true } },
            invitedBy: { select: { id: true, fullName: true } },
            quotations: { select: { id: true, quotationNo: true, status: true, currentVersionNo: true } },
          },
        },
        communications: { orderBy: { occurredAt: 'desc' }, take: 100, include: { actor: { select: { id: true, fullName: true } } } },
        statusHistory: { orderBy: { occurredAt: 'asc' }, include: { actor: { select: { id: true, fullName: true } } } },
        quotations: {
          include: {
            vendor: { select: { id: true, vendorCode: true, legalName: true } },
            versions: { orderBy: { versionNo: 'desc' }, take: 1 },
          },
        },
      },
    });
    if (!rfq) throw AppError.notFound('RFQ');
    const [approvals, attachments] = await Promise.all([
      this.prisma.approvalInstance.findMany({
        where: { companyId: auth.companyId, entityType: 'rfq', entityId: id },
        include: {
          tasks: { include: { assignee: { select: { id: true, fullName: true } }, stage: { select: { name: true } } }, orderBy: [{ sequence: 'asc' }] },
        },
        orderBy: { submittedAt: 'desc' },
      }),
      this.prisma.documentLink.findMany({
        where: { entityType: 'rfq', entityId: id, document: { deletedAt: null, companyId: auth.companyId } },
        include: { document: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true } } },
      }),
    ]);
    const now = new Date();
    const pending = approvals.find((a) => a.status === 'PENDING');
    return {
      ...rfq,
      lines: rfq.lines.map((l) => ({
        ...l,
        quantity: dec(l.quantity, 4),
        requisitionLine: l.requisitionLine ? { ...l.requisitionLine, estimatedUnitPrice: dec(l.requisitionLine.estimatedUnitPrice, 4) } : null,
      })),
      quotations: rfq.quotations.map((q) => ({
        ...q,
        versions: q.versions.map((v) => ({
          ...v,
          grandTotal: dec(v.grandTotal),
          subtotal: dec(v.subtotal),
          taxTotal: dec(v.taxTotal),
          freight: dec(v.freight),
          otherCharges: dec(v.otherCharges),
          discountTotal: dec(v.discountTotal),
        })),
      })),
      approvals,
      attachments: attachments.map((a) => ({ ...a.document, linkType: a.linkType })),
      overdue: rfq.responseDeadline < now && (OPEN_FOR_RESPONSES as readonly string[]).includes(rfq.status),
      viewer: {
        canManage: this.authz.has(auth, 'rfq.manage'),
        canRegisterQuotation: this.authz.has(auth, 'quotation.manage'),
        canAward: this.authz.has(auth, 'quotation.award'),
        pendingTaskId: pending?.tasks.find((t) => t.assigneeId === auth.userId && t.status === 'PENDING')?.id ?? null,
      },
    };
  }
}
