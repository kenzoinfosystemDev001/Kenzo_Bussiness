/**
 * Idempotent reference-data sync — safe in every environment.
 *  - Upserts the permission catalogue from @kenzo/shared.
 *  - Re-synchronises system roles, numbering templates and draft policy
 *    templates for every existing company.
 * Creates NO users and NO business data.
 *
 *   npm run db:seed
 */
import { PrismaClient } from '@prisma/client';
import { NumberingService } from '../src/infrastructure/numbering/numbering.service';
import { syncPermissionCatalogue, syncSystemRoles } from '../src/modules/access-control/role-sync';
import { CompanyProvisioningService } from '../src/modules/organization/company-provisioning.service';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const numbering = new NumberingService();
  const provisioning = new CompanyProvisioningService(numbering);
  try {
    await prisma.$transaction(
      async (tx) => {
        const permissions = await syncPermissionCatalogue(tx);
        const companies = await tx.company.findMany({ select: { id: true, code: true } });
        for (const c of companies) {
          await syncSystemRoles(tx, c.id);
          await numbering.ensureTemplates(tx, c.id);
          await provisioning.ensureDraftPolicies(tx, c.id, null);
        }
        console.log(`Synced ${permissions} permissions; refreshed system roles for ${companies.length} compan${companies.length === 1 ? 'y' : 'ies'}.`);
      },
      { timeout: 120_000 },
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
