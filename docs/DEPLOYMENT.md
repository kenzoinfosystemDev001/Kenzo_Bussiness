# Deployment

## What can and cannot run on Vercel

This repository is a monorepo with **two** deployable applications:

| App        | What it is                | Can Vercel host it? |
| ---------- | ------------------------- | ------------------- |
| `apps/web` | Next.js 16 front end      | **Yes**             |
| `apps/api` | NestJS API (long-running) | **No** — see below  |

The API cannot run on Vercel as it stands:

- it is a single long-lived process, not per-request functions;
- it runs in-process background work (outbox dispatcher, approval SLA escalation, vendor document expiry scans) on timers that only exist while the process is alive;
- it stores uploaded documents on a local disk path (`DOCUMENT_STORAGE_DIR`), which does not persist on serverless;
- it keeps a pooled PostgreSQL connection and relies on `SELECT … FOR UPDATE` transactions.

Host the API on a platform that runs a container or a persistent Node process — Render, Railway, Fly.io, AWS App Runner / ECS, or any VM. The database is already serverless-friendly (Neon).

**Deploying only `apps/web` to Vercel gives a site where every request fails**, because the browser's `/api/*` calls are proxied to `API_INTERNAL_URL`, which must point at a reachable API. Deploy the API first.

## Why the Vercel build failed

Two separate causes, in the order they appeared:

**1. No Vercel configuration.** Vercel built from the repository root, which is a workspace manifest with no `next` dependency and no Next.js app — nothing to detect or serve.

**2. `tsc: command not found` (exit 127) during `npm install`.**

```
> @kenzo/shared@0.1.0 build
> tsc -p tsconfig.build.json
sh: line 1: tsc: command not found
Error: [BUILD_UTILS_SPAWN_127] Command "npm install" exited with 127
```

The repository root compiles `packages/shared` from its `postinstall`, so every install runs that build. The script invoked `tsc` and depended on npm putting `node_modules/.bin` on PATH. On Vercel that bin link was missing even though the TypeScript _package_ itself was installed, so the shell could not find the command and the install died before any build ran.

Reproduced in an isolated npm workspace: with `NPM_CONFIG_PRODUCTION=true`, `npm install` leaves `node_modules/.bin/tsc` missing and a workspace postinstall fails in exactly this way. Vercel builds run with `NODE_ENV=production`.

The fix is `scripts/run-tsc.mjs`, which locates the compiler through Node module resolution rather than PATH; `packages/shared` uses it for both `build` and `typecheck`. Verified by running the shared build in a tree where `tsc` was absent from PATH, and by a full `next build` in a production-style install.

> Do **not** fix this with `include=dev` in a committed `.npmrc`. npm lets `include` win over `omit`, which silently breaks `npm audit --omit=dev` (the CI `audit:deps` gate) by pulling development packages back into the production audit. This was tested: the gate flipped from pass to fail.

## Vercel settings for `apps/web`

When importing the repository for the first time, set **Root Directory** to `apps/web` on the import screen, before the first build. Everything else can stay at its default — the repository supplies what Vercel needs.

Deploy from a commit that contains `scripts/run-tsc.mjs`; earlier commits fail the install for the reason above.

In the Vercel project → **Settings → General**:

| Setting                                  | Value                                                 |
| ---------------------------------------- | ----------------------------------------------------- |
| Root Directory                           | `apps/web`                                            |
| Include files outside the root directory | **enabled** (needed: `packages/shared` lives outside) |
| Framework Preset                         | Next.js (auto-detected)                               |
| Build Command                            | **override off / empty**                              |
| Output Directory                         | **override off / empty**                              |
| Install Command                          | **override off / empty**                              |

The three command overrides must be switched off so `apps/web/vercel.json` applies. In particular:

- **Output Directory must not be `dist`.** Next.js writes to `.next`, and Vercel's Next.js preset finds it on its own. Pointing at `dist` fails the deploy after an otherwise successful build.
- **Build Command must not be overridden.** Vercel’s Next.js preset runs the build itself; `packages/shared` is compiled by the repository root’s `postinstall`.

`vercel.json` is read from the Root Directory, so it only takes effect once Root Directory is `apps/web`.

### Required environment variable

Set in **Settings → Environment Variables**, for every environment you deploy:

| Name               | Value                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `API_INTERNAL_URL` | Public base URL of your deployed API, e.g. `https://kenzo-api.onrender.com` — no trailing slash, no `/api/v1` suffix |

> **This is read at build time, not only at run time.** Next.js evaluates `rewrites()` during `next build` and writes the result into `routes-manifest.json`. Changing `API_INTERNAL_URL` therefore requires a **redeploy**, not just a restart. Verify after a build with:
>
> ```
> grep -o 'https://[^"]*' .next/routes-manifest.json
> ```

Nothing else is needed by the web app. It holds no secrets: the browser only ever talks to the Vercel domain, and the API URL stays server-side.

## Matching API configuration

On the API host, set `APP_ORIGIN` to the **web app's public URL**, for example `https://kenzo-kore.vercel.app`.

If this does not match, every login and every write returns `403 CSRF_INVALID`. The API checks the `Origin` header, which Next.js forwards through the proxy, and the error message names both the origin it received and the one it expected.

Other API variables (see `.env.example`): `DATABASE_URL`, `DIRECT_DATABASE_URL`, `SESSION_SECRET`, `DATA_ENCRYPTION_KEY`, `NODE_ENV=production`, and `TRUST_PROXY=true` when behind a load balancer. Generate the two secrets fresh per environment; never reuse development values. Under `NODE_ENV=production` the API refuses to start unless cookies are secure.

Because the browser reaches the API only through the same-origin proxy, session cookies stay first-party and no CORS configuration is required in the browser path.

## Deployment order

1. Deploy the API; run `npm run db:migrate` and `npm run db:seed` against the production database.
2. Create the first administrator: `BOOTSTRAP_ADMIN_EMAIL=… BOOTSTRAP_ADMIN_NAME="…" npm run db:bootstrap-admin -w @kenzo/api`. It prints a single-use invitation link; no password is ever stored or printed.
3. Set `API_INTERNAL_URL` in Vercel and deploy `apps/web`.
4. Set `APP_ORIGIN` on the API to the Vercel URL and restart it.
5. Check `GET <api>/api/v1/health/ready`, then sign in through the web app.

## Outstanding work before production use

Carried from the Phase 01 report: object storage is local disk (S3 + KMS pending), mail has no real transport, rate limiting is per-instance in memory, and background pollers run in-process. Each needs addressing before a multi-instance production deployment.
