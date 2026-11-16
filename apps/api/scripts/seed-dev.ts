/**
 * LOCAL DEVELOPMENT ONLY — creates a clearly-labelled demo company with one
 * synthetic user per system role so every screen and permission path can be
 * exercised. Refuses to run unless NODE_ENV=development and the database host
 * is local. Never use in shared, staging or production environments.
 *
 *   npm run db:seed:dev -w @kenzo/api
 */
import { PrismaClient } from '@prisma/client';
import { SYSTEM_ROLE_KEYS, type SystemRoleKey } from '@kenzo/shared';
import { hashPassword } from '../src/infrastructure/crypto/password-hasher';
import { NumberingService } from '../src/infrastructure/numbering/numbering.service';
import { CompanyProvisioningService } from '../src/modules/organization/company-provisioning.service';

const DEMO_PASSWORD = process.env.DEV_SEED_PASSWORD ?? 'Kenzo-Dev-Only-2026';

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== 'development') throw new Error('seed-dev runs only with NODE_ENV=development');
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!['localhost', '127.0.0.1', '::1', 'postgres'].includes(url.hostname)) {
    throw new Error(`seed-dev refuses to run against non-local database host "${url.hostname}"`);
  }

  const prisma = new PrismaClient();
  try {
    if (await prisma.company.findUnique({ where: { code: 'DEMO' } })) {
      console.log('Demo company already exists — nothing to do.');
      return;
    }
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    await prisma.$transaction(
      async (tx) => {
        const provisioning = new CompanyProvisioningService(new NumberingService());
        const { company, roleIds } = await provisioning.provision(
          tx,
          {
            code: 'DEMO',
            legalName: 'Demo Company (Synthetic Data) Pvt. Ltd.',
            displayName: 'Demo Company (synthetic)',
            state: 'Karnataka',
            city: 'Bengaluru',
          },
          null,
        );
        const departments = new Map<string, string>();
        for (const [code, name] of [
          ['ENG', 'Engineering'],
          ['FIN', 'Finance'],
          ['PROC', 'Procurement'],
          ['OPS', 'Operations'],
        ] as const) {
          const d = await tx.department.create({ data: { companyId: company.id, code, name } });
          departments.set(code, d.id);
          await tx.costCentre.create({ data: { companyId: company.id, code: `CC-${code}`, name: `${name} cost centre`, departmentId: d.id } });
        }
        const deptFor: Record<SystemRoleKey, string> = {
          SUPER_ADMIN: 'OPS',
          COMPANY_ADMIN: 'OPS',
          PROCUREMENT_MANAGER: 'PROC',
          PROCUREMENT_EXECUTIVE: 'PROC',
          FINANCE_MANAGER: 'FIN',
          FINANCE_EXECUTIVE: 'FIN',
          DEPARTMENT_HEAD: 'ENG',
          REQUESTER: 'ENG',
          APPROVER: 'OPS',
          AUDITOR: 'FIN',
          READ_ONLY_MANAGEMENT: 'OPS',
        };
        const users = new Map<SystemRoleKey, string>();
        for (const key of SYSTEM_ROLE_KEYS) {
          const slug = key.toLowerCase().replace(/_/g, '.');
          const name = key
            .toLowerCase()
            .split('_')
            .map((w) => w[0]!.toUpperCase() + w.slice(1))
            .join(' ');
          const user = await tx.user.create({
            data: {
              companyId: company.id,
              email: `${slug}@demo.kenzo.local`,
              fullName: `Demo ${name}`,
              jobTitle: name,
              status: 'ACTIVE',
              passwordHash,
              passwordChangedAt: new Date(),
              activatedAt: new Date(),
              departmentId: departments.get(deptFor[key])!,
            },
          });
          users.set(key, user.id);
          await tx.userRoleAssignment.create({ data: { companyId: company.id, userId: user.id, roleId: roleIds.get(key)! } });
        }
        await tx.department.update({ where: { id: departments.get('ENG')! }, data: { headUserId: users.get('DEPARTMENT_HEAD')! } });
        await tx.department.update({ where: { id: departments.get('FIN')! }, data: { headUserId: users.get('FINANCE_MANAGER')! } });
        await tx.department.update({ where: { id: departments.get('PROC')! }, data: { headUserId: users.get('PROCUREMENT_MANAGER')! } });
        await tx.department.update({ where: { id: departments.get('OPS')! }, data: { headUserId: users.get('APPROVER')! } });
        await tx.user.update({ where: { id: users.get('REQUESTER')! }, data: { managerId: users.get('DEPARTMENT_HEAD')! } });
      },
      { timeout: 120_000 },
    );
    console.log('\nDemo company created with one synthetic user per role:');
    for (const key of SYSTEM_ROLE_KEYS) console.log(`  ${key.padEnd(22)} ${key.toLowerCase().replace(/_/g, '.')}@demo.kenzo.local`);
    console.log(`Password for all demo users: ${DEMO_PASSWORD}  (local development only)\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
