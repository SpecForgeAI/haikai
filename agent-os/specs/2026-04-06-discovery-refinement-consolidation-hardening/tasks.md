# Task Breakdown: Discovery Refinement, Consolidation, and System Hardening

## Overview
Total Tasks: 65 (across 8 task groups)

This is Increment 16 of 16 (final increment) for the legacy/current-state discovery capability. All work focuses on stabilization, hardening, and documentation -- not new feature expansion.

## Task List

### Pipeline Robustness (Discovery Service -- TypeScript/Express)

#### Task Group 1: Partial Failure Tolerance and Run State Machine
**Dependencies:** None

- [x] 1.0 Complete pipeline partial failure tolerance and run state enforcement
  - [x] 1.1 Write 6 focused tests for partial failure and state machine behavior
    - Test that when step 1b throws, stepsPayload records 1a as completed and 1b as failed with error detail
    - Test that error_message includes step identifier prefix (e.g., "Step 1c failed: ...")
    - Test that stepsPayload on failure includes the failing step name and error message
    - Test that after a FAILED run, a fresh POST creates a new independent run starting from 1a
    - Test that run status transitions follow PENDING -> RUNNING -> COMPLETED|FAILED only
    - Test that successful prior step results are preserved in stepsPayload when a later step fails
  - [x] 1.2 Enhance `startRun` in `discovery-service/src/services/runManager.ts` to include step identifier in error_message
    - Change line ~1996 from `error_message: errorMessage` to `error_message: \`Step ${step} failed: ${errorMessage}\``
    - Ensure the failing step's stepsPayload entry includes `{ status: 'failed', errorMessage, step }` not just `{ status: 'failed' }`
  - [x] 1.3 Add run status state machine validation
    - Add a `validateStatusTransition(currentStatus, newStatus)` utility function
    - Valid transitions: PENDING->RUNNING, RUNNING->COMPLETED, RUNNING->FAILED
    - Call this validation before each `archModelClient.updateDiscoveryRun` call in `startRun`
    - Throw a descriptive error if an invalid transition is attempted
  - [x] 1.4 Verify stepsPayload preserves all completed step metadata on failure
    - Confirm that the `stepsPayload` object built across the for-loop in `startRun` already accumulates completed steps (it does -- validate with the tests from 1.1)
    - Ensure the catch block persists the full accumulated stepsPayload (not just the failing step)
  - [x] 1.5 Ensure partial failure tests pass
    - Run ONLY the 6 tests written in 1.1
    - Verify all assertions about stepsPayload structure and error_message formatting

**Acceptance Criteria:**
- The 6 tests from 1.1 pass
- error_message includes step identifier (e.g., "Step 1c failed: connection timeout")
- stepsPayload on a failed run shows completed steps with their metadata and the failed step with error detail
- Run status transitions are validated; invalid transitions are rejected
- A fresh run after failure starts cleanly from step 1a

---

### Idempotency Layer (Java/Spring Boot + TypeScript)

#### Task Group 2: Idempotent Evidence, Relationship, Cluster, and Candidate Persistence
**Dependencies:** None (can run in parallel with Task Group 1)

