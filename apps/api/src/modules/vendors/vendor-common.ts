import { Injectable } from '@nestjs/common';
import type { Prisma, Vendor, VendorBankAccount, VendorStatus } from '@prisma/client';
import {
  NAME_SIMILARITY_THRESHOLD,
  STRONG_DUPLICATE_REASONS,
  VENDOR_STATUS_LABELS,
  canTransition,
  nameSimilarity,
  normalizeVendorName,
  type DuplicateReason,
} from '@kenzo/shared';
import type { AuthContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { FieldEncryptionService } from '../../infrastructure/crypto/field-encryption.service';
import type { Db, Tx } from '../../infrastructure/prisma/prisma.service';

const MASK = '••••';

/** Public (masked) shape of a vendor — never includes ciphertext or fingerprints. */
export function vendorView(v: Vendor) {
  const { panEnc: _enc, panFingerprint: _fp, panLast4, ...rest } = v;
  return { ...rest, panMasked: panLast4 ? `${MASK}${MASK}${panLast4.slice(-2)}` : null, hasPan: !!panLast4 };
}

export function bankAccountView(a: VendorBankAccount) {
  const { accountNumberEnc: _enc, accountFingerprint: _fp, accountLast4, ...rest } = a;
  return { ...rest, accountMasked: `${MASK} ${MASK} ${accountLast4}`, accountLast4 };
}

export interface DuplicateMatch {
  vendorId: string;
  vendorCode: string;
  legalName: string;
  tradeName: string | null;
  status: VendorStatus;
  city: string;
  gstin: string | null;
  reasons: DuplicateReason[];
  similarity: number;
  strong: boolean;
}

@Injectable()
export class VendorCommon {
  constructor(
    private readonly crypto: FieldEncryptionService,
    private readonly audit: AuditService,
  ) {}

  /** Loads a vendor of the active company or throws NOT_FOUND (never discloses other tenants). */
  async load(db: Db, auth: AuthContext, id: string): Promise<Vendor> {
    const v = await db.vendor.findFirst({ where: { id, companyId: auth.companyId } });
    if (!v) throw AppError.notFound('Vendor');
    return v;
  }

  /** Locks the vendor row for the rest of the transaction (serialises lifecycle changes). */
  async lock(tx: Tx, vendorId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM vendor WHERE id = ${vendorId}::uuid FOR UPDATE`;
  }

  /**
   * Single entry point for lifecycle changes: validates the transition, records
   * actor/time/reason in the append-only history and the audit trail.
   */
  async transition(
    tx: Tx,
    vendor: Vendor,
    to: VendorStatus,
    opts: { actorId: string | null; reason?: string | null; companyId?: string; data?: Prisma.VendorUpdateInput },
  ): Promise<Vendor> {
    if (vendor.status === to) throw AppError.invalidState(`Vendor is already ${VENDOR_STATUS_LABELS[to].toLowerCase()}`);
    if (!canTransition(vendor.status, to)) {
      throw AppError.invalidState(`A ${VENDOR_STATUS_LABELS[vendor.status].toLowerCase()} vendor cannot move to ${VENDOR_STATUS_LABELS[to].toLowerCase()}`, {
        from: vendor.status,
        to,
      });
    }
    const now = new Date();
    const stamp: Prisma.VendorUpdateInput =
      to === 'SUBMITTED'
        ? { submittedAt: now }
        : to === 'APPROVED'
          ? { approvedAt: now }
          : to === 'ACTIVE'
            ? { activatedAt: now, suspendedAt: null }
            : to === 'SUSPENDED'
              ? { suspendedAt: now }
              : to === 'ARCHIVED'
                ? { archivedAt: now }
                : {};
    const res = await tx.vendor.updateMany({
      where: { id: vendor.id, status: vendor.status, version: vendor.version },
      data: { status: to, statusReason: opts.reason ?? null, updatedById: opts.actorId, version: { increment: 1 } },
    });
    if (res.count !== 1) throw AppError.versionConflict();
    const updated = await tx.vendor.update({ where: { id: vendor.id }, data: { ...stamp, ...(opts.data ?? {}) } });
    await tx.vendorStatusHistory.create({
      data: { vendorId: vendor.id, fromStatus: vendor.status, toStatus: to, actorId: opts.actorId, reason: opts.reason ?? null },
    });
    await this.audit.record(tx, {
      action: `vendor.status.${to.toLowerCase()}`,
      entityType: 'vendor',
      entityId: vendor.id,
      companyId: vendor.companyId,
      actorId: opts.actorId,
      before: { status: vendor.status },
      after: { status: to },
      reason: opts.reason ?? null,
    });
    return updated;
  }

  panFields(pan: string | null | undefined) {
    if (!pan) return { panEnc: null, panLast4: null, panFingerprint: null };
    return {
      // AAD binds the ciphertext to its column purpose so it cannot be swapped into another field.
      panEnc: this.crypto.encrypt(pan, 'vendor.pan'),
      panLast4: pan.slice(-4),
      panFingerprint: this.crypto.fingerprint('pan', pan),
    };
  }

  decryptPan(v: Vendor): string | null {
    if (!v.panEnc) return null;
    return this.crypto.decrypt(v.panEnc, 'vendor.pan');
  }

  /**
   * Duplicate detection (PRD §3.2): normalised legal name (exact + similarity),
   * GSTIN, PAN (also derived from GSTIN) and bank-account fingerprint. Matches are
   * reported with their reasons; vendors are never merged automatically.
   */
  async findDuplicates(
    db: Db,
    companyId: string,
    input: { legalName?: string | null; gstin?: string | null; pan?: string | null; accountNumber?: string | null; excludeVendorId?: string | null },
  ): Promise<DuplicateMatch[]> {
    const matches = new Map<string, { vendor: Vendor; reasons: Set<DuplicateReason>; similarity: number }>();
    const add = (v: Vendor, reason: DuplicateReason, similarity = 0) => {
      if (v.id === input.excludeVendorId) return;
      const m = matches.get(v.id) ?? { vendor: v, reasons: new Set<DuplicateReason>(), similarity: 0 };
      m.reasons.add(reason);
      m.similarity = Math.max(m.similarity, similarity);
      matches.set(v.id, m);
    };

    if (input.gstin) {
      for (const v of await db.vendor.findMany({ where: { companyId, gstin: input.gstin.toUpperCase() } })) add(v, 'GSTIN', 1);
    }
    const pan = input.pan?.toUpperCase() ?? (input.gstin && input.gstin.length === 15 ? input.gstin.slice(2, 12).toUpperCase() : null);
    if (pan) {
      for (const v of await db.vendor.findMany({ where: { companyId, panFingerprint: this.crypto.fingerprint('pan', pan) } })) add(v, 'PAN', 1);
    }
    if (input.accountNumber) {
      const accounts = await db.vendorBankAccount.findMany({
        where: { companyId, accountFingerprint: this.crypto.fingerprint('bank_account', input.accountNumber), status: { in: ['PROPOSED', 'ACTIVE'] } },
        include: { vendor: true },
      });
      for (const a of accounts) add(a.vendor, 'BANK_ACCOUNT', 1);
    }
    if (input.legalName) {
      const normalized = normalizeVendorName(input.legalName);
      if (normalized) {
        const first = normalized.split(' ')[0]!;
        const candidates = await db.vendor.findMany({
          where: { companyId, OR: [{ normalizedName: normalized }, { normalizedName: { contains: first.slice(0, Math.max(3, Math.min(first.length, 6))) } }] },
          take: 300,
        });
        for (const v of candidates) {
          if (v.normalizedName === normalized) add(v, 'NAME_EXACT', 1);
          else {
            const s = nameSimilarity(input.legalName, v.legalName);
            if (s >= NAME_SIMILARITY_THRESHOLD) add(v, 'NAME_SIMILAR', s);
          }
        }
      }
    }

    return [...matches.values()]
      .map(({ vendor: v, reasons, similarity }) => {
        const list = [...reasons];
        return {
          vendorId: v.id,
          vendorCode: v.vendorCode,
          legalName: v.legalName,
          tradeName: v.tradeName,
          status: v.status,
          city: v.city,
          gstin: v.gstin,
          reasons: list,
          similarity: Math.round(similarity * 100) / 100,
          strong: list.some((r) => STRONG_DUPLICATE_REASONS.includes(r)),
        };
      })
      .sort((a, b) => Number(b.strong) - Number(a.strong) || b.similarity - a.similarity);
  }
}
