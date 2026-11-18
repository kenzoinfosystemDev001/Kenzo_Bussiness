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
//
// NODE_ENV alone is not enough to detect that: a host whose environment was
// never configured runs this with NODE_ENV unset, and the first symptom is the
// compiler dying of heap exhaustion two minutes later. Each platform's own
// marker catches that case immediately.
const host =
  (process.env.RENDER && 'Render') ||
  (process.env.RAILWAY_ENVIRONMENT && 'Railway') ||
  (process.env.FLY_APP_NAME && 'Fly.io') ||
  (process.env.DYNO && 'Heroku') ||
  (process.env.VERCEL && 'Vercel') ||
  (process.env.NODE_ENV === 'production' && 'this host');

if (host) {
  console.error(
    [
      `dev-api.mjs is a development-only watcher and must not run on ${host}.`,
      'It keeps the TypeScript compiler and a file watcher resident, which will',
      'exhaust the memory of a small instance and never bind a port.',
      '',
      'Set the service to build once and run the compiled server:',
      '  Build command:  npm ci && npm run build -w @kenzo/api',
      '  Start command:  npm run db:migrate -w @kenzo/api && npm start',
      '',
      'See docs/DEPLOYMENT.md, or apply the render.yaml blueprint in this repository.',
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
