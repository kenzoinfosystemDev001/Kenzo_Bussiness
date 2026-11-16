# Repository Audit — Kenzo-Kore BusinessOS

**Audit date:** 13 November 2026
**Scope:** Phase 01 "Repository intelligence" (Master Prompt 01 §2)
**Auditor:** Engineering (Phase 01 foundation)

---

## 1. Starting state of the repository

The repository at the start of Phase 01 contained exactly one artefact:

| Path                                               | Type                  | Notes                                                                     |
| -------------------------------------------------- | --------------------- | ------------------------------------------------------------------------- |
| `Kenzo-Kore_BusinessOS_Product_Blueprint_PRD.docx` | Word document (68 KB) | PRD + solution architecture + implementation blueprint, v1.0, 13 Nov 2026 |

There was **no** source code, version control (`.git`), package manifest, database schema, ORM, migrations, authentication, environment configuration, deployment configuration, CI, tests or UI.

Consequences for the audit checklist in Master Prompt 01 §2:

| Checklist item                                              | Finding                                                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------- |
| Frontend / backend architecture                             | None existed.                                                       |
| Framework, language, package manager, build tooling         | None existed.                                                       |
| Database schema, ORM, migrations                            | None existed.                                                       |
| Authentication / authorization                              | None existed.                                                       |
| Reusable components / design conventions                    | None in code. The PRD (§5) defines the visual direction and tokens. |
| Environment / deployment configuration                      | None existed.                                                       |
| API routes, services, hooks, state management               | None existed.                                                       |
| Broken / incomplete / duplicated / insecure implementations | Nothing to assess — no implementation present.                      |
| Run the application and existing tests                      | Nothing to run.                                                     |

Because nothing existed, "preserve existing working functionality" applies to the PRD's decisions rather than to code. The PRD was therefore treated as the authoritative specification, and its recommended stack (§6.2) and repository layout (§12) were adopted wherever they were compatible with a maintainable foundation. Deviations are recorded in [TECHNICAL_DECISIONS.md](TECHNICAL_DECISIONS.md).

## 2. PRD analysis — what the foundation must honour

Key binding decisions extracted from the PRD:

| PRD section  | Requirement                                                                    | How Phase 01 honours it                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exec summary | Shared transaction graph, not disconnected CRUD                                | Approval engine references entities by `(entity_type, entity_id)`; outbox events; numbering registry links numbers to entities; audit events carry entity refs. |
| §1.5         | Never destroy financial history                                                | Audit and approval-event tables are append-only via DB triggers; masters use status flags; role assignments are soft-revoked.                                   |
| §2.1         | `allow(action, resource, user)` with company, scope, policy conditions         | `AuthorizationService.can/assertCan/scopeFilter` implement exactly this formula.                                                                                |
| §2.2         | Separation of duties                                                           | `SegregationOfDutiesService` + engine-level checks at routing **and** decision time.                                                                            |
| §2.3         | Configurable approval matrix                                                   | Versioned `approval_policy` + `approval_policy_stage`; PRD matrix provisioned as **DRAFT** (thresholds are "illustrative only").                                |
| §3.1         | Login, logout, revocation, reset, invitations, activation, SSO/MFA             | Implemented (SSO is architecture-ready, see limitations).                                                                                                       |
| §6.1         | Modular monolith, PostgreSQL, workers                                          | NestJS modular monolith; PostgreSQL 17; in-process outbox/escalation pollers (BullMQ deferred).                                                                 |
| §8.2         | UUID PKs, NUMERIC money, timestamptz, FKs/checks, company_id everywhere        | All applied in the foundation schema and migration.                                                                                                             |
| §9.1         | `/api/v1`, error envelope with correlation id, cursor pagination, ETag/version | Implemented (`version` body field for optimistic concurrency).                                                                                                  |
| §10          | Security controls                                                              | See [ARCHITECTURE.md §6](ARCHITECTURE.md#6-security-architecture).                                                                                              |
| §14.2        | Gate A: no localStorage-only business records                                  | Browser storage holds only the theme preference.                                                                                                                |
| §16.2        | CI with migration gates                                                        | `.github/workflows/ci.yml` incl. migration up/drift/down/up validation.                                                                                         |

## 3. Development environment found

| Tool                    | Version found           | Used                                                 |
| ----------------------- | ----------------------- | ---------------------------------------------------- |
| Node.js                 | 20.18.0                 | Yes (all workspaces require ≥ 20.18)                 |
| npm                     | 10.8.2                  | Yes (workspaces)                                     |
| pnpm / yarn             | not installed           | No — npm workspaces used instead (see TD-03)         |
| Docker                  | 29.9.3 (daemon running) | Yes — local PostgreSQL 17                            |
| PostgreSQL client tools | not installed           | Not required (Prisma CLI used for all DB operations) |
| Python                  | not installed           | Not required                                         |
| git                     | 2.56                    | Repository initialised on `main`                     |

A `.env` file was created by the user at the repository root during Phase 01. At the time of the final verification it was **empty** on disk (0 bytes). The application therefore ran against the Docker PostgreSQL defined in `docker-compose.yml`; once `DATABASE_URL` is saved in `.env`, all scripts pick it up automatically (`scripts/with-env.mjs`, `apps/api/src/config/env.ts`).

## 4. Dependency security audit

Dependencies were chosen from currently-maintained release lines (registry checked on 13 Nov 2026):

| Package                 | Latest major available | Chosen           | Reason                                                                                       |
| ----------------------- | ---------------------- | ---------------- | -------------------------------------------------------------------------------------------- |
| next                    | 16.4.6                 | **16.4.6**       | Next 15.5 bundles a PostCSS version with a high-severity advisory; 16 is the supported line. |
| @nestjs/*               | 12.x                   | **11.x**         | 11 is the stable LTS-style line with full ecosystem support; 12 is very recent.              |
| prisma / @prisma/client | 7.x / 8 RC             | **6.19.x**       | 7 requires driver adapters + `prisma.config.ts`; 6.19 is mature and patched.                 |
| typescript              | 7.0 (native)           | **5.9.3**        | ts-jest / typescript-eslint target 5.x.                                                      |
| eslint                  | 10.x                   | **9.39**         | typescript-eslint and Next plugin target 9.                                                  |
| tailwindcss             | 4.x                    | **3.4 (v3-lts)** | Maintained LTS line; stable PostCSS integration.                                             |
| vitest                  | 5 RC / 4.1             | **4.1.12**       | Vitest 3.x has critical advisories (tinypool, mocker).                                       |

`npm audit --omit=dev` result after installation: **0 vulnerabilities**.

Remaining advisories are **development-only** and low/moderate (no high or critical):

| Advisory path                                           | Severity         | Exposure                          |
| ------------------------------------------------------- | ---------------- | --------------------------------- |
| `jest` → `jest-config` → `deepmerge`                    | low              | Test runner only; never shipped.  |
| `typescript-eslint` → `typescript-estree` → `minimatch` | moderate (ReDoS) | Lint-time only on trusted source. |

These are tracked; CI fails only on high/critical production advisories (`npm run audit:deps`).

## 5. Risks identified for the build

| Risk                                         | Mitigation in Phase 01                                                                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Approval thresholds unconfirmed (PRD §17)    | Default policies provisioned as DRAFT; publishing requires an explicit admin action with reason; submission fails loudly without an ACTIVE policy. |
| Multi-company scope uncertain (PRD §17.1 Q1) | Data model is company-scoped from day one; users can hold assignments in several companies with a workspace switcher.                              |
| No email provider chosen                     | Mail adapter interface + outbox; `log` transport for development; production logs never contain message bodies or tokens.                          |
| No object storage chosen                     | `ObjectStorage` port with private local-disk adapter; S3 adapter is a drop-in (Phase 02 roadmap).                                                  |
| SSO provider unknown                         | `identity_provider` / `identity_subject` columns and `integration_config` (kind `SSO`) are in place; OIDC flow deferred.                           |
