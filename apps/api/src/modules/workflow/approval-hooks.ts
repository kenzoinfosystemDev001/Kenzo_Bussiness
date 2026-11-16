import { Injectable } from '@nestjs/common';
import type { ApprovalInstance } from '@prisma/client';
import type { Tx } from '../../infrastructure/prisma/prisma.service';

/**
 * Dependency inversion between the workflow engine and business modules.
 * The engine owns approval state only; the module that owns the entity
 * registers handlers to update its own records when an approval completes.
 * Handlers run INSIDE the decision transaction, so e.g. "vendor becomes
 * Approved" commits atomically with the final approval — or not at all.
 */
export interface ApprovalOutcomeHandler {
  onApproved?(tx: Tx, instance: ApprovalInstance): Promise<void>;
  onRejected?(tx: Tx, instance: ApprovalInstance, reason: string): Promise<void>;
  onReturned?(tx: Tx, instance: ApprovalInstance, reason: string): Promise<void>;
  onCancelled?(tx: Tx, instance: ApprovalInstance, reason: string): Promise<void>;
}

@Injectable()
export class ApprovalHooksRegistry {
  private readonly handlers = new Map<string, ApprovalOutcomeHandler>();

  register(entityType: string, handler: ApprovalOutcomeHandler): void {
    if (this.handlers.has(entityType)) throw new Error(`Approval handler already registered for ${entityType}`);
    this.handlers.set(entityType, handler);
  }

  get(entityType: string): ApprovalOutcomeHandler | undefined {
    return this.handlers.get(entityType);
  }
}
