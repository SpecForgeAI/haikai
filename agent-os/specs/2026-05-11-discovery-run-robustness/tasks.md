# Task Breakdown: Discovery Run Robustness

> **CRITICAL — Live-run hazard (per `feedback_no_src_edits_during_run`):** Edits to `discovery-service/src/**` while a `tsx watch` discovery run is in flight will reload-kill the run. Before working on any task that modifies `discovery-service/src/**` (Task Groups 1, 2, and parts of Task Group 5), confirm no discovery run is active. Run a `tsx watch` restart cycle on a quiet state, not mid-pipeline.

## Overview
Total Task Groups: 7
This is a bundled spec covering three independent fixes surfaced during real-world testing of the just-shipped 7-spec discovery candidate evidence explainability roadmap:
- **Section 1**: replace env-driven proxy-prefix-strip hotfix with a per-run configurable suffix matcher (tier-3) plus per-candidate aggregate merge.
- **Section 2**: `discovery_run.service_id` survives service deletion via `ON DELETE SET NULL` + identity snapshot + "Service deleted" chip.
- **Section 3**: expose already-persisted `discovery_run.architecture_id` on the AMS DTO so the "Save to canonical model" modal resolves the architecture name.

## Cross-cutting constraints
- NO new top-level pipeline step in discovery-service. Section 1 modifies the existing runtime-evidence sub-stage and matcher only.
- NO new backend endpoints. Section 1 piggy-backs on the existing log-files PATCH (Spec 4). Section 2 piggy-backs on the existing createRun POST.
- M's defensive default at the matcher read site is **1** (when the key is missing from `config_snapshot`), matching the frontend default.
- Confidence ordering for per-candidate merge: `high > medium > low`. Same-confidence ties: first encountered wins (deterministic via Map iteration order).
- Tier-3 guardrail: candidate template's first non-empty segment must be a LITERAL (`!PLACEHOLDER_SEGMENT_REGEX.test(seg)`).
- Tier-3 cap: `log_segs - candidate_segs <= M`. M=0 disables tier-3 entirely.
- Section 2 graceful degradation: pre-existing runs without `serviceIdentitySnapshot` display `"Service deleted"` alone (the FK value is lost when SET NULL fires).
- Section 3 sentinel UUID for test fixtures: use `UUID.randomUUID()` per call site or the existing per-file convention (some test files already use a fixed constant for similar sentinel fields — match the file's local convention).
- Tests for old proxy-strip env-var behaviour must be **REMOVED**, not migrated, since the feature itself is removed.

## Task List

### Section 1 — Discovery-Service Tier-3 Matcher & Per-Candidate Merge

#### Task Group 1: Discovery-service matcher (tier-3 + per-candidate merge + remove env-var hotfix)
**Dependencies:** None
**Files:**
- `discovery-service/src/services/runtimeEvidence/endpointRuntimeMatcher.ts`
- `discovery-service/src/services/runtimeEvidence/endpointPathNormalizer.ts`
- `discovery-service/src/services/runtimeEvidence/httpRuntimeObservation.ts` (no type change expected; verify only)
- `discovery-service/src/services/runtimeEvidence/__tests__/endpointRuntimeMatcher.test.ts` (or sibling)
- `discovery-service/src/services/runtimeEvidence/__tests__/endpointPathNormalizer.test.ts` (or sibling)

- [x] 1.0 Complete discovery-service matcher changes
  - [x] 1.1 Write 2-8 focused tests for tier-3 matcher + per-candidate merge
    - Test: `M = 1` with candidate `GET /job/{id}/succinct` + log `GET /ui/job/12345/succinct` -> matches with `matchConfidence: 'low'` and `matchReason: 'suffix_match'` (AC1.7).
    - Test: `M = 1` with two-segment-prefix log `GET /api/proxy/job/12345/succinct` -> does NOT match the same candidate (over the cap, AC1.8).
    - Test: `M = 2` with two-segment-prefix log -> matches (AC1.9).
    - Test: `M = 0` -> no tier-3 matches produced regardless of input (AC1.6).
    - Test: candidate template `GET /{id}/foo` REJECTED by tier-3 literal-first-segment guardrail regardless of M (AC1.10).
    - Test: two aggregates pointing at the same candidate (e.g. tier-1 exact `/job/123/succinct` + tier-3 suffix `/ui/job/123/succinct`) -> exactly ONE merged `MatchedRuntimeEvidence` with summed counts, unioned time window, and the higher-confidence wins for `matchConfidence`/`matchReason`/`normalizedLogPath`/`codePathTemplate` (AC1.11).
    - Test (optional within 8): `normalizePath("/ui/job/123/succinct")` post-removal returns `/ui/job/{id}/succinct` (no proxy strip, AC1.14).
  - [x] 1.2 Extend `buildMatchedEvidence` reason union and confidence mapping in `endpointRuntimeMatcher.ts:177-201`
    - Reason union: `'exact_normalized_path' | 'equivalent_placeholders' | 'suffix_match'`.
    - Confidence mapping: `exact -> 'high'`, `equivalent -> 'medium'`, `suffix -> 'low'`.
    - Confirm `httpRuntimeObservation.ts:105` `matchConfidence` already includes `'low'` (no type change needed) and `matchReason: string` permits the new value.
  - [x] 1.3 Add tier-3 suffix-match pass in the per-aggregate loop at `endpointRuntimeMatcher.ts:245-283`
    - Pass runs only when tier-1 and tier-2 returned empty AND `M > 0`.
    - Method compatibility via existing `methodCompatible` helper.
    - Literal-first-segment guardrail: candidate template's first non-empty segment must satisfy `!PLACEHOLDER_SEGMENT_REGEX.test(seg)` (reuse `PLACEHOLDER_SEGMENT_REGEX` at line 65).
    - Cap: `log_segs.length >= candidate_segs.length` AND `log_segs.length - candidate_segs.length <= M`.
    - Segment comparison: apply existing placeholder-equivalence rule (`arePathsEquivalentByPlaceholder` or segment-by-segment) over the LAST K segments of the log's normalized path where K = candidate's segment count.
    - Disambiguate via existing `pickBest()` specificity selector; ambiguous tier-3 results route through the existing `ambiguousObservations` path.
  - [x] 1.4 Add per-candidate aggregate merge reducer
    - After the per-aggregate matching loop emits `MatchedRuntimeEvidence[]`, fold through a `Map<candidateId, MatchedRuntimeEvidence>` keyed on `chosen.candidate.id`.
    - SUM: `observedUsageCount`, `totalLogRequests`, `status2xxCount`, `status3xxCount`, `status4xxCount`, `status5xxCount`, `sourceLogFileCount`.
    - UNION: `firstSeen = min(existing, new)`, `lastSeen = max(existing, new)`. Re-aggregate `topStatusCodes` (sum per status, sort descending).
    - Highest-confidence contributor wins for `matchConfidence`, `matchReason`, `normalizedLogPath`, `codePathTemplate`. Ordering: `high > medium > low`.
    - Same-confidence tie: first encountered wins (deterministic via Map iteration order over aggregates).
    - Matcher emits `Array.from(map.values())`.
  - [x] 1.5 Accept the new options-object argument
    - Matcher signature becomes `matchAggregatesToCandidates(aggregates, candidates, { maxLogPathPrefixSegments })`.
    - No positional churn for existing callers (options is the new third arg).
  - [x] 1.6 Remove the env-driven proxy-strip hotfix from `endpointPathNormalizer.ts`
    - Delete `parseProxyPrefixes()` and `LOG_PROXY_PATH_PREFIXES` env read (lines 40-58).
    - Delete the `PROXY_PREFIXES` module-load constant (line 60).
    - Delete `stripProxyPrefix()` helper (lines 62-86).
    - Delete the `proxyStripped = stripProxyPrefix(pathOnly)` step inside `normalizePath()` (line 126) AND the explanatory comment block at line 125.
    - Delete/rewrite the proxy-prefix doc comment block (lines 22-32); remove the now-stale `/ui/job/123/succinct => /job/{id}/succinct` JSDoc example.
    - Post-removal `normalizePath` reduces to: strip query, split, per-segment `isIdSegment`, join.
  - [x] 1.7 Remove env-driven proxy-strip tests
    - Delete (not migrate) any test asserting `LOG_PROXY_PATH_PREFIXES` behaviour in `__tests__/endpointPathNormalizer.test.ts` or aggregator tests that mock `process.env.LOG_PROXY_PATH_PREFIXES`.
    - The feature is removed; the tests must go with it (AC1.13).
  - [x] 1.8 Update header doc on `endpointRuntimeMatcher.ts:9-37`
    - Document the new tier order: Tier 1 (exact, `high`), Tier 2 (equivalent_placeholder, `medium`), Tier 3 (suffix_match, `low`, gated on `M > 0`).
  - [x] 1.9 Ensure tier-3 + merge + removal tests pass
    - Run ONLY the 2-8 tests written in 1.1.
    - Confirm deleted env-var tests no longer execute.
    - Do NOT run the full discovery-service test suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests from 1.1 pass (covers AC1.6–AC1.11, AC1.14).
- AC1.12: `LOG_PROXY_PATH_PREFIXES`, `parseProxyPrefixes`, `stripProxyPrefix`, `PROXY_PREFIXES`, and the proxy-strip step in `normalizePath` are deleted.
- AC1.13: previously asserting env-driven proxy-strip tests are deleted.
- Tier-3 reason `'suffix_match'` carries `matchConfidence: 'low'`; tier-1/2 unchanged.

---

#### Task Group 2: Discovery-service orchestrator reads M from `config_snapshot`
**Dependencies:** Task Group 1
**Files:**
- `discovery-service/src/services/runtimeEvidence/runDiscoveryRuntimeEvidence.ts`
- `discovery-service/src/services/runtimeEvidence/__tests__/runDiscoveryRuntimeEvidence.test.ts`

- [x] 2.0 Wire M from config_snapshot into the matcher
  - [x] 2.1 Write 2-4 focused tests for orchestrator M read + threading
    - Test: `config_snapshot.runtimeEvidenceConfig.maxLogPathPrefixSegments = 3` -> matcher called with `{ maxLogPathPrefixSegments: 3 }`.
    - Test: missing `runtimeEvidenceConfig` key -> matcher called with `{ maxLogPathPrefixSegments: 1 }` (defensive default).
    - Test: out-of-range value (e.g. `99`) clamped to `5`; negative clamped to `0`.
    - Test: invalid type (e.g. `"two"`) -> defaults to `1`.
  - [x] 2.2 Add `readMaxLogPathPrefixSegments(configSnapshot)` helper
    - Sit alongside the existing `readLogFileArtifacts` (around lines 181-196).
    - Read `configSnapshot.runtimeEvidenceConfig.maxLogPathPrefixSegments`.
    - Return clamped integer in `[0..5]`; default `1` when missing, out of range, or invalid type.
  - [x] 2.3 Thread the value into the matcher call
    - Update the call at lines 495-498 to pass `{ maxLogPathPrefixSegments }` as the third options-object arg.
    - No new fetch — the orchestrator already receives `configSnapshot` (lines 152-154).
  - [x] 2.4 Ensure orchestrator tests pass
    - Run ONLY the 2-4 tests from 2.1.
    - Do NOT run the full discovery-service test suite at this stage.

**Acceptance Criteria:**
- The 2-4 tests from 2.1 pass (covers AC1.5).
- Defensive default of `1` applies when key is missing/invalid (matches frontend default).
- No other call sites of `matchAggregatesToCandidates` break.

---

### Section 1 — Backend Persistence

#### Task Group 3: AMS log-files PATCH merges `runtimeEvidenceConfig` into `config_snapshot`
**Dependencies:** None (parallel to Task Group 1; pre-requisite for end-to-end Section 1)
**Files:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/DiscoveryRunController.java` (line ~274 `patchLogFileArtifacts`)
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/DiscoveryRunService.java` (around line 681 `patchLogFileArtifacts`)
- `architecture-model-service/src/test/java/com/example/architecturemodel/controller/DiscoveryRunControllerTest.java` (or the existing log-files PATCH test)

- [x] 3.0 Persist `runtimeEvidenceConfig` alongside `inputArtifacts.logFiles[]`
  - [x] 3.1 Write 2-4 focused tests for the PATCH service merge
    - Test: PATCH body `{ logFiles: [...], attemptedCount: 2, runtimeEvidenceConfig: { maxLogPathPrefixSegments: 3 } }` -> `config_snapshot.runtimeEvidenceConfig.maxLogPathPrefixSegments == 3` after persistence.
    - Test: PATCH body without `runtimeEvidenceConfig` -> existing `config_snapshot.runtimeEvidenceConfig` (if any) preserved untouched.
    - Test: re-PATCH with a new value -> idempotent overwrite of `runtimeEvidenceConfig.maxLogPathPrefixSegments` (AC1.4).
    - Test (optional within 4): `runtimeEvidenceConfig` and `inputArtifacts.logFiles[]` written in the same JPA `save()` (no separate write).
  - [x] 3.2 Extend the controller request body
    - `DiscoveryRunController.patchLogFileArtifacts` accepts an optional sibling key `runtimeEvidenceConfig: { maxLogPathPrefixSegments: number }` alongside the existing `logFiles[]` / `attemptedCount` keys.
    - Use a `Map<String, Object>` or a small nested DTO record — match the existing PATCH controller convention.
  - [x] 3.3 Extend the service merge logic at `DiscoveryRunService.patchLogFileArtifacts` (~line 681)
    - In the same write that merges `inputArtifacts.logFiles[]`, also merge `config_snapshot.runtimeEvidenceConfig.maxLogPathPrefixSegments` when present in the request body.
    - When request body omits `runtimeEvidenceConfig`, leave the existing snapshot value unchanged (do not null it).
  - [x] 3.4 Ensure PATCH-merge tests pass
    - Run ONLY the 2-4 tests from 3.1.
    - Do NOT run the entire AMS test suite at this stage.

**Acceptance Criteria:**
- The 2-4 tests from 3.1 pass (covers AC1.4).
- Existing PATCH behaviour (logFiles + attemptedCount) is unchanged when no `runtimeEvidenceConfig` is supplied.
- Run-create POST shape is UNCHANGED — M never rides the create POST.

---

### Section 1 — Frontend + Gateway

#### Task Group 4: Frontend M input + log-files PATCH payload extension + gateway pass-through
**Dependencies:** Task Group 3 (so an end-to-end smoke works; UI can land in parallel but acceptance requires the AMS side)
**Files:**
- `frontend/src/components/DashboardView/StartDiscoveryRunModal.tsx`
- `frontend/src/components/DashboardView/PreflightModal.tsx`
- `frontend/src/services/gatewayClient.ts` (`uploadDiscoveryRunLogFiles` signature)
- `gateway/src/routes/discovery.ts` (upload route ~line 2182)
- `gateway/src/services/architectureModelClient.ts` (`patchDiscoveryRunLogFileArtifacts` ~line 2018)
- Frontend Vitest tests under `frontend/src/components/DashboardView/__tests__/`
- Gateway Jest tests under `gateway/src/__tests__/`

- [x] 4.0 Wire M from modals through to the gateway PATCH body
  - [x] 4.1 Write 4-8 focused tests across frontend + gateway
    - Frontend (Vitest): `StartDiscoveryRunModal` renders `<input type="number" min="0" max="5" step="1" />` with default value `1` and the one-line hint when `selectedFiles.length > 0`; hidden when no files selected (AC1.1).
    - Frontend (Vitest): `PreflightModal` mirrors the same UX (visibility-gated input + hint).
    - Frontend (Vitest): when user uploads logs with `M = 3`, the multipart FormData includes a `runtimeEvidenceConfig` field whose JSON value is `{"maxLogPathPrefixSegments":3}` (AC1.2).
    - Frontend (Vitest, optional): when `selectedFiles.length == 0`, the upload call is skipped entirely.
    - Gateway (Jest): `POST /…/log-files` route with multipart body including `runtimeEvidenceConfig` -> forwards `runtimeEvidenceConfig` alongside `logFiles` and `attemptedCount` in the PATCH call to AMS (AC1.3).
    - Gateway (Jest): backwards-compat — request without `runtimeEvidenceConfig` -> PATCH body to AMS omits the field.
  - [x] 4.2 Add the M input control to `StartDiscoveryRunModal`
    - Add `<input type="number" min="0" max="5" step="1" />` mirroring `WorkItemCreateModal.tsx:245-253` (plain numeric input + `<span className={styles.hint}>` below).
    - Default value `1`; clamp display to `[0..5]`.
    - Hint text: `"Tolerate up to N proxy prefix segments when matching log paths to endpoints (0-5, default 1)"`.
    - Visibility gated on `selectedFiles.length > 0`.
    - State lives alongside the existing `selectedFiles` state; threads into the existing submit handler.
  - [x] 4.3 Mirror the same control in `PreflightModal`
    - Same input + hint + visibility-gate pattern.
    - State threads into the existing preflight-confirm handler that drives the log-files upload.
  - [x] 4.4 Extend `uploadDiscoveryRunLogFiles` signature
    - New optional 5th argument: `maxLogPathPrefixSegments?: number`.
    - When provided, append a multipart FormData field `runtimeEvidenceConfig` with JSON-string value `JSON.stringify({ maxLogPathPrefixSegments })`.
    - When omitted, do not append the field (preserves backwards-compat for callers not supplying M).
  - [x] 4.5 Extend the gateway upload route (`gateway/src/routes/discovery.ts:2182`)
    - Parse the multipart `runtimeEvidenceConfig` field when present.
    - Forward it as a sibling key to `patchDiscoveryRunLogFileArtifacts` alongside `logFiles` and `attemptedCount`.
  - [x] 4.6 Extend `patchDiscoveryRunLogFileArtifacts` in `gateway/src/services/architectureModelClient.ts:2018`
    - New optional arg `runtimeEvidenceConfig?: { maxLogPathPrefixSegments: number }`.
    - Include it in the PATCH body sent to AMS when present.
    - Do NOT include the key when caller omits it (matches AMS service's "leave snapshot value unchanged" behaviour).
  - [x] 4.7 Ensure UI + gateway tests pass
    - Run ONLY the 4-8 tests from 4.1.
    - Do NOT run the full frontend or gateway test suites at this stage.

**Acceptance Criteria:**
- The 4-8 tests from 4.1 pass (covers AC1.1, AC1.2, AC1.3).
- M control hidden when `selectedFiles.length === 0`.
- Default value `1`; values outside `[0..5]` clamped by `min`/`max` attributes at the input level.
- Run-create POST shape unchanged — M rides only the log-files PATCH.

---

### Section 2 — Service Deletion FK Strategy (Option C)

#### Task Group 5: Liquibase 126 + service identity snapshot at run-create + "Service deleted" chip
**Dependencies:** None for the DB change; route-level snapshot capture independent of Section 1
**Files:**
- `architecture-model-service/src/main/resources/db/changelog/sql/126-discovery-run-service-id-set-null.sql` (NEW)
- `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
- `discovery-service/src/routes/runs.ts` (line 249 service-fetch site)
- `discovery-service/src/services/archModelClient.ts` (`createDiscoveryRun` line 652)
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/DiscoveryRunController.java` (`CreateDiscoveryRunRequest` line 345)
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/DiscoveryRunService.java` (`createRun` ~line 220, config_snapshot init)
- `frontend/src/components/DashboardView/DiscoveryRunsList.tsx` (lines 175-211)
- `frontend/src/components/DashboardView/DiscoveryRunDetailView.tsx` (header surface)
- `frontend/src/components/DashboardView/DiscoveryRunDetailView.module.css` (new `serviceNameLabel` and `serviceDeletedChip` classes)
- AMS test files: a new `DiscoveryRunServiceFkBehaviourTest` (or extend an existing service test); discovery-service route tests; frontend Vitest tests

- [x] 5.0 Section 2 vertical slice
  - [x] 5.1 Write 4-8 focused tests across the stack
    - AMS (H2 Spring Boot test): DELETE a row from `services` referenced by a `discovery_run` -> no FK violation; the `discovery_run.service_id` is set to NULL post-commit (AC2.2).
    - AMS (controller/service test): `createRun` with non-null `serviceId` + `service_identity_snapshot` payload -> entity persists with `config_snapshot.serviceIdentitySnapshot` containing all six fields (AC2.3, AC2.4).
    - AMS: `createRun` with null `serviceId` -> no `serviceIdentitySnapshot` written.
    - Discovery-service (Jest, mocked `archModelClient`): route at `runs.ts:249` captures service identity snapshot from the existing service fetch and threads it into `createDiscoveryRun` POST body when `serviceId` is non-null.
    - Frontend (Vitest): `DiscoveryRunsList` row with `service_id == null` AND `config_snapshot.serviceIdentitySnapshot.serviceName == "OldService"` -> renders `"OldService"` + amber `"Service deleted"` chip (AC2.5).
    - Frontend (Vitest): legacy orphan with `service_id == null` AND no snapshot -> renders `"Service deleted"` alone, no name suffix, no crash (AC2.7).
    - Frontend (Vitest): non-orphaned run (`service_id` resolves) -> no chip (AC2.8).
    - Frontend (Vitest): `DiscoveryRunDetailView` header surface renders the same name + chip on orphaned run (AC2.6).
  - [x] 5.2 Create Liquibase changeset 126
    - New file `architecture-model-service/src/main/resources/db/changelog/sql/126-discovery-run-service-id-set-null.sql`:
      - `ALTER TABLE discovery_run DROP CONSTRAINT IF EXISTS discovery_run_service_id_fkey;`
      - Re-add: `ALTER TABLE discovery_run ADD CONSTRAINT discovery_run_service_id_fkey FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;`
    - Per `feedback_liquibase_immutable_changesets`: do NOT edit changeset 081 or 082.
  - [x] 5.3 Register changeset 126 in master changelog
    - Add a `changeSet:` entry in `db.changelog-master.yaml` matching the existing id/author/preConditions/sqlFile pattern (use the immediate-prior 125 entry as template).
  - [x] 5.4 Extend `createDiscoveryRun` body shape in discovery-service
    - `discovery-service/src/services/archModelClient.ts:652` POST body gains optional `service_identity_snapshot?: { service_id, service_name, service_type, application_id, repo_location, repo_subfolder }`.
  - [x] 5.5 Capture snapshot at the route level
    - `discovery-service/src/routes/runs.ts:249` already fetches `service` for tier computation. Build the snapshot from that fetch when `serviceId` is non-null and pass it into the `archModelClient.createDiscoveryRun` call.
    - Snapshot fields: `serviceId`, `serviceName`, `serviceType`, `applicationId`, `repoLocation`, `repoSubfolder`. Source: `ServiceResponseDto` (`archModelClient.ts:79-126`).
    - Skip the snapshot entirely when `serviceId` is null (library-scoped, project-scoped without a service).
  - [x] 5.6 Accept snapshot in AMS controller
    - `DiscoveryRunController.CreateDiscoveryRunRequest` at line 345 gains `@JsonProperty("service_identity_snapshot") Map<String, Object> serviceIdentitySnapshot`.
  - [x] 5.7 Persist snapshot in AMS service
    - `DiscoveryRunService.createRun` writes the map into `config_snapshot.serviceIdentitySnapshot` at the existing config_snapshot init site (~line 220), atomic with run creation.
  - [x] 5.8 Add CSS classes for the chip
    - `DiscoveryRunDetailView.module.css`: new `serviceNameLabel` and `serviceDeletedChip` classes reusing the amber palette of `logsAttachWarningChipPartial` (lines 189-201).
  - [x] 5.9 Render the chip in `DiscoveryRunsList.tsx:175-211`
    - Predicate: `run.service_id == null && run.config_snapshot?.serviceIdentitySnapshot?.serviceName != null` -> render `<serviceNameLabel>{snapshot.serviceName}</serviceNameLabel><serviceDeletedChip>Service deleted</serviceDeletedChip>`.
    - Graceful fallback: `run.service_id == null && no snapshot` -> render `"Service deleted"` alone (no name suffix, no `id:` text because the FK value is lost when SET NULL fires).
    - Non-orphaned runs (`service_id` non-null) render unchanged — no chip.
  - [x] 5.10 Render the chip in `DiscoveryRunDetailView.tsx` header
    - Same predicate + same fallback as the list row.
  - [x] 5.11 Ensure Section 2 tests pass
    - Run ONLY the 4-8 tests from 5.1.
    - Do NOT run the full AMS / discovery-service / frontend test suites at this stage.

**Acceptance Criteria:**
- The 4-8 tests from 5.1 pass (covers AC2.1–AC2.8).
- Liquibase changeset 126 is the only new SQL file; 081/082 untouched.
- `serviceIdentitySnapshot` is captured only when `serviceId` is non-null.
- Frontend gracefully degrades for legacy orphans without a snapshot.

---

### Section 3 — Add `architecture_id` to AMS DTO

#### Task Group 6: AMS `DiscoveryRunDto` + `toDto()` + ~13 test-file call-site updates
**Dependencies:** None (independent of Sections 1 and 2; can land standalone)
**Files:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/DiscoveryRunDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/DiscoveryRunService.java` (`toDto()` lines 806-824)
- `architecture-model-service/src/test/java/com/example/architecturemodel/controller/DiscoveryEntityOriginsControllerTest.java` (lines 62, 66, 124)
- `architecture-model-service/src/test/java/com/example/architecturemodel/controller/DiscoveryRunControllerArchitectureScopingTest.java` (lines 86, 175)
- `architecture-model-service/src/test/java/com/example/architecturemodel/controller/DiscoveryRunControllerTest.java` (lines 65, 127, 132, 200, 244, 254)
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/DiscoveryRunModePersistenceTest.java` (lines 60, 105, ~165)

- [x] 6.0 Add `architecture_id` to the DTO and propagate
  - [x] 6.1 Write 2-4 focused assertions extending existing tests
    - Extend a happy-path `DiscoveryRunControllerTest` test to assert `jsonPath("$.architecture_id").value(...)` (AC3.3).
    - Add a `DiscoveryRunControllerArchitectureScopingTest` assertion: the returned DTO's `architecture_id` matches the architecture the run was bound to.
    - (Optional) Add a `toDto()` unit assertion: given an entity with a known `architectureId`, the resulting DTO carries the same UUID at the third positional slot.
  - [x] 6.2 Add the field to the DTO record
    - In `DiscoveryRunDto.java`, insert at record position 3 (between `projectId` and `serviceId`):
      ```java
      @JsonProperty("architecture_id")
      UUID architectureId,
      ```
    - Record is now 15 components (was 14). Matches `@JsonProperty("snake_case")` convention.
  - [x] 6.3 Update `DiscoveryRunService.toDto()`
    - Lines 806-824. Add `entity.getArchitectureId()` at positional argument index 3 (after `entity.getProjectId()`).
    - `DiscoveryRunEntity.getArchitectureId()` is Lombok-generated from `@Getter`; method already exists.
  - [x] 6.4 Update ~13 positional-constructor call sites in test files
    - Insert a sentinel `UUID` argument at position 3 in every `new DiscoveryRunDto(...)` call:
      - `controller/DiscoveryEntityOriginsControllerTest.java` lines 62, 66, 124 (3 sites).
      - `controller/DiscoveryRunControllerArchitectureScopingTest.java` lines 86, 175 (2 sites — these should pass the architecture-under-test's UUID, not a random one, so the new assertion in 6.1 can verify).
      - `controller/DiscoveryRunControllerTest.java` lines 65, 127, 132, 200, 244, 254 (6 sites).
      - `service/DiscoveryRunModePersistenceTest.java` lines 60, 105, ~165 (2-3 sites).
    - Use `UUID.randomUUID()` or the file's existing sentinel-UUID convention. Match per-file style.
    - Verify compile after each file's update (positional ordering is the failure mode).
  - [x] 6.5 Ensure Section 3 tests pass
    - Run ONLY the 2-4 tests from 6.1 plus the updated call-site files' existing tests (which must still compile and pass).
    - Do NOT run the entire AMS test suite.

**Acceptance Criteria:**
- The 2-4 assertions from 6.1 pass (covers AC3.1, AC3.2, AC3.3).
- All ~13 positional-constructor test call sites compile and their existing assertions still pass.
- AC3.4: no frontend or gateway code change required; field flows verbatim through the existing pass-through at `gateway/src/routes/discovery.ts:561`.

---

### Final Verification

#### Task Group 7: End-to-end verification & non-regression backstops
**Dependencies:** Task Groups 1-6

- [x] 7.0 Cross-feature verification (no new tests beyond the cap; smoke + non-regression)
  - [x] 7.1 Review feature-specific tests from Task Groups 1-6
    - Tier-3 matcher + per-candidate merge tests (1.1): ~6-8 tests.
    - Orchestrator M-read tests (2.1): ~2-4 tests.
    - AMS PATCH-merge tests (3.1): ~2-4 tests.
    - Frontend + gateway M-wire tests (4.1): ~4-8 tests.
    - Section 2 vertical-slice tests (5.1): ~4-8 tests.
    - Section 3 DTO tests (6.1): ~2-4 tests.
    - Total existing: approximately 20-36 tests.
  - [x] 7.2 Analyze gaps for THIS bundled spec only
    - Critical gap candidate 1: an end-to-end discovery-service test that exercises tier-3 + per-candidate merge with the M-from-`config_snapshot` path (orchestrator + matcher integration).
    - Critical gap candidate 2: a full-stack non-regression confirming the "Save to canonical model" modal resolves the architecture name from `architecture_id` (AC3.4) — verify via existing `DiscoveryRunDetailView.libraryScans.test.tsx` or sibling, or extend if absent.
    - Critical gap candidate 3: non-regression that Spec 1-7 testid contracts (`runtimeEvidenceContextBuilder`, `runtimeBadgeHelpers`, `displayConfidence`, `CandidateEvidenceSectionCard`, `candidateDetailsSupport`) are unaffected — quick visual smoke.
    - Do NOT assess entire-app coverage. Skip edge cases, performance tests, accessibility tests unless business-critical.
  - [x] 7.3 Write up to 10 additional strategic tests maximum
    - Add at most 10 tests to fill the critical gaps identified in 7.2.
    - Prioritise integration + end-to-end workflows over additional unit coverage.
    - Skip exhaustive scenario coverage; bias toward orchestrator->matcher integration and the full M-wire path (modal -> gateway -> AMS PATCH -> orchestrator read -> matcher tier-3 -> persisted matched-evidence).
  - [x] 7.4 Run feature-specific tests only
    - Run ONLY the tests from 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, and 7.3.
    - Expected total: approximately 30-46 tests maximum.
    - Do NOT run the entire application test suite.
    - Verify the seven acceptance-criteria groups (AC1.1–AC1.14, AC2.1–AC2.8, AC3.1–AC3.4) are end-to-end covered.
  - [x] 7.5 Non-regression sanity sweep on the 7-spec roadmap surfaces
    - Confirm UNCHANGED files have no diffs: `runtimeEvidenceContextBuilder.ts`, `runtimeBadgeHelpers.ts`, `displayConfidence.ts`, `CandidateEvidenceSectionCard.tsx`, `candidateDetailsSupport.ts`.
    - Confirm Spec 1-7 testid contracts intact (grep for any modified `data-testid` in the touched files).
    - Confirm run-create POST shape unchanged in `discovery-service/src/services/archModelClient.ts:652` (only `service_identity_snapshot` added as optional sibling; existing keys unchanged).
    - Confirm persisted `candidate.confidence` value is unchanged (Section 1 only adds a new `MatchedRuntimeEvidence` row; it does not mutate the candidate row).

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 30-46 tests total).
- No more than 10 additional tests added during gap-filling.
- Testing focused exclusively on this bundled spec's three sections.
- UNCHANGED files confirmed pristine.
- All 26 acceptance criteria (AC1.1-AC1.14, AC2.1-AC2.8, AC3.1-AC3.4) demonstrably covered.

---

## Execution Order

Recommended implementation sequence:
1. **Task Group 6** (Section 3 — DTO field exposure) — fully independent, smallest, lowest-risk. Land first to clear the "Save to canonical model" modal blocker.
2. **Task Group 1** (Section 1 — matcher tier-3 + per-candidate merge + remove env-var hotfix) — pure discovery-service logic, no UI dependencies, foundation for the rest of Section 1.
3. **Task Group 2** (Section 1 — orchestrator reads M) — depends on Group 1; small.
4. **Task Group 3** (Section 1 — AMS PATCH merge) — parallel-safe to Groups 1-2; pre-requisite for the end-to-end Section 1 wire.
5. **Task Group 4** (Section 1 — frontend + gateway wire) — depends on Group 3 for end-to-end smoke; UI can land in parallel with Group 3 backend.
6. **Task Group 5** (Section 2 — vertical slice: Liquibase + snapshot capture + chip) — independent of Section 1; coordinated within itself.
7. **Task Group 7** (Final verification) — depends on Groups 1-6.

Section 3 (Group 6) can ship as its own commit immediately. Sections 1 and 2 should ship paired with the Section 2 DB migration applied before the snapshot-capture code goes live.