- [x] 2.0 Complete idempotent persistence across all discovery entity types
  - [x] 2.1 Write 8 focused tests for upsert semantics and stable ID generation
    - Test `generateEvidenceId` produces identical hashes for identical inputs (existing -- verify)
    - Test new `generateRelationshipId` produces deterministic hash from (runId, sourceAtomId, targetAtomId, relationshipType)
    - Test new `generateClusterId` produces deterministic hash from (runId, clusterLabel, clusterType)
    - Test new `generateCandidateId` produces deterministic hash from (runId, candidateName, candidateType, parentCandidateId)
    - Test Java bulk-save evidence endpoint with duplicate IDs performs upsert (no duplicate row)
    - Test Java bulk-save relationships endpoint with duplicate IDs performs upsert
    - Test Java bulk-save clusters endpoint with duplicate IDs performs upsert
    - Test Java bulk-save candidates endpoint with duplicate IDs performs upsert
  - [x] 2.2 Extend `discovery-service/src/utils/evidenceId.ts` with new ID generation functions
    - Add `generateRelationshipId(runId, sourceAtomId, targetAtomId, relationshipType): string`
    - Add `generateClusterId(runId, clusterLabel, clusterType): string`
    - Add `generateCandidateId(runId, candidateName, candidateType, parentCandidateId): string`
    - All use the same SHA-256 hash pattern as `generateEvidenceId`
  - [x] 2.3 Create Liquibase migration for unique constraints on stable identifiers
    - File: `architecture-model-service/src/main/resources/db/changelog/sql/076-discovery-upsert-constraints.sql`
    - Add unique constraint on `discovery_evidence(id)` if not already the PK
    - Add unique constraint on `discovery_relationships(id)` if not already the PK
    - Add unique constraint on `discovery_clusters(id)` if not already the PK
    - Add unique constraint on `discovery_candidates(id)` if not already the PK
    - Register in `db.changelog-master.yaml`
  - [x] 2.4 Update Java bulk-save services to use upsert (ON CONFLICT DO UPDATE) semantics
    - `DiscoveryEvidenceService.bulkCreate` -- use `saveAll` with merge semantics or native upsert query
    - `DiscoveryRelationshipService.bulkCreate` -- same upsert pattern
    - `DiscoveryClusterService.bulkCreate` -- same upsert pattern
    - `DiscoveryCandidateService.bulkCreate` -- same upsert pattern
    - Each should detect existing records by ID and update fields rather than failing on constraint violation
  - [x] 2.5 Wire stable ID generation into step execution in `runManager.ts`
    - In `executeStep1b`: call `generateRelationshipId` when constructing relationship objects before persistence
    - In `executeStep1c`: call `generateClusterId` when constructing cluster objects before persistence
    - In `executeStep1d`: call `generateCandidateId` when constructing candidate objects before persistence
    - Ensure 1a already uses `generateEvidenceId` (it does -- verify)
  - [x] 2.6 Ensure idempotency tests pass
    - Run ONLY the 8 tests written in 2.1
    - Verify that re-persisting the same records by stable ID is a no-op

**Acceptance Criteria:**
- The 8 tests from 2.1 pass
- All four discovery entity types (evidence, relationships, clusters, candidates) have deterministic ID generation
- Java bulk-save endpoints use upsert semantics -- re-saving the same data by ID produces no duplicates
- Liquibase migration adds necessary constraints without breaking existing data

---

#### Task Group 3: Idempotent Candidate Save-Back
**Dependencies:** Task Group 2

- [x] 3.0 Complete idempotent candidate save-back flow
  - [x] 3.1 Write 4 focused tests for save-back idempotency
    - Test that save-approved skips candidates already in `committed` review_status
    - Test that save-approved checks `DiscoveryCandidateEntityMappingEntity` for previously saved candidates and skips them
    - Test that only candidates with review_status `approved` (not `committed`) are processed
    - Test that after successful save-back, candidate review_status transitions to `committed`
  - [x] 3.2 Update the save-approved flow to check for existing canonical entities
    - In the save-approved handler (gateway or MCP route), before creating a canonical entity for a candidate:
      1. Query `DiscoveryCandidateEntityMappingEntity` for an existing mapping with this candidate ID
      2. If mapping exists, skip this candidate (already saved back)
      3. If not, proceed with entity creation and mapping persistence
  - [x] 3.3 Gate save-back on review_status
    - Filter the candidate list to include only those with `review_status === 'approved'`
    - Exclude candidates already in `committed` status
    - After successful entity creation, update candidate `review_status` to `committed`
  - [x] 3.4 Ensure save-back idempotency tests pass
    - Run ONLY the 4 tests written in 3.1

**Acceptance Criteria:**
- The 4 tests from 3.1 pass
- Re-executing save-approved does not create duplicate canonical entities
- Only approved-and-not-yet-committed candidates are processed
- Committed candidates are skipped on re-execution

---

### Orphaned Data Management (Java/Spring Boot + Gateway + Discovery Service)

#### Task Group 4: Orphan Detection and Cleanup Endpoints
**Dependencies:** Task Group 2

