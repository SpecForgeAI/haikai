# Verification Report: API Behaviour Capture Fixes

**Spec:** `2026-05-16-api-behaviour-capture-fixes`
**Date:** 2026-05-16
**Verifier:** implementation-verifier
**Status:** Passed with Notes

---

## Executive Summary

All three real bugs identified during shaping are fixed in code (combined mutating gate, run-manager-driven attempt counter, auto-persist of every HTTP attempt), and all 21 spec-specific tests pass under a clean `jest` run with a clean `tsc --noEmit`.

**Post-verification follow-up (2026-05-16):** Note #1 (stale predecessor test `captureLoopRunner.test.ts` → `rejects mutating verbs when mutating_calls_confirmed=false`) was resolved after the initial verification: the test fixture was updated to force `safe_to_execute=false` so the new combined gate actually rejects, the expected reason string was aligned to `operation_not_executable`, and a `runManager.start/end` lifecycle was wrapped around the assertion to satisfy the new run-manager-driven counter. The guardrail intent (mutating POST blocked when unconfirmed) is preserved. Full `captureLoopRunner.test.ts` now passes 7/7. Note #2 (narrative "Loop-level cancellation diagnostic" section in spec.md) remains unimplemented and deferred — it was never broken out into a task and is left for a follow-up commit if the user wants it.

---

## 1. Tasks Verification

**Status:** All Complete (per tasks.md checkboxes; spot-checked against code)

### Completed Tasks
- [x] Task Group 1: Per-scenario HTTP attempt counter on `runManager` + config-driven cap
  - [x] 1.1-1.5 (tests, RunState field, `incrementHttpAttempts`, `LLM_HTTP_ATTEMPTS_PER_SCENARIO`, focused test run)
- [x] Task Group 2: Capture auto-persist + mutating-guard fix + attempt-counter wiring
  - [x] 2.1-2.9 (tests, config constant import, attempt counter wiring, combined gate, retry-budget enforcement, auto-persist, orchestrator cleanup, retryCount deprecation, focused test run)
- [x] Task Group 3: Full session-to-baseline end-to-end test (`captureSessionFullFlow.e2e.test.ts`)
  - [x] 3.1-3.6 (5 cases; local Express stub on 127.0.0.1:0; faked `gatewayClient` + in-memory AMS fake)
- [x] Task Group 4: Lean gap review (3 additional gap-fill tests added in `executeHttpRequestGapFill.test.ts`)
  - [x] 4.1-4.4

### Incomplete or Issues
- None at the task level. Tasks.md checkboxes accurately reflect what was built.

---

## 2. Documentation Verification

**Status:** Issues Found (missing per-group implementation reports)

### Implementation Documentation
- `agent-os/specs/2026-05-16-api-behaviour-capture-fixes/implementation/` exists but is **empty**. No per-task-group implementation reports were filed. JSDoc blocks on the touched source files (`execute_http_request.ts`, `runManager.ts`, `config.ts`, `captureSessionOrchestrator.ts`, `toolTypes.ts`) DO reference this spec explicitly, so the change rationale is at least captured in-code.

### Verification Documentation
- This report: `verifications/final-verification.md` (new).

### Missing Documentation
- Per-group implementation reports under `implementation/` (4 expected, 0 present).
- No formal sub-task-completion verifications. The acceptance criteria for each group were verified here against code rather than against pre-existing per-group verification docs.

---

## 3. Roadmap Updates

**Status:** No Updates Needed

### Updated Roadmap Items
- None.

### Notes
`agent-os/product/roadmap.md` is a phased meta-model + diagram + persistence roadmap (frontend + Spring Boot CRUD) and does not include items for the `api-migration-validation-service` capture pipeline. No matching roadmap item to tick.

---

## 4. Test Suite Results

**Status:** Passed with Issues (1 stale test failure introduced by this spec; not a behaviour regression)

### Spec-Specific Tests (21 total, claimed)

Run: `npx jest --testPathPattern="(runManagerHttpAttempts|configHttpAttempts|executeHttpRequestRewrite|executeHttpRequestGapFill|captureSessionFullFlow)"`

- **Total:** 21
- **Passing:** 21
- **Failing:** 0

Breakdown (`it(` count per file):
- `runManagerHttpAttempts.test.ts`: 4
- `configHttpAttempts.test.ts`: 2
- `executeHttpRequestRewrite.test.ts`: 7
- `executeHttpRequestGapFill.test.ts`: 3 (Group 4 lean gap-fill)
- `captureSessionFullFlow.e2e.test.ts`: 5

### Full `api-migration-validation-service` Suite

Run: `npx jest`

- **Test Suites:** 16 total / 15 passed / 1 failed
- **Tests:** 58 total / 57 passed / 1 failed
- **Errors:** 0

### Failed Tests

