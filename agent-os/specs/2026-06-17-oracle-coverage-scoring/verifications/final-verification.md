# Verification Report: Oracle Coverage Scoring

**Spec:** `2026-06-17-oracle-coverage-scoring`
**Date:** 2026-06-17
**Verifier:** implementation-verifier
**Status:** ✅ Passed

---

## Executive Summary

All four task groups are implemented, threaded end-to-end across the three layers
(AMS Java, api-migration-validation-service TS, frontend React), and verified by
re-running every command myself. The AMS module compiles offline and its 4
focused coverage-summary tests pass; the validation-service typechecks clean and
the FULL jest suite is green at exactly the expected 296 pass / 1 skip; the
frontend coverage-surfacing tests pass 6/6 with zero TypeScript errors in any of
the spec's changed files. The four core invariants (single-source no-drift,
scoped leak-free auth-override, snake_case persistence readable off the session
DTO, and no Phase 1/2/3 regression) all hold under direct inspection and test
evidence.

---

## 1. Tasks Verification

**Status:** ✅ All Complete

All task-group checkboxes in `tasks.md` were already `- [x]`. I spot-checked each
against the actual code and tests rather than trusting the marks; every claim is
backed by the implementation.

### Completed Tasks
- [x] Task Group 1: Coverage-summary JSONB field on the capture session (AMS)
  - [x] 1.1 Focused AMS round-trip tests — `ApiBehaviourCaptureSessionCoverageSummaryTest` (3 tests: nested round-trip, null-guarded PATCH preserve, snake_case wire)
  - [x] 1.2 Changeset numbering verified — `188-capture-volatile-paths.sql` is still the highest numeric on disk; `189` is next-free
  - [x] 1.3 Changeset `189-capture-coverage-summary.sql` — `ADD COLUMN coverage_summary_json jsonb NULL` + `COMMENT ON COLUMN`, no backfill, registered after 188 with the `not.columnExists` precondition in the master YAML
  - [x] 1.4 Entity field — `@Type(JsonType.class) @Column(name="coverage_summary_json", columnDefinition="jsonb") Map<String,Object> coverageSummaryJson`
  - [x] 1.5 DTO + request threaded with delegating backward-compatible constructors; no `@CamelCaseWire`
  - [x] 1.6 Null-guarded PATCH apply in `ApiBehaviourCaptureSessionService` (`if (request.coverageSummaryJson() != null)`); mapped in `ApiBehaviourMapper.toDto`
  - [x] 1.7 AMS layer tests pass + compile
- [x] Task Group 2: Single-source scorer, auth-override, and persistence (validation-service)
  - [x] 2.1 Focused tests — `oracleCoverageScoring.test.ts` + `oracleCoverageScoringIntegration.test.ts`
  - [x] 2.2 PURE scorer `scoreEndpointCoverage` (sibling to `selectCanonicalCapture`), reuses `selectCanonicalCapture` verbatim, records every required per-dimension field with honest miss reasons via `coverageMissReason`
  - [x] 2.3 Per-scenario-loop accumulation via `outcomesByName` snapshot taken before the next `beginScenario` reset; scored per operation
  - [x] 2.4 Scoped auth-override seam `requestWithAuthOverride` (swap-before / restore-in-`finally`) + shared `authOverride.ts`
  - [x] 2.5 Session-level auth-negative probes `runAuthNegativeProbes` with safe-representative selection and honest-miss fallback
  - [x] 2.6 Overall score folds auth as +1 in `assembleCoverageSummary`; persists `dimensions_total` / `dimensions_achieved`
  - [x] 2.7 `coverage_summary_json` on `archModelClient` `CaptureSessionDto` + `PatchCaptureSessionRequest`, written on the existing completion PATCH
  - [x] 2.8 `tsc --noEmit` clean; full jest green
