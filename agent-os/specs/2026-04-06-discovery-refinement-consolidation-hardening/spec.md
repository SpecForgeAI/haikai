# Specification: Discovery Refinement, Consolidation, and System Hardening

## Goal
Stabilize and production-harden the full discovery pipeline (Phase 0 through Phase 1a-1d) so that it executes reliably under repeated runs, handles partial failures gracefully, produces no duplicates on re-execution, and is observable, documented, and ready for broader usage.

## User Stories
- As a developer running discovery against a codebase, I want re-running the pipeline to be safe and non-duplicative so that I can recover from failures or re-analyze without manual cleanup.
- As an internal developer maintaining the discovery system, I want structured logging, clear documentation, and well-defined extension points so that I can debug issues and extend the system confidently.

## Specific Requirements

**Pipeline partial-failure tolerance**
- When a step (1a, 1b, 1c, 1d) throws, the `startRun` function in `runManager.ts` must persist all successful prior step results before marking the run as FAILED
- The `stepsPayload` must record the failing step name, the error message, and which prior steps completed successfully
- The `error_message` field on the run record must include the step identifier (e.g., "Step 1c failed: ...") so the failure location is immediately obvious from the run DTO
- After a failed run, a fresh POST to `/discovery/runs` must create a new run that re-executes from step 1a without interference from the failed run's data
- The run status state machine must be enforced: PENDING -> RUNNING -> COMPLETED|FAILED; no other transitions allowed

**Idempotent evidence persistence**
- The `generateEvidenceId` utility in `utils/evidenceId.ts` already produces deterministic SHA-256 hashes from (runId, repoUrl, filePath, type, distinguishingKey); this pattern must be extended to relationships, clusters, and candidates
- The `bulkSaveEvidence` call in `archModelClient.ts` (and equivalent bulk-save methods for relationships, clusters, candidates) must use upsert semantics so that re-persisting the same records by stable ID is a no-op
- The Java-side bulk save endpoints in the architecture-model-service must accept `ON CONFLICT DO UPDATE` or equivalent JPA logic keyed on the stable identifier
- Minor Liquibase migration(s) are acceptable to add unique constraints on stable identifier columns where missing

**Idempotent candidate save-back**
- The save-approved-candidates flow (triggered via POST `/projects/:projectId/runs/:runId/save-approved`) must check whether a canonical entity already exists for a given candidate before creating a new one
- Use the `DiscoveryCandidateEntityMappingEntity` to detect previously saved candidates and skip them on re-execution
- The `review_status` = 'committed' state (already in the candidate status enum) must gate save-back so only approved-and-not-yet-committed candidates are processed

**Orphaned data detection and explicit cleanup**
- Add a new endpoint: GET `/projects/:projectId/discovery/orphans` that returns counts of orphaned records (evidence without a valid run, candidates without a valid run, stale FAILED/CANCELLED runs older than 30 days)
- Add a new endpoint: POST `/projects/:projectId/discovery/cleanup` that deletes orphaned records identified above, returning a summary of what was removed
- These endpoints route through the gateway to the architecture-model-service
- No automatic/scheduled cleanup; both endpoints are manual and explicit
- No aggressive retention policy; stale run threshold is advisory and configurable via query parameter (default 30 days)

**Performance bottleneck removal**
- Audit the `executeStep1b` function which fetches all 1a atoms in a single call; if the atom count exceeds a threshold (e.g., 5000), paginate the fetch
- Audit the `executeStep1c` function which fetches all atoms AND all relationships; apply the same pagination pattern
- The linker rule loop in step 1b iterates rules sequentially; confirm no N+1 query pattern exists (each rule should operate on the in-memory atom set, not re-fetch)
- Review `BULK_SAVE_BATCH_SIZE` (currently 500) and confirm it is appropriate for relationship and cluster bulk saves, not just evidence atoms
- Add batch-size awareness to all bulk save calls across 1b, 1c, and 1d (some currently persist entire arrays in a single HTTP call without batching)

**Structured run-level logging**
- Replace `console.log` statements in `runManager.ts` with structured JSON log entries containing: `runId`, `projectId`, `step`, `event` (step_start, step_complete, step_failed, run_complete, run_failed), `timestamp`, `durationMs`, `counts` (evidence/relationship/cluster/candidate counts where applicable)
- Capture wall-clock duration for each step by recording `Date.now()` at step start and end, included in the structured log entry
- Capture total run duration in the final run_complete or run_failed log entry
- Enhance the existing `requestLogger.ts` middleware to emit structured JSON (not plain text `console.log`) for consistency with run-level logging
- Errors must include the original error message and stack trace in the structured log entry

**Diagnostic read surface**
- Add a GET `/discovery/runs/:runId/diagnostics` endpoint to the discovery-service that returns the run's `steps_payload` enriched with timing data and evidence/relationship/cluster/candidate counts per step
- This is a lightweight read-only endpoint that assembles data already persisted on the run record; no new persistence required
- Route through the gateway with the same proxy pattern used for existing run endpoints

