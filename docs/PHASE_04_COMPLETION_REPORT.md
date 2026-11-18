# Phase 04 Completion Report — Quotation Evaluation, Comparison & Award

**Product:** Kenzo-Kore BusinessOS · **Phase:** 04 Quotation evaluation, comparison and award · **Status:** API complete and verified; web UI not delivered (see §8)
**Verified on:** 18 November 2026

Phase 04 builds the comparison engine, weighted evaluation and award workflow on top of the Phase 03 sourcing module (requisitions, RFQs, versioned quotations) and the Phase 01 foundation (approval engine, audit, documents, numbering, notifications). No model, workflow or numbering scheme was duplicated: awards are authorised by the **shared approval engine** under the existing `rfq_award` entity type, numbered from the existing series, and evidenced in the existing audit trail.

---

## 1. What was delivered

| Requirement (Master Prompt 04)                | Implementation                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1 Deterministic comparison engine            | `EvaluationService.comparable()` reduces every quotation on an RFQ to one shape in a single basis currency, reporting per-vendor, per-version, item-wise price, quantity, discount, tax, freight, other charges, landed cost, lead time, warranty, payment terms and validity. Comparability blockers are named, never normalised away (see §3).                                |
| §2 Total landed cost                          | Line = qty × unit price; net = line − discount; total = net + tax + freight + other charges, computed by the shared `computeDocumentTotals` with line-level rounding (HALF_UP, 2 dp) so the document total is the exact sum of the displayed lines. Every component is returned and printed separately, so the arithmetic is checkable on screen and in the report.             |
| §2 Inclusive vs exclusive tax                 | `TaxTreatment` is stored on the quotation version **and on each line**, and drives the arithmetic: an exclusive line adds tax to the discounted value, an inclusive line extracts it out. A field where vendors mixed the two is flagged `MIXED_TAX_TREATMENT` and excluded from the lowest-price markers. Database CHECK constraints enforce the right identity per treatment. |
| §1 Currency normalisation                     | `ExchangeRate` records an approved rate with its **source and rate timestamp**, append-only. `normalizeAmount` converts only when such a rate covers the pair; with no rate the comparable total is `null` and the quotation carries `MIXED_CURRENCY_NO_RATE`. Nothing ever falls back to 1:1, and the rate used is stored on the scored row.                                   |
| §3 Comparison workspace                       | `GET /rfqs/:id/comparison` returns the full workspace payload: vendor columns, item-wise rows, lowest-comparable-price indicators (total and per line), missing-information warnings, delivery/warranty/payment/validity comparison, caveats and deterministic observations. **The web UI for it was not built — see §8.**                                                      |
| §3 Downloadable comparison reports            | `GET /rfqs/:id/comparison/report?format=pdf\|csv`.                                                                                                                                                                                                                                                                                                                              |
| §4 Weighted evaluation                        | `EvaluationCriteriaSet` + `EvaluationCriterion`: named, versioned, published sets. Weights are validated to total **exactly 100 %** on publish (99.99 % is refused). Criteria are automatic (price, delivery, payment terms — read from the quotation) or reviewer-scored 0–100.                                                                                                |
| §4 Stored inputs, formula version and results | Every scored row stores the raw value it used, the best value it was compared against, its weight, its normalised and weighted score, and the `formulaVersion` (`weighted-sum-v1`). `scoreBreakdown` holds the whole run as JSON. Re-running with the same inputs reproduces the same numbers exactly.                                                                          |
| §4 No silent score changes                    | Automatic criteria are **not writable**: posting a manual score for one is rejected (422). Manual scores accept 0–100 only, and each records its reviewer and timestamp.                                                                                                                                                                                                        |
| §5 Evaluation records and declarations        | Evaluation notes (append-only), per-quotation reviews reusing Phase 03 `quotation_review`, clarification requests and vendor responses from Phase 03, recommendation rationale on the award, supporting documents via the existing documents module.                                                                                                                            |
| §5 Conflict-of-interest declarations          | `ConflictOfInterestDeclaration`, append-only, one per reviewer per round. A reviewer who has not declared cannot score or recommend (`CONFLICT_DECLARATION_REQUIRED`, 403); one who declares a conflict is barred outright (`SEGREGATION_OF_DUTIES`, 403). A declared conflict must carry details.                                                                              |
| §6 Award workflow                             | Evaluation → Recommendation → Approval → Awarded / Rejected / Cancelled, with `AWARD_TRANSITIONS` as the single state machine and an append-only `rfq_award_event` trail carrying actor, timestamp and reason.                                                                                                                                                                  |
| §6 Approval via the shared engine             | `ApprovalEngine.submit(entityType: 'rfq_award')`. Thresholds, multi-level stages, rejection reasons, return-for-clarification, delegation and escalation all come from the engine unchanged. A default two-stage policy ships: procurement, plus finance above ₹500,000.                                                                                                        |
| §6 Separation of duties                       | The recommender, whoever recorded each winning quotation and whoever created each winning vendor are all passed to the engine as `excludedUserIds`, so none of them can decide the award — including through delegation or reassignment, which the engine checks against the same list.                                                                                         |
| §7 Award rules                                | The selected quotation must belong to the RFQ, be a submitted version, be the **same version that was evaluated**, not be excluded, not carry a hard comparability blocker, and be unexpired unless an exception is recorded on the award.                                                                                                                                      |
| §7 Partial awards                             | Permitted only when the RFQ was raised with `allowPartialAward`. Both forms are checked: fewer lines than requested, and lines split across vendors. Each awarded line carries its own vendor, quotation version and commercial terms.                                                                                                                                          |
| §7 Commercial snapshot                        | Written once when the award is issued and never recomputed. A database trigger makes an `AWARDED` award and its lines immutable, so a later quotation revision cannot rewrite what was awarded.                                                                                                                                                                                 |
| §8 AI assistance                              | **Not implemented — there is no AI integration in this architecture.** See §5 below.                                                                                                                                                                                                                                                                                            |
| §9 Reports                                    | Comparison (PDF + CSV), evaluation (PDF + CSV), award recommendation (PDF), approval report (PDF), final award document (PDF, only once issued) and an award line export (CSV).                                                                                                                                                                                                 |
| §10 Testing                                   | 27 unit tests on the engine and 33 integration tests through the HTTP API. See §6.                                                                                                                                                                                                                                                                                              |