- [x] Task Group 3: Surface coverage at Save-as-Baseline and readiness (frontend, display-only)
  - [x] 3.1 Focused tests — `CoverageSummaryScoring.test.tsx` (6 tests)
  - [x] 3.2 `coverage_summary_json` on the frontend `ApiBehaviourCaptureSessionDto`
  - [x] 3.3 Rendered on `CaptureSessionDetailView` (readiness/session-detail)
  - [x] 3.4 Rendered at Save-as-Baseline (`SaveAsBaselineModal` + `CaptureReviewPanel`)
  - [x] 3.5 Thin-coverage flag (`isThinEndpoint`) + null/legacy "coverage not recorded" sentinel; display-only (no gate)
  - [x] 3.6 Frontend tests pass; typecheck of spec files clean
- [x] Task Group 4: Test Review & Gap Analysis
  - [x] 4.1–4.4 No-drift, no-leak, and persistence-round-trip invariants explicitly covered by the integration test (`oracleCoverageScoringIntegration.test.ts`); full jest green; AMS compiles with changeset 189

### Incomplete or Issues
None. Every task is genuinely complete and backed by code + passing tests. No
checkboxes required correction.

---

## 2. Documentation Verification

**Status:** ⚠️ Issues Found (non-blocking)

### Implementation Documentation
The `agent-os/specs/2026-06-17-oracle-coverage-scoring/implementation/` folder
exists but is **empty** — no per-task-group implementation reports were written.

### Verification Documentation
- This report: `agent-os/specs/2026-06-17-oracle-coverage-scoring/verifications/final-verification.md`

### Missing Documentation
- No implementation reports under `implementation/`. This is a documentation gap
  only; it does not affect the correctness of the implementation, which is fully
  evidenced by the in-tree code and the passing test suites. The code itself is
  heavily self-documenting (every changed file carries spec-referenced rationale
  comments).

---

## 3. Roadmap Updates

**Status:** ⚠️ No Updates Needed

### Updated Roadmap Items
None.

### Notes
No `agent-os/product/roadmap.md` exists in this repository (the product folder is
not present at the expected path), and this spec is explicitly framed as "Spec A
of a 3-spec series" tracked within the specs tree rather than a roadmap line item.
No roadmap update was applicable.

---

## 4. Test Suite Results

**Status:** ✅ All Passing

### AMS layer (architecture-model-service, Maven, JDK 21)
- `mvn -o -q compile test-compile` → BUILD SUCCESS, no errors (offline).
- `mvn -o test -Dtest=ApiBehaviourCaptureSessionCoverageSummaryTest,CaptureCoverageSummaryChangesetTest`:
  - `CaptureCoverageSummaryChangesetTest` — Tests run: 1, Failures: 0, Errors: 0
  - `ApiBehaviourCaptureSessionCoverageSummaryTest` — Tests run: 3, Failures: 0, Errors: 0
  - Aggregate: **Tests run: 4, Failures: 0, Errors: 0, Skipped: 0 — BUILD SUCCESS**

### Validation-service layer (api-migration-validation-service, jest)
- `npx tsc --noEmit` → **exit 0, clean** (no type errors).
- `npx jest` (FULL suite):
  - **Test Suites: 1 skipped, 57 passed, 57 of 58 total**
  - **Tests: 1 skipped, 296 passed, 297 total**
  - Matches the expected 296 pass / 1 skip exactly. No regression of
    `defaultScenarioSet` / `selectCanonicalCapture` / learned-facts / multi-segment
    path-param tests.

### Frontend layer (frontend, vitest)
- `npx vitest run src/components/DashboardView/CoverageSummaryScoring.test.tsx` →
  **Test Files: 1 passed; Tests: 6 passed**.
- TypeScript: repo-wide `npx tsc --noEmit` reports **515 pre-existing errors**
  (the documented baseline noise, all in unrelated test files). Filtering for the
  spec's changed files (`CoverageSummaryPanel`, `CoverageSummaryScoring.test.tsx`,
  `apiBehaviourClient.ts`, `CaptureSessionDetailView`, `SaveAsBaselineModal`,
  `CaptureReviewPanel`) yields **0 errors** — the spec introduced no new type
  errors.

