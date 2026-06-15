# Verification Report: Model-Seeded Capture Inventory — Guaranteed Operation-Capture Completeness

**Spec:** `2026-06-11-model-seeded-capture-inventory`
**Date:** 2026-06-11
**Verifier:** implementation-verifier
**Status:** ✅ Passed (one documentation note)

Note: browser-based verification was unavailable for this run; verification was
performed via the four test stacks plus direct code inspection of every settled
requirement.

---

## Executive Summary

The full spec surface is implemented and green across all four stacks: the AMS
shared reconciliation calculator + endpoint + changesets 178/179 + idempotent
session-linked findings, the validation service's `reconcile-inventory` /
`account-endpoints` actions and fail-closed `/start` gate with persisted
justified override, the two gateway action proxies, and the frontend Step 4 /
409-override / detail-banner / baseline-coverage surfaces. 133 spec-surface
tests pass (43 JUnit + 36 validation-service Jest + 22 gateway Jest + 32
frontend Vitest) with zero failures, and every settled decision (D1–D8)
spot-checked in code holds. The only gap is documentation: the spec's
`implementation/` folder contains no per-task-group implementation reports.

---

## 1. Tasks Verification

**Status:** ✅ All Complete

All 5 task groups (28 sub-tasks) in `tasks.md` were already marked `- [x]` and
each was confirmed against code + passing tests.

### Completed Tasks
- [x] Task Group 1: AMS calculator, endpoint, changesets 178/179, finding emission
  - [x] 1.1–1.6 — `InventoryReconciliationCalculator` (sole home of
    `endpointKey`/`operationKey`/`soapDiscriminator`/`isSoapEndpoint`/`reconcile`),
    `ApiBehaviourInventoryReconciliationService` + controller, NEW changesets
    `178-capture-session-scope-and-coverage-override.sql` and
    `179-discovery-findings-capture-session-origin.sql`, delete-before-emit
    findings. Tests: `InventoryReconciliationCalculatorTest` (3),
    `ApiBehaviourInventoryReconciliationServiceTest` (6),
    `CaptureInventoryReconciliationChangesetTest` (1),
    `MigrationCaptureCoverageReadinessTest` (8, unchanged) — all green.
- [x] Task Group 2: validation-service actions + `/start` hard block + override
  - [x] 2.1–2.6 — `reconcile-inventory` (502 fail-closed envelope),
    `account-endpoints` (bulk include/exclude, 400 on missing exclude reason,
    `oasInventoryStore` append, rows returned), `parse-oas` scope persistence,
    `/start` gate (fail-closed 502 `INVENTORY_RECONCILIATION_UNAVAILABLE`,
    409 `INVENTORY_UNACCOUNTED_ENDPOINTS` with `UNACCOUNTED_EMBED_CAP = 50`
    + total count, override trio PATCH before proceeding). Jest:
    `captureSessionActions*` + `captureSessionOrchestrator*` 10 suites /
    36 tests green; `tsc --noEmit` clean.
- [x] Task Group 3: gateway action proxies
  - [x] 3.1–3.3 — `reconcile-inventory` + `account-endpoints` added to
    `API_BEHAVIOUR_ACTION_PATHS` (two list entries, no bespoke proxy code);
    dedicated suite `apiMigrationValidation-inventory-actions-proxy.test.ts`.
    Jest: 7 suites / 22 tests green; `tsc --noEmit` clean.
- [x] Task Group 4: frontend Step 4, 409 override, detail banner, baseline coverage
  - [x] 4.1–4.7 — `apiBehaviourClient.ts` `reconcileInventory`/`accountEndpoints`
    wrappers + new nullable fields; Step 4 unmatched/discovery-gaps/
    excluded-by-scope sections + both coverage figures; 409 override dialog
    (disabled until non-empty justification); `CaptureSessionDetailView`
    override banner; `BaselinesList` read-only coverage
    (`refresh_findings: false`) with Activate logic untouched. Vitest:
    `StartCaptureSessionWizard.inventoryReconciliation.test.tsx` (6),
    `BaselinesList.coverage.test.tsx` (1),
    `CaptureSessionDetailView.coverageOverride.test.tsx` (1) — all green.
- [x] Task Group 5: test review & gap analysis
  - [x] 5.1–5.4 — strategic end-to-end additions present:
    `captureSessionActions.inventoryReconciliation.e2e.test.ts` (lifecycle,
    block-then-override, staleness, coverage-math agreement) within the green
    Jest run.

### Incomplete or Issues
None.

---

## 2. Documentation Verification

**Status:** ⚠️ Issues Found (implementation reports missing)

### Implementation Documentation
- ⚠️ `implementation/` folder is EMPTY — no per-task-group implementation
  reports were written for Task Groups 1–5. Task completion was instead
  verified directly against code and tests (all evidence found; see section 1).

### Verification Documentation
- This report (`verifications/final-verification.md`).

### Missing Documentation
- `implementation/1-*.md` … `implementation/5-*.md` (all five task-group
  implementation reports). Documentation-only gap; no functional impact.

---

## 3. Roadmap Updates

**Status:** ⚠️ No Updates Needed

### Updated Roadmap Items
None.

### Notes
`agent-os/product/roadmap.md` covers only the original diagram-tool phases
(meta-model CRUD, diagram rendering/editing, backend/deployment). No roadmap
item corresponds to the capture-inventory / API-migration-validation feature
area, so no checkbox changes were applicable.

---

## 4. Test Suite Results

**Status:** ✅ All Passing (spec surface, per dispatch instructions)

