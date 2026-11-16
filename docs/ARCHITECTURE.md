# Architecture — Kenzo-Kore BusinessOS (Phase 01 foundation)

This document describes the system **as implemented**. Decisions and their rationale are in [TECHNICAL_DECISIONS.md](TECHNICAL_DECISIONS.md).

## 1. System context

```
Browser ──HTTPS──▶ Next.js web (apps/web) ──/api/* rewrite (server-side)──▶ NestJS API (apps/api) ──▶ PostgreSQL 17
                                                                                   │
                                                                                   ├─▶ Object storage (private; local disk adapter → S3 later)
                                                                                   ├─▶ Mail adapter (log/memory → SMTP/SES later) via outbox
                                                                                   └─▶ Future: OIDC SSO, OCR, ERP/HRMS/Expense integrations
```

- The browser only ever talks to the web origin. The web server proxies `/api/*` to `API_INTERNAL_URL`, so session cookies are first-party and the API address is never exposed.
- The API is the **only** enforcement point for authentication, authorization, validation and business rules. The web app's permission checks exist for UX only.

## 2. Repository layout

```
.
├── apps/
│   ├── api/                       NestJS 11 modular monolith
│   │   ├── prisma/                schema.prisma, migrations/<ts>_<name>/{migration.sql,down.sql}, seed.ts
│   │   ├── scripts/               validate-migrations, bootstrap-admin, seed-dev
│   │   ├── src/
│   │   │   ├── config/            env.ts — zod-validated configuration, fail-fast
│   │   │   ├── common/            context (ALS), decorators, errors, filters, guards, pipes, pagination
│   │   │   ├── infrastructure/    prisma, audit, outbox, mail, notifications, numbering, crypto, storage
│   │   │   ├── modules/           identity · access-control · organization · workflow · documents ·
│   │   │   │                      audit · notifications · numbering · integrations · health · vendors
│   │   │   ├── app.module.ts      global guards/filters/middleware
│   │   │   ├── bootstrap.ts       createApp() — shared by main.ts and integration tests
│   │   │   └── main.ts
│   │   └── test/                  unit/ (no DB) · integration/ (real PostgreSQL)
│   └── web/                       Next.js 16 App Router, Tailwind design system
├── packages/shared/               @kenzo/shared — permissions, roles, zod schemas, Dec money, fiscal, masking
├── infra/docker/                  postgres init (creates the test database)
├── scripts/                       with-env.mjs (loads root .env), dev-api.mjs
├── docs/                          this documentation set
├── .github/workflows/ci.yml       quality · database · security jobs
└── docker-compose.yml             local PostgreSQL 17
```

## 3. Module boundaries (API)

Layering inside the API:

| Layer                 | Location                                                                    | Responsibility                                                                         |
| --------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Presentation / API    | `*.controller.ts`                                                           | Routing, `@RequirePermissions`, zod validation pipes, HTTP shaping. No business rules. |
| Application / service | `*.service.ts`                                                              | Use-cases, transactions, record-level authorization, audit, notifications.             |
| Domain                | `@kenzo/shared` (`Dec`, fiscal, schemas), `approver-resolver.ts`, SoD rules | Pure rules and value objects.                                                          |
| Data access           | `PrismaService` (+ tagged raw SQL for locks/counters)                       | Persistence.                                                                           |
| Infrastructure        | `src/infrastructure/*`                                                      | Audit, outbox, mail, notifications, numbering, crypto, object storage.                 |

Module ownership and public contracts:

| Module                    | Owns tables                                                                                                                 | Public contract (what other modules may use)                                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **identity**              | `app_user`, `session`, `auth_token`                                                                                         | `SessionService` (revocation).                                                                                                              |
| **access-control**        | `permission`, `role`, `role_permission`, `user_role_assignment`                                                             | `AuthorizationService` (`can`, `assertCan`, `scopeFilter`, `assertMfa`), `SegregationOfDutiesService`, `AccessContextLoader`.               |
| **organization**          | `company`, `department`, `cost_centre`                                                                                      | `CompanyProvisioningService`.                                                                                                               |
| **workflow**              | `approval_policy`, `approval_policy_stage`, `approval_instance`, `approval_task`, `approval_event`, `approval_delegation`   | `ApprovalEngine.submit/cancel`, `ApprovalHooksRegistry.register(entityType, handler)`.                                                      |
| **documents**             | `document`, `document_link`                                                                                                 | `DocumentsService.upload/getAccessible/signedUrl`, `registerLinkAccess(entityType, resolver)`.                                              |
| **audit** (infra)         | `audit_event`                                                                                                               | `AuditService.record(tx, …)` — every module writes; only the audit controller reads.                                                        |
| **notifications** (infra) | `notification`                                                                                                              | `NotificationService.notify(tx, …)`, `queueEmail`.                                                                                          |
| **numbering** (infra)     | `numbering_series`, `generated_number`                                                                                      | `NumberingService.next(tx, …)`.                                                                                                             |
| **outbox** (infra)        | `outbox_event`                                                                                                              | `OutboxService.enqueue(tx, …)`, `on(eventType, handler)`.                                                                                   |
| **integrations**          | `integration_config`                                                                                                        | (read by future adapters)                                                                                                                   |
| **vendors** (Phase 02)    | `vendor`, `vendor_contact`, `vendor_bank_account`, `vendor_bank_change_request`, `vendor_document`, `vendor_status_history` | `VendorsService` (export). Registers approval hooks for `vendor` and `vendor_bank_change` and a document-link access resolver for `vendor`. |

