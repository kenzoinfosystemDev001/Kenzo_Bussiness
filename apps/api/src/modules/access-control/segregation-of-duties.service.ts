import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';

/**
 * Separation-of-duties rules (PRD §2.2). Each rule names the actors that must
 * be distinct from the acting user. Business modules call `assert` at the
 * decision point; the approval engine applies the same rules when resolving
 * and when accepting decisions, so a violation cannot be routed around by
 * assignment or delegation.
 */
export const SOD_RULES = {
  /** A requester cannot approve their own request when independent approval is required. */
  SELF_APPROVAL: 'A requester cannot approve their own request',
  /** A vendor creator cannot be the sole approver of that vendor's bank-detail change. */
  BANK_CHANGE_MAKER_CHECKER: 'The person who proposed or created this vendor cannot approve its bank-detail change',
  /** A payment creator cannot be its final releaser. */
  PAYMENT_MAKER_CHECKER: 'The person who recorded this payment cannot approve or release it',
  /** A user who approved an invoice cannot release its payment when policy prohibits it. */
  INVOICE_APPROVER_PAYMENT_RELEASER: 'The approver of this invoice cannot release its payment',
  /** The same person cannot approve in more than one stage of one approval. */
  DISTINCT_STAGE_APPROVERS: 'You have already approved an earlier stage of this request',
} as const;

export type SodRule = keyof typeof SOD_RULES;

@Injectable()
export class SegregationOfDutiesService {
  violates(actorId: string, conflictingActorIds: ReadonlyArray<string | null | undefined>): boolean {
    return conflictingActorIds.some((id) => !!id && id === actorId);
  }

  assert(rule: SodRule, actorId: string, conflictingActorIds: ReadonlyArray<string | null | undefined>): void {
    if (this.violates(actorId, conflictingActorIds)) {
      throw new AppError('SEGREGATION_OF_DUTIES', SOD_RULES[rule], { details: { rule } });
    }
  }
}