Per the verification dispatch, the SPEC SURFACE was re-run rather than the
whole-application suites of all four services (whole-suite runs are
explicitly out of scope for this spec's task plan).

### Test Summary
- **Total Tests:** 133
- **Passing:** 133
- **Failing:** 0
- **Errors:** 0

Breakdown:
- **AMS (JUnit)** — `mvn test -Dtest='InventoryReconciliation*,ApiBehaviourInventoryReconciliation*,CaptureInventoryReconciliation*,MigrationCaptureCoverageReadinessTest,MigrationDiscoveryContext*'`:
  8 classes, **43/43 passed** (BUILD SUCCESS), including the unchanged
  readiness suites (`MigrationCaptureCoverageReadinessTest` 8/8,
  `MigrationDiscoveryContextServiceTest` 12/12, aggregation 4/4,
  scenario seeds 5/5, suppression 4/4).
- **api-migration-validation-service** — `npx tsc --noEmit` CLEAN;
  `npx jest captureSessionActions captureSessionOrchestrator`:
  **10 suites / 36/36 passed** (includes
  `captureSessionActions.inventoryReconciliation.test.ts` and the
  `.e2e.test.ts` workflow suite).
- **gateway** — `npx tsc --noEmit` CLEAN;
  `npx jest apiMigrationValidation`: **7 suites / 22/22 passed** (includes
  `apiMigrationValidation-inventory-actions-proxy.test.ts`).
- **frontend** — `npx vitest run src/components/ApiBehaviour`:
  **8 files / 30/30 passed** (includes
  `StartCaptureSessionWizard.inventoryReconciliation.test.tsx`, 6 tests);
  plus the two spec suites outside that path:
  `BaselinesList.coverage.test.tsx` + 
  `CaptureSessionDetailView.coverageOverride.test.tsx` — **2/2 passed**.
- **frontend `tsc --noEmit`** — 519 errors, ALL pre-existing
  test-harness/baseline errors in unrelated files; **ZERO errors in the four
  spec-touched files** (`apiBehaviourClient.ts`,
  `StartCaptureSessionWizard.tsx`, `BaselinesList.tsx`,
  `CaptureSessionDetailView.tsx`) — net-zero NEW errors, bar met.

### Failed Tests
None — all spec-surface tests passing.

### Notes — settled-requirement spot-checks (all verified in code)

1. **Single key home (D2):** the SOAP-aware reconciliation key exists ONLY in
   `InventoryReconciliationCalculator` (`service/migration`).
   `MigrationDiscoveryContextService` retains thin delegating wrappers
   (lines ~1371–1386) and gate C calls `InventoryReconciliationCalculator.reconcile`
   (line ~1358); `ApiBehaviourInventoryReconciliationService` consumes the
   calculator. Zero `soap::` occurrences anywhere in
   validation-service/gateway/frontend TypeScript (sources AND tests). The only
   TS `<METHOD> <path>`-shaped strings are the pre-existing seed-safety map key
   (`captureSessionActions.ts:292`, predates this spec) and the spec-mandated
   `<METHOD>_<path>` operation_id naming fallback — neither is a reconciliation
   comparison.
2. **Fail-closed `/start` gate:** AMS reconciliation error → 502 with
   `code: 'INVENTORY_RECONCILIATION_UNAVAILABLE'` and an explicit
   "coverage gate fails closed" message — never a silent skip. Unaccounted
   endpoints + no override → 409 `code: 'INVENTORY_UNACCOUNTED_ENDPOINTS'`
   with `unaccountedCount`, the list capped at 50
   (`UNACCOUNTED_EMBED_CAP = 50`), and `unaccountedTotalCount`. Justified
   override PATCHes the trio (`coverage_override_justification`,
   `coverage_override_unaccounted_count`, `coverage_override_at`) BEFORE
   proceeding.
3. **Accounting rows:** EXCLUDE persists `included: false` +
   `exclusion_reason` (trimmed), with a 400 when the reason is missing/empty;
   INCLUDE synthesises a schema-less row via
   `synthesiseOperationFromEndpoint` with
   `x-amvs-source: 'model-endpoint-reconciliation'`, the `x-amvs-soap` block,
   `x-amvs-soap-root` placeholder schemas, `safe_to_execute: null`, and
   appends included rows to the cached `oasInventoryStore`.
4. **Reverse-direction findings:** changeset 179 adds
   `api_behaviour_capture_session_id UUID` FK with `ON DELETE CASCADE` + a
   partial index, and DROPs/re-ADDs `discovery_finding_exactly_one_origin` as
   the three-way exactly-one-of CHECK (changeset-160 precedent). The AMS
   service calls `deleteFindingsByCaptureSessionId` BEFORE re-emitting
   (delete-before-emit idempotence) with fail-soft per-finding catches;
   finding shape matches the spec
   (`operation_without_model_endpoint` / `capture_inventory_reconciliation`).
5. **Changeset immutability:** `178-...` and `179-...` are NEW (untracked)
   files; `git diff HEAD` shows changesets ≤177 untouched and
   `db.changelog-master.yaml` changed by additions only (the two new
   changeset entries with `columnExists` preconditions).
6. **Baseline Activate untouched (D3):** `BaselinesList.tsx` changes are the
   informational coverage figure fetched with `refresh_findings: false` plus
   the override note; the Activate/Archive transition logic is unchanged
   (the only deleted lines in the frontend diff are the wizard's `handleStart`
   refactor for the override flow).
7. **Readiness gate frozen (D6):** coverage gate C delegates to the extracted
   calculator and derives its two existing counts from the detailed result;
   all 8 `MigrationCaptureCoverageReadinessTest` tests plus the 25 other
   `MigrationDiscoveryContext*` tests pass unmodified.
