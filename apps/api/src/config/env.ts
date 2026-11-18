import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Environment configuration, validated at boot. The process refuses to start
 * with missing or weak security configuration. Secrets come from the
 * environment (secret manager injection in deployed environments, a git-ignored
 * `.env` locally) and are never sent to the browser bundle.
 */
const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: z
      .string()
      .min(1, 'DATABASE_URL is required')
      .refine((v) => /^postgres(ql)?:\/\//.test(v), 'DATABASE_URL must be a PostgreSQL URL'),
    /** Direct (non-pooled) connection used by Prisma Migrate only. */
    DIRECT_DATABASE_URL: z.string().optional(),
    APP_ORIGIN: z.string().url().default('http://localhost:3000'),
    /** HMAC key for CSRF tokens and signed URLs. ≥ 32 random bytes. */
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    /** AES-256-GCM key (base64, 32 bytes) for MFA secrets and restricted fields. */
    DATA_ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded'),
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(72).default(12),
    SESSION_IDLE_MINUTES: z.coerce
      .number()
      .int()
      .min(5)
      .max(24 * 60)
      .default(60),
    COOKIE_SECURE: bool.optional(),
    TRUST_PROXY: bool.default(false),
    LOGIN_MAX_FAILURES: z.coerce.number().int().min(3).max(20).default(5),
    LOGIN_LOCK_MINUTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 60)
      .default(15),
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).default(300),
    AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(3).default(10),
    DOCUMENT_STORAGE_DIR: z.string().default('storage/documents'),
    DOCUMENT_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .default(15 * 1024 * 1024),
    DOCUMENT_SCAN_MODE: z.enum(['none', 'required']).default('none'),
    OUTBOX_POLL_MS: z.coerce.number().int().min(0).default(5000),
    ESCALATION_POLL_MS: z.coerce
      .number()
      .int()
      .min(0)
      .default(15 * 60 * 1000),
    VENDOR_EXPIRY_SCAN_MS: z.coerce
      .number()
      .int()
      .min(0)
      .default(6 * 3600 * 1000),
    MAIL_TRANSPORT: z.enum(['log', 'memory']).default('log'),
    MAIL_FROM: z.string().default('Kenzo-Kore BusinessOS <no-reply@kenzo.local>'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  })
  .transform((e) => ({
    ...e,
    COOKIE_SECURE: e.COOKIE_SECURE ?? e.NODE_ENV === 'production',
    ALLOWED_ORIGINS: allowedOrigins(e.APP_ORIGIN, e.NODE_ENV),
  }));

/**
 * Origins accepted for state-changing requests (CSRF defence) and CORS.
 *
 * Production allows exactly APP_ORIGIN. Outside production we additionally
 * accept the loopback twin of that origin — `localhost` and `127.0.0.1` are the
 * same server but different origins to a browser, so hitting the app through
 * the "wrong" one would otherwise fail every write with CSRF_INVALID. Only the
 * configured port is ever accepted, and only loopback hosts.
 */
function allowedOrigins(appOrigin: string, nodeEnv: string): string[] {
  const url = new URL(appOrigin);
  const origins = new Set([url.origin]);
  if (nodeEnv !== 'production') {
    const twin = { localhost: '127.0.0.1', '127.0.0.1': 'localhost', '[::1]': 'localhost' }[url.hostname];
    if (twin) {
      const alt = new URL(url.toString());
      alt.hostname = twin;
      origins.add(alt.origin);
    }
  }
  return [...origins];
}

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

function loadDotEnvFiles(): void {
  // Repository-root .env, then app-level .env. Existing process variables win.
  const candidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env'), resolve(__dirname, '../../../../.env')];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const key = line
        .slice(0, eq)
        .replace(/^export\s+/, '')
        .trim();
      let value = line.slice(eq + 1).trim();
      if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

export function loadEnv(): Env {
  if (cached) return cached;
  loadDotEnvFiles();
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === 'production') {
    if (!parsed.data.COOKIE_SECURE) throw new Error('COOKIE_SECURE must be true in production');
    if (parsed.data.MAIL_TRANSPORT !== 'log') throw new Error('MAIL_TRANSPORT=memory is test-only');
  }
  cached = parsed.data;
  return cached;
}

/** Test hook — resets the cached env so tests can override variables. */
export function resetEnvCache(): void {
  cached = undefined;
}

export const ENV = Symbol('ENV');