**UX polish on DiscoveryRunDetailView**
- When a run has status RUNNING, show the current step name from `current_step` with a simple text-based progress indicator (e.g., "Running step 1b of 4...")
- When a run has status FAILED, show the `error_message` with the step context prominently in the error banner (the `.errorMessage` CSS class already exists)
- Improve empty states: when no runs exist, show a descriptive message instead of an empty list; when no candidates exist for a run, show "No candidates generated" instead of a blank table
- Add a "Refresh" button next to the run list header that re-fetches the run list without a full page reload

**UX polish on DiscoveryCandidateTable**
- When the active filter yields zero results, show a filter-aware empty message (e.g., "No rejected candidates" instead of generic empty)
- Add a subtle count summary line above the table (e.g., "12 candidates: 8 approved, 2 rejected, 2 pending")
- Ensure the loading spinner state (`loadingCandidateId`) shows a visible indicator on the row being acted upon, not just reduced opacity

**Internal documentation**
- Create `discovery-service/docs/pipeline-phases.md` describing Phase 0, Phase 1a (extraction), Phase 1b (relationships), Phase 1c (clustering), Phase 1d (candidate generation) with purpose, inputs, outputs, and step sequencing
- Create `discovery-service/docs/evidence-schema.md` documenting the EvidenceAtom, EvidenceRelationship, EvidenceCluster, and DiscoveryCandidate type structures with field descriptions
- Create `discovery-service/docs/decision-task-engine.md` describing how DecisionTasks are created, dispatched to the gateway for LLM resolution, and how results are applied back (triage thresholds, adjudication flow)
- Create `discovery-service/docs/analyzer-pack-authoring.md` covering the `AnalyzerPack` interface, how to register a new pack in `analyzerRegistry.ts`, input/output contracts, and the extractor pattern
- Create `discovery-service/docs/save-back-contract.md` specifying the candidate-to-entity save-back flow: approval workflow, POST endpoint, entity mapping persistence, and idempotency guarantees
- All docs are internal developer-facing markdown; no end-user documentation

## Visual Design
No visual assets provided.

## Existing Code to Leverage

**`discovery-service/src/services/runManager.ts` -- Pipeline orchestration**
- Contains the `startRun` function (line 1953) that sequences steps 1a-1d with try/catch per step, updating run status via `archModelClient.updateDiscoveryRun`
- Already persists `stepsPayload` with per-step status; enhance with timing and error detail rather than rewriting
- The `BULK_SAVE_BATCH_SIZE` constant and batching pattern in `executeStep1a` should be replicated to 1b/1c/1d bulk saves
- The step execution pattern (executeStep switch) is the natural place to add structured logging hooks

**`discovery-service/src/utils/evidenceId.ts` -- Deterministic ID generation**
- `generateEvidenceId` uses SHA-256 hash of (runId, repoUrl, filePath, type, distinguishingKey) for stable atom IDs
- This pattern should be extended to produce stable IDs for relationships, clusters, and candidates using their own distinguishing fields
- Existing callers already pass these IDs during persistence; the upsert change is on the Java bulk-save side

**`discovery-service/src/services/archModelClient.ts` -- Backend HTTP client**
- Singleton `ArchModelClient` with methods for all CRUD operations against the architecture-model-service
- New cleanup and diagnostics endpoints should follow the same method patterns (URL construction, error handling, AxiosError status propagation)
- The existing `bulkSaveEvidence`, `bulkSaveRelationships`, `bulkSaveClusters`, `bulkSaveCandidates` methods need upsert behavior from the backend side

**`frontend/src/components/DashboardView/DiscoveryRunDetailView.tsx` and `DiscoveryCandidateTable.tsx` -- Existing UI**
- `DiscoveryRunDetailView` already renders run list, status badges (via `getStatusClass`), detail panel, error messages, and candidate toggle
- `DiscoveryCandidateTable` already has filter chips with count badges, row tinting, and action buttons with loading state
- CSS module (`DiscoveryRunDetailView.module.css`) has existing styles for all status badges, error messages, empty states, and loading states
- UX polish should extend these existing components and styles rather than creating new ones

**`gateway/src/routes/discovery.ts` -- Gateway proxy routing**
- Contains all existing discovery proxy routes following a consistent pattern: extract params, build URL, axios call to backend, forward response
- New endpoints (orphans, cleanup, diagnostics) should follow the identical proxy pattern with the same error handling and logging

## Out of Scope
- New discovery phases beyond the existing Phase 0 + Phase 1a-1d
- New analyzer packs or expansion of the analyzer-pack library
- Advanced performance optimization or hard SLA commitments (only obvious bottleneck removal)
- Deep UI redesign of the discovery dashboard or candidate table layout
- Major changes to the hypothesis-first Q&A UI (Increment 15)
- Broad database schema redesign (only minor migrations for unique constraints or consistency)
- Aggressive automatic retention or deletion policies (cleanup is manual/explicit only)
- Authentication or authorization changes to discovery endpoints
- WebSocket or streaming additions for real-time progress updates
- New feature expansion disguised as hardening work
