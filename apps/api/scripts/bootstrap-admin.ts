/**
 * One-time production bootstrap: creates the first company and invites its
 * first Super Admin. No password is ever set or printed by this script — the
 * administrator receives a single-use 72-hour invitation link.
 *
 *   BOOTSTRAP_ADMIN_EMAIL=… BOOTSTRAP_ADMIN_NAME=… npm run db:bootstrap-admin
 *
 * Refuses to run if any company already exists.
 */
import { PrismaClient } from '@prisma/client';
import { createCompanySchema, emailSchema } from '@kenzo/shared';
import { generateToken, sha256Hex } from '../src/infrastructure/crypto/tokens';
import { NumberingService } from '../src/infrastructure/numbering/numbering.service';
import { CompanyProvisioningService } from '../src/modules/organization/company-provisioning.service';

async function main(): Promise<void> {
  const email = emailSchema.parse(process.env.BOOTSTRAP_ADMIN_EMAIL ?? '');
  const fullName = (process.env.BOOTSTRAP_ADMIN_NAME ?? '').trim();
  if (!fullName) throw new Error('BOOTSTRAP_ADMIN_NAME is required');
  const company = createCompanySchema.parse({
    code: process.env.BOOTSTRAP_COMPANY_CODE ?? 'KENZO',
    legalName: process.env.BOOTSTRAP_COMPANY_LEGAL_NAME ?? 'Kenzo Infosystems Pvt. Ltd.',
    displayName: process.env.BOOTSTRAP_COMPANY_DISPLAY_NAME ?? 'Kenzo Infosystems',
    timezone: 'Asia/Kolkata',
    baseCurrency: 'INR',
    fiscalYearStartMonth: 4,
  });
  const appOrigin = process.env.APP_ORIGIN ?? 'http://localhost:3000';

  const prisma = new PrismaClient();
  try {
    const token = generateToken();
    await prisma.$transaction(
      async (tx) => {
        if ((await tx.company.count()) > 0) throw new Error('A company already exists — bootstrap has already been performed.');
        const provisioning = new CompanyProvisioningService(new NumberingService());
        const { company: created, roleIds } = await provisioning.provision(tx, company, null);
        const user = await tx.user.create({ data: { companyId: created.id, email, fullName, status: 'INVITED' } });
        await tx.userRoleAssignment.create({ data: { companyId: created.id, userId: user.id, roleId: roleIds.get('SUPER_ADMIN')! } });
        await tx.authToken.create({
          data: { userId: user.id, type: 'INVITATION', tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + 72 * 3600_000) },
        });
        await tx.auditEvent.create({
          data: {
            companyId: created.id,
            action: 'platform.bootstrapped',
            entityType: 'company',
            entityId: created.id,
            afterData: { adminUserId: user.id, companyCode: created.code },
          },
        });
      },
      { timeout: 120_000 },
    );
    console.log(`\nCompany "${company.displayName}" created. Super Admin invited: ${email}`);
    console.log(`Single-use invitation link (expires in 72 h) — deliver it securely:\n${new URL(`/accept-invitation?token=${token}`, appOrigin).toString()}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
