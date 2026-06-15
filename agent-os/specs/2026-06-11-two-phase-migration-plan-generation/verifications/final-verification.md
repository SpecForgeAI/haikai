# Verification Report: Two-Phase Migration Delivery Plan Generation (Skeleton → Expand)

**Spec:** `2026-06-11-two-phase-migration-plan-generation`
**Date:** 2026-06-11
**Verifier:** implementation-verifier
**Status:** ✅ Passed

---

## Executive Summary

All 6 task groups (40 sub-tasks) are complete and verified. The full spec test surface is green across all three stacks — gateway Jest 52/52, AMS JUnit 28/28, frontend Vitest 69/69 — with a clean gateway `tsc` and no NEW frontend `tsc` errors attributable to this spec. Code spot-checks confirm every settled requirement: one shared env-tunable concurrency pool gates ALL generation LLM calls, zero Liquibase changes from this spec, expansion state rides inside `book_of_work_json`, unverified stamped content can never land (the only story-carrying append is the post-verification success path), and the legacy no-streams combined path is unchanged (regression-guard test green).

Browser-based verification was unavailable (services not running); verification was performed via the automated test suites plus direct code inspection.

---

## 1. Tasks Verification

**Status:** ✅ All Complete

### Completed Tasks
- [x] Task Group 1: Bounded-concurrency LLM pool + env config knobs (1.1–1.5)
  - `gateway/src/services/llmConcurrencyPool.ts` — generic `run<T>()` pool; ONE shared instance via `getMigrationPlanLlmPool()` sized from config.
  - `gateway/src/config.ts:307-308` — `migrationPlanLlmConcurrency` (default 4) and `migrationPlanExpansionBatchSize` (default 12) via `parseIntEnv`, documented in config comments.
  - Per-stream phase-1 calls routed through the pool (`migrationBookOfWorkHandler.ts:793,815`), no bare `Promise.all` over LLM calls.
- [x] Task Group 2: AMS atomic items/append + expansion-state merge endpoint (2.1–2.5)
  - `GeneratedMigrationBookOfWorkController.java:207` — `@PostMapping("/{bookId}/items/append")`.
  - `GeneratedMigrationBookOfWorkService.appendItems` (line 796) — single `@Transactional` server-side merge into `bookOfWorkJson`; sets `expansionState` on the epic item inside the JSON; validates expansion-state vocabulary, unknown epic → 400, non-draft → 400.
  - New DTO `AppendGeneratedMigrationBookOfWorkItemsRequest.java`; new test class `GeneratedMigrationBookOfWorkAppendItemsTest.java`.
- [x] Task Group 3: Skeleton-scoped prompts, draft persistence, expansion-state seeding (3.1–3.5)
  - Skeleton-mode prompt section; every epic seeded `not_expanded` in the persisted draft; shared shape defined once in `generatedMigrationBookOfWorkSchema.ts` (`MIGRATION_BOOK_OF_WORK_EXPANSION_STATES`, optional `expansionState` on items, validator accepts story-less skeletons).
  - Legacy no-streams path regression-guarded by test: "legacy no-streams path — still ONE full combined call with NO skeleton instruction and stories intact".
- [x] Task Group 4: Inventory batching, template stamping, 4-layer verification, atomic append, expansion routes (4.1–4.9)
  - `gateway/src/services/migrationBookOfWorkExpansionHandler.ts` — per-epic state machine, deterministic batching, stamping with `provenance:stamped`/`provenance:generated`, layers 1–3 implemented + layer 4 cited in comments.
  - Routes in `gateway/src/routes/migrationBookOfWork.ts`: `epics/:epicId/expand`, `expand-all`, `items/append` proxy, with the file's existing error-mapping conventions.
- [x] Task Group 5: Frontend expand controls, badges, partial-save warning, wizard/progress/draft-list copy (5.1–5.9)
  - `migrationDeliveryPlanApi.ts` expand functions + typed outcomes (`ExpandMigrationBookOfWorkEpicOutcome`, `ExpandAllMigrationBookOfWorkEpicsOutcome`); review-workspace expand controls; per-epic badges with retry; non-blocking partial-save warning; wizard/overlay/DraftSummary/draft-list copy.
- [x] Task Group 6: Test Review & Gap Analysis (6.1–6.4)
  - Feature test surface totals 149 tests across the three stacks (see Section 4), within and beyond the group-level minimums.

### Incomplete or Issues
None — all checkboxes in `tasks.md` were already marked complete and implementation evidence was found in code for every group.

---

## 2. Documentation Verification

**Status:** ⚠️ Issues Found (non-blocking)

### Implementation Documentation
- The spec folder contains `spec.md`, `tasks.md`, `planning/raw-idea.md`, and `planning/requirements.md` only.
- There is NO `implementations/` folder and no per-task-group implementation reports.

### Verification Documentation
- No prior area-verifier reports exist; this final verification is the first report in `verifications/`.

### Missing Documentation
- Per-group implementation reports (`implementations/1-…` through `implementations/6-…`) were not produced. Task completion was instead verified directly against the code and the passing test surface, so this is a documentation gap only, not an implementation gap.

---

## 3. Roadmap Updates

**Status:** ⚠️ No Updates Needed

### Updated Roadmap Items
None.

### Notes
`agent-os/product/roadmap.md` covers the early product phases (meta-model CRUD, diagram rendering/editing, UX polish) and contains no items for migration delivery plan generation. No roadmap item matches this spec, so no checkbox updates were made.

---

## 4. Test Suite Results

**Status:** ✅ All Passing (spec test surface)