- [x] 4.0 Complete orphan detection and explicit cleanup endpoints
  - [x] 4.1 Write 6 focused tests for orphan detection and cleanup
    - Test GET `/projects/:projectId/discovery/orphans` returns correct counts for evidence without a valid run
    - Test GET `/projects/:projectId/discovery/orphans` returns correct counts for candidates without a valid run
    - Test GET `/projects/:projectId/discovery/orphans` returns stale FAILED/CANCELLED runs older than threshold
    - Test POST `/projects/:projectId/discovery/cleanup` deletes orphaned records and returns summary
    - Test cleanup threshold is configurable via query parameter (default 30 days)
    - Test gateway proxies both endpoints correctly to architecture-model-service
  - [x] 4.2 Create Java service methods for orphan detection
    - Add `DiscoveryRunService.findOrphanedData(UUID projectId, int staleRunDaysThreshold)` method
    - Query evidence records where run_id does not exist in discovery_runs
    - Query candidates where run_id does not exist in discovery_runs
    - Query runs in FAILED or CANCELLED status with updated_at older than threshold
    - Return a summary DTO with counts: `orphanedEvidenceCount`, `orphanedCandidateCount`, `staleRunCount`
  - [x] 4.3 Create Java service methods for cleanup execution
    - Add `DiscoveryRunService.cleanupOrphanedData(UUID projectId, int staleRunDaysThreshold)` method
    - Delete orphaned evidence, candidates, relationships, clusters, and decision tasks
    - Delete stale FAILED/CANCELLED runs older than threshold (cascade deletes related records)
    - Return a summary DTO with counts of what was removed
  - [x] 4.4 Create Java controller endpoints
    - GET `/api/model/projects/{projectId}/discovery/orphans?staleDays=30`
    - POST `/api/model/projects/{projectId}/discovery/cleanup?staleDays=30`
    - Both use the same `DiscoveryRunService` methods from 4.2 and 4.3
  - [x] 4.5 Add gateway proxy routes for orphan endpoints
    - Add GET `/projects/:projectId/discovery/orphans` route in `gateway/src/routes/discovery.ts`
    - Add POST `/projects/:projectId/discovery/cleanup` route in `gateway/src/routes/discovery.ts`
    - Follow the identical proxy pattern (extract params, build URL, axios call, forward response) used by existing discovery routes
  - [x] 4.6 Ensure orphan detection and cleanup tests pass
    - Run ONLY the 6 tests written in 4.1

**Acceptance Criteria:**
- The 6 tests from 4.1 pass
- GET orphans endpoint returns accurate counts of orphaned records
- POST cleanup endpoint removes orphaned records and returns a deletion summary
- Stale run threshold is configurable via query parameter (default 30 days)
- No automatic or scheduled cleanup -- both endpoints are manual and explicit
- Gateway proxies both endpoints to the architecture-model-service correctly

---

### Performance Hardening (Discovery Service -- TypeScript)

#### Task Group 5: Performance Bottleneck Removal and Batch-Size Awareness
**Dependencies:** Task Group 2

