# Verification Report: Normalize Findings Review Actions (Spec F)

**Spec:** `2026-06-02-normalize-findings-review-actions`
**Date:** 2026-06-02
**Verifier:** implementation-verifier
**Status:** ✅ Passed

---

## Executive Summary

Spec F (normalize discovery FINDINGS to the candidate disposition model) is fully and correctly implemented end-to-end across all four stacks. The findings `status` column is renamed to `review_status` (with a new `previous_review_status` audit trail) via a clean additive Liquibase changeset; the vocabulary is the candidate-parity set `pending_review | approved | rejected | deferred`; transitions are unrestricted (any→any) with the transition graph removed; the human review surface is exactly Approve / Reject / Defer; and scope is contained (gateway route logic and mcp-server untouched, `135-discovery-findings.sql` byte-unchanged). All findings-domain test suites pass on every stack (AMS 57, frontend 38, gateway 18, discovery-service 16). The only test/typecheck noise observed is pre-existing and unrelated to this spec.

**Verdict: PASS.**

---

## 1. Tasks Verification

**Status:** ✅ All Complete

All six task groups in `tasks.md` are marked `- [x]` (groups 1.0–6.0 and every sub-task). Each was spot-checked against the implemented code and found genuinely complete; no checkbox required correction.

### Completed Tasks
- [x] Task Group 1: Liquibase Changeset — Rename Column + Migrate Values
  - [x] 1.1 Author `170-discovery-findings-review-status.sql` (rename, default, audit col, single index)
  - [x] 1.2 Value-migration DML for all five legacy values
  - [x] 1.3 Register changeset in `db.changelog-master.yaml` (precondition guards `status` column)
  - [x] 1.4 Migration applies cleanly (verified by `DiscoveryFindingsReviewStatusChangesetTest`)
- [x] Task Group 2: AMS Service, Entity, DTOs, Controller
  - [x] 2.1–2.10 Constants, persist default, transition-graph removal, audit capture, entity, DTO, mapper, single-row request DTOs, bulk DTO reconciliation, bulk loop, controller Javadoc, scoped test run
- [x] Task Group 3: Findings API Types + Tab/Drawer/Modal Surface
  - [x] 3.1–3.8 Tests, `findingsApi.ts` types, drawer 3-button surface, toolbar/labels/badges, summary pills + filter, modal labels, CSS, scoped test run
- [x] Task Group 4: FindingEmitter Emit Alignment
  - [x] 4.1–4.4 Run-gate, `FindingEmitter.ts` vocabulary + omit-on-emit, `archModelClient.ts` payload, tests
- [x] Task Group 5: Gateway Findings Proxy Test Fixtures
  - [x] 5.1–5.3 Bulk-review proxy fixtures, other findings proxy fixtures, scoped test run (NO route-logic change)
- [x] Task Group 6: Cross-Stack Verification + Fixture/Snapshot Drift
  - [x] 6.1–6.5 Residual-string sweep, four-stack test runs, scope-containment confirmation

### Incomplete or Issues
None. All tasks verified complete against the implemented code.

---

## 2. Documentation Verification

**Status:** ⚠️ Minor (non-blocking)

### Implementation Documentation
- The `implementation/` directory exists but is **empty** — no per-task-group implementation reports were written.
- This is **not a defect for this spec**: its `tasks.md` did not mandate separate implementation report files, and Task Group 6 captures the per-group verification evidence inline in `tasks.md` (sweep result, per-stack test counts, scope-containment confirmation). The spec's intent is fully traceable.

### Verification Documentation
- This report: `agent-os/specs/2026-06-02-normalize-findings-review-actions/verifications/final-verification.md`.

### In-code documentation (strong)
- The new changeset, entity, DTOs, service, frontend API client, and emitter all carry explicit "Spec F (2026-06-02)" Javadoc/JSDoc explaining the rename, the unrestricted-transition decision, and the `previous_review_status` audit trail. The intentional `review_status` field vs `status` query-param asymmetry is documented in `findingsApi.ts` and `DiscoveryFindingController`.

### Missing Documentation
- Per-task implementation reports under `implementation/` (optional for this spec; noted for completeness only).

---

## 3. Roadmap Updates

**Status:** ⚠️ No Updates Needed

### Updated Roadmap Items
None.

### Notes
`agent-os/product/roadmap.md` is the original v0.1–v0.5 meta-model / diagram-editor product roadmap (Phases 1–5: JSON load/save, diagram rendering/editing, backend/persistence/deployment). It contains **no** item relating to discovery findings, review-disposition vocabulary, or the unified-review program. Spec F belongs to the separate discovery-richness / unified-review initiative (tracked in project memory, not this product roadmap), so there is no roadmap item to mark complete. No change made.

