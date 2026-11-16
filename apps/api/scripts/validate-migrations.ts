/**
 * Migration gate (CI + local). Against a throwaway database on the same server:
 *   1. apply all migrations (up)               → must succeed
 *   2. diff migrated DB vs schema.prisma       → must be identical (no drift)
 *   3. apply every down.sql in reverse order   → must leave no application tables
 *   4. re-apply all migrations                 → must succeed (repeatable)
 *   5. drop the throwaway database
 *
 *   npm run db:validate-migrations
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

const root = resolve(__dirname, '..');
const migrationsDir = join(root, 'prisma', 'migrations');
const prismaBin = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'prisma.cmd' : 'prisma');
const prismaCmd = existsSync(prismaBin) ? prismaBin : 'npx';

function prisma(args: string[], url: string, allowExit: number[] = [0]): number {
  const fullArgs = prismaCmd === 'npx' ? ['prisma', ...args] : args;
  try {
    // Override BOTH urls: Prisma Migrate prefers directUrl, which must never point at the real database here.
    execFileSync(prismaCmd, fullArgs, {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: url, DIRECT_DATABASE_URL: url },
      shell: process.platform === 'win32',
    });
    return 0;
  } catch (err) {
    const status = (err as { status?: number }).status ?? 1;
    if (allowExit.includes(status)) return status;
    throw err;
  }
}

function withDatabase(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

async function main(): Promise<void> {
  // Runs on a throwaway database. Prefer the local test server (TEST_DATABASE_URL) so
  // validation never creates databases on a shared/managed server.
  const baseUrl = process.env.MIGRATION_CHECK_DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!baseUrl) throw new Error('TEST_DATABASE_URL (or DATABASE_URL) is required');
  const tempDb = `kk_migcheck_${Date.now()}`;
  const adminUrl = withDatabase(baseUrl, 'postgres');
  const tempUrl = withDatabase(baseUrl, tempDb);
  const admin = new PrismaClient({ datasourceUrl: adminUrl });

  await admin.$executeRawUnsafe(`CREATE DATABASE "${tempDb}"`);
  console.log(`▶ created ${tempDb}`);
  try {
    console.log('▶ 1/4 apply migrations');
    prisma(['migrate', 'deploy'], tempUrl);

    console.log('▶ 2/4 drift check (migrations vs schema.prisma)');
    const drift = prisma(['migrate', 'diff', '--from-url', tempUrl, '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code'], tempUrl, [0, 2]);
    if (drift !== 0) throw new Error('Schema drift: schema.prisma does not match the migrations. Create a migration.');

    console.log('▶ 3/4 roll back (down.sql, newest first)');
    const migrations = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .reverse();
    for (const name of migrations) {
      const down = join(migrationsDir, name, 'down.sql');
      if (!existsSync(down)) throw new Error(`Migration ${name} has no down.sql (document why if irreversible)`);
      prisma(['db', 'execute', '--url', tempUrl, '--file', down], tempUrl);
      console.log(`   ↩ ${name}`);
    }
    const temp = new PrismaClient({ datasourceUrl: tempUrl });
    try {
      const leftovers = await temp.$queryRaw<Array<{ table_name: string }>>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'`;
      if (leftovers.length > 0) throw new Error(`down.sql left tables behind: ${leftovers.map((t) => t.table_name).join(', ')}`);
      await temp.$executeRawUnsafe('DELETE FROM _prisma_migrations');
    } finally {
      await temp.$disconnect();
    }

    console.log('▶ 4/4 re-apply migrations');
    prisma(['migrate', 'deploy'], tempUrl);
    console.log('\n✔ migrations validated: up, drift-free, reversible, repeatable');
  } finally {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${tempDb}" WITH (FORCE)`);
    await admin.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(`\n✖ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