Dependency rules:

- Business modules (Phase 02+) depend on **workflow**, **documents**, **access-control** and infrastructure — never the reverse. Workflow knows entities only as `(entity_type, entity_id)` and reacts through registered hooks (dependency inversion), so no circular imports exist.
- Cross-module reads/writes go through the owning module's service. Direct Prisma access to another module's tables is not allowed (enforced by review; see roadmap for a lint rule).

## 4. Request pipeline

```
RequestContextMiddleware   correlation id (accepts valid x-correlation-id), IP, UA → AsyncLocalStorage
helmet / body limits        secure headers, JSON ≤ 1 MB
ThrottlerGuard              per-IP rate limits (global + stricter on auth routes)
AuthGuard                   Origin check → session cookie → active user → CSRF token → MFA gate → effective permissions
PermissionsGuard            @RequirePermissions(...) coarse gate; denials audited; MFA for privileged permissions
ZodValidationPipe           body/query/param validation; unknown keys stripped (no mass assignment)
Controller → Service        record-level assertCan, transactions, audit, outbox
AllExceptionsFilter         { error: { code, message, fieldErrors?, details?, correlationId } } — no stack traces
```

## 5. Data architecture

- PostgreSQL 17, UUID PKs via `gen_random_uuid()`, `timestamptz` (UTC), snake_case.
- **Tenant scoping:** every tenant-owned table carries `company_id`; every query filters on the session's active company; cross-company IDs resolve to 404.
- **Integrity in the database, not only the app:**
  - FKs on every relation (`ON DELETE RESTRICT` for business data; cascade only for owned children such as stages and role-permission rows).
  - Composite FK `user_role_assignment (company_id, role_id) → role (company_id, id)` — a user can only hold roles of the same company.
  - Partial unique indexes: one ACTIVE and one DRAFT policy per `(company, entity_type)`; one PENDING approval per `(company, entity_type, entity_id)`; case-insensitive unique email.
  - Check constraints: money ≥ 0, `min_amount ≤ max_amount`, delegation window, no self-delegation, user ≠ own manager, department ≠ own parent, fiscal month 1–12, ISO currency, numbering counters ≥ 1.
  - Append-only triggers on `audit_event`, `approval_event`, `generated_number` (UPDATE/DELETE/TRUNCATE rejected).
- **Money:** `NUMERIC(18,2)` in the DB; `Dec` fixed-point arithmetic in code; never JS floats.
- **Optimistic concurrency:** `version` column on editable records; updates use `WHERE id = ? AND version = ?`; conflicts return `409 VERSION_CONFLICT`.
- **Traceability:** approval instances pin the policy version; numbers are registered with their consuming entity; audit events carry entity type/id, actor, correlation id, before/after (secret-redacted) and SHA-256 hashes.

Entity overview (Phase 01):

```
company ─┬─ department ─┬─ cost_centre
         │              └─ (head) app_user
         ├─ app_user ─┬─ session / auth_token
         │            └─ user_role_assignment ── role ── role_permission ── permission
         ├─ approval_policy ── approval_policy_stage
         │        └─ approval_instance ─┬─ approval_task
         │                              └─ approval_event (append-only)
         ├─ approval_delegation
         ├─ document ── document_link (entity_type, entity_id)
         ├─ notification
         ├─ integration_config
         ├─ numbering_series · generated_number (append-only)
         ├─ outbox_event
         └─ audit_event (append-only)
```

## 6. Security architecture

