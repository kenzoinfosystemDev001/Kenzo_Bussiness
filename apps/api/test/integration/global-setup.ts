import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readTestDatabaseUrl } from './test-db-url';

/**
 * Brings the dedicated test database up to date with `prisma migrate deploy`.
 *
 * Deliberately NON-destructive: no reset/drop. Every test provisions its own
 * company with a random code, so runs are isolated by tenant and data from
 * earlier runs cannot interfere. (This also exercises company scoping on every
 * run, since other companies' data is always present.)
 */
export default function globalSetup(): void {
  const url = readTestDatabaseUrl();
  const root = resolve(__dirname, '../..');
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: root,
    stdio: 'pipe',
    // Both URLs MUST point at the test database: Prisma Migrate uses directUrl when present.
    env: { ...process.env, DATABASE_URL: url, DIRECT_DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    shell: process.platform === 'win32',
  });
}
