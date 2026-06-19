# Verification Report: Stateful Sequence Scenarios (Spec D)

**Spec:** `2026-06-18-stateful-sequence-scenarios`
**Date:** 2026-06-18
**Verifier:** implementation-verifier
**Status:** ✅ Passed

---

## Executive Summary

All 5 task groups are implemented, marked complete, and verified by re-running every
command myself (not trusting the implementers' marks). The AMS layer compiles under
JDK21 and all 17 targeted tests pass; the validation-service typechecks clean and the
FULL jest suite is 338 pass / 1 skip exactly as predicted; the frontend Spec D vitest
files (7 tests) pass with ZERO tsc errors in the changed files. All 8 load-bearing
invariants hold. Both repo-health checks (mojibake scan + `execute_http_request.ts`
restored-behavior) pass. No roadmap update applies (the product roadmap is the
architecture-modeling feature list and does not track the oracle A/B/C/D series).
Overall verdict: PASS.

---

## 1. Tasks Verification

**Status:** ✅ All Complete

### Completed Tasks
- [x] Task Group 1: AMS `sequence_json` column, DTO/mapper/service threading, integrity-hash fold
  - [x] 1.1–1.8 (column, changeset 192, DTO/request/mapper/service threading, hash fold, no-regression)
- [x] Task Group 2: `pin_sequence` terminal tool + orchestrator sequence assembly + ref-derived volatility
  - [x] 2.1–2.8 (pin tool, assembly, one-dimension, ref-derived volatility, persist carry, full-suite)
- [x] Task Group 3: deterministic ordered-step sub-runner + diagnostics
  - [x] 3.1–3.9 (dispatch branch, sub-runner, setup assert, act diff, cleanup best-effort, diagnostics)
- [x] Task Group 4: surface sequence steps, refs, cleanup status, pollution flag
  - [x] 4.1–4.7 (type fields, Save-carry, BaselineDetailView render, recon panel, changed-file typecheck)
- [x] Task Group 5: cross-layer invariant review + gap fill
  - [x] 5.1–5.4 (review, gap analysis, added tests, full no-regression sweep)

All task checkboxes in `tasks.md` were already `- [x]`. I spot-checked the code behind each
group and confirmed every claim independently — no checkbox required correction.

### Incomplete or Issues
None.

---

## 2. Documentation Verification

**Status:** ⚠️ No implementation reports (acceptable — code is self-documenting & verified)

### Implementation Documentation
The `implementation/` directory exists but is EMPTY — no per-group implementation reports
were written. This is a documentation gap, not an implementation gap: every task's code was
located, read, and re-verified directly, and every acceptance criterion is met. The source
files carry extensive in-code Javadoc/TSDoc (e.g. `BaselineContentHashUtil` sequence-fold
docs, changeset 192 header comment, `sequenceReplayRunner.ts` invariant comments) that
substitute for separate reports.

### Verification Documentation
- This report: `agent-os/specs/2026-06-18-stateful-sequence-scenarios/verifications/final-verification.md`

### Missing Documentation
- Per-task-group implementation reports under `implementation/` (none present). Non-blocking.

---

## 3. Roadmap Updates

**Status:** ⚠️ No Updates Needed

### Updated Roadmap Items
None.

### Notes
`agent-os/product/roadmap.md` tracks the architecture meta-model / diagram-editing product
(Phases 1–5: JSON schema, grids, diagram rendering/editing, Spring Boot + Postgres backend).
The oracle "Stateful Sequence Scenarios (Spec D)" feature — part of the A→B→C→D oracle-standard
series in the API-migration-validation-service — is NOT represented as a roadmap line item.
No roadmap entry matches this spec, so no checkbox was changed.

---

## 4. Test Suite Results

**Status:** ✅ All Passing

### AMS (architecture-model-service, JDK21)
- `mvn -o -q compile test-compile` → BUILD SUCCESS (no errors).
- `mvn -o test -Dtest=BaselineItemSequenceTest,BaselineContentHashUtilSequenceTest,BaselineContentHashUtilVolatileTest,ApiBehaviourBaselineIntegrityServiceTest,ApiBehaviourBaselineIntegrityWireTest`
  → **Tests run: 17, Failures: 0, Errors: 0, Skipped: 0** → BUILD SUCCESS.
  - BaselineItemSequenceTest: 3 (DTO/mapper/service round-trip + entity persistence of `sequence_json`)
  - BaselineContentHashUtilSequenceTest: 3 (omit-when-null byte-identical + include-when-present + step-field tamper)
  - BaselineContentHashUtilVolatileTest (Spec C): 3 — still green
  - ApiBehaviourBaselineIntegrityServiceTest (Spec C): 6 — still green
  - ApiBehaviourBaselineIntegrityWireTest (Spec C): 2 — still green

### validation-service (Node/TS)
- `npx tsc --noEmit` → exit 0, clean.
- `npx jest` (FULL) → **Test Suites: 1 skipped, 65 passed, 65 of 66 total; Tests: 1 skipped, 338 passed, 339 total** (matches the expected 338 pass / 1 skip exactly).
- Spec D subset (`sequenceReplayRunner`, `statefulSequenceCapture`, `statefulSequenceRefVolatilityRoundTrip`, `targetReplaySequenceDispatch`): **23 passed / 23**.

### frontend (React/TS)
- Spec D vitest (`BaselineDetailView.sequence.test.tsx`, `SaveAsBaselineModal.sequenceCarry.test.tsx`, `MigrationDeliveryReconciliationPanel.sequence.test.tsx`)
  → **Test Files 3 passed (3); Tests 7 passed (7)**.
- `npx tsc --noEmit` → 515 total errors (matches the documented ~515 PRE-EXISTING baseline). Filtered to the EXACT Spec D changed files (`BaselineDetailView.tsx`, `BaselineSequenceView.tsx`, `SaveAsBaselineModal.tsx`, `CaptureReviewPanel.tsx`, `MigrationDeliveryReconciliationPanel.tsx`, `apiBehaviourClient.ts`, + the 3 test files): **ZERO errors**. (A broad "sequence" grep surfaced unrelated `DiagramsView/SequenceEditor` / `SequenceDiagramRenderer` / `sequenceLayout.ts` errors — those belong to the architecture sequence-DIAGRAM feature, not this oracle spec, and are part of the pre-existing 515.)

### Test Summary
- **Total Tests (this spec's scope):** AMS 17 + validation-service full 339 (incl. 23 Spec D) + frontend 7 = exercised
- **Passing:** AMS 17, validation-service 338, frontend 7
- **Failing:** 0
- **Errors:** 0
- **Skipped:** validation-service 1 (pre-existing, unrelated)

### Failed Tests
None — all tests passing.

### Notes
The single skipped jest test is the documented pre-existing baseline skip (unchanged by this
spec). The 515 frontend tsc errors are the documented pre-existing unrelated baseline; none
fall in this spec's changed files.

---

## 5. Invariant Verification

| # | Invariant | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | Deterministic replay resolves `$N.<path>` refs | ✅ Met | `sequenceReplayRunner.ts` `resolveJsonPath` + `substituteRefs` + `substitutePathRefs` resolve from `liveBodies` keyed by earlier step index, applied to path/query/headers/body before each `executor.request`. NO LLM in the sub-runner. `sequenceReplayRunner.test.ts` green. |
| 2 | Ref-derived id tolerance (generated-id change NOT a break; genuine non-volatile change IS) | ✅ Met | `sequenceAssembly.deriveSequenceVolatilePaths` records (a) every `$N.<jsonpath>` referenced field + (b) `extractIdentifierPaths` ids into the SAME `volatile_paths_json` envelope (`volatility_source: 'declared'`) via `volatilityEnvelopeToWire`. A field NOT recorded still diffs strictly. `statefulSequenceRefVolatilityRoundTrip.test.ts` covers both directions. |
| 3 | Setup-fail → act not diffed | ✅ Met | `sequenceReplayRunner.ts` setup loop: any status-mismatch / transport-fail / non-http kind sets `setupFailed`, emits `sequence_setup_failed`, and `return result` BEFORE the act block. |
| 4 | Cleanup-fail / no-cleanup → flagged not crashed | ✅ Met | Cleanup loop uses `continue` on every failure path, sets `cleanupFailed`/`residualPollution` + emits `sequence_cleanup_failed`; `createdResourceCount>0 && cleanupStepCount===0` emits `sequence_residual_pollution`. Sequence verdict never flips to failed on cleanup error; never throws. `sendStep` catches transport errors (no throw). |
| 5 | Sequence requires `mutating_calls_confirmed` else `sequence_skipped` | ✅ Met | `replaySequenceItem` first guard: `session.mutating_calls_confirmed !== true` → `skipped=true` + distinct `sequence_skipped` diagnostic (NOT generic `mutating_skipped`), returns early. |
| 6 | Integrity hash byte-identical when `sequence_json` null (Spec C intact) | ✅ Met | `BaselineContentHashUtil.itemContent` only `put`s `sequence_json` when non-null; `CANONICAL_VERSION` stays 1. `BaselineContentHashUtilSequenceTest` independently rebuilds the pre-change 7-field canonical form and asserts byte-identical digest; Spec C `BaselineContentHashUtilVolatileTest` + `ApiBehaviourBaselineIntegrity*` all still pass. |
| 7 | Non-sequence single-shot capture/reconcile BYTE-FOR-BYTE unchanged | ✅ Met | `targetReplayRunner` dispatch branch guards on `item.sequence_json != null` then `continue`; single-shot path below is untouched. Capture assembles `sequence_json: null` for non-sequence scenarios. Frontend `BaselineSequenceView` renders nothing when null. Full jest suite green (338/1). |
| 8 | No regression of A/B/C | ✅ Met | Spec C integrity tests (3+6+2) green; full jest suite green; tsc clean; volatilityProbe mutating guard (`:167-169`) left untouched; pairKey + `compareJsonShapes` reused verbatim (no new diff engine). |

---

## 6. Repo-Health Checks

**Status:** ✅ Both Clean

### Mojibake scan
- `grep -rn "â€" api-migration-validation-service/src` → **0 hits** (empty output).
- `grep -rn "â€"` over the 9 frontend Spec D files (BaselineDetailView.tsx, BaselineSequenceView.tsx, SaveAsBaselineModal.tsx, CaptureReviewPanel.tsx, MigrationDeliveryReconciliationPanel.tsx, apiBehaviourClient.ts + the 3 test files) → **0 hits** (empty output).

### `execute_http_request.ts` restored-behavior
- `extractErrorSummary` present (line 50) WITH the `message|description` branch: regex `/(?:message|description)\b[^>]*>?\s*([\s\S]{1,600})/i` at line 75 (Tomcat/Jersey label extraction).
- `authMode` schema enum present: `enum: ['session', 'none', 'bad_token']` at line 802, with the per-call scoped-override description.
- Detailed top-level tool description string present (line 789, 457 chars): "Execute one HTTP request against the configured non-prod API… every attempt is auto-persisted as a capture row to AMS and the persisted captureId is returned."

All three byte-exact restorations confirmed intact.

---

## 7. Deviations

- **No implementation reports** under `implementation/` (directory empty). Documentation gap only; all code verified directly. Non-blocking.
- **No roadmap line item** matches this spec (the roadmap tracks the architecture-modeling product, not the oracle series). No update applied — expected.
- **AMS targeted-test count is 17, not the literal "2–8"** quoted per-group. The 17 includes the Spec C protection suites the prompt explicitly asked me to run alongside the spec's own 6 new tests (BaselineItemSequenceTest 3 + BaselineContentHashUtilSequenceTest 3). The spec's own new focused tests are within the 2–8 band; the extra 11 are the Spec C regression suites I was asked to re-run. Not a deviation in the spec's authored test count.

---

## 8. Overall Verdict

✅ **PASS**

Every layer compiles/typechecks and all relevant tests pass with the exact predicted counts
(AMS 17/17; validation-service 338 pass / 1 skip; frontend Spec D 7/7, zero changed-file tsc
errors). All 8 load-bearing invariants are independently confirmed in code and tests, including
the two highest-risk ones — the omit-when-null integrity hash (Spec C stays byte-identical,
`CANONICAL_VERSION` 1) and the byte-for-byte-unchanged single-shot path. Both repo-health
checks (mojibake = 0 hits; `execute_http_request.ts` restored behavior = all present) pass.
The implementation faithfully satisfies the spec, the R1–R8 resolved clarifications, and the
acceptance criteria of all five task groups.
