# Verification Report: Baseline Integrity & Provenance

**Spec:** `2026-06-17-baseline-integrity-provenance`
**Date:** 2026-06-17
**Verifier:** implementation-verifier
**Status:** ⚠️ Passed with Issues

---

## Executive Summary

End-to-end verification of all three layers (AMS / Java, api-migration-validation-service / TS,
frontend / React) passed against the run commands, with all feature tests green and all six
spec invariants confirmed. The implementation is high quality and correct on the trust-boundary
mechanics (server-side hashing + verification, deterministic canonical form including
`volatile_paths_json`, stamp-only-at-activate, current-only, advisory non-blocking reconcile,
null-hash neutral, no lifecycle regression). One genuine deviation was found: the frontend
baseline-view integrity badge is a two-state at-rest indicator ("Hash recorded" / "No integrity
hash recorded") and does NOT consume the AMS verify endpoint to render the live
**verified / mismatch (red)** states the spec's acceptance criterion calls for. This is documented
in the code as a deliberate "reconcile-side concern" choice. It is non-blocking for the trust
boundary (verification still happens server-side and is surfaced at reconcile) but is a partial
miss of one frontend acceptance criterion.

---

## 1. Tasks Verification

**Status:** ✅ All Complete (marks confirmed by spot-check)

All four task groups in `tasks.md` were already marked `- [x]`. Each was independently confirmed
against the code (no implementation reports exist in `implementation/` — the folder is empty — so
verification was by direct code + test inspection).

### Completed Tasks
- [x] Task Group 1: AMS columns, entity/DTO/mapper, hash + provenance stamping at activate, verify endpoint
  - [x] 1.1 Focused AMS tests written (`ApiBehaviourBaselineIntegrityServiceTest`, `ApiBehaviourBaselineIntegrityWireTest`, `BaselineContentHashUtilVolatileTest`)
  - [x] 1.2 Changeset `191-baseline-content-hash-provenance.sql` (next-free verified; `not.columnExists` + `COMMENT ON COLUMN`; registered after 190)
  - [x] 1.3 `ApiBehaviourBaselineEntity` threads `contentHash` (String) + `provenanceJson` (Map, `@Type(JsonType.class)`)
  - [x] 1.4 `ApiBehaviourBaselineDto` 15-arg canonical ctor + 13-arg + 11-arg delegating ctors; mapped in `ApiBehaviourMapper.toDto`
  - [x] 1.5 `BaselineContentHashUtil` canonical form (sorts items by `(method,path,scenario_name)`, includes `volatile_paths_json`, delegates to `UserJourneyDiagramHashUtil` SHA-256, `canonical_version: 1`)
  - [x] 1.6 Stamp at draft→active in `ApiBehaviourBaselineService.update()`; current-only; coverage_score from `coverage_summary_json.overall_score`, null-safe
  - [x] 1.7 `GET .../baselines/{baselineId}/integrity` verify endpoint (snake_case `ApiBehaviourBaselineIntegrityDto`)
  - [x] 1.8 Layer tests pass + no lifecycle regression
- [x] Task Group 2: validation-service reconcile consumes the integrity verdict (advisory, non-blocking)
  - [x] 2.1 Focused TS tests (`diffRunnerIntegrity.test.ts`, `archModelClientIntegrity.test.ts`)
  - [x] 2.2 `getBaselineIntegrity` on `archModelClient.ts`; `BaselineIntegrityDto` + `content_hash`/`provenance_json` on `BaselineDto`
  - [x] 2.3 Verify call at source/oracle load in `diffRunner.ts`; consumes verdict; advisory finding emitted in fail-soft tail
  - [x] 2.4 `tsc --noEmit` clean; full jest green
- [x] Task Group 3: frontend surface integrity + provenance + coverage on `BaselineDetailView.tsx`
  - [x] 3.1 Focused vitest (`BaselineDetailView.integrity.test.tsx`)
  - [x] 3.2 `content_hash`/`provenance_json` + `getBaselineIntegrity` + `ApiBehaviourBaselineIntegrityDto` on `apiBehaviourClient.ts`
  - [x] 3.3 Renders integrity badge + hash + provenance + coverage% on `kind='current'` only (see deviation re: live verify badge)
  - [x] 3.4 Changed-file typecheck clean; vitest green; no view regression
- [x] Task Group 4: cross-layer test review & gap analysis
  - [x] 4.1–4.4 Gap-fill tests added (`BaselineContentHashUtilVolatileTest` for volatile-paths pinning); feature tests + full TS suite green

### Incomplete or Issues
None of the task checkboxes required correction — all were already `- [x]` and all are
substantiated by code + passing tests. See Section 3 deviations for the one partial frontend
acceptance-criterion miss (it does not invalidate the task marks, which describe the rendered
surface accurately).

---

## 2. Documentation Verification

**Status:** ⚠️ Issues Found (no per-task implementation reports)

### Implementation Documentation
- The `agent-os/specs/2026-06-17-baseline-integrity-provenance/implementation/` directory exists
  but is EMPTY — no per-task-group implementation reports were written.

### Verification Documentation
- This report: `agent-os/specs/2026-06-17-baseline-integrity-provenance/verifications/final-verification.md`

### Missing Documentation
- No implementation reports (`implementation/1-*.md` … `4-*.md`). Verification therefore relied on
  direct source + test inspection rather than implementer write-ups. The code itself is unusually
  well-commented (changeset header, util Javadoc, service Javadoc, DTO Javadoc, diffRunner block
  comments all document the canonical form, the volatile-pinning-vs-tolerance distinction, and the
  advisory/null-hash/fail-soft semantics), which substantially compensates.

---

## 3. Roadmap Updates

**Status:** ⚠️ No Updates Needed

### Updated Roadmap Items
None.

### Notes
`agent-os/product/roadmap.md` describes a different product line (an architecture meta-model
editor: JSON schema, grids, diagram rendering/editing, backend persistence — Phases 1–5). No
roadmap item corresponds to API-behaviour baseline integrity / provenance, so there is nothing to
mark complete. No change made.

---

## 4. Test Suite Results

**Status:** ✅ All feature + no-regression tests passing (per-layer suites run; whole-monorepo
suite not run by design — the task scopes verification to the affected modules)

### Commands run (skeptical re-run, not trusting implementer marks)

**AMS (architecture-model-service, JDK 21):**
- `mvn -o -q compile test-compile` → SUCCESS (no errors)
- `mvn -o test -Dtest='ApiBehaviourBaselineIntegrity*,BaselineContentHashUtilVolatileTest'`
  → **11 run, 0 failures, 0 errors, 0 skipped** — BUILD SUCCESS
  - `ApiBehaviourBaselineIntegrityWireTest` — 2 (snake_case wire for both the integrity DTO and the baseline DTO)
  - `ApiBehaviourBaselineIntegrityServiceTest` — 6 (determinism, stamp-at-activate + coverage_score, null-safe coverage, tamper→mismatch, null-hash neutral, current-only target-not-stamped)
  - `BaselineContentHashUtilVolatileTest` — 3 (volatile-paths change→hash change, null-vs-declared differ, volatile key-order stable)
- No-regression: `mvn -o test -Dtest='ApiBehaviourBaselineKindAndPairingServiceTest,ApiBehaviourBaselinePairingControllerTest,ApiBehaviourCaptureSessionCoverageSummaryTest'`
  → **11 run, 0 failures, 0 errors** — BUILD SUCCESS

**api-migration-validation-service (Node/TS):**
- `npx tsc --noEmit` → EXIT 0 (clean)
- `npx jest` (FULL suite) → **Test Suites: 1 skipped, 61 passed, 62 total; Tests: 1 skipped, 315 passed, 316 total** — matches the expected 315 pass / 1 skip
- Key files: `diffRunnerIntegrity.test.ts` (4) + `archModelClientIntegrity.test.ts` (3) → **7 passed**

**frontend (React/TS):**
- `npx vitest run src/components/DashboardView/BaselineDetailView.integrity.test.tsx`
  → **6 passed** (1 file)
- Changed-file typecheck: `npx tsc --noEmit` total repo errors = **515** (pre-existing, unrelated,
  as the spec documents). Filtering for the three changed files
  (`BaselineDetailView.tsx`, `apiBehaviourClient.ts`, `BaselineDetailView.integrity.test.tsx`)
  → **ZERO** errors introduced by this spec.

### Test Summary (feature + relevant no-regression)
- **AMS:** 11 feature + 11 no-regression = 22 passing
- **validation-service:** full suite 315 passing / 1 skipped (includes the 7 new integrity tests)
- **frontend:** 6 passing (spec vitest)
- **Failing:** 0
- **Errors:** 0

### Failed Tests
None — all tests passing.

### Notes
- The 515 frontend `tsc` errors are PRE-EXISTING and unrelated to this spec (the spec explicitly
  flags ~515 baseline errors); none touch the changed files, so they are NOT a regression of this
  spec. The whole-monorepo test suite was not executed in full — per the task, verification is
  scoped to the three affected modules, all of which are green.

---

## 5. Acceptance Criteria & Invariant Verification

### AMS (Task Group 1) — ✅ PASS
- Changeset 191 verified next-free (187/188/189/190 highest on disk), adds both NULLABLE columns
  with `not.columnExists` + `COMMENT ON COLUMN`, registered after 190 (master changelog lines
  4259/4295/4310); no applied changeset edited. ✅
- `content_hash` + `provenance_json` thread through entity (reference types; JSONB via
  `@Type(JsonType.class)`), DTO (15-arg canonical + 13-arg + 11-arg delegating ctors), and mapper
  in snake_case (no `@CamelCaseWire`; confirmed by `ApiBehaviourBaselineIntegrityWireTest`). ✅
- **Invariant (1) hash deterministic + canonical, order-independent, INCLUDES `volatile_paths_json`
  as pinned content:** `BaselineContentHashUtil` sorts items by `(method,path,scenario_name)`,
  hashes `method/path/scenario_name/request_json/response_status/response_json/volatile_paths_json`,
  recursively sorts JSON keys via `UserJourneyDiagramHashUtil`'s canonical mapper, UTF-8 / SHA-256
  lowercase hex, `canonical_version: 1`. Proven by the determinism test (different insertion + key
  order → identical hash) and the three volatile-paths tests (changing declared volatile paths
  changes the hash; key-order inside the envelope does not). The pinning-vs-tolerance distinction
  is documented in the changeset comment, the util Javadoc, and the service Javadoc. ✅
- **Invariant (2) stamped ONLY at draft→active, current-only; provenance carries Spec A's
  coverage_score:** `ApiBehaviourBaselineService.update()` stamps only when
  `active && !active-before`; `stampIntegrityIfCurrent` early-returns for non-`current` kinds;
  `buildProvenance` reads `coverage_summary_json.overall_score` (NOT `in_scope_coverage_pct`),
  null-safe when the session has no summary. Proven by stamp-at-activate, null-safe-coverage, and
  current-only tests. ✅ (Note: `create()` also stamps when a baseline is created directly as
  active — still gated to `kind='current'` via the same helper; this is a benign superset of
  "transition into active," not a violation.)
- **Invariant (3) verify endpoint detects tampering:** `verifyIntegrity` recomputes over current
  stored items with the identical canonical form and returns
  `{ content_hash, recomputed_hash, integrity_verified }` where
  `integrity_verified = stored != null && stored.equals(recomputed)`. Proven by the tamper test
  (recomputed_hash differs → integrity_verified false). ✅
- **Invariant (5) null-hash neutral:** null `content_hash` → `integrity_verified: false` with a
  non-null `recomputed_hash`; consumer treats as "no hash recorded." Proven by the null-hash test. ✅

### validation-service (Task Group 2) — ✅ PASS
- `getBaselineIntegrity` mirrors `getBaseline`/`listBaselineItems` endpoint + `toClientError`
  shape; `BaselineDto` extended with `content_hash` + `provenance_json` (snake_case). ✅
- **Invariant (4) reconcile mismatch is ADVISORY (warns, never blocks):** `diffRunner.ts` calls
  verify at source/oracle load inside a try/catch; a REAL mismatch (`integrity_verified === false`
  AND non-null `content_hash`) emits a visible `api_behaviour_oracle_integrity_mismatch` finding in
  the fail-soft tail block (after `deleteFindingsByApiBehaviourDiffId`, recompute-safe) and the
  reconcile PROCEEDS. Proven by `diffRunnerIntegrity` "real mismatch … reconcile completes". ✅
- **Invariant (5) null-hash neutral at reconcile:** null `content_hash` → breadcrumb only, no
  finding, not a mismatch. Proven by the "null-hash baseline is NEUTRAL" test. ✅
- **Fail-soft:** a verify-call error sets `sourceIntegrity = undefined`, logs a warning, and the
  reconcile completes with no finding. Proven by the "verify-call error is FAIL-SOFT" test. ✅
- `integrity_verified === true` emits no finding (proven). ✅
- Full jest suite green at 315/1 (no reconcile-classification regression). ✅

### frontend (Task Group 3) — ⚠️ PASS WITH ISSUES
- `apiBehaviourClient.ts` extends the baseline DTO with `content_hash` + `provenance_json`, adds
  `parseBaselineProvenance` (defensive), the `ApiBehaviourBaselineIntegrityDto`, and the
  `getBaselineIntegrity` client method. ✅
- `BaselineDetailView.tsx` renders, for `kind='current'` only: the content hash (truncated, full
  value on `data-content-hash`) or the neutral "No integrity hash recorded" badge when null;
  provenance rows (environment, activated_at); and the coverage score (formatted as %). Target
  baselines are not surfaced. Proven by the 6 vitest cases. ✅
- **Invariant (6) no regression of lifecycle/immutability/reconcile:** confirmed across layers
  (AMS lifecycle/pairing tests + full TS suite + view-render tests all green). ✅
- **DEVIATION — live verify badge:** the spec acceptance criterion states the integrity badge must
  show **verified / mismatch (red) / "no hash recorded" (neutral)** and that "the badge consumes
  the AMS verify operation for the displayed baseline." As built, the badge is a TWO-state at-rest
  indicator derived solely from `baseline.content_hash`: **"Hash recorded"** (styled
  `integrityVerified`) or **"No integrity hash recorded"** (styled `integrityNeutral`). The view
  does NOT call `getBaselineIntegrity`, so it never renders a live **mismatch (red)** state. The
  code (BaselineDetailView.tsx ~lines 280–283) documents this as an intentional choice ("the live
  verified/mismatch verdict … is the reconcile-side concern"). The `getBaselineIntegrity` client
  method exists but is unused by the view. Net effect: the null-hash neutral state and an at-rest
  "hash recorded" state are present, but the spec's live tamper-mismatch surfacing in the baseline
  view is absent (tamper is still surfaced server-side at reconcile via the advisory finding). ⚠️

---

## 6. Deviations Summary

1. **Frontend integrity badge does not consume the verify endpoint (partial acceptance-criterion
   miss).** Spec calls for a live verified / mismatch (red) / no-hash badge driven by the AMS
   verify operation; implementation surfaces only an at-rest "Hash recorded" / "No integrity hash
   recorded" two-state badge from the stored `content_hash`, with `getBaselineIntegrity` present
   but unused in the view. Documented in-code as deliberate. Trust boundary is unaffected
   (server-side verify + reconcile-time advisory finding both work). Severity: low/medium —
   reviewers do not get the at-a-glance tamper signal in the baseline view itself.

2. **No per-task implementation reports** in `implementation/` (folder empty). Mitigated by
   thorough in-code documentation.

3. **Minor (not a violation): `create()` also stamps a directly-created active baseline.** Beyond
   the literal "at draft→active PATCH," but gated to `kind='current'` and semantically still
   "transition into active." Acceptable and arguably more correct for the target-replay writer path.

---

## Overall Verdict

**⚠️ PASSED WITH ISSUES.**

The trust-boundary core of the spec is fully and correctly implemented and verified: server-side
deterministic canonical hashing (including `volatile_paths_json` as pinned content, separate from
reconcile tolerance), stamp-only-at-activate + current-only, provenance carrying Spec A's
`overall_score` (null-safe), a server-side verify endpoint that detects tampering, an advisory
non-blocking reconcile consumer, null-hash neutrality at both verify and reconcile, and no
regression of baseline lifecycle / immutability / kind-pairing / existing reconcile. All feature
tests across the three modules pass on a skeptical re-run (AMS 11+11, TS 315/1 incl. 7 new,
frontend 6), `tsc` is clean in the validation-service and introduces zero new errors in the
changed frontend files.

The single substantive gap is the frontend baseline-view integrity badge: it is an at-rest
two-state indicator and does not call the verify endpoint to render the live verified/mismatch
(red) states the spec's frontend acceptance criterion describes. This is a documented design
choice and does not weaken the tamper-evidence guarantee (which is enforced server-side and
surfaced at reconcile), but it is a partial miss of one acceptance criterion and is the reason the
verdict is "passed with issues" rather than a clean pass.
