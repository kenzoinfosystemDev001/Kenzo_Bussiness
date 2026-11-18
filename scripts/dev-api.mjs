#!/usr/bin/env node
/**
 * API dev loop without extra tooling: `tsc --watch` compiles (keeping the
 * decorator metadata NestJS DI depends on) and `node --watch` restarts on output
 * changes. Run from apps/api.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

// This is a development loop: `tsc --watch` and `node --watch` both stay
// resident, which costs far more memory than the compiled server and tolerates
// type errors instead of failing. Deployed hosts must build once and run
// `dist/main.js`; starting this script there exhausts the heap instead.
if (process.env.NODE_ENV === 'production') {
  console.error(
    [
      'dev-api.mjs is a development-only watcher and must not run with NODE_ENV=production.',
      'Build and start the compiled server instead:',
      '  npm run build -w @kenzo/api',
      '  npm run start -w @kenzo/api',
    ].join('\n'),
  );
  process.exit(1);
}

const isWin = process.platform === 'win32';
const procs = [];

function run(cmd, args) {
  const p = spawn(cmd, args, { stdio: 'inherit', shell: isWin });
  procs.push(p);
  p.on('exit', (code) => {
    for (const other of procs) if (other !== p) other.kill();
    process.exit(code ?? 0);
  });
}

run('npx', ['tsc', '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput']);

const wait = setInterval(() => {
  if (existsSync('dist/main.js')) {
    clearInterval(wait);
    run('node', ['--enable-source-maps', '--watch-path=dist', 'dist/main.js']);
  }
}, 500);

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => procs.forEach((p) => p.kill()));