- [x] 5.0 Complete performance bottleneck audit and resolution
  - [x] 5.1 Write 4 focused tests for pagination and batching behavior
    - Test that `executeStep1b` paginates atom fetches when count exceeds threshold (5000)
    - Test that `executeStep1c` paginates atom and relationship fetches when counts exceed threshold
    - Test that bulk save calls in steps 1b, 1c, and 1d respect `BULK_SAVE_BATCH_SIZE`
    - Test that linker rule loop in step 1b does not re-fetch atoms per rule (operates on in-memory set)
  - [x] 5.2 Add paginated fetch to `executeStep1b` in `runManager.ts`
    - Before fetching all 1a atoms, first call a count endpoint (or use the stepsPayload atom count from step 1a)
    - If count exceeds 5000, fetch atoms in pages (e.g., 2000 per page) using offset/limit query params
    - Accumulate all pages into a single in-memory array before passing to linker rules
    - Add corresponding paginated fetch method to `archModelClient.ts` if not already present
  - [x] 5.3 Add paginated fetch to `executeStep1c` in `runManager.ts`
    - Apply the same pagination pattern to atom and relationship fetches
    - Use stepsPayload counts from prior steps to determine whether pagination is needed
  - [x] 5.4 Audit and fix N+1 patterns in step 1b linker rule loop
    - Confirm that each linker rule receives the full in-memory atom array and does not re-fetch
    - If any rule makes individual HTTP calls per atom or per pair, refactor to batch operations
  - [x] 5.5 Apply `BULK_SAVE_BATCH_SIZE` to all bulk save calls in steps 1b, 1c, and 1d
    - Step 1b: batch relationship persistence using `BULK_SAVE_BATCH_SIZE` (currently may persist entire array)
    - Step 1c: batch cluster persistence using `BULK_SAVE_BATCH_SIZE`
    - Step 1d: verify candidate persistence already uses `BULK_SAVE_BATCH_SIZE` (it does at line ~1905)
    - Standardize the batching loop pattern across all steps to match step 1a's pattern
  - [x] 5.6 Review `BULK_SAVE_BATCH_SIZE` value (500) for appropriateness
    - Verify 500 is reasonable for relationships (which may have larger payloads than atoms)
    - Verify 500 is reasonable for clusters (which include member arrays)
    - If cluster member arrays make 500 too large, consider a smaller batch size for clusters only
    - Document any batch size adjustments as code comments
  - [x] 5.7 Ensure performance tests pass
    - Run ONLY the 4 tests written in 5.1

**Acceptance Criteria:**
- The 4 tests from 5.1 pass
- Steps 1b and 1c paginate large atom/relationship fetches instead of loading everything in a single call
- No N+1 query patterns in the linker rule loop
- All bulk save calls across 1b, 1c, and 1d use batched persistence with `BULK_SAVE_BATCH_SIZE`
- Batch size reviewed and documented for each entity type

---

### Observability (Discovery Service -- TypeScript)

#### Task Group 6: Structured Logging, Diagnostics Endpoint, and Request Logger
**Dependencies:** Task Group 1 (needs run state machine), Task Group 5 (needs timing hooks)

- [x] 6.0 Complete structured logging and diagnostics
  - [x] 6.1 Write 6 focused tests for structured logging and diagnostics endpoint
    - Test that `startRun` emits structured JSON log entries with runId, projectId, step, event, timestamp
    - Test that step_start and step_complete events include correct step identifier
    - Test that step_failed event includes error message and stack trace
    - Test that run_complete event includes total durationMs
    - Test that each step log entry includes durationMs (wall-clock timing)
    - Test that GET `/discovery/runs/:runId/diagnostics` returns stepsPayload with timing and counts
  - [x] 6.2 Create a structured logger utility for run-level events
    - Create `discovery-service/src/utils/runLogger.ts`
    - Export `logRunEvent(params: { runId, projectId, step?, event, timestamp, durationMs?, counts?, error?, stack? })` function
    - Output as JSON string via `console.log(JSON.stringify({...}))` for container-friendly structured logging
    - Event types: `step_start`, `step_complete`, `step_failed`, `run_complete`, `run_failed`
  - [x] 6.3 Instrument `startRun` in `runManager.ts` with structured logging
    - Record `Date.now()` at run start and before each step
    - Call `logRunEvent` with `step_start` before each step execution
    - Call `logRunEvent` with `step_complete` after each step, including durationMs and step result counts
    - Call `logRunEvent` with `step_failed` in the catch block, including error message and stack
    - Call `logRunEvent` with `run_complete` or `run_failed` at the end, including total durationMs
    - Persist timing data (stepStartedAt, stepCompletedAt, durationMs) into the stepsPayload
  - [x] 6.4 Enhance `requestLogger.ts` middleware to emit structured JSON
    - Replace `console.log` plain text with JSON structured output
    - Include fields: method, path, statusCode, durationMs, timestamp
    - Maintain the existing res.on('finish') pattern for response logging
  - [x] 6.5 Add diagnostics route in discovery-service
    - Add GET `/discovery/runs/:runId/diagnostics` route in `discovery-service/src/routes/runs.ts`
    - Fetch the run record via `archModelClient.getDiscoveryRun`
    - Return `steps_payload` enriched with any timing data and evidence/relationship/cluster/candidate counts already embedded in stepsPayload
    - This is read-only -- no new persistence required
  - [x] 6.6 Add gateway proxy route for diagnostics
    - Add GET `/projects/:projectId/runs/:runId/diagnostics` route in `gateway/src/routes/discovery.ts`
    - Proxy to discovery-service GET `/discovery/runs/:runId/diagnostics`
    - Follow the same proxy pattern as existing run detail routes
  - [x] 6.7 Ensure observability tests pass
    - Run ONLY the 6 tests written in 6.1