1. `src/__tests__/captureLoopRunner.test.ts` -> `execute_http_request -- mutating verb gating > rejects mutating verbs when mutating_calls_confirmed=false`
   - **Cause:** Stale test from predecessor spec (`2026-05-15-api-behaviour-baseline-capture-service`). Two stale assumptions:
     - Expects `reason: 'mutating_not_confirmed'`, which this spec renamed to `operation_not_executable` (D5-aligned gate consolidation).
     - Builds a `ToolExecutionContext` and invokes the handler directly without calling `runManager.start(...)` first; the handler now increments `runManager.scenarioHttpAttempts` at the top, which throws `runManager: no live run for session session-1` before reaching the gate. Hence the observed failure is the run-manager throw, not the gate throw.
   - **Behavioural check:** The test setup itself (`safe_to_execute: true` AND `mutatingCallsConfirmed: false` for a POST) is the case the new combined gate is INTENDED to allow (`included AND (safe_to_execute OR mutatingCallsConfirmed)`). The test's intent ("block mutating verbs when not confirmed") is obsolete under the corrected gate semantics. Group 2 sub-task 2.4 should arguably have updated or deleted this test as part of the gate-rename cleanup; it was missed.
   - **CLAUDE.md pre-existing-fail list:** This test is NOT in the pre-existing-fail list. It was working before this spec and was silently broken by it.

### Notes

- `npx tsc --noEmit` in `api-migration-validation-service/` is clean (no output / exit 0).
- All five `captureSessionFullFlow.e2e.test.ts` cases exercised the real Express stub on `127.0.0.1:0` and pass: attempt-number sequence + scenario reset, 500 row, socket-close row with `response_status=null` + populated `error_type`/`error_message`, baseline round-trip, and the mutating-confirmation flow.
- None of the pre-existing broken tests listed in CLAUDE.md memory (in `gateway/` and `frontend/`) live in `api-migration-validation-service/`; nothing in the pre-existing list was touched.

---

## 5. Per-Acceptance-Criterion Verification

### Group 1: Run Manager + Config Plumbing
- **AC: counter resets on `beginScenario` and increments via `incrementHttpAttempts`** -> PASS. Verified in `runManager.ts:83-89,106-111` and in `runManagerHttpAttempts.test.ts` (4 cases pass).
- **AC: `LLM_HTTP_ATTEMPTS_PER_SCENARIO` defaults to 3 and respects env override** -> PASS. Verified in `config.ts:83-84` and in `configHttpAttempts.test.ts` (2 cases pass).
- **AC: No edits to `execute_http_request.ts` or `captureSessionOrchestrator.ts` in Group 1** -> Not directly verifiable post-hoc but JSDoc and code shape are consistent with sequential implementation.

### Group 2: `execute_http_request` Rewrite
- **AC: every attempt (2xx, non-2xx, transport failure) persists exactly one capture row** -> PASS. Verified via the unconditional `archModelClient.createCapture` call at `execute_http_request.ts:214-242` (single call path, no early-return branches skip it) and via tests in `executeHttpRequestRewrite.test.ts` for all three outcomes.
- **AC: transport/auth failure rows have `response_status = null` + populated `error_type`/`error_message`** -> PASS. Verified at `execute_http_request.ts:177-181, 225-232` and in the e2e socket-close case.
- **AC: combined gate honours `mutatingCallsConfirmed` (third gate no longer dead code)** -> PASS. Verified at `execute_http_request.ts:98-109` (`if (!safeToExecute && !mutatingConfirmed) throw ...`) and in the e2e mutating-confirmation case.
- **AC: `attempt_number` reflects the per-scenario `runManager` counter, not removed `ctx.retryCount`** -> PASS. Verified at `execute_http_request.ts:73, 218`; `captureSessionOrchestrator.ts:211-218` no longer spreads `retryCount`.
- **AC: exceeding `LLM_HTTP_ATTEMPTS_PER_SCENARIO` emits `retry_exhausted` diagnostic + throws `ToolValidationError`** -> PASS. Verified at `execute_http_request.ts:113-146` (diagnostic write inside try/catch, then unconditional throw with reason `retry_budget_exhausted`) and in `executeHttpRequestRewrite.test.ts`.
- **AC: `createCapture` failures rethrow (no silent swallow)** -> PASS. Verified at `execute_http_request.ts:243-252` (`console.error` then `throw err`) and in `executeHttpRequestRewrite.test.ts`.
- **AC: orchestrator compiles cleanly under chosen `retryCount` option** -> PASS. `tsc --noEmit` clean; chose option (a) — kept `retryCount?: number` on `ToolExecutionContext` with `@deprecated` JSDoc (toolTypes.ts:72-80).

### Group 3: Full Session-to-Baseline E2E
- **AC: attempt-counter sequence 1,2,3 within scenario + reset at boundary** -> PASS.
- **AC: 500 path produces `response_status=500` row** -> PASS.
- **AC: socket-close path produces row with `response_status=null` + populated `error_type`/`error_message`** -> PASS.
- **AC: accept-one-capture + save-baseline round-trips with matching item count + snapshot** -> PASS.
- **AC: mutating-confirmation flow blocks POST when false, succeeds when true** -> PASS.

