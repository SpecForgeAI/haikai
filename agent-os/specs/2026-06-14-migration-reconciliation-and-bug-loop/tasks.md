# Task Breakdown: Migration Reconciliation + Bug Loop (Verification back-half, Spec 4 of 4)

## Overview
Total Tasks: 6 task groups

This is the FINAL spec of the 4-spec migration auto-flow program. It extends Spec 3's
build-results door with the deploy -> reconcile -> bug -> re-reconcile loop. Specs 1-3 are
built; this spec FILLS the two seams Spec 3 left:

- `migrationExecutionDriver.ts:771` `// TODO(Spec 4)` deployed branch (full-baseline reconcile).
- `buildResultsReceiver.ts:138-150` `bug_id` clean acknowledged-no-op seam (scoped re-reconcile + dispositions).

Confirmed reuse anchors (verified on disk):
- AMS highest changeset = **182** (Spec 3); register **183** after it in `db.changelog-master.yaml`.
- `migration_execution_run.pinned_current_baseline_id` already holds the oracle anchor (Driver writes it at Migrate, `migrationExecutionDriver.ts:462`).
- `api_behaviour_diff_item.source_baseline_item_id` is persisted by `diffRunner.ts:287` — the CD-6 scoped-re-reconcile resolution key.
- Reconciler is session-driven (`targetCaptureSessionActions.ts`: create -> /secrets -> /start -> 202 fire-and-forget `runTargetReplay` -> auto `runDiff`); `secretsStore` is in-memory, never persisted.
- Outbound via `implementationLlmProxyClient.request(...)` (`implementationLlmServiceBaseUrl` / `...BearerToken` in `gateway/src/config.ts`); inbound `buildResultsServiceToken` guard already exists in `buildResultsReceiver.ts` (reuse).
- Contract: `docs/reconciliation-integration/migration-reconciliation-integration.{md,openapi.yaml}`.

Governing corrections (CD-A, CD-B): the oracle is ALWAYS the pinned current-state baseline (no
override mechanism); reconciliation replays the FULL pinned baseline (NO deferred-exclusion).
Deferred / intentional deviations are handled by HUMAN DISPOSITION (`accepted / won't-report`),
never by changing the oracle.

## Task List

### Persistence Layer (AMS)

#### Task Group 1: Break <-> Bug Lifecycle + Disposition Store (changeset 183)
**Dependencies:** None
**Stack:** Java / Spring Boot (`architecture-model-service/`)

The run-scoped persistence the gateway loop reads and mutates: bug rows, the thin
`bug_id <-> api_behaviour_diff_item` link (reference existing diff_item rows ONLY — no
break-data duplication), the disposition lifecycle, attempt/round counters, and circuit-breaker
state. snake_case wire (global default); boxed PATCH-mutable Java types per
`project_primitive_double_dto_overwrite.md`.

