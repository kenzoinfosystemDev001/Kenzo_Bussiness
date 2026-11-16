# Phase 01 Completion Report — Foundation

**Product:** Kenzo-Kore BusinessOS · **Phase:** 01 Foundation · **Status:** Complete and verified
**Verified on:** 16 November 2026 (Windows 11, Node 20.18, PostgreSQL 17 local + Neon PostgreSQL 18)

---

## 1. Existing repository findings

The repository contained only the product blueprint (`Kenzo-Kore_BusinessOS_Product_Blueprint_PRD.docx`). There was no code, git history, schema, authentication or configuration, so nothing existing could be broken; the PRD was treated as the specification. Full details: [REPOSITORY_AUDIT.md](REPOSITORY_AUDIT.md).

## 2. Architecture implemented

Modular monolith per PRD §6: NestJS 11 API (`apps/api`), Next.js 16 web (`apps/web`), shared contracts (`packages/shared`), PostgreSQL via Prisma 6.19. Module boundaries, request pipeline, data and security architecture: [ARCHITECTURE.md](ARCHITECTURE.md). Decisions TD-01…TD-23: [TECHNICAL_DECISIONS.md](TECHNICAL_DECISIONS.md).

## 3. Files created (high level)

| Area               | Location                                                                                                                                                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo & tooling | `package.json` (npm workspaces), `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc.json`, `.editorconfig`, `.gitattributes`, `.gitignore`, `.env.example`, `docker-compose.yml`, `infra/docker/postgres-init.sql`, `scripts/with-env.mjs`, `scripts/dev-api.mjs` |
| CI                 | `.github/workflows/ci.yml` (quality · database · security jobs)                                                                                                                                                                                                        |
| Shared contracts   | `packages/shared/src/{permissions,roles,schemas,money,fiscal,masking,errors,approvals}.ts` + tests                                                                                                                                                                     |
| API core           | `apps/api/src/{config,common,infrastructure}/**`, `bootstrap.ts`, `main.ts`, `app.module.ts`                                                                                                                                                                           |
| API modules        | `apps/api/src/modules/{identity,access-control,organization,workflow,documents,audit,notifications,numbering,integrations,health}/**`                                                                                                                                  |
| Database           | `apps/api/prisma/schema.prisma`, `migrations/20261113000000_foundation/{migration.sql,down.sql}`, `seed.ts`                                                                                                                                                            |
| Scripts            | `apps/api/scripts/{validate-migrations,bootstrap-admin,seed-dev}.ts`                                                                                                                                                                                                   |
| Tests              | `apps/api/test/unit/*.spec.ts`, `apps/api/test/integration/{harness,auth,rbac,approvals,infrastructure}.spec.ts`                                                                                                                                                       |
| Web                | `apps/web/**` — design system, app shell, command palette, 24 routes (see §7)                                                                                                                                                                                          |
| Docs               | `README.md`, `docs/*.md`                                                                                                                                                                                                                                               |

## 4. Database migrations

`20261113000000_foundation` — 24 tables, 12 enums, plus hand-written guarantees: append-only triggers (`audit_event`, `approval_event`, `generated_number`), partial unique indexes (one ACTIVE/DRAFT policy per entity type, one PENDING approval per record, case-insensitive email, GSTIN), and 30+ CHECK constraints. `down.sql` provided.

Applied to: local test database (`kenzo_kore_test`), throwaway validation databases, and the **Neon database** (`neondb`, which was verified empty before migrating). Migration gate (`npm run db:validate-migrations`): **up → drift-free → down → up: passed**.

## 5. Authentication and RBAC

