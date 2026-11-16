# Technical Decisions (ADR log)

Each decision records context, the choice, and consequences. Status values: **Accepted**, **Superseded**, **Proposed**.

---

### TD-01 — Modular monolith (NestJS) + Next.js web — Accepted

**Context.** PRD §6.1 recommends a modular monolith with asynchronous workers; a small team; strong consistency needed for approvals, numbering and payments.
**Decision.** One NestJS API process organised by domain module, one Next.js web app, one PostgreSQL database. Modules expose services/events; no cross-module repository access.
**Consequences.** Simple deployment and transactions; module boundaries are enforced by convention + review (see ARCHITECTURE §3). A worker process can be split out later without changing module contracts.

### TD-02 — PostgreSQL 17 + Prisma 6.19 — Accepted

**Context.** PRD §6.2 suggests Prisma or Drizzle. Prisma 7 (released) requires driver adapters and a new config file; Prisma 6.19 is mature.
**Decision.** Prisma 6.19 for schema, client and migrations. Raw SQL (tagged templates only) for locking (`FOR UPDATE`, `SKIP LOCKED`), atomic counters and DB-level guarantees (triggers, partial unique indexes, check constraints) that Prisma's schema language cannot express — appended to the migration SQL.
**Consequences.** Upgrade path to Prisma 7 is a contained change in `PrismaService`. ESLint forbids `$queryRawUnsafe/$executeRawUnsafe` in application code.

### TD-03 — npm workspaces instead of pnpm — Accepted

**Context.** PRD §12 shows `pnpm-workspace.yaml`; pnpm is not installed on the build machine.
**Decision.** npm workspaces (`apps/*`, `packages/*`) with a committed `package-lock.json`.
**Consequences.** Equivalent monorepo behaviour; switching to pnpm later only needs a workspace file and lockfile regeneration.

### TD-04 — Server-side opaque sessions, not JWTs — Accepted

**Context.** Requirements include immediate session revocation, deactivation, MFA step-up and per-company context.
**Decision.** Random 256-bit token in an `HttpOnly; SameSite=Lax; Secure (prod)` cookie; only its SHA-256 hash is stored in `session`. Absolute TTL (12 h) + idle timeout (60 min). Session carries the active company and MFA state.
**Consequences.** Revocation is instant (one row update). One indexed lookup per request (touch at most once per minute).

### TD-05 — CSRF: origin check + session-bound double-submit token — Accepted

**Decision.** All state-changing requests with an `Origin` header must come from `APP_ORIGIN` (also blocks login CSRF). Authenticated mutations must send `x-csrf-token` = HMAC(SESSION_SECRET, session id), delivered via a readable `kk_csrf` cookie and `/auth/me`.
**Consequences.** Works with the same-origin proxy and non-browser API clients (which send no Origin and must still hold a valid session + token).

### TD-06 — Password hashing with Node scrypt — Accepted

**Context.** PRD warns against building crypto from scratch; native argon2 bindings add build complexity on Windows/CI.
**Decision.** Node's built-in `crypto.scrypt` (N=2^15, r=8, p=1, 64-byte key, 16-byte salt), encoded with parameters; transparent re-hash on login when parameters change.
**Consequences.** No native dependency; memory-hard KDF meeting OWASP guidance.

### TD-07 — MFA via RFC 6238 TOTP, secrets encrypted with AES-256-GCM — Accepted

**Decision.** TOTP implemented with Node crypto (validated against RFC 4226 vectors). Secrets encrypted with `DATA_ENCRYPTION_KEY` (versioned `v1.` ciphertext format, AAD bound to the user). Sessions of MFA-enrolled users start `mfa_pending` and can only reach `@AllowMfaPending` routes. Companies can enforce MFA for permissions flagged `requiresMfa`.
**Consequences.** MFA-ready privileged authentication without an external provider; WebAuthn/IdP-MFA can be added behind the same session flag.

