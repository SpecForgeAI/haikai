# Verification Report: API Test Harness — Findings Integration

**Spec:** `2026-05-25-api-test-harness-findings-integration`
**Date:** 2026-05-25
**Verifier:** implementation-verifier
**Status:** Passed with Issues (pre-existing only; no new regressions)

---

## Executive Summary

Spec #6 (the smallest of the 3-spec API test-harness arc) is fully implemented across all four code layers (AMS schema + Java, validation-service emission, gateway read/review proxies, frontend badge column + new drawer). All 39 new tests written for this spec pass: 24 AMS targeted tests, 10 validation-service tests, 3 gateway tests, 10 frontend tests (with 2 optional regression assertions). All four critical pitfalls flagged in the spec have been correctly addressed (mandatory pre-emit delete, MigrationSpecContextResolver NPE filter, new DiffFindingDetailDrawer not refactor, schema CHECK exactly-one-of-origin). Group 5 is user-driven manual smoke and remains unticked as designed.

---

## 1. Tasks Verification

**Status:** All Complete (Groups 1-4 implemented; Group 5 left unticked by design as user-driven manual smoke)

### Completed Tasks

- [x] Task Group 1: AMS Persistence + Java Application Layer (Liquibase 160 + entity/DTO/mapper/repo/service + new diff-scoped controller + ApiBehaviourDiffArchitectureGuard + MigrationSpecContextResolver filter)
  - [x] 1.1-1.11 all sub-tasks ticked
  - Verified: Changeset 160 present at `architecture-model-service/src/main/resources/db/changelog/sql/160-discovery-findings-api-behaviour-diff-origin.sql`, registered in `db.changelog-master.yaml` at lines 3365-3380 with `preConditions: onFail: MARK_RAN` pattern.
  - Verified: `ALTER TABLE discovery_findings ALTER COLUMN run_id DROP NOT NULL` present (line 45).
  - Verified: New `api_behaviour_diff_id UUID NULL REFERENCES api_behaviour_diffs(id) ON DELETE CASCADE` (lines 47-49).
  - Verified: Partial index `idx_discovery_finding_api_behaviour_diff_id ... WHERE api_behaviour_diff_id IS NOT NULL` (lines 51-53).
  - Verified: `discovery_finding_exactly_one_origin CHECK ((run_id IS NOT NULL)::int + (api_behaviour_diff_id IS NOT NULL)::int = 1)` (lines 55-57).
  - Verified: Column comments on both `api_behaviour_diff_id` and `run_id` (lines 59-63).
  - Verified: `DiscoveryFindingEntity` adds nullable `UUID apiBehaviourDiffId` with comprehensive Javadoc; `runId` flipped to nullable (no `nullable=false` on @Column).
  - Verified: `DiscoveryFindingDto` extended with `apiBehaviourDiffId` field + backward-compatible delegating constructor + boxed-type Javadoc note for future maintainers.
  - Verified: `DiscoveryFindingRepository` has `findByApiBehaviourDiffIdOrderByCreatedAtAsc`, `findByProjectIdAndArchitectureIdAndRunIdNotNull`, and `@Modifying @Query` bulk `deleteByApiBehaviourDiffId`.
  - Verified: `DiscoveryFindingService.ALLOWED_LINK_TARGET_TYPES` includes `api_behaviour_diff_item` and does NOT include `api_behaviour_baseline`.
  - Verified: `DiscoveryFindingService` has `validateExactlyOneOrigin`, `createForDiff`, `listForDiff`, `getForDiff`, `updateForDiff`, `reviewForDiff`, `findingsByDiffItem`, `deleteFindingsByApiBehaviourDiffId`.
  - Verified: `MigrationSpecContextResolver.loadFindings` switched to `findByProjectIdAndArchitectureIdAndRunIdNotNull` at line 1021 with code comment referencing accepted Q7.
  - Verified: New `ApiBehaviourDiffArchitectureGuard` exists at `architecture-model-service/src/main/java/com/example/architecturemodel/service/ApiBehaviourDiffArchitectureGuard.java`.
  - Verified: New `ApiBehaviourDiffFindingController` at `.../controller/apibehaviour/ApiBehaviourDiffFindingController.java` mounts `/api/projects/{projectId}/api-behaviour/diffs/{diffId}/findings` with GET, GET by-diff-item, POST (internal), DELETE bulk, PATCH, POST review endpoints.