- Login/logout, opaque server sessions (HttpOnly, SameSite=Lax, Secure in prod), absolute + idle expiry, session list/revoke, revoke-others.
- Password reset (single-use, 60 min, no enumeration), password change (revokes other sessions), lockout after 5 failures.
- User invitations (72 h single-use), activation/deactivation (revokes sessions immediately).
- TOTP MFA (enrol, verify, disable), MFA-pending sessions, company-level MFA enforcement for privileged permissions.
- SSO-ready: `identity_provider`/`identity_subject` columns and SSO integration config.
- 59 catalogued permissions, 11 system roles (Super Admin, Company Admin, Procurement Manager/Executive, Finance Manager/Executive, Department Head, Requester, Approver, Auditor, Read-only Management), OWN/DEPARTMENT/COMPANY scopes, custom roles, time-bound assignments.
- Backend enforcement on every route (`PermissionsGuard`) + record-level checks (`AuthorizationService.assertCan`) + company scoping (foreign records → 404).
- Separation of duties: no self-approval; maker-checker exclusions; distinct approvers across stages; nobody edits their own roles; administrative permissions cannot be granted beyond your own.
- Approval engine: versioned policies, amount/department/category conditions, sequential and parallel (ANY N-of-M / ALL) stages, role/user/department-head/manager routing, delegation, admin reassignment, SLA escalation, mandatory reasons for reject/return, return-for-clarification, cancellation, simulation, in-transaction outcome hooks, notifications.

## 6. Security controls

Origin allow-list + session-bound CSRF tokens; zod validation with mass-assignment stripping; Prisma parameterisation with a lint ban on unsafe raw SQL; helmet secure headers (strict JSON CSP, HSTS in prod); per-IP and auth-specific rate limits; fail-fast env validation; secrets only in env / secret manager (integration config refuses secret-looking keys); AES-256-GCM field encryption; masking + audit redaction; private document storage with magic-byte validation, signed user-bound URLs and integrity checks; append-only audit with before/after hashes and correlation IDs; uniform error envelope without stack traces. Production dependency audit: **0 vulnerabilities**.

## 7. Tests executed and results (actual)

| Suite                                                                                 | Command                          | Result                                |
| ------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------- |
| Shared unit (money, fiscal, masking, roles)                                           | `npm run test -w @kenzo/shared`  | **23 / 23 passed** (Phase 01 portion) |
| API unit (TOTP RFC vectors, hashing, encryption, authorization, SoD, file types)      | `npx jest --selectProjects unit` | **21 / 21 passed**                    |
| API integration — auth & sessions                                                     | `auth.spec.ts`                   | **17 / 17 passed**                    |
| API integration — RBAC, isolation, anti-escalation                                    | `rbac.spec.ts`                   | **14 / 14 passed**                    |
| API integration — approval engine                                                     | `approvals.spec.ts`              | **15 / 15 passed**                    |
| API integration — infrastructure (audit, numbering, outbox, documents, headers)       | `infrastructure.spec.ts`         | **16 / 16 passed**                    |
| Web (API client, CSRF, status badges, tables, confirm dialog, gating, palette, forms) | `npm run test -w @kenzo/web`     | **20 / 20 passed**                    |
| Lint                                                                                  | `npx eslint . --max-warnings=0`  | **0 problems**                        |
| Typecheck                                                                             | shared, API, web                 | **passed**                            |
| Migration gate                                                                        | `npm run db:validate-migrations` | **passed**                            |

The integration suite runs twice in a row without resets (tenant-isolated by design), proving tests are repeatable.

## 8. Build and deployment status

- `npm run build -w @kenzo/api` — passed. The API was started against Neon: `/api/v1/health` → `ok`, `/api/v1/health/ready` → `ready, database ok`.
- `npm run build -w @kenzo/web` — passed (Next 16.4.6, Turbopack).
- CI workflow defined; it will run on the first push to GitHub.
- No production deployment target exists yet (PRD §16 AWS topology is Phase 06).

## 9. Known limitations

- Mail delivery uses the `log` transport (no SMTP/SES yet); emails are queued via the outbox and printed in development.
- Object storage is the private local-disk adapter; S3 + KMS and malware scanning are pending (`DOCUMENT_SCAN_MODE=none`).
- OIDC SSO flow, TOTP recovery codes and replay protection are not implemented yet.
- Rate limiting is in-memory per instance; background pollers run in-process (BullMQ/Redis later).
- OpenAPI document is not generated yet.
- Web CSP permits inline scripts (TD-23). jsdom tests need `--experimental-require-module` on Node 20.18 (configured).
- Approval thresholds are provisioned as DRAFT policies and must be confirmed by finance before publishing.

## 10. Instructions for starting Phase 02

Phase 02 has been executed — see [PHASE_02_COMPLETION_REPORT.md](PHASE_02_COMPLETION_REPORT.md). For later phases, reuse the extension points listed in [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md#foundation-extension-points-each-phase-must-use).
