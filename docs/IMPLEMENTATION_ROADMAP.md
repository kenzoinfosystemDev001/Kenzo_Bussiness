# Implementation Roadmap

Derived from PRD §14 (release plan) and Appendix A (implementation order), adjusted for what Phase 01 actually delivered. Durations are indicative for one experienced full-stack developer with part-time product/finance/QA support.

| Phase                         | Scope                                                                                                                                                                           | Exit gate                                                                | Status                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------ |
| **00 Discovery & controls**   | Confirm entities, approval limits, tax policy, retention, roles, accounting boundary, sample documents                                                                          | Answers to PRD §17.1 questions recorded                                  | **Open** — see "Decisions needed" below                |
| **01 Foundation**             | Monorepo, CI, environments, auth, organisation, RBAC, SoD, audit, approval engine, numbering, documents, notifications, outbox, design system, migrations                       | Build, migrations, auth, backend RBAC, company scoping, audit, tests, CI | **Complete** — [report](PHASE_01_COMPLETION_REPORT.md) |
| **02 Vendor master**          | Vendor onboarding & lifecycle, documents (versioning, expiry, verification), encrypted bank details with maker-checker, duplicate detection, Vendor 360, performance indicators | PRD §3.2 + Master Prompt 02                                              | **Complete** — [report](PHASE_02_COMPLETION_REPORT.md) |
| **03 Requisition + sourcing** | Purchase requisitions on the approval engine, RFQ, invitations, quotation versions, deterministic comparison, award                                                             | PRD §3.3–3.4, §4.2                                                       | Next                                                   |
| **04 Procurement**            | PO from award / direct path, revisions with re-approval, GRN and service acceptance, partial receipts, traceability                                                             | PRD §3.5                                                                 | Planned                                                |
| **05 Billing + payments**     | AP invoices with 2/3-way matching and duplicate detection, OCR review, AR invoices, payments maker-checker, allocations, ageing, exports                                        | PRD §3.6–3.8                                                             | Planned                                                |
| **06 Hardening + rollout**    | Threat model, load test, restore drill, observability (OpenTelemetry/Sentry), UAT, runbooks, controlled rollout                                                                 | PRD Gates A–F                                                            | Planned                                                |

## Foundation extension points each phase must use

| Need                              | Use (do not re-implement)                                                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Who may do X to record Y          | `AuthorizationService.assertCan(auth, '<perm>', { companyId, departmentId, ownerId })`; list queries via `scopeFilter`                    |
| Maker-checker / no self-approval  | `ApprovalEngine.submit(tx, auth, { excludedUserIds: [makerId, …] })` + `SegregationOfDutiesService.assert`                                |
| Approval outcome → business state | `ApprovalHooksRegistry.register('<entity_type>', { onApproved, onRejected, onReturned, onCancelled })` (runs in the deciding transaction) |
| Human-readable numbers            | `NumberingService.next(tx, { companyId, documentType })`                                                                                  |
| Evidence & attachments            | `DocumentsService.upload(…, link)` + `registerLinkAccess('<entity_type>', resolver)`                                                      |
| Encrypted restricted fields       | `FieldEncryptionService.encrypt(value, '<entity>:<id>')`; display with `maskTail`/`maskMiddle`                                            |
| Money                             | `Dec`, `computeLineAmounts`, `allocateProportionally` from `@kenzo/shared`; `NUMERIC(18,2)` columns + `currency_code`                     |
| History                           | `AuditService.record(tx, …)` in the same transaction as the change                                                                        |
| Async side-effects                | `OutboxService.enqueue(tx, …)` + idempotent handler via `outbox.on(...)`                                                                  |
| New permissions                   | Add to `packages/shared/src/permissions.ts` (catalogued already for Phases 2–5), grant in `roles.ts`, run `npm run db:seed`               |

## Technical backlog carried from Phase 01

| Item                                                                                                | Target phase |
| --------------------------------------------------------------------------------------------------- | ------------ |
| S3 + KMS `ObjectStorage` adapter; malware-scan worker (ClamAV/GuardDuty) feeding `scan_status`      | 02           |
| OIDC SSO login (Google Workspace / Entra ID) using `identity_provider/identity_subject`; SCIM later | 03           |
| SMTP/SES mail transport + delivery log + bounce handling                                            | 02           |
| OpenAPI 3.1 document generated from zod schemas (`z.toJSONSchema`)                                  | 03           |
| Redis throttler store + BullMQ worker process (replace in-process pollers)                          | 05           |
| PostgreSQL row-level security as defence-in-depth for `company_id`                                  | 06           |
| Lint rule preventing cross-module Prisma model access                                               | 03           |
| TOTP replay protection (last-used step) and recovery codes                                          | 03           |
| Playwright E2E for critical flows                                                                   | 03 onward    |
| OpenTelemetry tracing, Sentry, structured log shipping, alerting                                    | 06           |

## Decisions needed from Kenzo (PRD §17.1)

1. Number of legal entities in year one (multi-company is supported now).
2. Whether AR (customer invoicing) is in the first release.
3. Accounting/ERP system of record.
4. Who creates vendors, edits bank details, approves POs and releases payments (maps to role assignments).
5. Actual approval thresholds and exception categories — the provisioned policies are **drafts** of the PRD example matrix and must be confirmed before publishing.
6. Budget check requirement for requisitions.
7. Vendor quotation/invoice intake channel.
8. Finance-approved tax invoice fields and formats.
9. Cloud account/region and document-retention policy.