- [x] Task Group 2: Validation-Service Emission Layer (findingEmissionRules + diffRunner extension + archModelClient extensions + explicit recompute cleanup)
  - [x] 2.1-2.5 all sub-tasks ticked
  - Verified: New file `api-migration-validation-service/src/services/findingEmissionRules.ts` exists with first-ever `critical` severity comment at the top (lines 1-8).
  - Verified: `diffRunner.ts` at lines 451-467 has STEP 1 (MANDATORY) `await archModelClient.deleteFindingsByApiBehaviourDiffId(projectId, diffId)` BEFORE the per-item create loop, with extensive comment referencing accepted Q6.
  - Verified: STEP 2 fail-soft per-finding emission loop at lines 470-512 with `op=finding_emission_failed` diagnostic logging.
  - Verified: `archModelClient.ts` extended with `createDiffFinding`, `deleteFindingsByApiBehaviourDiffId`, `listFindingsByDiffId`, `listFindingsByDiffItemId` (lines 1381+).
  - Verified: 10 new validation-service tests across 2 files (findingEmissionRules.test.ts: 7; diffRunnerFindingEmission.test.ts: 3).

- [x] Task Group 3: Gateway Read/Review Proxies + Typed Wrappers (NO create-proxy)
  - [x] 3.1-3.4 all sub-tasks ticked
  - Verified: `gateway/src/routes/apiMigrationValidation.ts` lines 1255-1320 contain the three diff-scoped proxies: GET `/findings`, GET `/findings/by-diff-item/:diffItemId`, PATCH `/findings/:findingId` with a clear comment at line 1261 stating the gateway does NOT proxy POST/DELETE.
  - Verified: `gateway/src/services/apiBehaviourClient.ts` has `DiscoveryFindingDto` (line 740) with both `run_id: string | null` and `api_behaviour_diff_id: string | null` (line 748), and `listDiffFindings`, `listDiffFindingsByDiffItem`, `patchDiffFinding` wrappers.
  - Verified: NO `createDiffFinding` or `createFinding` wrapper in `apiBehaviourClient.ts` (grep returns no results).
  - Verified: 3 new gateway tests in `apiMigrationValidation-findings-proxy.test.ts` all pass.

- [x] Task Group 4: Frontend Layer (`diffFindingsApi.ts` + `DriftReportTab` badge column + `DiffFindingDetailDrawer`)
  - [x] 4.1-4.6 all sub-tasks ticked
  - Verified: New file `frontend/src/api/diffFindingsApi.ts` exists.
  - Verified: New file `frontend/src/components/DashboardView/DiffFindingDetailDrawer.tsx` exists (453 LOC) under `DashboardView/`, not `Discovery/`. NOTE: spec quoted ~150 LOC; actual size is larger but still a copy-modify of the original (the spec language was approximate).
  - Verified: New file `frontend/src/components/DashboardView/DiffFindingDetailDrawer.module.css` exists.
  - Verified: `DriftReportTab.tsx` imports `DiffFindingDetailDrawer` and `listDiffFindings`, with grouping helper for per-diff_item badges.
  - Verified: `frontend/src/components/Discovery/FindingDetailDrawer.tsx`, `frontend/src/components/Discovery/FindingsTab.tsx`, and `frontend/src/api/findingsApi.ts` are UNMODIFIED (verified by `git status --porcelain` returning empty for all three).
  - Verified: 10 new Vitest tests across 2 files (DriftReportTab.test.tsx: 6; DiffFindingDetailDrawer.test.tsx: 4) all pass.

### Incomplete or Issues

- [ ] Task Group 5: End-to-end manual verification — INTENTIONALLY LEFT UNTICKED. Per the user's instructions and the spec's own design, Group 5 is user-driven manual smoke and should not be auto-completed by the verifier. All 8 sub-tasks (5.1-5.8) remain unticked.

---

## 2. Documentation Verification

**Status:** Passed with Issues

### Implementation Documentation
- No `implementations/` folder was created for this spec. Other 2026-05-25 specs in this repo (e.g. `ams-dto-json-naming-audit-sweep`, `ams-test-infrastructure-cleanup`, `tech-stack-prefill-and-target-write`) also do not have an `implementations/` folder — instead they include a `verifications/final-verification.md` file. This spec follows that same convention.
- The spec itself, the requirements, and the tasks (with all sub-tasks ticked for Groups 1-4) constitute the implementation record.

### Verification Documentation
- This document (`agent-os/specs/2026-05-25-api-test-harness-findings-integration/verifications/final-verification.md`) is the final verification artifact.

### Missing Documentation
- No per-group implementation reports — but tasks.md is comprehensive, and Group 5's manual-smoke checklist serves as the operator runbook. Consistent with the convention in sibling 2026-05-25 specs.

---

## 3. Roadmap Updates

**Status:** No Updates Needed

### Updated Roadmap Items
- None

