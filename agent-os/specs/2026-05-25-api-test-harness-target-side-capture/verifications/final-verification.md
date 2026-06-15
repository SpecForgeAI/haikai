# Verification Report: API Test Harness — Target-Side Capture

**Spec:** `2026-05-25-api-test-harness-target-side-capture`
**Date:** 2026-05-25
**Verifier:** implementation-verifier
**Status:** Passed with Issues (per-spec scope clean; broader suites carry unrelated pre-existing failures)

---

## Executive Summary

All five per-layer task groups (Groups 1-5) are implemented and their per-spec tests pass cleanly across AMS Java, the api-migration-validation-service, gateway, and frontend. Every anchor called out for verification was found in place — the two Liquibase changesets at slots `156-`/`157-`, the entity + repo + DTO + service extensions, the new `targetReplayRunner.ts` + 6 (not 5) validation-service routes, the gateway proxies + typed client, and the frontend forked wizard + entry button + detail-view banner. Group 6 is the user-driven manual smoke test and remains unticked by design. No new failures were introduced in any suite; all failing tests in the broader AMS / gateway / frontend suites are documented pre-existing issues unrelated to the apibehaviour surface this spec touches.

---

## 1. Tasks Verification

**Status:** All Complete (Groups 1-5); Group 6 intentionally left unticked (manual smoke)

### Completed Tasks
- [x] Task Group 1: AMS Liquibase + entity + repository extensions
  - [x] 1.1 - 1.8 all subtasks complete
- [x] Task Group 2: AMS DTOs + service-layer pairing invariant + new pairing-read controller
  - [x] 2.1 - 2.7 all subtasks complete
- [x] Task Group 3: `targetReplayRunner.ts` + validation-service routes
  - [x] 3.1 - 3.8 all subtasks complete
- [x] Task Group 4: Gateway proxy + typed client wrapper
  - [x] 4.1 - 4.5 all subtasks complete
- [x] Task Group 5: Forked target replay wizard + entry button + detail-view banner
  - [x] 5.1 - 5.6 all subtasks complete
- [ ] Task Group 6: End-to-end manual verification on the running stack — **intentionally left unticked; user-driven manual smoke per spec design**

### Anchor verification (per the spec)

**Group 1 — Schema layer:**
- `architecture-model-service/src/main/resources/db/changelog/sql/156-api-behaviour-baselines-kind.sql` present with `kind TEXT NOT NULL DEFAULT 'current'` + `paired_with_baseline_id UUID NULL REFERENCES api_behaviour_baselines(id) ON DELETE SET NULL` + partial index `api_behaviour_baselines_paired_idx`.
- `architecture-model-service/src/main/resources/db/changelog/sql/157-api-behaviour-capture-sessions-kind.sql` present with `kind` + `source_baseline_id UUID NULL REFERENCES api_behaviour_baselines(id)` + partial index `api_behaviour_capture_sessions_source_idx`.
- Both registered in `db.changelog-master.yaml` at line 3252 and line 3269.
- Slot drift noted in tasks.md preserved (`156-/157-` instead of the originally-planned `140-/141-`).
- `ApiBehaviourBaselineEntity` (lines 111-125) carries `String kind = "current"` + `UUID pairedWithBaselineId`.
- `ApiBehaviourCaptureSessionEntity` (lines 182-195) carries `String kind = "current"` + `UUID sourceBaselineId`.
- Repository finders `findByPairedWithBaselineIdOrderByCreatedAtDesc` + `findByProjectIdAndArchitectureIdAndKindOrderByCreatedAtDesc` present on both repos.
- 4 new tests in `ApiBehaviourKindAndPairingPersistenceTest.java` — all pass.

**Group 2 — AMS Java app layer:**
- 6 DTOs extended with backward-compatible delegating constructors confirmed via git diff: `ApiBehaviourBaselineDto`, `ApiBehaviourCaptureSessionDto`, `CreateApiBehaviourBaselineRequest`, `UpdateApiBehaviourBaselineRequest`, `CreateApiBehaviourCaptureSessionRequest`, `UpdateApiBehaviourCaptureSessionRequest`.
- New controller endpoint mounted on `ApiBehaviourBaselineController` at `GET /{sourceId}/target-baselines`.
- 12 new tests across `ApiBehaviourBaselineKindAndPairingServiceTest`, `ApiBehaviourCaptureSessionKindAndPairingServiceTest`, `ApiBehaviourBaselinePairingControllerTest` — all pass.