---

## 2. Database migration

`20261118000000_quotation_evaluation_award` — 11 new tables, validated by the repository gate (`npm run db:validate-migrations`: applies, drift-free against `schema.prisma`, reverses cleanly via `down.sql`, re-applies).

| Table                              | Purpose                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| `exchange_rate`                    | Approved rates with source and timestamp. Append-only by trigger.               |
| `evaluation_criteria_set`          | Named, versioned criteria sets. One ACTIVE per name, one default per company.   |
| `evaluation_criterion`             | Key, label, weight, source, direction.                                          |
| `rfq_evaluation`                   | One round per RFQ; freezes criteria set, formula version and basis currency.    |
| `quotation_evaluation`             | Per quotation: evaluated version, comparable total, rate used, score, blockers. |
| `evaluation_score`                 | Per criterion: raw value, normalised and weighted score, reviewer.              |
| `conflict_of_interest_declaration` | One per reviewer per round. Append-only.                                        |
| `evaluation_note`                  | Round-level reviewer commentary. Append-only.                                   |
| `rfq_award`                        | Recommendation and award, with rationale, approval link and frozen snapshot.    |
| `rfq_award_line`                   | One awarded RFQ line with its vendor, quotation version and commercial terms.   |
| `rfq_award_event`                  | Append-only status trail. Append-only by trigger.                               |

Changes to existing tables:

- `quotation_version.tax_treatment` and `quotation_version_line.tax_treatment` (default `EXCLUSIVE`, so every existing row keeps its meaning).
- `rfq.allow_partial_award` (default `false`).
- `quotation_version_grand_total_chk` and `quotation_line_total_chk` rewritten to branch on the tax treatment. The Phase 03 versions asserted the tax-exclusive identity unconditionally and would have rejected every inclusive quotation.

Integrity enforced in the database, not only in the service: weights within 0–100, scores within 0–100, a missing figure carries no score and a present one is always scored, an excluded quotation must carry a reason, a declared conflict must carry details, an `AWARDED` award must have its approval, its timestamps and its snapshot, and at most one live award per RFQ.

---

## 3. Comparability: what the engine refuses to do

The engine never presents two quotations as equivalent when they are not. Each is tagged with the reasons it cannot be compared on its face:

| Blocker                  | Meaning                                            | Effect                                                      |
| ------------------------ | -------------------------------------------------- | ----------------------------------------------------------- |
| `MIXED_CURRENCY_NO_RATE` | Quoted in another currency with no approved rate   | **Hard.** No comparable total, no score, cannot be awarded. |
| `MIXED_TAX_TREATMENT`    | Quoted tax-inclusive while others quoted tax-extra | **Hard.** Same.                                             |
| `NO_SUBMITTED_VERSION`   | Nothing submitted yet                              | **Hard.** Same.                                             |
| `INCOMPLETE_RESPONSE`    | Did not price every requested item                 | Soft: scored and shown, flagged, total covers less scope.   |
| `EXPIRED`                | Validity has lapsed                                | Soft: scored and shown; award needs a recorded exception.   |