### TD-08 — Authorization model: RBAC + scoped grants + record checks — Accepted

**Decision.** Permission catalogue in code (`@kenzo/shared`), synced to DB. Role grants carry scope `OWN | DEPARTMENT | COMPANY`. `PermissionsGuard` is the coarse route gate; services call `AuthorizationService.assertCan(auth, permission, resource)`. Cross-company resources return **404** to avoid existence disclosure. Anti-escalation: users cannot change their own assignments and can only grant roles/permissions they themselves hold at ≥ scope.
**Consequences.** Least privilege by default; uniform authorization point for all future modules.

### TD-09 — System roles defined in code, re-synced by seed — Accepted

**Decision.** The 11 required roles are code templates (`SYSTEM_ROLES`). They are provisioned per company, immutable through the API, and re-synced by `npm run db:seed`. Companies add custom roles for variations.
**Consequences.** Role definitions are reviewed like code; no drift between environments. Administrators hold no financial release authority (PRD §2).

### TD-10 — Approval engine with in-transaction outcome hooks — Accepted

**Decision.** Versioned policies (one ACTIVE per entity type, enforced by partial unique index). Resolution yields concrete tasks at submission; stages may be sequential (different sequences) or parallel (same stage, `ANY` N-of-M or `ALL`). Owning modules register `ApprovalOutcomeHandler`s that run inside the deciding transaction; the engine also emits outbox events. Instance rows are locked (`SELECT … FOR UPDATE`) for every decision.
**Consequences.** Business modules never re-implement approval rules; no cyclic imports (workflow never imports business modules).

### TD-11 — Transactional outbox with in-process poller — Accepted (interim)

**Context.** PRD §6.2 recommends Redis + BullMQ; Phase 01 has no queue infrastructure yet.
**Decision.** `outbox_event` written in the business transaction; an in-process poller claims batches with `FOR UPDATE SKIP LOCKED`, retries with exponential backoff, dead-letters after 8 attempts.
**Consequences.** Correct at-least-once delivery today, safe across multiple API replicas. Moving to BullMQ later changes only the dispatcher.

### TD-12 — Numbering via template + period rows and atomic UPDATE … RETURNING — Accepted

**Decision.** Per-company, per-document-type template row; period rows per fiscal year (or `ALL`). Allocation in the caller's transaction; `generated_number` registry enforces `(company, number, document_type)` uniqueness.
**Consequences.** No duplicates under concurrency (tested with 20 parallel allocations); numbers roll back with failed transactions.

### TD-13 — Private object storage port; local disk adapter for development — Accepted

**Decision.** `ObjectStorage` interface; `LocalDiskStorage` writes outside any web root with random keys and 0600 permissions. Content type is detected from magic bytes; downloads use 5-minute HMAC URLs bound to the requesting user **and** still require the session; responses are `attachment`, `nosniff`, sandboxed.
**Consequences.** S3 + KMS adapter (Phase 02) needs no API changes.

### TD-14 — Shared contracts package (`@kenzo/shared`) compiled to CommonJS — Accepted

**Decision.** Permission catalogue, role templates, zod schemas, fixed-point `Dec` money arithmetic, fiscal/numbering helpers and masking live in one package consumed by API (authoritative validation) and web (UX validation).
**Consequences.** One source of truth for validation and permissions; built automatically on `npm install`.

### TD-15 — Exact decimal arithmetic (`Dec`) — Accepted

**Decision.** BigInt-backed fixed-point decimal with explicit rounding modes (HALF_UP, HALF_EVEN, DOWN); fractional JS numbers are rejected at the boundary. Line-level rounding and largest-remainder allocation helpers.
**Consequences.** No float error in any financial computation (PRD §8.2, §10.1).

### TD-16 — Versions: Next 16, NestJS 11, Prisma 6.19, TS 5.9, ESLint 9, Tailwind 3.4 LTS, Vitest 4 — Accepted