---

## 4. Test Suite Results

**Status:** ✅ All Passing (findings domain)

Per the verification scope, tests were run narrowed to the findings domain on each stack (not whole-module suites; no services started). Every selected suite is green.

### Test Summary (findings domain, this run)
- **Total Tests:** 129 (AMS 57 + frontend 38 + gateway 18 + discovery-service 16)
- **Passing:** 129
- **Failing:** 0
- **Errors:** 0

#### AMS — `mvn -q -Dtest='DiscoveryFinding*,DiscoveryFindingsReviewStatusChangesetTest,MigrationDiscoveryContextServiceTest,MigrationSpecContextResolverTest' test`
Build exit code 0. Surefire reports stamped this run (2026-06-02 13:52), **9 classes, 57 tests, 0 failures, 0 errors**:

| Class | Tests | Result |
|---|---:|---|
| DiscoveryFindingControllerTest | 7 | PASS |
| DiscoveryFindingsReviewStatusChangesetTest | 1 | PASS |
| DiscoveryFindingApiBehaviourDiffOriginPersistenceTest | 3 | PASS |
| DiscoveryFindingPersistenceTest | 7 | PASS |
| DiscoveryFindingBulkReviewTest | 8 | PASS |
| DiscoveryFindingOriginAndLinkTargetTest | 7 | PASS |
| DiscoveryFindingStatusTransitionTest | 3 | PASS |
| MigrationDiscoveryContextServiceTest | 12 | PASS |
| MigrationSpecContextResolverTest | 9 | PASS |

- The `DiscoveryFindingStatusTransitionTest` (3 tests) asserts candidate-parity statuses, the `{approved, rejected, deferred}` reviewer set, and legacy-vocabulary retirement.
- `DiscoveryFindingBulkReviewTest` (8 tests) covers the any→any transitions, `skipped_by_reason.transition_not_allowed == 0`, `already_in_target` counting same-status rows, and `delta_by_from_status` keyed by the new vocabulary.
- Hibernate SQL in the run log confirms the live schema selects `review_status` and `previous_review_status`.

#### Frontend — `npx vitest run` (findings suites)
**6 files, 38 tests, all passing:**
- `findingsApi.test.ts` (5), `FindingsTab.test.tsx` (7), `FindingsTab.bulk.test.tsx` (5), `FindingsTab.crossStack.test.tsx` (3) — 20 tests
- `findingTypeLabels.test.tsx` (7), `FindingsTab.dataLayerFidelity2.test.tsx` (11) — 18 tests

#### Gateway — `npx jest discovery-findings migrationDiscoveryContext`
**6 suites, 18 tests, all passing** — incl. `discovery-findings-bulk-review-proxy.test.ts`, `discovery-findings-proxy.test.ts`, and the drift-fixed `migrationDiscoveryContext.test.ts`.

#### discovery-service — `npx jest findingEmitter archModelClientFindings`
**2 suites, 16 tests, all passing** — `archModelClientFindings.test.ts` explicitly asserts the emit OMITS `review_status` (AMS defaults `pending_review`) and maps an explicit `reviewStatus` → wire `review_status`.

### Type / Lint Health
- **discovery-service** `tsc --noEmit`: exit 0 (clean).
- **gateway** `tsc --noEmit`: exit 0 (clean).
- **frontend** `tsc --noEmit` (whole project): 454 pre-existing error lines, **none in production findings sources** (`findingsApi.ts`, `FindingsTab.tsx`, `FindingDetailDrawer.tsx`, `BulkFindingActionConfirmModal.tsx` are all clean). The only findings-domain hits are in test files and are the same repo-wide pre-existing categories: `TS2304 Cannot find name 'global'` (affects dozens of unrelated `__tests__` files; Vitest supplies `global` at runtime, so the suites pass) and `TS6133 'React' is declared but never read`. Not attributable to Spec F.
- **AMS** compiled successfully (tests ran).

### Failed Tests
None — all selected findings-domain tests passing.

### Notes — pre-existing / unrelated (NOT attributable to this spec)
- **Stale AMS Surefire reports:** two sibling reports `MigrationSpecContextResolverCrossStoryTest` and `MigrationSpecContextResolverProjectConfigTest` are stamped 13:06 (a prior full-module run) and were NOT selected by this run's `-Dtest` filter (the `MigrationSpecContextResolverTest` selector does not wildcard-match the longer class names). They are green regardless; flagged only so the count is read against this run's 9 today-stamped classes.
- **tasks.md narrative count drift (cosmetic):** Group 6.2 narrates "81 tests / 14 classes" and 6.3 narrates "47 tests" for the extra frontend suites; this run's authoritative Surefire output is 57 tests / 9 classes for AMS and 18 tests for the two extra frontend suites. The difference is selector/narrative bookkeeping only — every selected suite passes, so the discrepancy does not affect the verdict.
- **Frontend whole-project `tsc` errors** (454) are pre-existing tooling/test-typing issues across unrelated domains (Selective Copy, chat, infrastructure-terraform, etc.) and the repo-wide `global` test-typing gap — present on files this spec never touched.

