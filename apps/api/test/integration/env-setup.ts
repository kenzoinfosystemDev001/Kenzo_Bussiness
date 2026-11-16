import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTestDatabaseUrl } from './test-db-url';

/** Runs in every integration-test worker before modules load. */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = readTestDatabaseUrl();
process.env.DIRECT_DATABASE_URL = process.env.DATABASE_URL;
process.env.APP_ORIGIN = 'http://localhost:3000';
process.env.SESSION_SECRET = 'test-session-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.MAIL_TRANSPORT = 'memory';
process.env.OUTBOX_POLL_MS = '0';
process.env.ESCALATION_POLL_MS = '0';
process.env.RATE_LIMIT_PER_MINUTE = '100000';
process.env.AUTH_RATE_LIMIT_PER_MINUTE = '100000';
process.env.LOGIN_MAX_FAILURES = '5';
process.env.DOCUMENT_STORAGE_DIR = mkdtempSync(join(tmpdir(), 'kk-docs-'));
process.env.DOCUMENT_MAX_BYTES = String(1024 * 1024);
process.env.LOG_LEVEL = 'error';
