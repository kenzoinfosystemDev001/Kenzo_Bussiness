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

**3. `TypeScript could not be resolved` during `npm install`.** With the compiler no longer looked up on PATH, the next deploy showed that Vercel does not install the repository root's devDependencies at all — not even with `--include=dev`. Two consequences, both fixed:

- `packages/shared/tsconfig.json` required `@types/node` through `types: ["node"]`, although nothing in the package uses a Node API. It is now `types: []`, so the package compiles without it.
- `typescript` is now a **dependency** of `packages/shared` rather than only a root devDependency. The package compiles itself during `postinstall`, so the compiler must sit in whatever closure the installer resolves — the same one that provides `zod`. npm dedupes it against the root devDependency, so only one copy is installed, and `npm audit --omit=dev` still reports no vulnerabilities.

The general rule: anything the root `postinstall` needs must be reachable from the production closure, because a host may install only that.

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

## Hosting the API on Render

### Why the first Render deploy crashed

The service was started with `npm run dev`, which is the local development loop
(`scripts/dev-api.mjs`): it keeps `tsc --watch` and `node --watch dist` resident
side by side. Two failures followed from that single setting.

```
Can't reach database server at `127.0.0.1:55432`
Failed running 'dist/main.js'. Waiting for file changes before restarting...
...
FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
==> Exited with status 134
==> No open ports detected, continuing to scan...
```

1. **`DATABASE_URL` still pointed at the local Docker database.** `127.0.0.1:55432`
   is the port `docker-compose.yml` publishes on a developer machine; inside a
   Render container nothing listens there. Prisma could not connect, so the
   server exited before binding a port.
2. **The watcher then burned the instance's memory.** Under `npm run dev` a
   crashed server does not end the service — `node --watch` parks and waits for
   a file change while the TypeScript compiler stays resident. On a 512 MB
   instance the compiler's heap hit its limit and V8 aborted with exit code 134,
   which is what Render reported. `No open ports detected` was a consequence,
   not a separate problem: the process never reached `app.listen`.

Running `npm run dev` on a host is the root cause of both. `scripts/dev-api.mjs`
now refuses to start when it detects a deployment platform — Render, Railway,
Fly.io, Heroku or Vercel by their own environment markers, or `NODE_ENV=production`
— and prints the settings below. Checking `NODE_ENV` alone was not enough: a
service whose environment was never configured runs with it unset, and the first
symptom is still the compiler dying of heap exhaustion two minutes later.

A deployed instance must **build once and run the compiled output**:

| Setting           | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| Root Directory    | repository root (leave blank) — the API needs `packages/shared` |
| Build Command     | `npm ci && npm run build -w @kenzo/api`                         |
| Start Command     | `npm run db:migrate -w @kenzo/api && npm start`                 |
| Health Check Path | `/api/v1/health`                                                |

`npm start` at the repository root is `node dist/main.js` — one process, no
compiler, no watchers. It is deliberately the root script, because Render and
most hosts fall back to `npm start` when the start command is left blank.
`prisma migrate deploy` is idempotent, so running it on each boot is safe and
keeps the schema in step without a paid pre-deploy command.

> Changing `render.yaml` does **not** change a service that was created by hand.
> A blueprint only configures services it creates. An existing service keeps the
> Build and Start commands and the environment variables in its own dashboard
> until you edit them there, which is why a service left on `npm run dev` goes on
> failing no matter what this repository says.

### Deploying with the blueprint

`render.yaml` at the repository root declares the service and a PostgreSQL
database with exactly those settings.

1. Push a commit containing `render.yaml` and **make sure it compiles** —
   `npm run build -w @kenzo/api` must pass locally first. Production builds use
   `tsc` without `--watch`, so any type error fails the deploy; the development
   watcher tolerates errors and keeps serving the last good output, which hides
   them.
2. In Render: **Blueprints → New Blueprint Instance**, select the repository,
   apply.
3. Fill in the two variables the blueprint leaves blank (`sync: false`), under
   the service's **Environment**:

   | Name                  | Value                                                                               |
   | --------------------- | ----------------------------------------------------------------------------------- |
   | `DATA_ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`       |
   | `APP_ORIGIN`          | Public URL of the web app, e.g. `https://kenzo-kore.vercel.app` — no trailing slash |

   `SESSION_SECRET` is generated by Render. `DATABASE_URL` and
   `DIRECT_DATABASE_URL` are wired to the blueprint's database automatically.
   Never copy these values from a development `.env`.

4. Wait for the deploy, then check `https://<service>.onrender.com/api/v1/health`
   and `/api/v1/health/ready`. `ready` returning 200 means migrations applied and
   the database is reachable.
5. Create the first administrator — free instances have no shell, so run it from
   your machine against the database's **External Database URL** (Render
   dashboard → the database → Connections):

   ```
   DATABASE_URL='<external url>' DIRECT_DATABASE_URL='<external url>' \
     BOOTSTRAP_ADMIN_EMAIL='you@example.com' BOOTSTRAP_ADMIN_NAME='Your Name' \
     npm run db:bootstrap-admin -w @kenzo/api
   ```

   It prints a single-use invitation link.

Configuring the service by hand instead of by blueprint works equally well: create
a **Web Service**, point it at the repository, and set the four values in the
table above plus the environment variables listed in `render.yaml`.

### Limits of the free plan

These are properties of the plan, not of the application, but this API feels all
three:

- **Free web services sleep after 15 minutes without traffic** and take ~50 s to
  wake. The in-process background work — the outbox dispatcher, approval SLA
  escalation and vendor document expiry scans — only runs while the process is
  alive, so timers stop while the service is asleep. Anything time-sensitive
  needs a paid instance.
- **Free PostgreSQL is deleted after 30 days.** Keep nothing you cannot recreate
  on it, or upgrade before the expiry date shown in the dashboard.
- **The filesystem is ephemeral.** `DOCUMENT_STORAGE_DIR` is wiped on every
  deploy and restart, so uploaded documents do not survive. A persistent disk
  (paid) mounted at that path fixes it until object storage replaces local disk.

If the build itself runs out of memory, the compiler — not the server — is the
thing that needs more room: move the service to Starter. The runtime footprint of
`node dist/main.js` is small.

## Deployment order

1. Deploy the API; run `npm run db:migrate` and `npm run db:seed` against the production database.
2. Create the first administrator: `BOOTSTRAP_ADMIN_EMAIL=… BOOTSTRAP_ADMIN_NAME="…" npm run db:bootstrap-admin -w @kenzo/api`. It prints a single-use invitation link; no password is ever stored or printed.
3. Set `API_INTERNAL_URL` in Vercel and deploy `apps/web`.
4. Set `APP_ORIGIN` on the API to the Vercel URL and restart it.
5. Check `GET <api>/api/v1/health/ready`, then sign in through the web app.

## Outstanding work before production use

Carried from the Phase 01 report: object storage is local disk (S3 + KMS pending), mail has no real transport, rate limiting is per-instance in memory, and background pollers run in-process. Each needs addressing before a multi-instance production deployment.