Lowest-price indicators are computed only across quotations with no hard blocker, so a cheaper unconverted figure can never win the marker.

---

## 4. API

All under `/api/v1`. Action routes answer 200, creations 201, matching the rest of the codebase.

| Method & path                                                                | Permission             | Purpose                                                  |
| ---------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------- |
| `GET /evaluation/criteria-sets`                                              | `quotation.read`       | List sets with their criteria and weights                |
| `POST /evaluation/criteria-sets`                                             | `evaluation.configure` | Create a draft set (weights validated)                   |
| `GET /evaluation/criteria-sets/:id`                                          | `quotation.read`       | One set                                                  |
| `POST /evaluation/criteria-sets/:id/publish`                                 | `evaluation.configure` | Publish; retires the previous active version             |
| `GET /evaluation/exchange-rates`                                             | `quotation.read`       | Approved rates                                           |
| `POST /evaluation/exchange-rates`                                            | `exchange_rate.manage` | Record an approved rate with source and timestamp        |
| `GET /rfqs/:id/comparison`                                                   | `quotation.read`       | The comparison workspace payload                         |
| `GET /rfqs/:id/comparison/report?format=pdf\|csv`                            | `quotation.read`       | Comparison report                                        |
| `POST /rfqs/:id/evaluation`                                                  | `quotation.manage`     | Open the round; seeds rows and automatic scores          |
| `GET /rfqs/:id/evaluation`                                                   | `quotation.read`       | Criteria, scores with their working, declarations, notes |
| `POST /rfqs/:id/evaluation/declarations`                                     | `quotation.read`       | Declare conflict of interest                             |
| `POST /rfqs/:id/evaluation/notes`                                            | `quotation.manage`     | Add a reviewer note                                      |
| `POST /rfqs/:id/evaluation/quotations/:qid/scores`                           | `quotation.manage`     | Enter manual scores; re-runs the engine                  |
| `POST /rfqs/:id/evaluation/quotations/:qid/exclude`                          | `quotation.manage`     | Exclude with a recorded reason                           |
| `POST /rfqs/:id/evaluation/recompute`                                        | `quotation.manage`     | Re-run after a revision or a new rate                    |
| `POST /rfqs/:id/evaluation/complete`                                         | `quotation.manage`     | Close the round                                          |
| `GET /rfqs/:id/evaluation/report?format=pdf\|csv`                            | `quotation.read`       | Evaluation report                                        |
| `POST /rfqs/:id/evaluation/award`                                            | `quotation.award`      | Recommend an award; submits it for approval              |
| `GET /rfqs/:id/evaluation/award`                                             | `quotation.read`       | Awards raised from this RFQ                              |
| `GET /awards`, `GET /awards/:id`                                             | `quotation.read`       | List and detail                                          |
| `POST /awards/:id/issue`                                                     | `quotation.award`      | Issue an approved award; freezes the snapshot            |
| `POST /awards/:id/resubmit`                                                  | `quotation.award`      | Resubmit a returned recommendation                       |
| `POST /awards/:id/cancel`                                                    | `quotation.award`      | Cancel one that has not been issued                      |
| `GET /awards/:id/recommendation`, `/approval-report`, `/document`, `/export` | `quotation.read`       | The four award documents                                 |

New permissions: `evaluation.configure` and `exchange_rate.manage`, both sensitive, both granted to Procurement Manager only. A Procurement Executive can score but cannot reweight the criteria or set an exchange rate.

---

## 5. AI assistance (§8) — deliberately not implemented

§8 conditions AI-assisted summaries on the architecture already having a secure AI integration mechanism. **It does not.** `INTEGRATION_KINDS` covers SSO, email, storage, OCR, ERP, HRMS, expense and bank; there is no model provider, no key handling for one, and no egress policy for commercial data. Adding one as a side effect of this phase would have meant inventing a security boundary nobody has reviewed and sending vendor pricing to a third party by default.

What the workspace returns instead is a set of **deterministic observations**, computed from the records on the page: the price spread between the cheapest and dearest comparable quotations, which responses priced fewer items than were requested, which cannot be compared on face value, and which have lapsed. Each observation carries the quotation ids it is about, so every statement can be checked against the table above it. This covers the parts of §8 that are factual — summarising commercial differences, highlighting missing fields, flagging risks — without a model.

The remaining parts (narrative drafting, historical performance summaries) are left for a phase that introduces a reviewed AI integration. The prohibitions in §8 are already structural rather than advisory: the award is decided by the approval engine, prices come only from stored quotation rows, and automatic criteria are not writable through any endpoint.

