import { Injectable } from '@nestjs/common';
import type { Company } from '@prisma/client';
import { NumberingService } from '../../infrastructure/numbering/numbering.service';
import type { Tx } from '../../infrastructure/prisma/prisma.service';
import { syncPermissionCatalogue, syncSystemRoles } from '../access-control/role-sync';
import { DEFAULT_POLICY_TEMPLATES } from '../workflow/default-policies';

export interface ProvisionCompanyInput {
  code: string;
  legalName: string;
  displayName: string;
  gstin?: string | null;
  pan?: string | null;
  country?: string;
  timezone?: string;
  baseCurrency?: string;
  fiscalYearStartMonth?: number;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
}

/**
 * Creates a company with everything it needs to operate: system roles,
 * numbering templates and DRAFT approval policies built from the PRD's
 * illustrative matrix. Draft policies are never active until an administrator
 * reviews the thresholds with finance and publishes them (PRD §17 open question).
 */
@Injectable()
export class CompanyProvisioningService {
  constructor(private readonly numbering: NumberingService) {}

  async provision(tx: Tx, input: ProvisionCompanyInput, actorId: string | null): Promise<{ company: Company; roleIds: Map<string, string> }> {
    await syncPermissionCatalogue(tx);
    const company = await tx.company.create({
      data: {
        code: input.code,
        legalName: input.legalName,
        displayName: input.displayName,
        gstin: input.gstin ?? null,
        pan: input.pan ?? null,
        country: input.country ?? 'IN',
        timezone: input.timezone ?? 'Asia/Kolkata',
        baseCurrency: input.baseCurrency ?? 'INR',
        fiscalYearStartMonth: input.fiscalYearStartMonth ?? 4,
        addressLine1: input.addressLine1 ?? null,
        addressLine2: input.addressLine2 ?? null,
        city: input.city ?? null,
        state: input.state ?? null,
        postalCode: input.postalCode ?? null,
        createdById: actorId,
        updatedById: actorId,
      },
    });
    const roleIds = await syncSystemRoles(tx, company.id, actorId);
    await this.numbering.ensureTemplates(tx, company.id);
    await this.ensureDraftPolicies(tx, company.id, actorId);
    return { company, roleIds };
  }

  async ensureDraftPolicies(tx: Tx, companyId: string, actorId: string | null): Promise<void> {
    for (const t of DEFAULT_POLICY_TEMPLATES) {
      const exists = await tx.approvalPolicy.findFirst({ where: { companyId, entityType: t.entityType } });
      if (exists) continue;
      await tx.approvalPolicy.create({
        data: {
          companyId,
          entityType: t.entityType,
          name: t.name,
          description: t.description,
          policyVersion: 1,
          status: 'DRAFT',
          requireIndependentApproval: true,
          distinctApproversAcrossStages: true,
          allowDelegation: t.allowDelegation,
          excludeInitiatorFromAllStages: true,
          createdById: actorId,
          updatedById: actorId,
          stages: {
            create: t.stages.map((s) => ({
              sequence: s.sequence,
              name: s.name,
              mode: s.mode,
              minApprovals: s.minApprovals ?? 1,
              minAmount: s.minAmount ?? null,
              maxAmount: s.maxAmount ?? null,
              approverType: s.approverType,
              approverRoleKey: s.approverRoleKey ?? null,
              slaHours: s.slaHours ?? null,
              escalationRoleKey: s.escalationRoleKey ?? null,
            })),
          },
        },
      });
    }
  }
}
