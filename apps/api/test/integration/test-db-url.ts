import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Integration tests run ONLY against TEST_DATABASE_URL — never DATABASE_URL —
 * and refuse database names that do not look like test databases, because the
 * suite resets the schema.
 */
export function readTestDatabaseUrl(): string {
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    const envFile = resolve(__dirname, '../../../../.env');
    if (existsSync(envFile)) {
      const line = readFileSync(envFile, 'utf8')
        .split(/\r?\n/)
        .find((l) => l.trim().startsWith('TEST_DATABASE_URL='));
      url = line
        ?.slice(line.indexOf('=') + 1)
        .trim()
        .replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  url ||= 'postgresql://kenzo:kenzo_local_dev_only@127.0.0.1:55432/kenzo_kore_test?schema=public';
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!/test/i.test(dbName)) throw new Error(`Refusing to run integration tests against "${dbName}" — the database name must contain "test".`);
  return url;
}