See [REPOSITORY_AUDIT.md §4](REPOSITORY_AUDIT.md#4-dependency-security-audit). Production dependency audit is clean.

### TD-17 — Web app talks to the API through a same-origin proxy — Accepted

**Decision.** Next.js rewrites `/api/*` to `API_INTERNAL_URL` server-side. Cookies stay first-party; no CORS in the browser path; no API URL or secrets in client bundles (no `NEXT_PUBLIC_*` secrets).

### TD-18 — Reversible migrations with a validation gate — Accepted

**Decision.** Every migration directory contains Prisma's `migration.sql` plus a hand-written `down.sql`. `npm run db:validate-migrations` applies up → checks drift against `schema.prisma` → applies all downs → asserts no tables remain → re-applies up, on a throwaway database. Runs in CI.
**Consequences.** Down migrations are tested, not aspirational. Production rollback policy remains "forward-fix" for data-bearing changes (PRD §16.2).

### TD-19 — Pooled runtime URL + direct migration URL (Neon) — Accepted

**Context.** The Kenzo database is Neon PostgreSQL (PG 18) behind a PgBouncer pooler. Prisma Migrate needs a session-level connection.
**Decision.** `DATABASE_URL` = pooled endpoint (application); `DIRECT_DATABASE_URL` = direct endpoint (migrations, `directUrl` in `schema.prisma`). Every script that overrides `DATABASE_URL` (test setup, migration validator) overrides **both**, so a test run can never migrate or touch the real database.
**Consequences.** Integration tests and the migration gate run on local PostgreSQL only; the test runner additionally refuses databases whose name lacks "test" and never uses `migrate reset`.

### TD-20 — Anti-escalation applies to administrative permissions — Accepted (refines TD-08)

**Context.** The first implementation required the granter to hold _every_ permission of a role, which made it impossible for a Company Admin (who intentionally holds no business permissions) to assign Requester or Auditor.
**Decision.** Escalation checks apply to _administrative_ permissions (`platform.*`, `user.*`, `role.*`, `audit.*`, `org.company.manage`, `approval.policy.manage`, `approval.delegation.admin`, `numbering.manage`, `integration.manage`). Business roles are assignable by `role.assign` holders; each grant is audited and record-level maker-checker still binds the grantee.

### TD-21 — Vendor restricted identifiers — Accepted

**Decision.** PAN and bank account numbers are AES-256-GCM encrypted with purpose-bound AAD, stored with an HMAC fingerprint (HKDF-derived key) for duplicate detection and the last four characters for masked display. Reveal requires `vendor.bank.read` (+MFA when enforced), a stated reason, and is audited without the value. Bank accounts are never edited in place: changes create a PROPOSED row approved through maker-checker (`vendor_bank_change` policy; proposer and vendor creator excluded).
**Note.** A GSTIN is a public registration number that legally embeds the PAN (characters 3–12); for GST-registered vendors the PAN is therefore inherently visible through the GSTIN. PAN encryption protects unregistered vendors and avoids storing PAN as a separate searchable clear value.

### TD-22 — Vendor lifecycle driven by the approval engine — Accepted

**Decision.** `DRAFT → SUBMITTED` starts the `vendor` approval (creator excluded). Engine hooks move the vendor to `APPROVED` (verifying the proposed bank account), `REJECTED`, or back to `DRAFT` (returned / withdrawn) inside the deciding transaction. `ACTIVE` requires all required documents verified and unexpired, and an activator other than the creator. Legal/tax identity fields are locked after approval. Every transition writes `vendor_status_history` (append-only) and an audit event.

### TD-23 — Web CSP allows inline scripts — Accepted (interim)

**Context.** Next.js hydration requires inline scripts; a nonce-based CSP forces fully dynamic rendering.
**Decision.** `script-src 'self' 'unsafe-inline'` with all other CSP directives restrictive; React escaping plus the lint ban on `dangerouslySetInnerHTML` mitigate XSS. Revisit with nonces in Phase 06 hardening.