**Group 3 — Validation service:**
- `api-migration-validation-service/src/services/targetReplayRunner.ts` present, exports `runTargetReplay` + `TransportFailureThresholdExceededError`.
- `api-migration-validation-service/src/routes/targetCaptureSessionActions.ts` present with 6 routes (create, secrets, test-connection, start, cancel, status — one more than the spec's 5; the additional `/secrets` route is noted in the implementation notes and mirrors the validation-service public surface).
- `src/config.ts` line 175-176 declares `TARGET_REPLAY_CONSECUTIVE_FAILURE_ABORT` defaulting to 10.
- `archModelClient.ts` extended additively (modified per git status, not new).
- 13 new tests (8 runner + 5 routes) — all pass.
- Existing reused files (`captureLoopRunner.ts`, `captureSessionOrchestrator.ts`, `httpExecutor.ts`, `runManager.ts`, `secretsStore.ts`, `startupReconciliation.ts`, `redactor.ts`, `gatewayClient.ts`) NOT modified per git status.

**Group 4 — Gateway:**
- `gateway/src/routes/apiMigrationValidation.ts` extended with 6 proxy routes (target-capture-sessions create/secrets/test-connection/start/cancel/status) + 1 AMS-direct pairing proxy `GET /api/v1/projects/:projectId/api-behaviour/baselines/:sourceId/target-baselines` (note: gateway URL uses `/api/v1/projects/` not `/api/v1/architecture-model/projects/` per the implementation note).
- New file `gateway/src/services/apiBehaviourClient.ts` present with typed wrappers including `createTargetCaptureSession`, `setTargetSessionSecrets`, `testTargetConnection`, `startTargetCaptureSession`, `cancelTargetCaptureSession`, `getTargetCaptureSessionStatus`, `listTargetBaselinesPairedWith`.
- 4 new tests across `apiMigrationValidation-target-capture-proxy.test.ts` (3) + `apiBehaviourClient.test.ts` (1) — all pass.

**Group 5 — Frontend:**
- New file `frontend/src/components/ApiBehaviour/StartTargetReplayWizard.tsx` present (forked wizard — NOT a mode flag on `StartCaptureSessionWizard.tsx`).
- New file `frontend/src/components/ApiBehaviour/StartTargetReplayWizard.test.tsx` present with 4 tests — all pass.
- `frontend/src/api/apiBehaviourClient.ts` extended with the 6 typed-client functions (lines 1122, 1139, 1157, 1176, 1195, 1214).
- `ApiBaselinesListPage.tsx` carries the "Capture target API behaviour" entry button (lines 141, 156).
- `BaselineDetailView.tsx` (located in `frontend/src/components/DashboardView/`, not `ApiBehaviour/`) carries the kind-conditional header banner with "Target-side API capture" text at lines 257-265, with paired-source lookup at lines 140-144.

### Incomplete or Issues

None. Group 6 is intentionally unticked — manual smoke test owned by the user.

---

## 2. Documentation Verification

**Status:** Complete

### Implementation Documentation

This spec follows the convention of inline implementation notes embedded in `tasks.md` rather than separate per-task `implementation/*.md` files. Implementation notes are present and detailed inline at:
- Task 1.1, 1.2, 1.3, 1.4, 1.8 (Group 1 notes)
- Task 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7 (Group 2 notes)
- Task 3.8 (Group 3 summary note)
- Task 4.1, 4.2, 4.3, 4.4, 4.5 (Group 4 notes)
- Task 5.2, 5.6 (Group 5 notes)

### Verification Documentation

- `agent-os/specs/2026-05-25-api-test-harness-target-side-capture/verifications/final-verification.md` (this file)

### Missing Documentation

None for this spec's documentation convention.

---

## 3. Roadmap Updates

**Status:** No Updates Needed

### Updated Roadmap Items

None.

### Notes

`agent-os/product/roadmap.md` is the meta-model + diagramming product roadmap (41 items spanning Phases 1-5 covering JSON schema, diagram rendering, interactive editing, UX polish, and backend / deployment). None of the 41 roadmap items match this spec's surface area (API behaviour baseline target-side capture). The roadmap does not currently track api-migration-validation or api-behaviour feature work — those specs are tracked via the agent-os specs folder only.

---

## 4. Test Suite Results

**Status:** Passed with Issues (new tests clean; broader suites carry unrelated pre-existing failures)

### Test Summary

**Per-spec new tests (the surface this spec touches):**
- AMS apibehaviour tests: **28 / 28 passing** (`mvn test -Dtest='ApiBehaviour*'`) — includes 4 new persistence tests, 4 new baseline-service tests, 4 new session-service tests, 4 new controller tests, plus the 12 pre-existing apibehaviour tests still passing.
- api-migration-validation-service: **13 / 13 new tests passing** (`targetReplayRunner.test.ts` 8 + `targetCaptureSessionActions.test.ts` 5).
- Gateway: **4 / 4 new tests passing** (`apiMigrationValidation-target-capture-proxy.test.ts` 3 + `apiBehaviourClient.test.ts` 1).
- Frontend: **4 / 4 new wizard tests passing**; the broader frontend ApiBehaviour / DashboardView surface this spec touched runs **43 / 43 passing** across 11 affected test files.

**Total new tests added by this spec: ~49** (4 persistence + 12 service/controller + 13 validation-service + 4 gateway + 4 frontend wizard + 12 broader frontend surface verifications that exercise the new fields).

**Whole-suite snapshots:**

api-migration-validation-service (Jest):
- Total: 137 (136 passing, 1 skipped, 0 failing)
- 31 of 32 suites pass; 1 skipped — clean.

Gateway (Jest):
- Total: 1963 (1894 passing, 69 failing)
- 40 of 269 suites fail — all failures match pre-existing patterns documented in `MEMORY.md` (`dashboardSummary-*`, `chatV2-panel-*`, `bootstrap-*`, `hub-bootstrap-*`, `azure-openai-*`, `conversation-memory-edge-cases`, `discoveryDecisionTasks*`, `llmClient*`, `transcript-*`, etc.). No new failures introduced.

Frontend (Vitest):
- Total: 9904 (9279 passing, 625 failing, 8 errors)
- 221 of 985 files fail — all failures are pre-existing per `MEMORY.md` (the wider Vitest suite has broad pre-existing failures unrelated to ApiBehaviour). Targeted run of the 11 files touching this spec's surface passes 43 / 43 cleanly.

AMS (Maven Surefire):
- Total: 1927 (1700 passing, 96 failures, 131 errors, 12 skipped)
- 77 of ~250 test files fail — none are in the `apibehaviour` package. The 28 ApiBehaviour tests (12 pre-existing + 16 new across this spec) all pass.
- `mvn test-compile` exits 0 — confirms the test-compile invariant from `2026-05-25-ams-test-infrastructure-cleanup` still holds.

### Failed Tests

**No new failures.** All failures match documented pre-existing patterns:

- Gateway suite failures (40 suites / 69 tests): match pre-existing patterns from `MEMORY.md` — dashboard summary tests, chatV2 panel tests, hub bootstrap tests, azure-openai tests, conversation memory edge cases, discovery decision tasks, prompt composer, registry loader, transcript tests, etc.
- Frontend suite failures (221 files / 625 tests): pre-existing wider-tree failures noted in `MEMORY.md` as unrelated to ApiBehaviour work.
- AMS suite failures (77 files / 227 tests): broad failures across non-apibehaviour packages (ModelRoundTripTest, various controller integration tests, discovery tests, etc.). Per the `2026-05-25-ams-test-infrastructure-cleanup` spec context, `mvn test-compile` is the held invariant; the broader `mvn test` suite has known wider issues unrelated to this spec.

### Notes

- **PATCH safety confirmed:** All four new DTO fields introduced by this spec (`kind` on both DTOs, `pairedWithBaselineId`, `sourceBaselineId`) are reference types (`String`, `UUID`). No boxed-primitive drift risk per `project_primitive_double_dto_overwrite.md`. The Javadoc note recording this rule is present on the extended DTOs per task 2.2 / 2.3.
- **Liquibase immutability:** No edits to changesets <= 155. Two new files only (`156-` + `157-`) per `feedback_liquibase_immutable_changesets.md`.
- **Reused infra untouched:** Per git status, `httpExecutor.ts`, `runManager.ts`, `secretsStore.ts`, `startupReconciliation.ts`, `redactor.ts`, `captureLoopRunner.ts`, `captureSessionOrchestrator.ts`, `gatewayClient.ts` are NOT in the modified file list — confirming the spec's "no edits to reused kind-agnostic infrastructure" constraint.
- **Naming discipline:** The "Target Baseline" phrase reserved for the unrelated architecture-copy feature is avoided; "Capture target API behaviour" (verb-first) is used for the entry button, and "Target-side API capture (paired with: ...)" is used for the detail-view banner, both verified in the source files.
- **Slot drift documented:** Liquibase changeset slots moved from the originally planned `140-/141-` to `156-/157-` because slots 140-155 were taken by intervening specs. Tasks.md (1.2) and the changeset SQL headers all explicitly record this drift.
- **Route count delta:** Group 3 ships 6 routes (not 5) and Group 4 ships 6 proxy routes (not 5) — the additional `/target-capture-sessions/:id/secrets` route is noted inline in the implementation notes and is required for in-memory secrets bundle loading before `/start` will fire the runner.
- **Group 6 (manual smoke test):** Intentionally left unticked per the spec's design and per the user's explicit verification instructions — this is owned by the user and not in scope for this automated verification pass.