### Group 4: Lean Gap Review
- **AC: ≤10 additional tests added; demonstrably covers spec's four gaps; pre-existing broken tests untouched** -> PASS (3 added in `executeHttpRequestGapFill.test.ts`).

### Spec Section "Loop-level cancellation diagnostic" (no matching task)
- **Spec text (lines 41-44):** Asks for a `cancelled` diagnostic + new `LoopOutcomeReason = 'cancelled'` in `captureLoopRunner.ts`.
- **Status:** NOT IMPLEMENTED. `grep -n "cancelled" captureLoopRunner.ts` returns nothing. This section was in spec.md but was not broken out as a task in tasks.md (Groups 1-4 cover counter, handler, e2e, gap review only). Not flagged in any group's acceptance criteria; arguably out-of-scope-as-built. Noting for completeness — not a blocker.

---

## 6. Per-Decision Verification (D1-D7)

- **D1. Keep `record_scenario_candidate` untouched** -> PASS. File `src/services/tools/record_scenario_candidate.ts` exists; `src/services/tools/index.ts` still registers it.
- **D2. Transport/auth failures persist a capture row (no diagnostic); loop-level failures emit diagnostics** -> PASS. Capture-row branch in `execute_http_request.ts:177-181, 225-232`. The `retry_exhausted` diagnostic is the only loop-level diagnostic added here.
- **D3. Per-scenario attempt counter, reset per scenario, default cap 3** -> PASS. Reset in `runManager.beginScenario` (line 87); cap from `LLM_HTTP_ATTEMPTS_PER_SCENARIO` default `3`.
- **D4. Counter lives in `runManager.scenarioHttpAttempts`; incremented at TOP of `execute_http_request`** -> PASS. Field at `runManager.ts:38`; increment at `execute_http_request.ts:73` (first line of handler body after arg validation, before any gate check).
- **D5. Spec stays tightly scoped (no `record_scenario_candidate` / UI / AMS schema / gateway / OAS parser / DB adapter / baseline-creation changes)** -> PASS (see Section 7).
- **D6. New e2e file `captureSessionFullFlow.e2e.test.ts` next to existing orchestrator e2e, local Express stub** -> PASS. File exists at the prescribed location with 5 cases.
- **D7. Lift cap from module constant to `config.ts` env var** -> PASS. `LLM_HTTP_ATTEMPTS_PER_SCENARIO` in `config.ts:83-84`; imported and used in `execute_http_request.ts:6, 113, 125, 128, 145`. No `MAX_RETRIES_PER_SCENARIO` constant remains in `execute_http_request.ts`.

---

## 7. Per-Out-of-Scope-Item Verification

Cross-check that no code outside the agreed scope was modified for this spec:

- **No UI (frontend)** -> Not touched by this spec. Working-tree `frontend/` modifications relate to other unrelated specs (architecture/selective-copy/manage-architectures), not this one.
- **No AMS Java service / schema / Liquibase / controllers / services / repositories** -> Not touched. Working-tree AMS modifications relate to other unrelated specs (selective-copy, architecture-element-mappings, api-behaviour scaffolding from the predecessor spec). No new Liquibase changesets added by this spec.
- **No gateway routes / proxy logic / tests** -> Not touched by this spec.
- **No OAS parser / OAS inventory store** -> `oasParser.ts` and `oasInventoryStore.ts` not modified by this spec.
- **No DB adapter changes (Postgres / Sybase / sqlGuard / sampling tools)** -> `db/` directory not modified by this spec.
- **No baseline creation logic / snapshot shape / baseline review UI** -> Baseline endpoints in `archModelClient.ts` were called by the new e2e test fake but not changed.
- **No `record_scenario_candidate` changes** -> File unchanged.
- **No cross-stack e2e rig** -> Group 3 e2e fakes AMS + LLM at client boundaries; only the target API is real (Express stub on `127.0.0.1:0`), matching D6.

---

## 8. Final Verdict

**PASS WITH NOTES**

- All 21 spec-specific tests pass; `tsc --noEmit` clean; all three real bugs fixed in code; D1-D7 honoured; out-of-scope surfaces untouched.
- One stale test (`captureLoopRunner.test.ts` mutating-verb-gating case) now fails because its assumptions are obsolete under the corrected gate + counter wiring. Group 2 sub-task 2.4 should have updated/removed it. Not a behaviour regression; ≤10-line follow-up to rename the reason assertion and add `runManager.start(...)` setup (or delete the test as redundant with `executeHttpRequestRewrite.test.ts`).
- The narrative "Loop-level cancellation diagnostic" section in spec.md (lines 41-44) was not broken out into Task Groups 1-4 and is NOT implemented in `captureLoopRunner.ts`. Either out-of-scope-as-built or a missed follow-up; flagged for product call.
- Per-task implementation reports under `implementation/` are absent; in-code JSDoc references partially compensate.