- [x] 1.0 Complete the AMS break/bug lifecycle store
  - [x] 1.1 Write 2-8 focused tests (controller + service slice)
    - Limit to 2-8 highly focused tests maximum
    - Cover only: create breaks from a reconcile result (run + pinned baseline + `source_baseline_item_id` resolution key persisted); read breaks for a run; one disposition transition (e.g. `open -> reported`); attempt-counter increment is non-destructive on PATCH (boxed-type guard)
    - Put them in the existing `migration` test packages (`...controller/migration`, `...service/migration`)
    - Skip exhaustive coverage of every state and every endpoint
  - [x] 1.2 Create the `migration_reconciliation_bug` entity + the `bug_id <-> api_behaviour_diff_item` link
    - `migration_reconciliation_bug`: `bug_id`, `status`, circuit-breaker round/attempt counter, verdict, FK to Spec 3 `migration_execution_run` (run-scoped)
    - Thin link row references existing `api_behaviour_diff_item` ids only (NO break-data duplication) and carries the per-break disposition lifecycle + per-break attempt counter + per-break circuit-breaker flag
    - Mirror Spec 3's run-state persistence style (`migrationExecutionRun*` entities) and the `MigrationStorySpecGenerationEntity` boxed-type / `@Type(JsonType.class)` JSONB idiom for any verdict/evidence JSON column
  - [x] 1.3 Model the disposition lifecycle states
    - Machine states: `open` (new) -> `reported` (sent-as-bug; carries `bug_id`, attempt N) -> `fix_reported` -> `closed` (re-reconcile clean) | `needs_review` (still-broken after the re-run round, escalated)
    - Human dispositions (terminal, never re-run): `accepted / won't-report (intentional deviation or deferred)`, `disputed`
    - `accepted / won't-report` and the escalated `needs_review` are how edited-spec / deferred-story deviations are recorded WITHOUT changing the oracle
  - [x] 1.4 Create the Liquibase changeset 183 (NEW changeset ONLY)
    - New `sql/183-*.sql` registered in `db.changelog-master.yaml` AFTER `182-migration-execution-run-state.sql` (coordinate: 182 is the highest on disk)
    - Indexes for the run FK + the diff_item link FK; never edit applied changesets (`feedback_liquibase_immutable_changesets.md`)
  - [x] 1.5 Add DTO + Mapper + Repository + Service
    - snake_case wire (global default — no annotation); `@CamelCaseWire` ONLY if a camelCase consumer exists (none expected here)
    - Boxed PATCH-mutable types (`Integer` attempt counter, `Boolean`/`Long` flags) with null guards in the update path (`project_primitive_double_dto_overwrite.md`)
  - [x] 1.6 Add the endpoints the gateway loop needs
    - Create breaks from a reconcile result (run + pinned baseline + `source_baseline_item_id` keys)
    - Read breaks for a run (with disposition + attempt + circuit-breaker state)
    - Update a break's disposition; increment a break's attempt counter; set circuit-broken/escalated
  - [x] 1.7 Ensure the AMS layer tests pass
    - Run ONLY the 2-8 tests from 1.1, FOREGROUND, from INSIDE `architecture-model-service/`:
      `mvn -q -Dtest='MigrationReconciliationBug*Test' test` (adjust to the actual class names)
    - Verify changeset 183 applies on the H2 2.3 per-context DB
    - Do NOT run the full AMS suite at this stage

**Acceptance Criteria:**
- The 2-8 tests from 1.1 pass (foreground `mvn` from inside `architecture-model-service/`)
- Changeset 183 applies cleanly and is registered after 182
- Breaks persist tied to the run + pinned baseline + a `source_baseline_item_id` resolution key
- Disposition lifecycle, attempt counters, and circuit-breaker state round-trip; PATCH does not wipe boxed numeric fields

### Gateway — Deploy -> Reconcile Trigger

#### Task Group 2: `deployed` -> Full-Baseline Reconciliation (fills the Driver `TODO(Spec 4)`)
**Dependencies:** Task Group 1
**Stack:** Express / TypeScript (`gateway/`) + headless drive of `api-migration-validation-service`