---

## 5. Acceptance-Contract Conformance (per requirements.md "Resolved Decisions" + "Net end state")

**Status:** ✅ Conforms

- **Migration correctness** (`170-...sql`, verified live by `DiscoveryFindingsReviewStatusChangesetTest`):
  - `ALTER TABLE discovery_findings RENAME COLUMN status TO review_status` (kept `TEXT NOT NULL`).
  - DEFAULT changed `'new'` → `'pending_review'`; fresh insert lands on `pending_review`.
  - `previous_review_status TEXT` added (nullable, no default, unset by migration).
  - Single status index: `idx_discovery_finding_status` dropped, `idx_discovery_finding_review_status` created — exactly one remains.
  - All five legacy values migrated: `accepted→approved`, `ignored→rejected`, `needs_review→deferred`, `new→pending_review`, `resolved→approved`; no legacy value remains.
  - NO CHECK constraint added (free-text + pack-extensibility preserved).
  - `135-discovery-findings.sql` is **byte-unchanged** (zero git diff); changelog-master change is purely additive (one `170` block, precondition `columnExists status`, `onFail: MARK_RAN`).
- **AMS vocabulary / transitions / audit:** `ALLOWED_STATUSES = {pending_review, approved, rejected, deferred}`; `ALLOWED_REVIEWER_STATUSES = {approved, rejected, deferred}`; `ALLOWED_TRANSITIONS` and `InvalidFindingStatusTransitionException` removed; `applyStatusChange` captures `previousReviewStatus` before overwrite on every real transition and stamps `reviewed_at`; persist default is `pending_review`.
- **Bulk reconciliation:** `bulkReview` reads `request.reviewStatus()`, validates against `ALLOWED_REVIEWER_STATUSES`, removed the transition pre-check + skip path; `SkippedByReason.transitionNotAllowed` retained as a field but hard-wired to `0`; `alreadyInTarget` counts same-`review_status` rows; `deltaByFromStatus` keyed by pre-mutation `review_status`. Response Javadoc documents the new key vocabulary.
- **Wire field:** entity `review_status`/`previous_review_status` (snake_case via global SNAKE_CASE, no `@CamelCaseWire`); DTO record components `reviewStatus`/`previousReviewStatus` with a backward-compat delegating constructor defaulting both new positions to null; frontend `DiscoveryFindingDto` carries `review_status` + `previous_review_status` with the four-value `DiscoveryFindingStatus` union.
- **Human surface = exactly Approve / Reject / Defer:**
  - Drawer: three action buttons `finding-action-approve|reject|defer` (Approve/Reject/Defer) calling `reviewFinding` with `approved|rejected|deferred`, plus Save Notes; NO Mark Resolved / Mark Needs Review buttons (only doc-comment references to their removal remain).
  - Tab: `BULK_TARGET_STATUSES = ['approved','rejected','deferred']`; labels Approve/Reject/Defer; summary pills Pending Review / Approved / Rejected / Deferred (+ Total, Critical + High); no Resolved pill; filter options `pending_review/approved/rejected/deferred`.
  - Modal: `statusDisplayLabel` → Approved / Rejected / Deferred / Pending Review.
- **discovery-service emit:** `FindingEmitter` `FindingStatus`/`VALID_STATUSES` = the four-value set; emit OMITS the disposition field (AMS applies `pending_review`); `archModelClient.DiscoveryFindingCreatePayload.reviewStatus` maps to wire `review_status`. (Tests confirm omission.)
- **Scope containment:** `gateway/src/routes/discovery.ts` zero diff; no non-test gateway src change; `mcp-server/` zero diff; no stray legacy finding-status literals in production sources (the two grep hits are a retirement-documentation comment and a candidate-status param doc — both correct).

---

## Final Verdict

**✅ PASS.** Spec F is implemented to its acceptance contract end-to-end, with the migration correctness, vocabulary normalization, unrestricted-transition + audit-trail behaviour, three-verb human surface, emit alignment, and scope containment all verified against code and green findings-domain tests on all four stacks. Observed test/typecheck noise is pre-existing and unrelated.