| Control              | Implementation                                                                                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication       | Opaque server sessions (TD-04), scrypt passwords (TD-06), lockout after N failures, equal-time responses for unknown accounts, no account enumeration on login/reset.                         |
| MFA                  | TOTP enrolment/verification, MFA-pending sessions, company-level enforcement for `requiresMfa` permissions (TD-07).                                                                           |
| Session management   | Absolute + idle expiry, per-session and per-user revocation, revocation on password reset/change and deactivation.                                                                            |
| CSRF                 | Origin allow-list + session-bound HMAC token (TD-05).                                                                                                                                         |
| Authorization        | Backend RBAC + scope + record checks on every route (TD-08); 404 for foreign records; anti-escalation.                                                                                        |
| Separation of duties | No self-approval, maker-checker exclusions, distinct approvers across stages, no self-role-changes; enforced at routing and at decision.                                                      |
| Validation           | zod on every body/query/param; unknown keys stripped; DB constraints as second line.                                                                                                          |
| Injection            | Prisma parameterisation; raw SQL only via tagged templates (lint rule).                                                                                                                       |
| XSS                  | API serves JSON with `default-src 'none'` CSP; web app forbids `dangerouslySetInnerHTML` (lint rule) and sets a CSP.                                                                          |
| Secure headers       | helmet (CSP, frame-ancestors none, nosniff, referrer no-referrer, CORP same-origin, HSTS in production); `x-powered-by` disabled.                                                             |
| Rate limiting        | Global per-IP limit and stricter auth limits (`@nestjs/throttler`; in-memory per instance — Redis store for multi-replica).                                                                   |
| Secrets              | Env/secret-manager only; validated at boot; `.env` git-ignored; integration config rejects secret-looking keys and stores only `secretRef`.                                                   |
| Sensitive data       | AES-256-GCM field encryption service; masking helpers; audit payload redaction by field-name tokens.                                                                                          |
| Files                | Magic-byte type detection, size limits, random object keys, private storage, signed user-bound URLs + session, `attachment` + sandbox CSP, SHA-256 integrity check on read, scan-status gate. |
| Audit                | Append-only, transactional with the change, before/after hashes, IP/UA/correlation id; security failures recorded even when the request fails.                                                |
| Errors               | Uniform envelope; internal errors logged server-side with correlation id only.                                                                                                                |

## 7. Approval engine

```
submit(tx, auth, {entityType, entityId, amount, departmentId, categoryKey, excludedUserIds})
  └─ ACTIVE policy (pinned version) → applicable stages (amount band / department / category)
       └─ per stage: candidates (ROLE | USER | DEPARTMENT_HEAD (walks up if requester is head) | REQUESTER_MANAGER)
            ∩ eligible approvers (ACTIVE + holds approval.task.act)
            − requester − excludedUserIds (maker-checker)
            → delegation applied (if policy allows and delegate is independent)
            → fail APPROVAL_NO_ELIGIBLE_APPROVER if too few (never silently skipped)
  └─ tasks created (stage 1 PENDING, later WAITING) → notifications → audit

decide(task, APPROVE|REJECT|RETURN, reason)       [instance row locked FOR UPDATE]
  └─ assignee check · SoD re-check (self, excluded, distinct stages) · reason mandatory for reject/return
  └─ APPROVE: stage complete when ANY: minApprovals reached / ALL: every task approved → next stage or APPROVED
  └─ REJECT / RETURN: instance closed, open tasks cancelled
  └─ terminal: owning module hook (same transaction) + outbox event + requester notification

reassign(delegate | admin) · cancel(requester | admin) · escalateOverdue() (SLA, idempotent)
```

Policy lifecycle: `DRAFT → ACTIVE → RETIRED`; edit only drafts; clone any version into a new draft; simulate a chain without side effects.

## 8. Web application

- Next.js 16 App Router; server-side `/api/*` rewrite; `proxy.ts` performs UX-only redirects when no session cookie exists.
- Data fetching with TanStack Query; a typed fetch client attaches the CSRF header and maps the error envelope.
- Design system in `apps/web/components` (tokens in CSS variables, light/dark themes, accessible primitives on Radix Dialog/Dropdown).
- No business data in browser storage; only the theme preference is persisted locally.

## 9. Operations

| Concern         | Phase 01 state                                                                                                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configuration   | `apps/api/src/config/env.ts` (fail-fast); `.env.example` documents every variable.                                                                                         |
| Health          | `GET /api/v1/health` (liveness), `GET /api/v1/health/ready` (DB + migrations).                                                                                             |
| Logging         | Nest logger; structured JSON for errors (`correlationId`); mail bodies never logged in production.                                                                         |
| Background work | In-process outbox dispatcher and SLA escalation poller (intervals configurable; 0 disables).                                                                               |
| CI              | `.github/workflows/ci.yml`: format, lint, typecheck, unit tests, build; migration validation + integration tests on PostgreSQL 17; production dependency audit + gitleaks. |
| Local           | `docker compose up -d postgres`; `npm run db:migrate`; `npm run db:seed`; `npm run db:seed:dev -w @kenzo/api` (demo data, local only).                                     |