---

## 6. Tests executed and results (actual)

| Suite                                         | Result                                        |
| --------------------------------------------- | --------------------------------------------- |
| `packages/shared` unit (`evaluation.test.ts`) | 27 new tests, all passing (59 in the package) |
| `apps/api` unit                               | 21 passing                                    |
| `apps/web` unit                               | 38 passing                                    |
| `apps/api` integration (`evaluation.spec.ts`) | 33 new tests, all passing                     |
| `npm run db:validate-migrations`              | up, drift-free, reversible, repeatable        |
| `npm run lint`, `npm run format:check`        | clean                                         |
| `tsc --noEmit` (api and web)                  | clean                                         |

Coverage against §10, each by a named test:

- **Tax calculations** — exclusive adds, inclusive extracts, `taxable + tax = total` holds under both at 0/5/12/18/28 %, and a zero-rated inclusive line equals an exclusive one.
- **Discount calculations** — applied before tax under both treatments; line-rounded totals sum exactly.
- **Currency normalisation** — unchanged when currencies match, converted at the approved rate with the rate named, `null` (never 1:1) when no rate exists, rounded half-up.
- **Incomplete quotations** — reported as missing items, not as zero; the total is flagged as covering less scope.
- **Expired quotations** — refused for award without an exception, allowed with one recorded.
- **Scoring weights** — exactly 100 % required, 99.99 % refused, duplicates and negatives refused, fractional weights accepted.
- **Invalid evaluation changes** — manual score on an automatic criterion refused; score outside 0–100 refused; scoring a closed round refused; scoring without a declaration refused; scoring with a declared conflict refused.
- **Approval authorization** — `quotation.award` required to recommend; the recommender cannot approve; another company sees 404 for both the award and the comparison.
- **Partial awards** — refused on an RFQ that does not permit one, in both forms; permitted and split across two vendors when it does.
- **Concurrent award attempts** — two simultaneous recommendations produce exactly one award (201 + 409).
- **Historical version preservation** — a revision after scoring blocks the award until the round is re-run, and the evaluated version number stays on record; an issued award is immutable at the database level.

---

## 7. Defects found and fixed in existing code

Phase 03 shipped without any integration test that created an RFQ, which hid two faults. Both were exercised for the first time by this phase's tests:

1. **`RfqService.create` could never create an RFQ.** The nested line data passed `companyId`, which Prisma derives from the parent relation and therefore rejects; the type annotation did not catch it because the array comes from `.map()` rather than a literal. Every RFQ creation returned 500.
2. **`NotificationService.queueEmail` discarded the outbox event id** that `OutboxService.enqueue` returns and that the RFQ invitation flow records as its delivery reference. (Fixed in the previous commit, with the sourcing module wiring.)

Also fixed:

3. **A 1-in-16 flaky assertion** in `infrastructure.spec.ts`: the signed-URL tamper replaced the first signature character with `0`, which is a no-op when that character is already `0`.

---

## 8. Known limitations

- **No web UI.** `apps/web` has no sourcing pages at all — Phase 03 delivered the API only — so the comparison workspace of §3 exists as a complete API payload (vendor columns, item rows, lowest-price indicators, warnings, observations) but nothing renders it. A buyer today reaches it through the API or the PDF/CSV reports. Building it means building the RFQ and quotation screens underneath it, which is a phase of work in itself.
- **Spreadsheet exports are CSV**, UTF-8 with a BOM so Excel opens them directly. The repository has no spreadsheet dependency and the data is flat; a real `.xlsx` writer would be a new dependency for no gain here.
- **One evaluation round per RFQ.** Re-evaluating after a re-tender means a new RFQ. The schema enforces this.
- **Exchange rates are entered by hand** by a user holding `exchange_rate.manage`. There is no rate feed; the source and timestamp are recorded so the provenance of each conversion is auditable.
- **Vendor-performance criteria are reviewer-scored.** The automatic sources are price, delivery and payment terms. Past performance has no measured input until the receipt and invoice phases supply one.
- **Award cancellation after issue is not modelled.** An issued award is immutable; reversing one needs a cancellation document, which belongs with purchase orders.

---

## 9. Handoff — starting Phase 05

An issued `rfq_award` with its frozen snapshot is the input a purchase order is raised from: `rfq_award_line` already carries, per line, the vendor, the quotation version, quantity, unit price, discount, tax rate, tax treatment and currency, and `GET /awards/:id/export` emits exactly that as CSV. `purchase_order` is already in `APPROVAL_ENTITY_TYPES` and `NUMBERED_DOCUMENT_TYPES` with prefix `PO`, so Phase 05 can raise and number one without touching either list.