On the `deployed` build-results outcome with NO `bug_id`, drive the reconciler against the run's
pinned `kind='current'` baseline. FULL baseline — NOT scoped to migrated specs; deferred /
un-migrated stories MUST surface as breaks (CD-B, the user's locked correction). Mirror the
session-driven harness server-side.

- [x] 2.0 Complete the full-baseline reconcile trigger
  - [x] 2.1 Write 2-8 focused tests
    - Limit to 2-8 highly focused tests maximum
    - Cover only: `deployed`+no-`bug_id` reads `pinned_current_baseline_id` and drives a FULL-baseline reconcile (NOT scoped to migrated specs); breaks persist to the Group 1 store keyed on run + `source_baseline_item_id`; a re-fired `deployed` does NOT start a second concurrent reconcile (idempotency, Spec 3 CD-6); creds-absent PAUSES in `needs target credentials` (CD-2 fallback)
    - Use the gateway live-LLM guard + `architectureModelClientMock` (`gateway/src/testSetup/architectureModelClientMock`)
    - Skip exhaustive transport / replay-engine internals (the engine body is reused unchanged)
  - [x] 2.2 Fill the Driver `// TODO(Spec 4)` deployed branch (`migrationExecutionDriver.ts:771`)
    - After Spec 3 records `target_base_url` on the run, read `pinned_current_baseline_id` (CD-1) and trigger the reconcile
    - HARD signal if no pinned baseline (the oracle anchor was set at Migrate; Migrate hard-blocks without one)
  - [x] 2.3 Mirror the session-driven harness server-side (drive, do NOT rebuild)
    - Create a `kind='target'` session (`source_baseline_id` = pinned baseline, `api_base_url` = `target_base_url`), load per-invocation creds into the validation-service `secretsStore`, transition to `running`, fire-and-forget `runTargetReplay` (auto-triggers `runDiff`) — the `targetCaptureSessionActions.ts` create/secrets/start/202 precedent
    - Full baseline: replay ALL accepted `kind='current'` `baseline_items`; NO deferred-exclusion logic (CD-B)
    - Add the gateway->validation trigger alongside the existing `apiMigrationValidation.ts` proxies (DI seams)
  - [x] 2.4 Persist breaks to the Group 1 store on completion
    - A break == a drifting `api_behaviour_diff_item`; key each on the run + `source_baseline_item_id`
    - Structured logs (`[diag-gateway]` prefix consistent with `buildResultsReceiver.ts`)
  - [x] 2.5 Idempotency + creds-absent pause
    - Re-fired `deployed` for the same run = no second concurrent reconcile (mirror Spec 3 CD-6)
    - Creds absent at callback time (restart / long run) -> PAUSE in `needs target credentials` for re-entry; creds STILL never stored/logged (CD-2)
  - [x] 2.6 Ensure the trigger tests pass
    - `npx tsc --noEmit` in `gateway/`
    - Run ONLY the 2-8 tests from 2.1 (with the live-LLM guard + `architectureModelClientMock`)
    - Do NOT run the full gateway suite at this stage

**Acceptance Criteria:**
- The 2-8 tests from 2.1 pass; `gateway` `npx tsc --noEmit` clean
- `deployed`+no-`bug_id` reads the pinned baseline and drives a FULL-baseline reconcile
- A deferred / un-migrated story's divergence surfaces as a break (CD-B)
- Breaks land in the Group 1 store keyed on run + `source_baseline_item_id`
- Re-fired `deployed` is idempotent; creds-absent pauses without storing creds

### Gateway — Human-Gated Bug Send

#### Task Group 3: Human-Gated Bug Send + Non-Sent Dispositions
**Dependencies:** Task Group 2
**Stack:** Express / TypeScript (`gateway/`)

The human gate: an endpoint where the human submits SELECTED breaks as bugs (one report per
batch) and assigns dispositions to the rest. Nothing auto-sends.

- [x] 3.0 Complete the bug-send + disposition endpoint
  - [x] 3.1 Write 2-8 focused tests
    - Limit to 2-8 highly focused tests maximum
    - Cover only: a selected batch POSTs ONE snake_case `CreateBugRequest` per the contract (per-request `callback_url` + `bug_id`) via `implementationLlmProxyClient`; those breaks become `reported` (`bug_id`, attempt=1); a NON-sent break gets a human disposition (`accepted / won't-report` | `disputed`) and the oracle is unchanged
    - Use the live-LLM guard + `architectureModelClientMock`
  - [x] 3.2 Add the send endpoint (the human gate)
    - Input: the user-selected break batch for the run; nothing auto-fires (CD-4)
    - One `POST /api/v2/bugs` per batch (CD-5) via `implementationLlmProxyClient.request('/api/v2/bugs', ...)` — the existing authed outbound seam (no new transport)
  - [x] 3.3 Build the snake_case `CreateBugRequest` body (CD-3)
    - snake_case (`company`, `project`, `bug_type:"reconciliation"`, `title`, `bug_description`) — matches BOTH the round-2 running service AND the pinned doc; NO doc change for the bug send
    - `bug_description`: one prose entry per break; attach `breaks.json` `BreakEvidence[]` (operation, request, expected_response, actual_response, diff)
    - Send `callback_url` (Haikai's build-results URL) on EVERY bug report while the verification service is external
  - [x] 3.4 Mark sent breaks + persist `bug_id -> [break ids]`
    - Sent breaks -> `reported` with `bug_id`, attempt=1 (Group 1 store)
  - [x] 3.5 Persist non-sent dispositions
    - Breaks NOT sent get `accepted / won't-report (intentional deviation or deferred)` or `disputed` — TERMINAL, not sent, not re-run; the oracle is NEVER mutated (CD-A)
  - [x] 3.6 Ensure the send tests pass
    - `npx tsc --noEmit` in `gateway/`
    - Run ONLY the 2-8 tests from 3.1 (live-LLM guard + `architectureModelClientMock`)
    - Do NOT run the full gateway suite at this stage

**Acceptance Criteria:**
- The 2-8 tests from 3.1 pass; `gateway` `npx tsc --noEmit` clean
- A selected batch sends ONE snake_case `CreateBugRequest` (with `callback_url` + `bug_id`); breaks become `reported`
- `bug_id -> [break ids]` persisted; `breaks.json` evidence attached
- Non-sent breaks get a terminal human disposition with the oracle unchanged
- Nothing auto-sends (the send is the human gate)

### Gateway — Bug Callback -> Scoped Re-Reconcile + Circuit Breaker

#### Task Group 4: `bug_id` Callback -> Scoped Re-Reconcile + Circuit Breaker (fills the `bug_id` seam)
**Dependencies:** Task Groups 1-3
**Stack:** Express / TypeScript (`gateway/`) + headless drive of `api-migration-validation-service`

Fill the `buildResultsReceiver.ts:138-150` `bug_id` clean no-op seam. On a `bug_id` fix outcome,
re-reconcile ONLY the affected area (via `source_baseline_item_id`), apply the circuit breaker,
and stay idempotent.

- [x] 4.0 Complete the scoped re-reconcile + circuit breaker
  - [x] 4.1 Write 2-8 focused tests
    - Limit to 2-8 highly focused tests maximum
    - Cover only: `bug_id`+`deployed` re-reconciles ONLY that bug's breaks (resolved via `source_baseline_item_id`, NOT the whole baseline); clean -> `fixed_confirmed`/`closed`; still-broken -> attempt++ and the circuit breaker is checked; trip -> `circuit-broken`/escalated `needs_review` with NO auto-loop; `bug_id`+`failed`/`rejected` -> terminal `needs_review` (no re-run); a duplicate callback for an already-terminal break/bug is a no-op `202`
    - Reuse the inbound `buildResultsServiceToken` guard (already in `buildResultsReceiver.ts`)
    - Use the live-LLM guard + `architectureModelClientMock`
  - [x] 4.2 Fill the `bug_id` dispatch seam (`buildResultsReceiver.ts:138-150`)
    - `bug_id`+`deployed` -> scoped re-reconcile; `bug_id`+`failed`/`rejected` -> terminal `needs_review` (no re-run); keep the `202 { acknowledged: true }` contract + inbound token guard unchanged (Spec 3)
  - [x] 4.3 Scoped re-reconcile (only the affected area)
    - Resolve "that bug's breaks" -> source operations via each `api_behaviour_diff_item.source_baseline_item_id` (CD-6) and diff JUST those (reuse the `diffActions.ts` recompute/create-diff path against `target_base_url`)
    - Clean -> `fixed_confirmed`/`closed`; still-differing -> reopen
  - [x] 4.4 Circuit breaker
    - On still-broken: increment the attempt/round counter (Group 1) and check the max-attempts threshold (configurable, per break/area)
    - Under the cap -> may re-send/loop; on trip -> `circuit-broken-escalated` (terminal `needs_review`, human disposition); do NOT auto-loop (CD-6: the bounded re-run round)
    - `failed`/`rejected` outcomes escalate to `needs_review` with no re-run
  - [x] 4.5 Idempotency
    - Duplicate callback for an already-terminal break/bug = no-op `202` (Spec 3 CD-6 consistency); no second concurrent scoped re-reconcile
  - [x] 4.6 Ensure the callback tests pass
    - `npx tsc --noEmit` in `gateway/`
    - Run ONLY the 2-8 tests from 4.1 (live-LLM guard + `architectureModelClientMock`)
    - Do NOT run the full gateway suite at this stage

**Acceptance Criteria:**
- The 2-8 tests from 4.1 pass; `gateway` `npx tsc --noEmit` clean
- `bug_id`+`deployed` re-reconciles ONLY the affected area via `source_baseline_item_id`
- Clean -> `fixed_confirmed`; still-broken -> attempt++ then circuit-breaker check
- Circuit breaker trips to escalated `needs_review` with NO infinite loop; `failed`/`rejected` escalate without a re-run
- Duplicate callbacks are idempotent no-ops; inbound token guard reused unchanged

### Frontend — Reconciliation Review Surface

#### Task Group 5: Reconciliation Review + Select-to-Send + Disposition UI
**Dependencies:** Task Groups 1-4
**Stack:** React / TypeScript (`frontend/`)

List the run's breaks, let the human SELECT which to send as bugs (the gate) vs assign a
disposition, and show re-reconcile outcomes + attempt counts. Extend the existing breaks UI as the
design basis; reuse Spec 3's run-progress/banner patterns.

- [x] 5.0 Complete the reconciliation review surface
  - [x] 5.1 Write 2-8 focused tests
    - Limit to 2-8 highly focused tests maximum
    - Cover only: the breaks list renders per-break disposition + attempt + circuit-breaker state; selecting a batch + Send invokes the bug-send client; a non-sent break's disposition assignment invokes the disposition client; the `fixed_confirmed`/`still_broken`/`escalated` states render
    - Use `renderWithProviders`; mock the new bug-lifecycle client
  - [x] 5.2 Extend the breaks table for the reconciliation run
    - Design basis: the existing breaks UI (`DriftReportTab.tsx` counts strip + sortable/filterable diff-item table; `DiffItemDetailModal.tsx` source-vs-target detail; `DiffFindingDetailDrawer.tsx` disposition drawer)
    - Make the break == drifting `api_behaviour_diff_item` equivalence explicit (UI may keep "drift" copy per the existing convention)
    - Columns: source operation/area, disposition, attempt/round counter, circuit-breaker state
  - [x] 5.3 Build select -> "Send bug report" (batch) — the human gate
    - Select breaks -> Send action -> the Group 3 endpoint; nothing auto-sends
  - [x] 5.4 Build the disposition assignment (non-sent breaks)
    - Assign `accepted / won't-report` | `disputed` to breaks not sent -> the Group 1/3 disposition path (oracle unchanged)
  - [x] 5.5 Show re-reconcile outcomes + the needs-review queue + the creds pause
    - Render `fixed_confirmed` / `still_broken` / `escalated` + attempt counts; a `needs_review` queue; surface the `needs target credentials` pause state for re-entry (CD-2 fallback)
    - Reuse Spec 3's run-progress / banner patterns
  - [x] 5.6 Add the new bug-lifecycle/disposition client
    - Extend `apiBehaviourClient.ts` / `diffFindingsApi.ts` where they fit; add a NEW client for the bug-lifecycle/disposition data (Group 1 endpoints)
  - [x] 5.7 Ensure the UI tests pass
    - Run ONLY the 2-8 tests from 5.1 (vitest, `renderWithProviders`)
    - `npx tsc --noEmit` in `frontend/` stays within the 616-line tsc baseline (do not exceed it)
    - Do NOT run the full frontend suite at this stage

**Acceptance Criteria:**
- The 2-8 tests from 5.1 pass; the `frontend` tsc baseline (616) is not exceeded
- Breaks list shows source operation/area + disposition + attempt + circuit-breaker state
- Select -> Send invokes the bug-send gate; non-sent breaks take a disposition (oracle unchanged)
- Re-reconcile outcomes, the needs-review queue, and the `needs target credentials` pause render

### Testing

#### Task Group 6: End-to-End Gap Review (loop coverage)
**Dependencies:** Task Groups 1-5
**Stack:** cross-stack (gateway Jest primarily; AMS / frontend where a gap is loop-critical)

- [x] 6.0 Review existing tests and fill critical loop gaps only
  - [x] 6.1 Review the tests from Task Groups 1-5
    - Group 1 (AMS, 2-8) + Group 2 (gateway, 2-8) + Group 3 (gateway, 2-8) + Group 4 (gateway, 2-8) + Group 5 (frontend, 2-8) ~= 10-40 existing tests
  - [x] 6.2 Analyze gaps for THIS feature's loop only
    - Identify untested end-to-end transitions of the deploy -> reconcile -> bug -> re-reconcile loop
    - Do NOT assess whole-application coverage; focus ONLY on this spec's loop
  - [x] 6.3 Write up to 12 strategic end-to-end tests maximum
    - Target these loop transitions (add only what 6.1 did not already cover):
      - `deployed` -> FULL-baseline reconcile persists breaks INCLUDING a deferred-story break (the CD-B locked correction)
      - human-gated send POSTs `CreateBugRequest` + marks the breaks `reported`
      - an un-sent break gets a disposition and the oracle is unchanged (CD-A)
      - `bug_id` callback -> SCOPED re-reconcile: clean -> `fixed_confirmed`; still-broken -> attempt++
      - circuit breaker trips -> escalated `needs_review` (NO infinite loop)
      - a duplicate callback is an idempotent no-op `202`
      - the review UI reflects each of the above states
    - Maximum 12 new tests; skip non-loop edge cases, performance, and accessibility unless loop-critical
  - [x] 6.4 Run feature-specific tests only
    - Gateway: ONLY this spec's tests (live-LLM guard + `architectureModelClientMock`); `npx tsc --noEmit`
    - AMS: ONLY the Group 1 + any new loop tests, FOREGROUND `mvn` from INSIDE `architecture-model-service/`
    - Frontend: ONLY this spec's vitest (`renderWithProviders`); tsc baseline 616 not exceeded
    - Expected total ~= 22-52 tests; do NOT run any full application suite

**Acceptance Criteria:**
- All feature-specific tests pass (~22-52 total across the three stacks)
- The full deploy -> reconcile -> bug -> re-reconcile loop is covered end-to-end, including the deferred-story break (CD-B) and the oracle-unchanged disposition (CD-A)
- The circuit breaker is proven to terminate (no infinite loop)
- No more than 12 additional tests added; coverage stays exclusively on this spec's loop

## Open Contract Detail (does NOT block this task list)

- The verdict round-trip `POST /api/v2/reconciliation` (CD-7) — sent ONCE after the full
  reconciliation completes, REGARDLESS of outcome, carrying the verdict (`verified` /
  `breaks_found`) + the box/cell correlation taken FROM the `deployed` callback — is ABSENT from the
  pinned openapi. Its exact field shape MUST be pinned with the external developer (modelled on the
  external `source` + `findings[{ verdict, cell keys }]` intake) BEFORE that sub-task builds. This
  is a contract detail, not an unresolved product decision; fold the send into Group 2's completion
  path once the shape is confirmed.

## Execution Order

Recommended implementation sequence (strict dependency order):
1. AMS break/bug lifecycle store, changeset 183 (Task Group 1)
2. Gateway `deployed` -> full-baseline reconcile trigger (Task Group 2)
3. Gateway human-gated bug send + non-sent dispositions (Task Group 3)
4. Gateway `bug_id` callback -> scoped re-reconcile + circuit breaker (Task Group 4)
5. Frontend reconciliation review + select-to-send + disposition UI (Task Group 5)
6. End-to-end gap review (Task Group 6)