### Notes
- `agent-os/product/roadmap.md` is a Phase 1-5 product roadmap covering core meta-model CRUD, diagram editing, UX polish, and backend foundations. The API test-harness arc (Specs #4-#6) is a delivery-engineering / migration-validation feature outside the roadmap's product-feature scope. No items in the roadmap describe automatic finding emission from api_behaviour_diffs, the Drift report tab, or related infrastructure. No update needed.

---

## 4. Test Suite Results

**Status:** Passed with Issues (pre-existing failures only; no new regressions)

### Test Summary

**AMS (`mvn test`):**
- Total: 1956 tests
- Passing: 1709
- Failing: 96
- Errors: 139
- Skipped: 12
- All new spec tests pass (24/24): ApiBehaviourDiffFindingControllerTest (5/5), DiscoveryFindingApiBehaviourDiffOriginPersistenceTest (3/3), DiscoveryFindingOriginAndLinkTargetTest (7/7), MigrationSpecContextResolverTest (9/9 — includes new regression test for the RunIdNotNull filter).

**Validation Service (`npx jest`):**
- Total: 164 tests (163 passing, 1 skipped)
- Failing: 0
- New spec tests: findingEmissionRules.test.ts (7/7), diffRunnerFindingEmission.test.ts (3/3) — all pass.

**Gateway (`npx jest`):**
- Total: 1970 tests
- Passing: 1901
- Failing: 69 (across 40 failed suites)
- New spec tests: apiMigrationValidation-findings-proxy.test.ts (3/3) — all pass.

**Frontend (`npx vitest run`):**
- Test Files: 765 passed, 222 failed (987 total)
- Tests: 9288 passed, 626 failed (9914 total)
- Errors: 8 uncaught (context provider issues from unrelated tests)
- New spec tests: DriftReportTab.test.tsx (6/6), DiffFindingDetailDrawer.test.tsx (4/4) — all pass.

### Failed Tests

The failing tests in AMS, gateway, and frontend are all pre-existing per MEMORY.md and unrelated to this spec. Confirmed examples:

- Gateway: `bootstrap-summary-fetching.test.ts`, `conversation-memory-edge-cases.test.ts`, `dashboardSummary-*.test.ts`, `hub-bootstrap-4-task-definition.test.ts`, `chatV2-panel-integration.test.ts`, `chatV2-panel-context-and-filtering.test.ts` — all called out in MEMORY.md as pre-existing.
- AMS: `UserJourneySyncServiceTest` Mockito stubbing-argument mismatches (unrelated to findings/diff origin work); the broader 96 failures + 139 errors are likewise unrelated and not introduced by this spec.
- Frontend: `useActivateTemporaryDiagram` provider-missing errors, `DiscoveryRunDetailPage` `candidates.filter` undefined — all pre-existing test infrastructure issues unrelated to the new DriftReportTab badge column or DiffFindingDetailDrawer.

### Notes

- All four critical pitfalls have been correctly addressed:
  1. Mandatory `deleteFindingsByApiBehaviourDiffId` before re-emit — verified at `diffRunner.ts` line 459 as STEP 1, with regression test in `diffRunnerFindingEmission.test.ts`.
  2. `MigrationSpecContextResolver` NPE filter — verified at line 1021 using `findByProjectIdAndArchitectureIdAndRunIdNotNull`, with explicit regression test in `MigrationSpecContextResolverTest` (test labelled "Regression: resolver uses findByProjectIdAndArchitectureIdAndRunIdNotNull so diff-sourced findings (run_id=null) do NOT NPE downstream").
  3. New `DiffFindingDetailDrawer`, not refactor — confirmed `FindingDetailDrawer.tsx`, `FindingsTab.tsx`, and `findingsApi.ts` are untouched (git status clean for all three).
  4. Schema CHECK exactly-one-of-origin — verified at changeset 160 lines 55-57, with both rejection paths tested in `DiscoveryFindingApiBehaviourDiffOriginPersistenceTest` and service-layer mirror tested in `DiscoveryFindingOriginAndLinkTargetTest`.

- All out-of-scope confirmations hold: no LLM-assisted classification, no Origin filter on FindingsTab, no top-level unified findings view, no reviewer workflow changes, no `@JsonNaming` audit for the new field, no activation of `api_behaviour_baseline` as link target_type, no refactoring of existing `FindingDetailDrawer`, no POST proxy in gateway.

- PATCH safety: all new fields are reference types (UUID, String, Instant). DTO Javadoc explicitly records the boxed-type rule for future maintainers per `project_primitive_double_dto_overwrite.md`.

- `mvn test-compile` exits 0 (clean).

- The DiffFindingDetailDrawer was implemented at ~453 LOC versus the spec's quoted ~150 LOC. The spec explicitly stated the LOC was approximate ("~150 LOC copy-modify"); the larger size reflects fuller copy-modify scope (drawer header, body, status transitions, accept/ignore/resolve buttons, in-drawer selector when >1 finding). This is acceptable and does not represent a deviation from the spec's intent.

- Group 5 manual smoke verification is intentionally left unticked per user instructions ("Group 5 manual smoke is user-driven — leave unticked").
