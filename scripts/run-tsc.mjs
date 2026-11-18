#!/usr/bin/env node
/**
 * Runs the TypeScript compiler without relying on `tsc` being on PATH.
 *
 * npm normally puts `node_modules/.bin` on PATH for lifecycle scripts, but in a
 * workspace that is not dependable: on Vercel, `npm install` ran the root
 * postinstall and the workspace build failed with `sh: tsc: command not found`
 * even though TypeScript was installed. Resolving the compiler through Node's
 * module resolution works wherever npm hoisted it.
 *
 *   node scripts/run-tsc.mjs -p tsconfig.build.json
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

let tsc;
for (const specifier of ['typescript/bin/tsc', 'typescript/lib/tsc.js']) {
  try {
    tsc = require.resolve(specifier);
    break;
  } catch {
    // Try the next entry point; TypeScript's layout has differed across majors.
  }
}

if (!tsc) {
  console.error(
    [
      'TypeScript could not be resolved from ' + fileURLToPath(new URL('.', import.meta.url)) + '.',
      'It is a devDependency of the repository root — install dependencies first:',
      '  npm install            (or, in CI, npm ci)',
      'If the installer was told to skip development dependencies, re-run it with --include=dev.',
    ].join('\n'),
  );
  process.exit(1);
}

const result = spawnSync(process.execPath, [tsc, ...process.argv.slice(2)], { stdio: 'inherit' });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