### Test Summary
- **AMS focused tests:** 4 passing
- **Validation-service full suite:** 296 passing, 1 skipped, 0 failing
- **Frontend coverage tests:** 6 passing
- **Total verified for this spec:** 306 passing, 1 skipped, 0 failing

### Failed Tests
None — all tests passing across all three layers.

### Notes
- The 1 skipped jest test is the long-standing pre-existing skip (the suite's
  baseline is 296 pass / 1 skip), not a regression introduced by this spec.
- The 515 frontend `tsc` errors are pre-existing baseline noise in unrelated test
  files, as flagged in the verification brief; none touch this spec's files.

---

## 5. Acceptance Criteria & Core Invariants

**Invariant 1 — Single-source, no-drift.** ✅ Met. The scorer
(`scoreEndpointCoverage`) maps over the EXACT `GeneratedScenario[]` the loop used
for generation and reuses `selectCanonicalCapture` verbatim to decide "achieved".
A dimension can only be one generated scenario, so none can be scored that was
not generated and every generated dimension is scored. The integration test
`persists per_endpoint dimensions that match defaultScenarioSet 1:1` proves this
end-to-end against the real orchestrator.

**Invariant 2 — Auth-override scoped + leak-free.** ✅ Met.
`requestWithAuthOverride` captures the session auth, swaps the override, and
restores it in a `finally` (so even a thrown call restores). `resolveAuthOverride`
returns `null` for `session`/absent, so the normal `request` path is byte-for-byte
unchanged when no override is present. Covered by `restores session auth even when
the overridden call throws (no leak on error)` and `routes through the NORMAL
request seam ... when authMode is absent`. The tool arg and the orchestrator
probes share one definition (`authOverride.ts`, `BAD_TOKEN_VALUE`) so they cannot
drift.

**Invariant 3 — Persistence snake_case, readable off the session DTO.** ✅ Met.
`coverage_summary_json` is written on the existing completion PATCH beside
`scenarios_attempted/completed/errored`; AMS stores it as a JSONB
`Map<String,Object>` with the global SNAKE_CASE strategy and NO `@CamelCaseWire`
(verified by the DTO serialization test asserting `coverage_summary_json` present
and `coverageSummaryJson` absent). The null-guarded PATCH apply preserves an
existing summary when the key is omitted. The shape exposes `overall_score` +
per-endpoint dimensions/reasons for Spec C to consume.

**Invariant 4 — No Phase 1/2/3 regression.** ✅ Met. Full jest stays at 296 pass /
1 skip; `defaultScenarioSet`, `selectCanonicalCapture`, `GeneratedScenario`, and
`ScenarioExpectedStatus` semantics are untouched (the scorer only reads them). AMS
compiles cleanly with changeset 189 applied; existing capture-session call sites
are preserved via delegating constructors.

**Deviations from spec:** None functional. Two minor notes:
1. The verification brief suggested `mvn -pl architecture-model-service`, but AMS
   is a standalone Maven module (Spring Boot parent, no reactor), so I ran Maven
   from within the module directory — equivalent and correct.
2. The `189` SQL file documents the `not.columnExists` precondition in its header
   comment; the precondition itself lives in `db.changelog-master.yaml` (the
   Liquibase-YAML idiom), exactly mirroring how `188` is structured. This is the
   established repo pattern, not a deviation.

---

## Overall Verdict

✅ **PASS.** The Oracle Coverage Scoring spec is fully and correctly implemented
across all three layers. All acceptance criteria are met, all four core
invariants hold, and every test passes (AMS 4/4, validation-service 296 pass / 1
skip, frontend 6/6) with clean typechecks on the spec's files. The only gap is the
absence of written implementation reports under `implementation/` — a
documentation omission that does not affect correctness.
