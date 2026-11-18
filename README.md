# Kenzo-Kore BusinessOS

Internal business operations platform for Kenzo Infosystems Pvt. Ltd. — vendor management, procurement (requisitions → RFQ → quotations → PO → receipts), accounts payable/receivable, payments, approvals and financial reporting on one shared transaction graph.

> **Phase 01** (foundation: auth, RBAC, company scoping, approval engine, audit, numbering, documents, notifications, design system, CI) and **Phase 02** (vendor management: onboarding wizard, lifecycle, documents, encrypted bank details with maker-checker, duplicate detection, Vendor 360, performance) are complete. See [Phase 01](docs/PHASE_01_COMPLETION_REPORT.md) and [Phase 02](docs/PHASE_02_COMPLETION_REPORT.md) reports.

## Stack

|                  |                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------ |
| API              | NestJS 11 (TypeScript 5.9), modular monolith — `apps/api`                                  |
| Web              | Next.js 16 App Router, React 19, Tailwind CSS 3.4 — `apps/web`                             |
| Database         | PostgreSQL 17, Prisma 6.19 migrations — `apps/api/prisma`                                  |
| Shared contracts | `@kenzo/shared` — permissions, roles, zod schemas, exact decimal money — `packages/shared` |

## Prerequisites

- Node.js ≥ 20.18 and npm ≥ 10
- Docker (for local PostgreSQL) — or any PostgreSQL ≥ 14 reachable via `DATABASE_URL`

## Getting started (local)

```bash
# 1. Install (also builds @kenzo/shared)
npm install

# 2. Configure — copy and fill in the two secrets (commands are in the file)
cp .env.example .env

# 3. Database
npm run db:up              # PostgreSQL 17 on 127.0.0.1:55432 (+ kenzo_kore_test database)
npm run db:migrate         # apply migrations
npm run db:seed            # permission catalogue + system roles (idempotent, no users)

# 4a. Local demo data (synthetic users for every role; refuses non-local databases)
npm run db:seed:dev -w @kenzo/api
# 4b. …or bootstrap a real first administrator (prints a one-time invitation link)
BOOTSTRAP_ADMIN_EMAIL=admin@example.com BOOTSTRAP_ADMIN_NAME="First Admin" npm run db:bootstrap-admin -w @kenzo/api

# 5. Run
npm run dev:api            # http://127.0.0.1:4000/api/v1/health
npm run dev:web            # http://localhost:3000
```

## Quality gates

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:unit                 # shared + API unit + web component tests
npm run test:integration          # API integration/authorization tests (needs PostgreSQL; uses TEST_DATABASE_URL)
npm run db:validate-migrations    # up → drift check → down → up on a throwaway database
npm run build
npm run audit:deps                # fails on high/critical production advisories
```

CI runs all of the above (`.github/workflows/ci.yml`).

## Documentation

- [Repository audit](docs/REPOSITORY_AUDIT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Technical decisions](docs/TECHNICAL_DECISIONS.md)
- [Implementation roadmap](docs/IMPLEMENTATION_ROADMAP.md)
- [Deployment](docs/DEPLOYMENT.md) — what can run on Vercel, and what cannot
- [Phase 01 completion report](docs/PHASE_01_COMPLETION_REPORT.md)
- [Phase 02 completion report](docs/PHASE_02_COMPLETION_REPORT.md)
- Product blueprint: `Kenzo-Kore_BusinessOS_Product_Blueprint_PRD.docx`

## Security notes

- Never commit `.env` or real data. Secrets are injected from a secret manager in deployed environments.
- All authorization is enforced by the API; UI permission checks are cosmetic.
- Report vulnerabilities privately to the engineering lead; do not open public issues.