Per the verification instructions for this spec, the run was scoped to the spec's defined test surface (not the whole-repo suites of all three services).

### Test Summary
- **Total Tests:** 149
- **Passing:** 149
- **Failing:** 0
- **Errors:** 0

| Stack | Command | Result |
|---|---|---|
| Gateway types | `npx tsc --noEmit` | Clean (exit 0) |
| Gateway Jest | `npx jest migrationBookOfWork llmConcurrencyPool generatedMigrationBookOfWorkSchema` | 5 suites, 52/52 pass (`migrationBookOfWorkHandler`, `migrationBookOfWorkExpansion`, `migrationBookOfWorkRoute`, `generatedMigrationBookOfWorkSchema`, `llmConcurrencyPool`) |
| AMS JUnit | `mvn test -Dtest='GeneratedMigrationBookOfWork*'` | 28/28 pass, BUILD SUCCESS |
| Frontend Vitest | `npx vitest run src/components/ProductManager/MigrationDeliveryPlan src/api/__tests__/migrationDeliveryPlanApi.errorParsing.test.ts` | 7 files, 69/69 pass |

### Failed Tests
None — all tests passing.

### Frontend `tsc` note
Frontend `npx tsc --noEmit` reports three errors touching spec-surface test files; all are PRE-EXISTING harness issues, not regressions from this spec:
- `MigrationDeliveryPlanReviewWorkspace.test.tsx(18,1)` and `MigrationDeliveryPlanSaveToBacklogAndDraftList.test.tsx(21,1)` — TS6133 unused `React` import; the identical import lines exist in the HEAD versions of both files (pre-existing harness pattern).
- `migrationDeliveryPlanApi.errorParsing.test.ts(28,17)` — TS2352 harness cast; this spec's edits to `migrationDeliveryPlanApi.ts` only ADDED new expand interfaces/functions and did not touch `GenerateMigrationDeliveryPlanRequest`, so the cast error is independent of this spec (known pre-existing api-test harness error). The file's 3 runtime tests pass under Vitest.

Net-zero NEW frontend `tsc` errors from spec-touched changes — the acceptance bar is met.

---

## 5. Critical Settled-Requirement Spot-Checks (code inspection)

**Status:** ✅ All Verified

1. **`MIGRATION_PLAN_LLM_CONCURRENCY` gates ALL generation LLM calls.**
   - Knobs read via `parseIntEnv` with defaults 4 / 12 (`gateway/src/config.ts:307-308`); tunable to 1 with env change alone.
   - ONE shared pool singleton (`getMigrationPlanLlmPool()` in `llmConcurrencyPool.ts`).
   - Phase 1: per-stream skeleton calls submit via `llmPool.run` (`migrationBookOfWorkHandler.ts:815`).
   - Phase 2: every LLM call funnels through the single `callWithRetry` helper (`migrationBookOfWorkExpansionHandler.ts:865-904`, pool submission at line 875), used by all four call sites — batch expansion (line 944), non-inventory whole-epic (line 980), judge verdict (line 1091), and bespoke rewrites (line 1120). No other raw `callLlm` call sites exist in the expansion handler.
   - Limit-1 serial behaviour pinned by the passing test "skeleton calls run through the shared bounded pool — with a limit-1 pool the per-stream calls execute fully serially".

2. **NO Liquibase changes from this spec.**
   - This spec's AMS footprint is controller/service/repository/DTO/test files only; `GeneratedMigrationBookOfWorkEntity.java` is unmodified in the working tree (no new columns, no new `chk_gmbw_status` values).
   - The only Liquibase change in the working tree (changeset `171-capture-session-scenario-counts.sql` + master-changelog entry) belongs to a SEPARATE capture-session fix on `api_behaviour_capture_sessions` and touches nothing in the migration-books-of-work surface.

3. **Expansion state rides inside `book_of_work_json`.**
   - Single shared shape defined once in `generatedMigrationBookOfWorkSchema.ts` (`expansionState` field on epic items, vocabulary `not_expanded | expanding | expanded | failed`); AMS `appendItems` merges `epic.put("expansionState", …)` into the stored JSON server-side within one `@Transactional` boundary; frontend types mirror the same shape.

4. **Unverified stamped content can never land.**
   - The ONLY story-carrying append is the success path, reached strictly after item-schema validation + merged `validateBookOfWorkHierarchy` + all verification layers; any pipeline failure (batch/judge/bespoke-rewrite after one retry) is caught and persisted as a state-only `expansion_state='failed'` merge with `storiesAppended: 0` (`migrationBookOfWorkExpansionHandler.ts:1255-1314`). A failed epic leaves every other epic's stories intact (per-epic merge).

5. **Legacy no-streams combined path unchanged.**
   - Regression-guard test green: "legacy no-streams path — still ONE full combined call with NO skeleton instruction and stories intact"; the original single-call invariant test ("the handler invokes the LLM exactly once") also still passes.

6. **Expand-all skip semantics.** `expanded` epics are skipped as terminal, fresh `expanding` is skipped as in-flight, stale `expanding` and `failed` are expandable (`migrationBookOfWorkExpansionHandler.ts:269-284`); routes for expand-one / expand-all / append-proxy exist with the existing error-mapping conventions (`gateway/src/routes/migrationBookOfWork.ts`).

---

## Verification Method Note

Services were not running during verification, so browser-based end-to-end checks were not performed. Verification relied on the three automated test stacks (all green at the mocked-LLM level, including the skeleton → expand → retry → partial-save workflows) plus direct code inspection of every settled requirement listed above.