**Acceptance Criteria:**
- The 6 tests from 6.1 pass
- `startRun` emits structured JSON log entries for every step transition and run completion/failure
- Each log entry includes runId, projectId, step, event, timestamp, durationMs where applicable
- Error log entries include message and stack trace
- `requestLogger.ts` emits structured JSON instead of plain text
- Diagnostics endpoint returns stepsPayload with timing and count data
- Gateway proxies the diagnostics endpoint correctly

---

### Frontend UX Polish (React/TypeScript)

#### Task Group 7: DiscoveryRunDetailView and DiscoveryCandidateTable Polish
**Dependencies:** Task Group 6 (diagnostics endpoint needed for progress data)

- [x] 7.0 Complete UX polish for discovery UI components
  - [x] 7.1 Write 6 focused tests for UI polish behavior
    - Test that RUNNING status shows current step name with progress indicator text
    - Test that FAILED status shows error_message with step context in the error banner
    - Test that empty run list shows descriptive message instead of empty container
    - Test that empty candidates for a run shows "No candidates generated" message
    - Test that candidate table filter yielding zero results shows filter-aware empty message
    - Test that candidate count summary line renders correct breakdown above the table
  - [x] 7.2 Enhance `DiscoveryRunDetailView.tsx` for RUNNING status progress indicator
    - When `selectedRun.status === 'RUNNING'`, display `current_step` with a textual progress indicator
    - Format as "Running step 1b of 4..." using the step value and total VALID_STEPS count
    - Place within the existing detail panel area
  - [x] 7.3 Enhance `DiscoveryRunDetailView.tsx` for FAILED status error display
    - When `selectedRun.status === 'FAILED'`, show `error_message` prominently in the existing `.errorMessage` CSS class
    - Ensure the step context from the error_message prefix (e.g., "Step 1c failed: ...") is clearly visible
  - [x] 7.4 Add empty state messages to `DiscoveryRunDetailView.tsx`
    - When `runs` array is empty after loading, show "No discovery runs found for this project. Start a new run to begin analyzing your codebase."
    - When candidates array is empty for a selected run, show "No candidates generated for this run."
    - Use existing empty state styling from `DiscoveryRunDetailView.module.css`
  - [x] 7.5 Add Refresh button to `DiscoveryRunDetailView.tsx`
    - Add a "Refresh" button next to the run list header
    - On click, re-fetch the run list via `getDiscoveryRuns(projectId)` without full page reload
    - Use existing button styling
  - [x] 7.6 Enhance `DiscoveryCandidateTable.tsx` with filter-aware empty state and count summary
    - When the active filter yields zero results, show a filter-specific message (e.g., "No rejected candidates" instead of generic empty)
    - Add a count summary line above the table: "12 candidates: 8 approved, 2 rejected, 2 pending"
    - Compute counts from the full candidates array, not the filtered subset
  - [x] 7.7 Improve loading indicator for candidate action in `DiscoveryCandidateTable.tsx`
    - When `loadingCandidateId` matches a row, add a visible spinner or loading text indicator on that row
    - Ensure it is more visible than the current reduced-opacity approach (add a small inline spinner or "Saving..." text)
  - [x] 7.8 Ensure UI polish tests pass
    - Run ONLY the 6 tests written in 7.1

**Acceptance Criteria:**
- The 6 tests from 7.1 pass
- RUNNING runs show current step with progress text
- FAILED runs show error_message with step context prominently
- Empty states show descriptive messages instead of blank areas
- Refresh button re-fetches run list without page reload
- Candidate table shows filter-aware empty messages and count summary
- Loading indicator on candidate actions is clearly visible

---

### Internal Documentation (Markdown)

#### Task Group 8: Pipeline, Schema, and Extension Documentation
**Dependencies:** Task Groups 1-6 (documentation should reflect the hardened system)

