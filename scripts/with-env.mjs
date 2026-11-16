#!/usr/bin/env node
/**
 * Runs a command with environment variables loaded from the repository-root
 * `.env` (and optionally `apps/api/.env`). Real environment variables always
 * win, so CI and production inject secrets without any file.
 *
 *   node scripts/with-env.mjs prisma migrate deploy
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseEnvFile(path) {
  const out = {};
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line
      .slice(0, eq)
      .replace(/^export\s+/, '')
      .trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const fileEnv = {};
for (const file of [resolve(root, '.env'), resolve(root, 'apps/api/.env')]) {
  if (existsSync(file)) Object.assign(fileEnv, parseEnvFile(file));
}
const env = { ...fileEnv, ...process.env };

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error('usage: with-env.mjs <command> [...args]');
  process.exit(2);
}
const child = spawn(cmd, args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
