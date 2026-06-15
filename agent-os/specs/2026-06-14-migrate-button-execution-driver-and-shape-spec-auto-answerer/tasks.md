# Task Breakdown: Migrate Button + Migration Execution Driver + External Shape-Spec Auto-Answerer (Spec 3 of 4)

## Overview
Total Tasks: 6 task groups

This is the EXECUTION layer of the 4-spec migration auto-flow program. Spec 1 (implementation-ready
per-story specs + `implement-state`, changeset 181 on disk) and Spec 2 (TEST work-item siblings) are
built. Spec 3 adds: durable AMS run-state (changeset **182**), a gateway-hosted Migration Execution
Driver, the inbound build-results door, the headless shape-spec auto-answerer, and the Migrate button
+ hard-block gate + run-progress UI.

Authoritative decisions: `planning/requirements.md` CD-1..CD-9. The spec body is `spec.md`. No visual
assets were provided.

Execution sequence is strictly dependency-ordered: AMS run-state foundation first (everything persists
there), then the Driver core, then the build-results receiver (consumes the Driver's run-state), then
the auto-answerer (called by the Driver's per-spec runner), then the frontend surface, then the
strategic end-to-end gap pass.

## Task List

### AMS Run-State Foundation

#### Task Group 1: Migration Execution Run-State (Liquibase changeset 182 + entity/DTO/mapper/repo/service/endpoints)
**Dependencies:** None

Persist the durable spine the Driver advances over. Two tables: `migration_execution_run` (one run over
one book of work) and `migration_execution_run_item` (one per dispatched spec). PLUS a `deferred` flag
on the book item / work item (defer = implementation-exclusion only; CD-7). New changeset **182 ONLY**
(181 is Spec 1's, already on disk; 180 applied) registered in `db.changelog-master.yaml` AFTER 181's
block, with a paired `.sql` in `db/changelog/sql/` (CD-9). snake_case wire default; boxed reference
types for EVERY PATCH-mutable field (per `project_primitive_double_dto_overwrite.md`); the
auto-answerer decision log is an INLINE JSONB column on the run-item via `@Type(JsonType.class)`
(CD-4 — NOT a separate table). `@CamelCaseWire` only if a camelCase consumer exists.

- [x] 1.0 Complete AMS run-state foundation
  - [x] 1.1 Write 2-8 focused tests for run-state persistence
    - Limit to 2-8 highly focused tests maximum (Spring Boot test slice or repository/service test)
    - Cover ONLY critical behaviours: create-run round-trips the pinned `kind='current'` baseline id +
      `deploy_on_complete`/`target_base_url` markers; a PATCH update of a per-spec run-item
      (`dispatched` flag / `job_id` / `outcome`) persists and reads back snake_case; a boxed
      PATCH-mutable field left absent on a partial update does NOT wipe (guards the primitive-overwrite
      trap); the decision-log JSONB column round-trips a `{ question, answer, rationale }` list
    - Skip exhaustive coverage of every column and every endpoint
  - [x] 1.2 Create Liquibase changeset 182 (`migration_execution_run` + `migration_execution_run_item`)
    - Append a `changeSet` block `182-migration-execution-run-state` to `db.changelog-master.yaml`
      AFTER the `181-implementation-ready-spec-fields` block, with a paired
      `db/changelog/sql/182-migration-execution-run-state.sql` (mirror the 180/181 `sqlFile` +
      `preConditions: not columnExists/tableExists` idiom)
    - `migration_execution_run` columns: `id`, workspace/book-of-work scope keys, `status`
      (started | dispatching | halted | deployed | failed), current sequence position,
      `pinned_current_baseline_id` (the active `kind='current'` API-behaviour baseline id — CD-7
      baseline pinning), `deploy_on_complete` marker context as needed, `target_base_url` (set on the
      deployed outcome), created/updated timestamps
    - `migration_execution_run_item` columns: `id`, FK to run, `sequence_position`, `work_item_id`,
      `spec_name`, `status` (pending | answering | submitting | submitted | implemented | deployed |
      failed | rejected), `dispatched` flag, `job_id`, `branch`, `pr_url`, `outcome`
      (implemented | deployed | failed | rejected), `deploy_on_complete` flag (TRUE only on the final
      item), `target_base_url`, `auto_answer_decision_log_json` (INLINE JSONB — CD-4), timestamps
    - Add indexes for `run_id`, `job_id` (callback lookup keys); FK run-item -> run
    - NEVER edit changeset 181 or any applied changeset (per `feedback_liquibase_immutable_changesets.md`)
  - [x] 1.3 Add the `deferred` flag to the book item / work item (defer = implementation-exclusion only)
    - Persist a durable `deferred` boxed Boolean readable by the readiness predicate and the
      run-sequence builder (CD-7); place it where the Migrate predicate + sequence walk read state
      (the book-of-work item / `work_item` row), in changeset 182
    - Defer NEVER removes the story from reconciliation scope (Spec 4 reconciles the full pinned
      baseline; a deferred story correctly surfaces there as a break)
  - [x] 1.4 Create entities + DTOs + mapper for both tables
    - `MigrationExecutionRunEntity` + `MigrationExecutionRunItemEntity` mirroring the
      `MigrationStorySpecGenerationEntity` boxed-type + `@Type(JsonType.class)` JSONB idiom
    - DTOs snake_case wire by default; `@CamelCaseWire` only if a camelCase consumer is identified
    - EVERY PATCH-mutable field is a boxed reference type (Boolean/Long/Integer/String), never a
      primitive (`project_primitive_double_dto_overwrite.md`)
    - Mapper(s) entity <-> DTO following the existing migration-delivery mapper conventions
  - [x] 1.5 Create repository + service + endpoints
    - Repository(s) with finders by run id, by book-of-work scope, by `job_id` (callback correlation)
    - Service to: create a run (records the pinned baseline id + the ordered run-items), read run-state
      (run + items for the progress view), PATCH per-spec run-item state (dispatched / job_id /
      outcome / branch / pr_url / decision-log append), PATCH run status + current position +
      target_base_url
    - REST endpoints: `POST` create-run, `GET` run-state (run + items), `PATCH` run-item,
      `PATCH` run; null-guard every boxed field in the update handlers so an absent field is a no-op,
      not a wipe
  - [x] 1.6 Ensure AMS run-state tests pass
    - Run ONLY the 2-8 tests from 1.1 via targeted FOREGROUND Maven (single test class /
      `-Dtest=...`), NOT the full AMS suite
    - Verify changeset 182 applies against the test H2 context (migration runs cleanly)

**Acceptance Criteria:**
- The 2-8 tests from 1.1 pass
- Changeset 182 is registered AFTER 181 and applies cleanly; 181 and all applied changesets untouched
- Run + run-item persist; per-spec PATCH of `dispatched`/`job_id`/`outcome` round-trips snake_case
- The pinned `kind='current'` baseline id and the inline decision-log JSONB round-trip
- No boxed PATCH-mutable field wipes on a partial update
- `deferred` flag is durable and readable by the predicate + sequence builder

---

### Gateway Migration Execution Driver

#### Task Group 2: Migrate Trigger + Driver Orchestration Core (hard-block gate, sequence build, dispatch, boot-recovery)
**Dependencies:** Task Group 1

The gateway-hosted Driver. A Migrate trigger that validates the HARD-BLOCK gate server-side, pins the
baseline, builds the ordered dispatch set, creates the AMS run, and dispatches the FIRST spec —
returning immediately (CD-7, CD-5). Progression is EVENT-DRIVEN over the AMS run-state (each
build-results callback, Group 3, steps it forward). Per-spec dispatch submits the combined
`generated_spec_text` to the external orchestration endpoint with a per-request `callback_url`
(CD-3), with `deploy_on_complete=TRUE` only on the FINAL spec. A boot-recovery sweep on gateway start
reconciles in-flight run-state vs reality and re-kicks any spec stuck mid-segment (CD-2). The
per-spec shape-spec-answer->submit segment runs as a minimal detached in-process async task (CD-2);
it CALLS the Group 4 auto-answerer to answer shape-spec questions.

- [x] 2.0 Complete the Migration Execution Driver core
  - [x] 2.1 Write 2-8 focused tests for the Driver (gateway Jest; mock `architectureModelClient` via the
        `architectureModelClientMock` helper; live-LLM guard respected)
    - Limit to 2-8 highly focused tests maximum
    - Cover ONLY critical behaviours: the hard-block gate REFUSES when a non-deferred story is
      not-spec-ready and PERMITS when all in-scope stories are ready + a `kind='current'` baseline
      exists; the gate REFUSES when no active baseline exists; the ordered dispatch set is built from
      `book_of_work_json` in (depth, sequenceOrder) order EXCLUDING deferred items and INCLUDING TEST
      items; the Migrate trigger creates the run + dispatches only the FIRST spec and returns
      immediately; `deploy_on_complete=TRUE` is threaded ONLY on the final item; the orchestration
      submit body carries `callback_url`
    - Skip exhaustive per-branch coverage; the boot-recovery + advance paths get one happy-path test each
  - [x] 2.2 Build the Migrate trigger endpoint (book-of-work-scoped) with server-side hard-block validation
    - Validate the HARD-BLOCK gate server-side (do not trust the UI): refuse with a structured reason
      list if ANY in-scope (non-deferred) story is not spec-ready — spec-ready = `workItemId` present /
      `backlogStatus = saved` AND `specGenerationStatus in { generated, generated_with_warnings }` AND
      `staleReason = null` (CD-7)
    - ALSO refuse unless an active `kind='current'` API-behaviour baseline exists for the workspace
      (the oracle precondition — CD-7); return the missing-baseline reason explicitly
    - On pass: pin the active baseline id, create the AMS run (Group 1 create-run), dispatch the FIRST
      spec via the background runner, and RETURN IMMEDIATELY (the run is NOT held in the request)
  - [x] 2.3 Build the ordered run-sequence builder
    - Walk `book_of_work_json` in (depth, sequenceOrder) order (CD-5); EXCLUDE `deferred` items;
      INCLUDE TEST items (they sort after their spanned children naturally — no special-casing)
    - For each sequenced item resolve `migration_story_spec_generations.generated_spec_text` (the edited
      override wins) + the folder / `spec_name`; create one `migration_execution_run_item` per spec
      (status pending, sequence position, `work_item_id`, `spec_name`) via Group 1
    - Mark the FINAL item as `deploy_on_complete=TRUE`; all others FALSE
  - [x] 2.4 Build the Driver-side, server-to-server orchestration submit path (per spec)
    - POST to `/api/v2/jobs/orchestrations` server-side (NOT via the browser client) with `spec_intents`
      (the `spec_name` folder + optional `session_id`), `context_files`, `options`; reuse the
      `implementationLlmProxyClient` `request(...)` JSON seam with the upstream Bearer auto-injected
    - SEND `callback_url` (the gateway's build-results URL) per-request on EVERY submit (CD-3); thread
      `deploy_on_complete` from the run-item (TRUE only on the final spec)
    - Correlate the returned `{ job_id, status, created_at }` `job_id` to the run-item (PATCH run-item
      `job_id` + status submitted via Group 1)
    - Update the on-disk pinned contract: add `callback_url` to the `OrchestrationRequest` schema in
      `docs/reconciliation-integration/migration-reconciliation-integration.openapi.yaml` AND the
      send-side narrative in `migration-reconciliation-integration.md` so contract and implementation
      agree (CD-3 drift flag)
  - [x] 2.5 Build the minimal detached in-process per-spec background runner
    - A detached async task per spec for the autonomous, minutes-long shape-spec-answer -> submit
      segment (CD-2); NOT a generic persisted task table + tick loop — across-spec progression is
      event-driven over the AMS run-state
    - The runner drives the headless shape-spec stream (the Group 4 auto-answerer owns the
      stream-drive + answer loop), then performs the 2.4 orchestration submit on stream conclusion
      (`folder` + `session`), capturing `session_id` for the orchestration handoff only (CD-1)
    - DI seams for the LLM client, the upstream proxy client, and the AMS run-state client so the
      runner is unit-testable with mocks
  - [x] 2.6 Build the event-driven advance + boot-recovery sweep
    - Advance API the Group 3 receiver calls per callback: step the run-item, advance the run position,
      dispatch the NEXT spec (or, on the final spec's deployed outcome, mark the run deployed) — all
      over durable AMS run-state, no long-held in-memory loop
    - Boot-recovery sweep on gateway startup: reconcile in-flight run-state vs reality and re-kick any
      run-item stuck mid-segment (status answering/submitting with no `job_id` yet) so a long migration
      auto-resumes across restarts (CD-2)
    - Per-item failure isolation (one item's failure halts THIS run cleanly, recorded against the work
      item, and never corrupts unrelated state) + structured logs throughout
  - [x] 2.7 Ensure Driver tests pass
    - Run ONLY the 2-8 tests from 2.1 via targeted Jest (LLM-guard + `architectureModelClientMock`),
      then `npx tsc --noEmit` in `gateway/`
    - Do NOT run the entire gateway suite

**Acceptance Criteria:**
- The 2-8 tests from 2.1 pass; `gateway` `npx tsc --noEmit` is clean
- Hard-block refuses on any non-deferred un-ready story AND on a missing `kind='current'` baseline,
  with an explicit per-reason list; permits only when fully ready
- Dispatch set is (depth, sequenceOrder) from `book_of_work_json`, excludes deferred, includes TEST items
- Migrate trigger creates the run, pins the baseline, dispatches only the FIRST spec, returns immediately
- `deploy_on_complete=TRUE` and `callback_url` are threaded correctly (final-spec-only / every-submit)
- The pinned openapi.yaml + design doc carry `callback_url` on `OrchestrationRequest`
- Boot-recovery re-kicks a stuck in-flight run-item; failures are isolated and logged

---

### Gateway Build-Results Receiver

#### Task Group 3: Inbound Build-Results Door + job_id Dispatch
**Dependencies:** Task Group 2

The single inbound door the external service calls. `POST /build-results` on
`implementationProjectsRouter` (mounted `/api/implementation`, so it resolves to
`/api/implementation/build-results`). Reuse the router's snake_case wire conventions, `callUpstream`
error idiom, and AMS-client persistence pattern; the door is snake_case + camelCase-tolerant. A NEW
inbound service-token check (the existing routes are outbound-auth only). On each callback the Driver
(Group 2 advance) consumes it keyed on `job_id` -> update run-state, advance, dispatch next (or deploy
on the final spec). Advances are IDEMPOTENT (CD-6). The `bug_id` paths stay a clean seam for Spec 4.

- [x] 3.0 Complete the build-results receiver
  - [x] 3.1 Write 2-8 focused tests for the door (gateway Jest; mock `architectureModelClient`)
    - Limit to 2-8 highly focused tests maximum
    - Cover ONLY critical behaviours: `job_id`+`implemented` records `pr_url`, advances the run, and
      triggers the NEXT spec's dispatch; `job_id`+`failed`|`rejected` halts the run and records against
      the work item; `job_id`+`deployed` (final spec) marks the run deployed + records `target_base_url`;
      a DUPLICATE already-advanced callback is an idempotent no-op `202` (CD-6); validation errors
      return `401` (bad token) / `404` (unknown `job_id`) / `422` (neither id, or deployed without
      `target_base_url`)
    - Skip exhaustive coverage of every error permutation
  - [x] 3.2 Add `POST /build-results` to `implementationProjectsRouter`
    - Path resolves to `/api/implementation/build-results` (matching the pinned contract); reuse the
      router's snake_case wire + `callUpstream` error idiom + AMS-client persistence pattern; accept
      snake_case + camelCase-tolerant bodies
    - Contract (`BuildResultCallback`): required `{ company, project, outcome }`; exactly one of
      `job_id`/`bug_id`; `outcome in { implemented, deployed, failed, rejected }`; `target_base_url`
      required when `outcome=deployed`; optional `pr_url` + `summary`; respond `202 { acknowledged: true }`
  - [x] 3.3 Add the NEW inbound service-token check
    - Add an inbound service-token gate on this door (NEW — the existing `/api/implementation` routes
      are outbound-auth only); a bad/missing token returns `401`
  - [x] 3.4 Wire the `job_id` dispatch into the Driver advance
    - On a valid `job_id` callback, look up the run-item by `job_id` (Group 1 finder; `404` if unknown
      for the workspace) and call the Group 2 advance: `implemented` -> record `pr_url` + advance +
      dispatch next; `failed`|`rejected` -> halt + record against the work item; `deployed` (final
      spec) -> mark run deployed + record `target_base_url` + leave a clean reconciliation hand-off
      seam (Spec 4 — do not implement the reconcile body)
    - Make advances IDEMPOTENT: a duplicate `implemented`/`deployed`/`failed` for an already-advanced
      run-item is a no-op `202` (CD-6)
    - Leave the `bug_id` paths as a clean, unimplemented seam for Spec 4
    - Per-item failure isolation + structured logs (every inbound callback logs job_id, outcome, the
      resulting advance/no-op decision)
  - [x] 3.5 Ensure build-results tests pass
    - Run ONLY the 2-8 tests from 3.1 via targeted Jest, then `npx tsc --noEmit` in `gateway/`
    - Do NOT run the entire gateway suite

**Acceptance Criteria:**
- The 2-8 tests from 3.1 pass; `gateway` `npx tsc --noEmit` is clean
- `POST /api/implementation/build-results` validates the contract; responds `202 { acknowledged: true }`
- `401`/`404`/`422` returned for bad token / unknown `job_id` / missing-id-or-deployed-without-base-url
- `implemented` advances + dispatches next; `failed`/`rejected` halts + records; `deployed` marks
  deployed + records `target_base_url`
- Duplicate callbacks are idempotent no-op `202`s; `bug_id` paths remain a clean Spec-4 seam

---

### Gateway Shape-Spec Auto-Answerer

#### Task Group 4: Headless Shape-Spec Stream Drive + Auto-Answer Decision Endpoint
**Dependencies:** Task Group 2

Drive the shape-spec SSE stream server-side (reuse the proven `requestStream` in-process seam from
`shapeSpec.ts` + the `parseSSELine` event union from `useShapeSpecStream.ts`) and answer each
`questions` batch automatically from the migration context. It DECIDES (best grounded recommendation)
and NEVER ABSTAINS (the LOCK — no human-in-the-loop during the automated run). Reuse the architect
open-phase CHASSIS as the PATTERN (`openPhaseLoopRunner.ts`: the `ArchitectLlmClient` seam, the
`ARCHITECT_LOOP_*` limits, `withTimeout`, `runSingleToolRound`, never-throw results) with a NEW
answer-the-question tool — do NOT reuse the four architect-domain tools. Grounding = the combined
`generated_spec_text` (primary) + `contextResolvers.ts` (product/migration goal + discovery findings),
composed via the `buildOpenPhaseGrounding` PATTERN. Each `{ question, answer, rationale }` is appended
to the run-item inline decision log (CD-4). This endpoint/loop is what the Group 2 per-spec runner calls.

- [x] 4.0 Complete the shape-spec auto-answerer
  - [x] 4.1 Write 2-8 focused tests for the auto-answerer (gateway Jest; mock `llmClient` per the LLM-guard)
    - Limit to 2-8 highly focused tests maximum
    - Cover ONLY critical behaviours: the SSE-line parser handles the event union
      (`content`/`questions`/`folder`/`session`/`done`/`skill_invoked`); on a `questions` batch the
      answerer emits ONE combined numbered answer string (CD-1) and NEVER abstains; the resume re-POST
      uses `session_mode:'resume'` with NO `session_id` in the body (CD-1); each decision
      `{ question, answer, rationale }` is recorded to the run-item log (CD-4); a bounded-loop timeout
      yields a structured (never-throw) result
    - Skip exhaustive grounding-permutation coverage
  - [x] 4.2 Build the headless shape-spec stream drive
    - Call `requestStream(SHAPE_SPEC_STREAM_PATH, …)` in-process (the proven `shapeSpec.ts` seam,
      upstream Bearer auto-injected); feed the spec's combined `generated_spec_text` as the first message
    - Parse `data:` SSE lines with the same `parseSSELine` logic the browser hook uses (the event union
      above); on stream conclusion (`folder` + `session`) capture the `spec_name` (folder) for the
      orchestration handoff and the `session_id` for the `SpecIntent` only (NOT for shape-spec resume)
  - [x] 4.3 Build the resume re-POST loop (CD-1)
    - On each `questions` batch, re-POST ONE combined, numbered answer string with
      `session_mode:'resume'` and NO `session_id` in the body (the external service holds the session
      by company/project — matching the gateway proxy today)
    - Batch-process-then-`done` discipline mirroring the hook
  - [x] 4.4 Build the auto-answer decision logic (reuse the architect chassis PATTERN, NEW tool)
    - Reuse the `openPhaseLoopRunner.ts` CHASSIS: the `ArchitectLlmClient` seam, the `ARCHITECT_LOOP_*`
      limits (5 rounds / 30s per call / 120s wall from `llmLoopRunner.ts`), `withTimeout`,
      `runSingleToolRound`, never-throw structured results
    - Add a NEW single tool: given a streamed shape-spec QUESTION + the implementation-ready spec text +
      oracle grounding -> emit an ANSWER STRING + a short rationale, DECIDING, NEVER abstaining
    - Compose grounding via the `buildOpenPhaseGrounding` PATTERN: the combined `generated_spec_text`
      body as primary ground + `contextResolvers.ts` for product/migration goal + discovery findings
    - Append each `{ question, chosen answer, rationale }` to the run-item inline JSONB decision log
      (Group 1 PATCH; CD-4)
  - [x] 4.5 Ensure auto-answerer tests pass
    - Run ONLY the 2-8 tests from 4.1 via targeted Jest (LLM-guard — `llmClient` mocked), then
      `npx tsc --noEmit` in `gateway/`
    - Do NOT run the entire gateway suite

**Acceptance Criteria:**
- The 2-8 tests from 4.1 pass; `gateway` `npx tsc --noEmit` is clean
- The stream is driven headless in-process; the SSE event union parses correctly
- Each `questions` batch is answered with ONE combined numbered string, `session_mode:'resume'`, no
  `session_id` in the body; the answerer NEVER abstains
- The NEW answer tool decides from the spec text + composed grounding; the bounded loop never throws
- Each decision is recorded to the run-item inline JSONB log

---

### Frontend Migrate Surface

#### Task Group 5: Migrate Button + Hard-Block Gate UI + Defer Action + Run-Progress View
**Dependencies:** Task Groups 1-4

On the Migration Delivery Dashboard, modelled on `MigrationDeliveryGenerateAllDialog` (confirm dialog +
run-progress surface), book-of-work-scoped. The Migrate button is disabled with a clear blocking-reason
list when the hard-block fails (CD-7); a per-story "defer this story" action (with copy that defer
excludes from IMPLEMENTATION only, NOT from reconciliation) marks the story `deferred`; run-progress
surfaces per-spec dispatched/implemented/failed/deployed status + the auto-answer decision log from the
run-state read API. Frontend: vitest + `renderWithProviders`; tsc baseline 616.

- [x] 5.0 Complete the frontend Migrate surface
  - [x] 5.1 Write 2-8 focused tests for the Migrate UI (vitest + `renderWithProviders`)
    - Limit to 2-8 highly focused tests maximum
    - Cover ONLY critical behaviours: the Migrate button is DISABLED with the blocking-reason list
      rendered when a non-deferred story is un-ready or the `kind='current'` baseline is missing, and
      ENABLED when all in-scope stories are ready; the "defer this story" action marks the story
      `deferred` and removes it from the blocking set (the story still renders, not deleted); the
      run-progress view renders per-spec dispatched/implemented/failed/deployed status from run-state
    - Skip exhaustive state-permutation coverage
  - [x] 5.2 Add the Migrate button + confirm dialog (book-of-work-scoped)
    - Model on `MigrationDeliveryGenerateAllDialog.tsx`; mount on the Migration Delivery Dashboard;
      confirm gate before kicking the Migrate trigger (Group 2)
  - [x] 5.3 Implement the HARD-BLOCK gate UI
    - Disable Migrate until the client-side predicate passes: every in-scope (non-deferred) story
      spec-ready (`workItemId` / `backlogStatus = saved` AND
      `specGenerationStatus in { generated, generated_with_warnings }` AND `staleReason = null`) AND an
      active `kind='current'` baseline exists (CD-7)
    - When blocked, render a CLEAR list of exactly what is blocking — per-story reason + the
      missing-baseline reason; never silently skip (the server re-validates in Group 2 regardless)
  - [x] 5.4 Implement the per-story "defer this story" action
    - Explicit, visible per-story action that marks the story `deferred` (persist via the Group 1 AMS
      flag); a deferred story drops out of the in-scope hard-block set (the deliberate way to launch
      without an un-generated story)
    - Clear copy: defer excludes the story from IMPLEMENTATION in THIS run ONLY, and does NOT remove it
      from reconciliation scope — it will correctly surface as a break in Spec 4 (CD-7). Deferral is
      never silent
  - [x] 5.5 Build the run-progress view
    - Driven from the run-state read API (Group 1 `GET` run-state): per-spec dispatched / implemented /
      failed / deployed status, current position, halted, deployed; surface the per-spec auto-answer
      decision log (the inline JSONB from CD-4)
  - [x] 5.6 Ensure frontend tests pass
    - Run ONLY the 2-8 tests from 5.1 via targeted vitest, then `npx tsc --noEmit` against the 616-line
      tsc baseline (no NEW type errors beyond the baseline)
    - Do NOT run the entire frontend suite

**Acceptance Criteria:**
- The 2-8 tests from 5.1 pass; frontend tsc shows no new errors beyond the 616-line baseline
- Migrate is disabled with a clear, complete blocking-reason list (per-story + missing-baseline) when
  blocked; enabled only when fully ready
- "Defer this story" marks the story `deferred`, removes it from the blocking set, keeps it visible,
  and carries copy that it stays in reconciliation scope
- Run-progress reflects per-spec dispatched/implemented/failed/deployed + the auto-answer decision log

---

### End-to-End Gap Pass

#### Task Group 6: Strategic End-to-End Test Review & Gap Analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical end-to-end gaps only
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the 2-8 tests each from AMS run-state (1.1), Driver (2.1), build-results door (3.1),
      auto-answerer (4.1), and the Migrate UI (5.1) — roughly 10-40 existing tests
  - [x] 6.2 Analyze coverage gaps for THIS feature only
    - Identify critical end-to-end migration-execution workflows lacking coverage; focus ONLY on this
      spec's requirements (CD-1..CD-9), prioritising end-to-end flows over unit gaps
    - Do NOT assess whole-application coverage; skip edge/performance/accessibility unless
      business-critical
  - [x] 6.3 Write up to 12 additional strategic tests maximum
    - Maximum 12 NEW tests across the critical seams:
      - hard-block BLOCKS on a non-deferred un-ready story / missing baseline and PERMITS when all ready
      - defer EXCLUDES a story from the dispatch set while the story still exists (and stays in
        reconciliation scope conceptually)
      - ordered dispatch follows (depth, sequenceOrder) with TEST items after spanned children, and
        `deploy_on_complete=TRUE` is set ONLY on the final spec
      - a build-results `implemented` callback advances the run AND dispatches the next spec; a
        `failed`/`rejected` callback halts + records; a duplicate callback is an idempotent no-op
      - boot-recovery resumes an in-flight run stuck mid-segment
      - the auto-answerer answers a `questions` batch WITHOUT abstaining and logs the decision
      - the run-progress UI reflects run-state (dispatched/implemented/failed/deployed)
    - Do NOT write comprehensive coverage; skip non-critical permutations
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY this spec's tests: gateway targeted Jest (LLM-guard + `architectureModelClientMock`) +
      `npx tsc --noEmit`; AMS targeted FOREGROUND Maven (the run-state test class); frontend targeted
      vitest + tsc baseline 616 + `renderWithProviders`
    - Expected total roughly 22-52 tests; do NOT run any full application suite

**Acceptance Criteria:**
- All feature-specific tests pass (roughly 22-52 total across the three stacks)
- The critical end-to-end migration-execution workflows for this spec are covered
- No more than 12 additional tests added to fill gaps
- Testing is focused exclusively on this spec's requirements; no whole-suite runs

---

## Execution Order

Recommended implementation sequence (strict dependency order):
1. AMS Run-State Foundation — changeset 182, entities/DTOs/mapper/repo/service/endpoints, `deferred` flag (Task Group 1)
2. Gateway Migration Execution Driver — Migrate trigger, hard-block gate, sequence build, dispatch, background runner, advance + boot-recovery (Task Group 2)
3. Gateway Build-Results Receiver — `POST /api/implementation/build-results`, inbound token check, `job_id` dispatch into the Driver advance (Task Group 3)
4. Gateway Shape-Spec Auto-Answerer — headless stream drive, resume loop, decide-never-abstain tool (Task Group 4)
5. Frontend Migrate Surface — button, hard-block gate UI, defer action, run-progress view (Task Group 5)
6. End-to-End Gap Pass — up to 12 strategic tests (Task Group 6)

## Verification Conventions (per group)
- Gateway: `npx tsc --noEmit` in `gateway/` + targeted Jest with the live-LLM guard and the
  `architectureModelClientMock` helper (mock `llmClient` in auto-answerer tests). Run ONLY the
  group's new tests, never the full suite.
- AMS: targeted FOREGROUND Maven (single test class / `-Dtest=...`); confirm changeset 182 applies
  against the test H2 context. Never the full AMS suite mid-group.
- Frontend: targeted vitest with `renderWithProviders`; `npx tsc --noEmit` against the 616-line tsc
  baseline (no NEW errors). Run ONLY the group's new tests.