- [x] 8.0 Complete internal developer documentation
  - [x] 8.1 Create `discovery-service/docs/pipeline-phases.md`
    - Describe Phase 0 (configuration and setup)
    - Describe Phase 1a (universal extraction): purpose, inputs (AnalyzerInput with config_snapshot), outputs (EvidenceAtom[]), step sequencing
    - Describe Phase 1b (relationship inference): purpose, inputs (1a atoms), outputs (EvidenceRelationship[]), linker rules, triage, DecisionTasks
    - Describe Phase 1c (evidence clustering): purpose, inputs (atoms + relationships), outputs (EvidenceCluster[]), clustering rules, merge passes, triage
    - Describe Phase 1d (candidate generation): purpose, inputs (clusters + atoms + relationships), outputs (DiscoveryCandidate[]), generation rules, triage, adjudication
    - Document the step sequencing in `startRun` and the stepsPayload state tracking
    - Document the partial failure tolerance behavior (which steps persist, error_message format)
  - [x] 8.2 Create `discovery-service/docs/evidence-schema.md`
    - Document `EvidenceAtom` type: all fields with descriptions, type-specific data payloads (file_structure, symbol, string_pattern)
    - Document `EvidenceRelationship` type: sourceAtomId, targetAtomId, relationshipType, confidence, metadata
    - Document `EvidenceCluster` type: label, clusterType, members array, confidence, metadata
    - Document `DiscoveryCandidate` type: name, candidateType, confidence, review_status enum, parentCandidateId, supporting evidence references
    - Include the stable ID generation pattern for each type
  - [x] 8.3 Create `discovery-service/docs/decision-task-engine.md`
    - Describe the DecisionTask concept: what triggers creation, task types (relationship confirmation, competing resolution, cluster merge, type classification, etc.)
    - Document how tasks are dispatched to the gateway for LLM resolution
    - Document how results are applied back (triage thresholds, adjudication flow)
    - Reference the `gatewayClient` service for task dispatch
    - Document `CANDIDATE_AUTO_ACCEPT_THRESHOLD` and `CANDIDATE_AMBIGUOUS_THRESHOLD` constants
  - [x] 8.4 Create `discovery-service/docs/analyzer-pack-authoring.md`
    - Document the `AnalyzerPack` interface: `name`, `analyze(input: AnalyzerInput): Promise<AnalyzerOutput>`
    - Explain how to register a new pack in `analyzerRegistry.ts` via `registry.register(name, pack)`
    - Document input/output contracts: `AnalyzerInput` fields, expected `AnalyzerOutput` structure
    - Describe the extractor pattern used in `discovery-service/src/services/extractors/`
    - Reference the existing `phase1aAnalyzerPack.ts` and `stubAnalyzerPack.ts` as examples
  - [x] 8.5 Create `discovery-service/docs/save-back-contract.md`
    - Specify the candidate-to-entity save-back flow end to end
    - Document the approval workflow: pending_review -> approved -> committed
    - Document the POST endpoint for save-approved and its gateway proxy
    - Document entity mapping persistence via `DiscoveryCandidateEntityMappingEntity`
    - Document the idempotency guarantees (check mapping before creating entity, committed status gating)
  - [x] 8.6 Review documentation for accuracy against implemented code
    - Cross-reference each doc against the actual source files
    - Verify type names, field names, function signatures, and file paths are accurate
    - Ensure partial failure behavior documented in 8.1 matches the implementation from Task Group 1

**Acceptance Criteria:**
- All 5 markdown documents exist in `discovery-service/docs/`
- Each document is written for internal developer consumption (not end-user facing)
- Type names, field names, and file paths are accurate against the codebase
- Pipeline phases document reflects the hardened partial failure behavior
- Save-back contract document reflects the idempotency guarantees

---

### Test Review and Gap Analysis

#### Task Group 9: Cross-Cutting Test Review
**Dependencies:** Task Groups 1-7

