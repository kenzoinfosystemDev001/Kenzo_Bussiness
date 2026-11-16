import { randomUUID } from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { ApprovalInstance, Prisma, Vendor } from '@prisma/client';
import {
  normalizeVendorName,
  stateCodeFor,
  vendorProfileIssues,
  type CreateVendorInput,
  type UpdateVendorInput,
  type VendorContactInput,
  type VendorProfileInput,
} from '@kenzo/shared';
import type { AuthContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { NotificationService } from '../../infrastructure/notifications/notification.service';
import { NumberingService } from '../../infrastructure/numbering/numbering.service';
import { PrismaService, type Tx } from '../../infrastructure/prisma/prisma.service';
import { AuthorizationService } from '../access-control/authorization.service';
import { SegregationOfDutiesService } from '../access-control/segregation-of-duties.service';
import { ApprovalEngine } from '../workflow/approval-engine.service';
import { ApprovalHooksRegistry } from '../workflow/approval-hooks';
import { VendorBankService } from './vendor-bank.service';
import { vendorView, VendorCommon } from './vendor-common';
import { VendorDocumentsService } from './vendor-documents.service';

/** Fields that define the legal/tax identity — frozen once a vendor leaves draft. */
const IDENTITY_FIELDS = ['legalName', 'gstRegistrationType', 'gstin', 'pan', 'registrationNumber', 'msmeRegistered', 'msmeNumber', 'country'] as const;

@Injectable()
export class VendorsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly common: VendorCommon,
    private readonly bank: VendorBankService,
    private readonly docs: VendorDocumentsService,
    private readonly numbering: NumberingService,
    private readonly engine: ApprovalEngine,
    private readonly hooks: ApprovalHooksRegistry,
    private readonly authz: AuthorizationService,
    private readonly sod: SegregationOfDutiesService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  /** Onboarding approval outcomes drive the vendor lifecycle inside the deciding transaction. */
  onModuleInit(): void {
    this.hooks.register('vendor', {
      onApproved: async (tx, instance) => {
        const vendor = await tx.vendor.findUniqueOrThrow({ where: { id: instance.entityId } });
        const finalTask = await tx.approvalTask.findFirst({ where: { instanceId: instance.id, status: 'APPROVED' }, orderBy: { decidedAt: 'desc' } });
        const approverId = finalTask?.decidedById ?? null;
        if (vendor.status === 'SUBMITTED') {
          // Record the implicit review step so the history shows the full path.
          await this.common.transition(tx, vendor, 'UNDER_REVIEW', { actorId: approverId, reason: 'Review completed through approval workflow' });
        }
        const fresh = await tx.vendor.findUniqueOrThrow({ where: { id: instance.entityId } });
        await this.common.transition(tx, fresh, 'APPROVED', { actorId: approverId, reason: 'All onboarding approval stages approved' });
        // The onboarding approval (incl. finance stage) verifies the proposed bank account.
        await tx.vendorBankAccount.updateMany({
          where: { vendorId: vendor.id, status: 'PROPOSED' },
          data: { status: 'ACTIVE', verifiedById: approverId, verifiedAt: new Date() },
        });
        await this.notifyCreator(tx, vendor, 'vendor.approved', `Vendor ${vendor.legalName} approved — ready to activate`);
      },
      onRejected: (tx, instance, reason) => this.closeReview(tx, instance, 'REJECTED', reason),
      onReturned: (tx, instance, reason) => this.closeReview(tx, instance, 'DRAFT', `Returned for clarification: ${reason}`),
      onCancelled: (tx, instance, reason) => this.closeReview(tx, instance, 'DRAFT', `Submission withdrawn: ${reason}`),
    });
  }

  private async closeReview(tx: Tx, instance: ApprovalInstance, to: 'REJECTED' | 'DRAFT', reason: string) {
    const vendor = await tx.vendor.findUniqueOrThrow({ where: { id: instance.entityId } });
    const actor = await tx.approvalTask.findFirst({
      where: { instanceId: instance.id, status: { in: ['REJECTED', 'RETURNED'] } },
      orderBy: { decidedAt: 'desc' },
    });
    await this.common.transition(tx, vendor, to, { actorId: actor?.decidedById ?? null, reason });
    if (to === 'REJECTED') await this.notifyCreator(tx, vendor, 'vendor.rejected', `Vendor ${vendor.legalName} rejected`, reason);
    else if (instance.status === 'RETURNED')
      await this.notifyCreator(tx, vendor, 'vendor.returned', `Vendor ${vendor.legalName} returned for clarification`, reason);
  }

  private async notifyCreator(tx: Tx, vendor: Vendor, type: string, title: string, body?: string) {
    await this.notifications.notify(tx, {
      companyId: vendor.companyId,
      userId: vendor.createdById,
      type,
      title,
      body,
      link: `/vendors/${vendor.id}`,
      entityType: 'vendor',
      entityId: vendor.id,
    });
  }

  // ── Create ──────────────────────────────────────────────────────────────

  async create(auth: AuthContext, input: CreateVendorInput) {
    const duplicates = await this.common.findDuplicates(this.prisma, auth.companyId, {
      legalName: input.legalName,
      gstin: input.gstin,
      pan: input.pan,
      accountNumber: input.bankAccount?.accountNumber ?? null,
    });
    const strong = duplicates.filter((d) => d.strong);
    if (strong.length > 0 && !input.duplicateOverrideReason) {
      throw new AppError('CONFLICT', 'Possible duplicate vendor found. Review the matches, or confirm with a reason that this is a different vendor.', {
        details: { duplicates: strong },
      });
    }
    const vendor = await this.prisma.tx(async (tx) => {
      const vendorId = randomUUID();
      const code = await this.numbering.next(tx, { companyId: auth.companyId, documentType: 'vendor', entityId: vendorId, issuedById: auth.userId });
      const created = await tx.vendor.create({
        data: {
          ...this.profileData(input),
          ...this.common.panFields(input.pan),
          id: vendorId,
          companyId: auth.companyId,
          vendorCode: code,
          duplicateOverrideReason: strong.length > 0 ? input.duplicateOverrideReason : null,
          createdById: auth.userId,
          updatedById: auth.userId,
        },
      });
      for (const [i, c] of input.contacts.entries()) {
        await tx.vendorContact.create({
          data: { companyId: auth.companyId, vendorId: created.id, ...c, isPrimary: c.isPrimary || (i === 0 && !input.contacts.some((x) => x.isPrimary)) },
        });
      }
      if (input.bankAccount) await this.bank.createAccount(tx, auth, created.id, input.bankAccount);
      await tx.vendorStatusHistory.create({
        data: { vendorId: created.id, fromStatus: null, toStatus: 'DRAFT', actorId: auth.userId, reason: 'Vendor draft created' },
      });
      await this.audit.record(tx, {
        action: 'vendor.created',
        entityType: 'vendor',
        entityId: created.id,
        after: {
          vendorCode: code,
          legalName: input.legalName,
          gstin: input.gstin,
          vendorType: input.vendorType,
          category: input.category,
          contacts: input.contacts.length,
          bankProposed: !!input.bankAccount,
        },
      });
      if (strong.length > 0) {
        await this.audit.record(tx, {
          action: 'vendor.duplicate_override',
          entityType: 'vendor',
          entityId: created.id,
          after: { matches: strong.map((d) => ({ vendorCode: d.vendorCode, reasons: d.reasons })) },
          reason: input.duplicateOverrideReason,
        });
      }
      return created;
    });
    return { vendor: vendorView(vendor), duplicates: duplicates.filter((d) => !d.strong) };
  }

  private profileData(p: Partial<VendorProfileInput>): Prisma.VendorUncheckedUpdateInput & Prisma.VendorUncheckedCreateInput {
    const out: Record<string, unknown> = {};
    const copy = [
      'legalName',
      'tradeName',
      'vendorType',
      'category',
      'gstRegistrationType',
      'gstin',
      'registrationNumber',
      'msmeRegistered',
      'msmeNumber',
      'website',
      'email',
      'phone',
      'addressLine1',
      'addressLine2',
      'city',
      'state',
      'postalCode',
      'country',
      'paymentTermsDays',
      'preferredCurrency',
      'internalNotes',
    ] as const;
    for (const k of copy) if (p[k] !== undefined) out[k] = p[k];
    if (p.legalName !== undefined) out.normalizedName = normalizeVendorName(p.legalName);
    if (p.state !== undefined) out.stateCode = p.country && p.country !== 'IN' ? null : stateCodeFor(p.state);
    return out as Prisma.VendorUncheckedUpdateInput & Prisma.VendorUncheckedCreateInput;
  }

  // ── Update ──────────────────────────────────────────────────────────────

  async update(auth: AuthContext, id: string, input: UpdateVendorInput) {
    return this.prisma.tx(async (tx) => {
      await this.common.lock(tx, id);
      const vendor = await this.common.load(tx, auth, id);
      if (['SUBMITTED', 'UNDER_REVIEW'].includes(vendor.status))
        throw AppError.invalidState('This vendor is under review. Withdraw the submission to make changes.');
      if (vendor.status === 'ARCHIVED') throw AppError.invalidState('Archived vendors are read-only');
      const { version, ...changes } = input;
      const editable = ['DRAFT', 'REJECTED'].includes(vendor.status);
      if (!editable) {
        const locked = IDENTITY_FIELDS.filter(
          (f) =>
            changes[f] !== undefined &&
            String(changes[f] ?? '') !== String(f === 'pan' ? (this.common.decryptPan(vendor) ?? '') : ((vendor as Record<string, unknown>)[f] ?? '')),
        );
        if (locked.length) {
          throw AppError.invalidState(
            `Legal and tax identity fields are locked after approval (${locked.join(', ')}). Raise a new vendor or contact an administrator.`,
            { lockedFields: locked },
          );
        }
      }
      const currentPan = this.common.decryptPan(vendor);
      const merged = {
        legalName: vendor.legalName,
        tradeName: vendor.tradeName,
        vendorType: vendor.vendorType,
        category: vendor.category,
        gstRegistrationType: vendor.gstRegistrationType,
        gstin: vendor.gstin,
        pan: currentPan,
        registrationNumber: vendor.registrationNumber,
        msmeRegistered: vendor.msmeRegistered,
        msmeNumber: vendor.msmeNumber,
        website: vendor.website,
        email: vendor.email,
        phone: vendor.phone,
        addressLine1: vendor.addressLine1,
        addressLine2: vendor.addressLine2,
        city: vendor.city,
        state: vendor.state,
        postalCode: vendor.postalCode,
        country: vendor.country,
        paymentTermsDays: vendor.paymentTermsDays,
        preferredCurrency: vendor.preferredCurrency,
        internalNotes: vendor.internalNotes,
        ...changes,
      } as VendorProfileInput;
      const issues = vendorProfileIssues(merged);
      if (issues.length) throw AppError.validation(issues);

      const panChanged = changes.pan !== undefined && (changes.pan ?? null) !== currentPan;
      const res = await tx.vendor.updateMany({
        where: { id, version },
        data: {
          ...this.profileData({ ...changes, ...(changes.state !== undefined ? { country: merged.country, state: merged.state } : {}) }),
          ...(panChanged ? this.common.panFields(changes.pan) : {}),
          updatedById: auth.userId,
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) throw AppError.versionConflict();
      const changedKeys = Object.keys(changes);
      await this.audit.record(tx, {
        action: 'vendor.updated',
        entityType: 'vendor',
        entityId: id,
        before: Object.fromEntries(changedKeys.map((k) => [k, k === 'pan' ? '[REDACTED]' : (vendor as Record<string, unknown>)[k]])),
        after: changes,
      });
      return vendorView(await tx.vendor.findUniqueOrThrow({ where: { id } }));
    });
  }

  // ── Contacts ────────────────────────────────────────────────────────────

  private async assertContactsEditable(tx: Tx, auth: AuthContext, vendorId: string) {
    const vendor = await this.common.load(tx, auth, vendorId);
    if (vendor.status === 'ARCHIVED') throw AppError.invalidState('Archived vendors are read-only');
    return vendor;
  }

  async addContact(auth: AuthContext, vendorId: string, input: VendorContactInput) {
    return this.prisma.tx(async (tx) => {
      await this.assertContactsEditable(tx, auth, vendorId);
      const count = await tx.vendorContact.count({ where: { vendorId } });
      if (count >= 20) throw AppError.invalidState('A vendor can have at most 20 contacts');
      const primary = input.isPrimary || count === 0;
      if (primary) await tx.vendorContact.updateMany({ where: { vendorId, isPrimary: true }, data: { isPrimary: false } });
      const c = await tx.vendorContact.create({ data: { companyId: auth.companyId, vendorId, ...input, isPrimary: primary } });
      await this.audit.record(tx, {
        action: 'vendor.contact.added',
        entityType: 'vendor',
        entityId: vendorId,
        after: { contactId: c.id, name: c.name, email: c.email },
      });
      return c;
    });
  }

  async updateContact(auth: AuthContext, vendorId: string, contactId: string, input: Partial<VendorContactInput>) {
    return this.prisma.tx(async (tx) => {
      await this.assertContactsEditable(tx, auth, vendorId);
      const before = await tx.vendorContact.findFirst({ where: { id: contactId, vendorId, companyId: auth.companyId } });
      if (!before) throw AppError.notFound('Contact');
      if (input.isPrimary) await tx.vendorContact.updateMany({ where: { vendorId, isPrimary: true, id: { not: contactId } }, data: { isPrimary: false } });
      if (input.isPrimary === false && before.isPrimary) throw AppError.invalidState('Make another contact primary instead');
      const c = await tx.vendorContact.update({ where: { id: contactId }, data: input });
      await this.audit.record(tx, { action: 'vendor.contact.updated', entityType: 'vendor', entityId: vendorId, before, after: input });
      return c;
    });
  }

  async removeContact(auth: AuthContext, vendorId: string, contactId: string) {
    await this.prisma.tx(async (tx) => {
      await this.assertContactsEditable(tx, auth, vendorId);
      const c = await tx.vendorContact.findFirst({ where: { id: contactId, vendorId, companyId: auth.companyId } });
      if (!c) throw AppError.notFound('Contact');
      if (c.isPrimary && (await tx.vendorContact.count({ where: { vendorId } })) > 1)
        throw AppError.invalidState('Make another contact primary before removing this one');
      await tx.vendorContact.delete({ where: { id: contactId } });
      await this.audit.record(tx, { action: 'vendor.contact.removed', entityType: 'vendor', entityId: vendorId, before: { name: c.name, email: c.email } });
    });
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  /** DRAFT → SUBMITTED: completeness + duplicate re-check, then onboarding approval. */
  async submit(auth: AuthContext, id: string, note?: string | null) {
    return this.prisma.tx(async (tx) => {
      await this.common.lock(tx, id);
      const vendor = await this.common.load(tx, auth, id);
      if (vendor.status !== 'DRAFT') throw AppError.invalidState('Only draft vendors can be submitted');
      const problems: Array<{ path: string; message: string }> = [];
      const contacts = await tx.vendorContact.count({ where: { vendorId: id } });
      if (contacts === 0) problems.push({ path: 'contacts', message: 'Add at least one contact person' });
      const compliance = await this.docs.compliance(tx, vendor);
      for (const r of compliance.requirements) {
        if (r.state === 'MISSING') problems.push({ path: `documents.${r.documentType}`, message: `Upload: ${r.label}` });
        if (r.state === 'REJECTED') problems.push({ path: `documents.${r.documentType}`, message: `Replace the rejected ${r.label}` });
        if (r.state === 'EXPIRED') problems.push({ path: `documents.${r.documentType}`, message: `Upload a valid ${r.label} (expired)` });
      }
      if (problems.length) throw AppError.validation(problems, 'The vendor is not ready for submission');

      const bank = await tx.vendorBankAccount.findFirst({ where: { vendorId: id, status: 'PROPOSED' } });
      const duplicates = (
        await this.common.findDuplicates(tx, auth.companyId, {
          legalName: vendor.legalName,
          gstin: vendor.gstin,
          pan: this.common.decryptPan(vendor),
          excludeVendorId: id,
        })
      ).filter((d) => d.strong && d.status !== 'ARCHIVED' && d.status !== 'REJECTED');
      if (duplicates.length && !vendor.duplicateOverrideReason) {
        throw new AppError('CONFLICT', 'A matching vendor exists. Resolve the duplicate before submitting.', { details: { duplicates } });
      }

      await this.engine.submit(tx, auth, {
        entityType: 'vendor',
        entityId: vendor.id,
        entityReference: vendor.vendorCode,
        entitySummary: `${vendor.legalName} · ${vendor.category} · ${vendor.city}${bank ? ' · bank details for verification' : ''}`,
        categoryKey: vendor.category,
        requesterId: auth.userId,
        // The creator never approves their own vendor, even if someone else submits it.
        excludedUserIds: [vendor.createdById],
      });
      const updated = await this.common.transition(tx, vendor, 'SUBMITTED', { actorId: auth.userId, reason: note ?? 'Submitted for onboarding approval' });
      return vendorView(updated);
    });
  }

  /** SUBMITTED → UNDER_REVIEW: an assigned approver (or vendor approver) picks it up. */
  async startReview(auth: AuthContext, id: string) {
    return this.prisma.tx(async (tx) => {
      await this.common.lock(tx, id);
      const vendor = await this.common.load(tx, auth, id);
      const instance = await tx.approvalInstance.findFirst({
        where: { companyId: auth.companyId, entityType: 'vendor', entityId: id, status: 'PENDING' },
        include: { tasks: true },
      });
      const assigned = !!instance?.tasks.some((t) => t.assigneeId === auth.userId && t.status === 'PENDING');
      if (!assigned && !this.authz.has(auth, 'vendor.approve')) throw AppError.forbidden('Only an assigned reviewer can start the review');
      this.sod.assert('SELF_APPROVAL', auth.userId, [vendor.createdById]);
      return vendorView(await this.common.transition(tx, vendor, 'UNDER_REVIEW', { actorId: auth.userId, reason: 'Review started' }));
    });
  }

  async withdraw(auth: AuthContext, id: string, reason: string) {
    const vendor = await this.common.load(this.prisma, auth, id);
    if (!['SUBMITTED', 'UNDER_REVIEW'].includes(vendor.status)) throw AppError.invalidState('Only vendors under review can be withdrawn');
    const instance = await this.prisma.approvalInstance.findFirst({
      where: { companyId: auth.companyId, entityType: 'vendor', entityId: id, status: 'PENDING' },
    });
    if (!instance) throw AppError.invalidState('No pending approval found');
    await this.engine.cancel(auth, instance.id, reason, { asAdmin: this.authz.has(auth, 'vendor.approve') });
    return vendorView(await this.common.load(this.prisma, auth, id));
  }

  /** APPROVED/SUSPENDED → ACTIVE requires full document compliance and an independent actor. */
  private async assertReadyToTrade(tx: Tx, vendor: Vendor) {
    const compliance = await this.docs.compliance(tx, vendor);
    const gaps = compliance.requirements.filter((r) => r.state !== 'VERIFIED');
    if (gaps.length) {
      throw AppError.validation(
        gaps.map((g) => ({ path: `documents.${g.documentType}`, message: `${g.label}: ${g.state.toLowerCase()}` })),
        'All required documents must be verified and valid before the vendor can transact',
      );
    }
    const pendingBank = await tx.vendorBankAccount.count({ where: { vendorId: vendor.id, status: 'PROPOSED' } });
    const pendingChange = await tx.vendorBankChangeRequest.count({ where: { vendorId: vendor.id, status: 'PENDING_APPROVAL' } });
    if (pendingBank > 0 && pendingChange === 0) throw AppError.invalidState('The proposed bank account has not been verified');
  }

  async activate(auth: AuthContext, id: string, reason?: string | null) {
    return this.prisma.tx(async (tx) => {
      await this.common.lock(tx, id);
      const vendor = await this.common.load(tx, auth, id);
      this.sod.assert('SELF_APPROVAL', auth.userId, [vendor.createdById]);
      if (vendor.status !== 'APPROVED') throw AppError.invalidState('Only approved vendors can be activated');
      await this.assertReadyToTrade(tx, vendor);
      return vendorView(
        await this.common.transition(tx, vendor, 'ACTIVE', { actorId: auth.userId, reason: reason ?? 'Activated after approval and document verification' }),
      );
    });
  }

  async suspend(auth: AuthContext, id: string, reason: string) {
    return this.prisma.tx(async (tx) => {
      await this.common.lock(tx, id);
      const vendor = await this.common.load(tx, auth, id);
      const updated = await this.common.transition(tx, vendor, 'SUSPENDED', { actorId: auth.userId, reason });
      await this.notifyCreator(tx, vendor, 'vendor.suspended', `Vendor ${vendor.legalName} suspended`, reason);
      return vendorView(updated);
    });
  }

  async reactivate(auth: AuthContext, id: string, reason: string) {
    return this.prisma.tx(async (tx) => {
      await this.common.lock(tx, id);
      const vendor = await this.common.load(tx, auth, id);
      if (vendor.status !== 'SUSPENDED') throw AppError.invalidState('Only suspended vendors can be reactivated');
      await this.assertReadyToTrade(tx, vendor);
      return vendorView(await this.common.transition(tx, vendor, 'ACTIVE', { actorId: auth.userId, reason }));
    });
  }

  async archive(auth: AuthContext, id: string, reason: string) {
    return this.prisma.tx(async (tx) => {
      await this.common.lock(tx, id);
      const vendor = await this.common.load(tx, auth, id);
      const pendingChange = await tx.vendorBankChangeRequest.count({ where: { vendorId: id, status: 'PENDING_APPROVAL' } });
      if (pendingChange) throw AppError.invalidState('Cancel the pending bank-detail change before archiving');
      return vendorView(await this.common.transition(tx, vendor, 'ARCHIVED', { actorId: auth.userId, reason }));
    });
  }

  async reopen(auth: AuthContext, id: string, reason: string) {
    return this.prisma.tx(async (tx) => {
      await this.common.lock(tx, id);
      const vendor = await this.common.load(tx, auth, id);
      if (vendor.status !== 'REJECTED') throw AppError.invalidState('Only rejected vendors can be reopened');
      return vendorView(await this.common.transition(tx, vendor, 'DRAFT', { actorId: auth.userId, reason }));
    });
  }
}
