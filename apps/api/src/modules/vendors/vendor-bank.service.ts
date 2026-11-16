import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { ApprovalInstance } from '@prisma/client';
import type { VendorBankInput } from '@kenzo/shared';
import type { AuthContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { FieldEncryptionService } from '../../infrastructure/crypto/field-encryption.service';
import { NotificationService } from '../../infrastructure/notifications/notification.service';
import { PrismaService, type Tx } from '../../infrastructure/prisma/prisma.service';
import { AuthorizationService } from '../access-control/authorization.service';
import { ApprovalEngine } from '../workflow/approval-engine.service';
import { ApprovalHooksRegistry } from '../workflow/approval-hooks';
import { bankAccountView, VendorCommon } from './vendor-common';

const AAD = 'vendor.bank_account';

/**
 * Restricted bank-detail field group (PRD §3.2, Master Prompt 02 §5):
 *  - account numbers encrypted at rest (AES-256-GCM) + keyed fingerprint;
 *  - masked by default; reveal requires `vendor.bank.read` (+MFA when enforced),
 *    a stated reason, and is audited;
 *  - changes to an approved vendor go through maker-checker approval where the
 *    proposer AND the vendor creator are excluded from approving;
 *  - accounts are never edited in place — history is preserved.
 */
@Injectable()
export class VendorBankService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly common: VendorCommon,
    private readonly crypto: FieldEncryptionService,
    private readonly authz: AuthorizationService,
    private readonly engine: ApprovalEngine,
    private readonly hooks: ApprovalHooksRegistry,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit(): void {
    this.hooks.register('vendor_bank_change', {
      onApproved: (tx, i) => this.finishChange(tx, i, 'APPROVED'),
      onRejected: (tx, i, reason) => this.finishChange(tx, i, 'REJECTED', reason),
      onReturned: (tx, i, reason) => this.finishChange(tx, i, 'RETURNED', reason),
      onCancelled: (tx, i, reason) => this.finishChange(tx, i, 'CANCELLED', reason),
    });
  }

  private async assertNotUsedByAnotherVendor(tx: Tx, companyId: string, vendorId: string, fingerprint: string) {
    const clash = await tx.vendorBankAccount.findFirst({
      where: { companyId, accountFingerprint: fingerprint, status: { in: ['PROPOSED', 'ACTIVE'] }, vendorId: { not: vendorId } },
      include: { vendor: { select: { vendorCode: true, legalName: true } } },
    });
    if (clash) {
      throw new AppError(
        'CONFLICT',
        `This bank account is already registered to vendor ${clash.vendor.vendorCode} (${clash.vendor.legalName}). Shared accounts are a fraud indicator — investigate before proceeding.`,
        {
          details: { reason: 'BANK_ACCOUNT_IN_USE', vendorCode: clash.vendor.vendorCode },
        },
      );
    }
  }

  /** Creates a PROPOSED account row (encrypted). */
  async createAccount(tx: Tx, auth: AuthContext, vendorId: string, input: VendorBankInput) {
    const fingerprint = this.crypto.fingerprint('bank_account', input.accountNumber);
    await this.assertNotUsedByAnotherVendor(tx, auth.companyId, vendorId, fingerprint);
    if (input.proofDocumentId) {
      const proof = await tx.document.findFirst({ where: { id: input.proofDocumentId, companyId: auth.companyId } });
      if (!proof) throw AppError.validation([{ path: 'proofDocumentId', message: 'Proof document not found' }]);
    }
    return tx.vendorBankAccount.create({
      data: {
        companyId: auth.companyId,
        vendorId,
        accountHolderName: input.accountHolderName,
        bankName: input.bankName,
        branchName: input.branchName ?? null,
        ifsc: input.accountType === 'OVERSEAS' ? null : (input.ifsc ?? null),
        swiftCode: input.swiftCode ?? null,
        accountType: input.accountType,
        accountNumberEnc: this.crypto.encrypt(input.accountNumber, AAD),
        accountLast4: input.accountNumber.slice(-4),
        accountFingerprint: fingerprint,
        proofDocumentId: input.proofDocumentId ?? null,
        status: 'PROPOSED',
        createdById: auth.userId,
      },
    });
  }

  /**
   * Draft/rejected vendors: the proposed account is part of onboarding and is
   * verified by the onboarding approval. Replaces any previous proposal.
   */
  async setOnboardingAccount(auth: AuthContext, vendorId: string, input: VendorBankInput) {
    return this.prisma.tx(async (tx) => {
      await this.common.lock(tx, vendorId);
      const vendor = await this.common.load(tx, auth, vendorId);
      if (!['DRAFT', 'REJECTED'].includes(vendor.status)) {
        throw AppError.invalidState('Bank details of a submitted or approved vendor can only change through a bank-change request');
      }
      await tx.vendorBankAccount.updateMany({ where: { vendorId, status: 'PROPOSED' }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
      const account = await this.createAccount(tx, auth, vendorId, input);
      await this.audit.record(tx, {
        action: 'vendor.bank.proposed',
        entityType: 'vendor',
        entityId: vendorId,
        after: { bankAccountId: account.id, bankName: account.bankName, last4: account.accountLast4, ifsc: account.ifsc },
      });
      return bankAccountView(account);
    });
  }

  /** Maker step of a bank-detail change for an approved/active/suspended vendor. */
  async requestChange(auth: AuthContext, vendorId: string, input: VendorBankInput & { reason: string }) {
    return this.prisma.tx(async (tx) => {
      await this.common.lock(tx, vendorId);
      const vendor = await this.common.load(tx, auth, vendorId);
      if (!['APPROVED', 'ACTIVE', 'SUSPENDED'].includes(vendor.status)) {
        throw AppError.invalidState('Bank-change requests apply to approved vendors. Edit the onboarding details instead.');
      }
      const pending = await tx.vendorBankChangeRequest.findFirst({ where: { vendorId, status: 'PENDING_APPROVAL' } });
      if (pending) throw AppError.invalidState('A bank-detail change is already awaiting approval for this vendor');
      const previous = await tx.vendorBankAccount.findFirst({ where: { vendorId, status: 'ACTIVE' } });
      const fingerprint = this.crypto.fingerprint('bank_account', input.accountNumber);
      if (previous?.accountFingerprint === fingerprint) throw AppError.validation([{ path: 'accountNumber', message: 'This is already the active account' }]);
      const account = await this.createAccount(tx, auth, vendorId, input);
      const request = await tx.vendorBankChangeRequest.create({
        data: {
          companyId: auth.companyId,
          vendorId,
          proposedAccountId: account.id,
          previousAccountId: previous?.id ?? null,
          reason: input.reason,
          requestedById: auth.userId,
        },
      });
      // Maker-checker: neither the proposer nor the vendor's creator may approve.
      await this.engine.submit(tx, auth, {
        entityType: 'vendor_bank_change',
        entityId: request.id,
        entityReference: vendor.vendorCode,
        entitySummary: `Bank change for ${vendor.legalName}: ${account.bankName} ••${account.accountLast4}${previous ? ` (replaces ••${previous.accountLast4})` : ''}`,
        requesterId: auth.userId,
        excludedUserIds: [auth.userId, vendor.createdById],
      });
      await this.audit.record(tx, {
        action: 'vendor.bank_change.requested',
        entityType: 'vendor',
        entityId: vendorId,
        before: previous ? { bankAccountId: previous.id, last4: previous.accountLast4, bankName: previous.bankName } : null,
        after: { requestId: request.id, bankAccountId: account.id, last4: account.accountLast4, bankName: account.bankName, ifsc: account.ifsc },
        reason: input.reason,
      });
      return { ...request, proposedAccount: bankAccountView(account) };
    });
  }

  async cancelChange(auth: AuthContext, vendorId: string, requestId: string, reason: string) {
    const request = await this.prisma.vendorBankChangeRequest.findFirst({ where: { id: requestId, vendorId, companyId: auth.companyId } });
    if (!request) throw AppError.notFound('Bank-change request');
    if (request.status !== 'PENDING_APPROVAL') throw AppError.invalidState('Only pending requests can be cancelled');
    const instance = await this.prisma.approvalInstance.findFirst({
      where: { companyId: auth.companyId, entityType: 'vendor_bank_change', entityId: requestId, status: 'PENDING' },
    });
    if (!instance) throw AppError.invalidState('No pending approval found for this request');
    await this.engine.cancel(auth, instance.id, reason, { asAdmin: this.authz.has(auth, 'approval.delegation.admin') });
  }

  /** Approval outcome — runs inside the deciding transaction. */
  private async finishChange(tx: Tx, instance: ApprovalInstance, outcome: 'APPROVED' | 'REJECTED' | 'RETURNED' | 'CANCELLED', reason?: string) {
    const request = await tx.vendorBankChangeRequest.findUniqueOrThrow({ where: { id: instance.entityId }, include: { vendor: true, proposedAccount: true } });
    const now = new Date();
    await tx.vendorBankChangeRequest.update({ where: { id: request.id }, data: { status: outcome, outcomeReason: reason ?? null, decidedAt: now } });
    if (outcome === 'APPROVED') {
      const finalApprover = await tx.approvalTask.findFirst({ where: { instanceId: instance.id, status: 'APPROVED' }, orderBy: { decidedAt: 'desc' } });
      await tx.vendorBankAccount.updateMany({ where: { vendorId: request.vendorId, status: 'ACTIVE' }, data: { status: 'SUPERSEDED', supersededAt: now } });
      await tx.vendorBankAccount.update({
        where: { id: request.proposedAccountId },
        data: { status: 'ACTIVE', verifiedById: finalApprover?.decidedById ?? null, verifiedAt: now },
      });
    } else {
      await tx.vendorBankAccount.update({ where: { id: request.proposedAccountId }, data: { status: 'REJECTED' } });
    }
    await this.audit.record(tx, {
      action: `vendor.bank_change.${outcome.toLowerCase()}`,
      entityType: 'vendor',
      entityId: request.vendorId,
      companyId: request.companyId,
      actorId: null,
      after: { requestId: request.id, bankAccountId: request.proposedAccountId, last4: request.proposedAccount.accountLast4 },
      reason: reason ?? null,
    });
    if (outcome !== 'APPROVED' && outcome !== 'CANCELLED') {
      await this.notifications.notify(tx, {
        companyId: request.companyId,
        userId: request.requestedById,
        type: `vendor.bank_change.${outcome.toLowerCase()}`,
        title: `Bank change for ${request.vendor.legalName} ${outcome.toLowerCase()}`,
        body: reason,
        link: `/vendors/${request.vendorId}?tab=bank`,
        entityType: 'vendor',
        entityId: request.vendorId,
      });
    }
  }

  /** Reveals one full account number. Requires vendor.bank.read (+MFA if enforced) and a reason. Audited. */
  async revealAccount(auth: AuthContext, vendorId: string, accountId: string, reason: string) {
    const vendor = await this.common.load(this.prisma, auth, vendorId);
    this.authz.assertCan(auth, 'vendor.bank.read', { companyId: vendor.companyId }, 'Vendor');
    const account = await this.prisma.vendorBankAccount.findFirst({ where: { id: accountId, vendorId, companyId: auth.companyId } });
    if (!account) throw AppError.notFound('Bank account');
    const accountNumber = this.crypto.decrypt(account.accountNumberEnc, AAD);
    await this.audit.record(this.prisma, {
      action: 'vendor.bank.revealed',
      entityType: 'vendor',
      entityId: vendorId,
      after: { bankAccountId: account.id, last4: account.accountLast4 },
      reason,
    });
    return { accountNumber, ifsc: account.ifsc, swiftCode: account.swiftCode, revealedAt: new Date().toISOString() };
  }

  async revealPan(auth: AuthContext, vendorId: string, reason: string) {
    const vendor = await this.common.load(this.prisma, auth, vendorId);
    this.authz.assertCan(auth, 'vendor.bank.read', { companyId: vendor.companyId }, 'Vendor');
    const pan = this.common.decryptPan(vendor);
    if (!pan) throw AppError.notFound('PAN');
    await this.audit.record(this.prisma, { action: 'vendor.pan.revealed', entityType: 'vendor', entityId: vendorId, reason });
    return { pan, revealedAt: new Date().toISOString() };
  }

  /** Bank verification workspace queue. */
  async queue(auth: AuthContext, status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'RETURNED' | 'CANCELLED') {
    const rows = await this.prisma.vendorBankChangeRequest.findMany({
      where: { companyId: auth.companyId, status },
      include: {
        vendor: { select: { id: true, vendorCode: true, legalName: true, status: true } },
        proposedAccount: true,
        previousAccount: true,
        requestedBy: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const instances = await this.prisma.approvalInstance.findMany({
      where: { companyId: auth.companyId, entityType: 'vendor_bank_change', entityId: { in: rows.map((r) => r.id) } },
      select: {
        id: true,
        entityId: true,
        status: true,
        tasks: { where: { status: 'PENDING' }, select: { id: true, assigneeId: true, assignee: { select: { fullName: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return {
      items: rows.map((r) => {
        const inst = instances.find((i) => i.entityId === r.id);
        return {
          ...r,
          proposedAccount: bankAccountView(r.proposedAccount),
          previousAccount: r.previousAccount ? bankAccountView(r.previousAccount) : null,
          approval: inst
            ? {
                instanceId: inst.id,
                status: inst.status,
                pendingWith: inst.tasks.map((t) => t.assignee.fullName),
                myTaskId: inst.tasks.find((t) => t.assigneeId === auth.userId)?.id ?? null,
              }
            : null,
        };
      }),
    };
  }
}