- [x] 9.0 Review existing tests and fill critical gaps only
  - [x] 9.1 Review tests from Task Groups 1-7
    - Review the 6 tests from Task Group 1 (partial failure / state machine)
    - Review the 8 tests from Task Group 2 (idempotent persistence)
    - Review the 4 tests from Task Group 3 (save-back idempotency)
    - Review the 6 tests from Task Group 4 (orphan detection / cleanup)
    - Review the 4 tests from Task Group 5 (pagination / batching)
    - Review the 6 tests from Task Group 6 (structured logging / diagnostics)
    - Review the 6 tests from Task Group 7 (UI polish)
    - Total existing tests: approximately 40 tests
  - [x] 9.2 Analyze test coverage gaps for this feature only
    - Identify critical end-to-end workflows that lack coverage (e.g., full pipeline re-run producing no duplicates)
    - Check that the interaction between idempotent persistence and partial failure recovery is tested
    - Check that gateway proxy routes for new endpoints (orphans, cleanup, diagnostics) have route-level tests
    - Focus ONLY on gaps related to this spec's hardening requirements
  - [x] 9.3 Write up to 10 additional strategic tests to fill identified gaps
    - Prioritize integration-level tests over unit tests
    - Example gaps to fill: full re-run idempotency end-to-end, cleanup after partial failure, diagnostics response shape, gateway route forwarding for new endpoints
    - Do NOT write comprehensive coverage for all scenarios
    - Do NOT write performance benchmarks or load tests
  - [x] 9.4 Run feature-specific tests only
    - Run ONLY tests related to this spec (tests from groups 1-7 and newly written tests from 9.3)
    - Expected total: approximately 40-50 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical hardening workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 40-50 tests total)
- Critical end-to-end hardening workflows are covered
- No more than 10 additional tests added in gap-filling
- Testing focused exclusively on this spec's refinement and hardening requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1** (Pipeline Robustness) and **Task Group 2** (Idempotency Layer) -- run in parallel, no dependencies between them
2. **Task Group 3** (Save-Back Idempotency) -- depends on Task Group 2 for upsert semantics
3. **Task Group 4** (Orphan Detection/Cleanup) and **Task Group 5** (Performance Hardening) -- run in parallel, both depend on Task Group 2
4. **Task Group 6** (Observability/Logging) -- depends on Task Groups 1 and 5
5. **Task Group 7** (Frontend UX Polish) -- depends on Task Group 6 for diagnostics data
6. **Task Group 8** (Internal Documentation) -- depends on Task Groups 1-6 being complete so docs reflect final state
7. **Task Group 9** (Test Review and Gap Analysis) -- depends on all prior groups

```
Phase 1 (parallel):  [TG1: Pipeline Robustness]  [TG2: Idempotency]
Phase 2:             [TG3: Save-Back Idempotency]
Phase 3 (parallel):  [TG4: Orphan Cleanup]  [TG5: Performance]
Phase 4:             [TG6: Observability]
Phase 5:             [TG7: UX Polish]
Phase 6:             [TG8: Documentation]
Phase 7:             [TG9: Test Review]
```

## Key Files by Task Group

| Task Group | Primary Files |
|---|---|
| TG1 | `discovery-service/src/services/runManager.ts` |
| TG2 | `discovery-service/src/utils/evidenceId.ts`, `architecture-model-service/.../service/Discovery*Service.java`, Liquibase migration |
| TG3 | Gateway/MCP save-approved handler, `DiscoveryCandidateEntityMappingService.java` |
| TG4 | `architecture-model-service/.../service/DiscoveryRunService.java`, `architecture-model-service/.../controller/DiscoveryOrphanController.java`, `gateway/src/routes/discovery.ts` |
| TG5 | `discovery-service/src/services/runManager.ts`, `discovery-service/src/services/archModelClient.ts` |
| TG6 | New `discovery-service/src/utils/runLogger.ts`, `discovery-service/src/middleware/requestLogger.ts`, `discovery-service/src/routes/runs.ts`, `gateway/src/routes/discovery.ts` |
| TG7 | `frontend/src/components/DashboardView/DiscoveryRunDetailView.tsx`, `frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx`, `frontend/src/components/DashboardView/DiscoveryRunDetailView.module.css` |
| TG8 | New `discovery-service/docs/*.md` (5 files) |
| TG9 | Test files across all services |
