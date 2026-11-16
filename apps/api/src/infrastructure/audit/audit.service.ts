import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { redactSecrets } from '@kenzo/shared';
import { RequestContext } from '../../common/context/request-context';
import { canonicalJson, sha256Hex } from '../crypto/tokens';
import type { Db } from '../prisma/prisma.service';

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  companyId?: string | null;
  /** Defaults to the authenticated user of the current request. */
  actorId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  outcome?: 'SUCCESS' | 'DENIED' | 'FAILURE';
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(canonicalJson(redactSecrets(value))) as Prisma.InputJsonValue;
}

/**
 * Append-only audit trail. Call `record(tx, …)` inside the same transaction as
 * the change it describes so the business change and its evidence commit
 * together. Payloads are secret-redacted and hashed (before/after SHA-256) so
 * later tampering with copies can be detected. The table itself rejects
 * UPDATE/DELETE via a database trigger.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  async record(db: Db, input: AuditInput): Promise<void> {
    const ctx = RequestContext.get();
    const before = toJson(input.before);
    const after = toJson(input.after);
    await db.auditEvent.create({
      data: {
        companyId: input.companyId === undefined ? (ctx?.auth?.companyId ?? null) : input.companyId,
        actorId: input.actorId === undefined ? (ctx?.auth?.userId ?? null) : input.actorId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        beforeData: before,
        afterData: after,
        beforeHash: before === undefined ? null : sha256Hex(canonicalJson(before)),
        afterHash: after === undefined ? null : sha256Hex(canonicalJson(after)),
        reason: input.reason ?? null,
        outcome: input.outcome ?? 'SUCCESS',
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        correlationId: ctx?.correlationId ?? null,
      },
    });
  }

  /**
   * For security events that must be recorded even when the surrounding request
   * fails (e.g. denied access, failed login). Never throws.
   */
  async recordSafely(db: Db, input: AuditInput): Promise<void> {
    try {
      await this.record(db, input);
    } catch (err) {
      this.logger.error(JSON.stringify({ msg: 'audit_write_failed', action: input.action, error: (err as Error).message }));
    }
  }
}
