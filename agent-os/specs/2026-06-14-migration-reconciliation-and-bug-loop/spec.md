# Specification: Migration Reconciliation + Bug Loop (Verification back-half, Spec 4 of 4)

## Goal
After the Migration Execution Driver's final spec deploys, reconcile the full migrated system against the pinned current-state behavioural baseline, let a human review the resulting breaks and gate which are sent as bug reports, then close the loop with scoped re-reconciliation, a circuit breaker, and a verdict release — handling intentional/deferred deviations by human disposition, never by changing the oracle.

## User Stories
- As a migration engineer, when the target deploys I want the system to automatically replay every captured current-state operation against it and surface all behavioural breaks, so I can see exactly where the migrated system diverges from the legacy black box.
- As a migration engineer, I want to review the breaks and explicitly choose which to send as bug reports versus dispose (accepted / won't-report) for intentional or deferred deviations, so I never auto-file a "bug" for a deliberate change.
- As a migration engineer, I want a fixed bug to re-reconcile only its own breaks and a circuit breaker to escalate a still-broken break to me, so the fix→re-reconcile loop cannot spin forever.

## Specific Requirements

**Build-results door extension (gateway — fills Spec 3's `deployed` TODO + the `bug_id` seam)**
- Extend `POST /api/implementation/build-results` (Spec 3's `buildResultsReceiver.ts` on `implementationProjectsRouter`); keep Spec 3's validation, inbound service-token guard (`buildResultsServiceToken`), and `202 { acknowledged: true }` contract unchanged.
- `deployed` + NO `bug_id` (final-spec deploy): replace the `// TODO(Spec 4)` no-op — after Spec 3 records `target_base_url` on the run, trigger a FULL-BASELINE reconciliation against that URL.
- `bug_id` + `deployed`: SCOPED re-reconciliation of only that bug's breaks against `target_base_url` (respect the circuit breaker).
- `bug_id` + `failed` / `rejected`: route that bug's break(s) to a terminal `needs_review` disposition (no re-run).
- Idempotency consistent with Spec 3 (CD-6): a duplicate/re-fired callback for an already-terminal break/bug is a no-op `202`; a re-fired `deployed` must not start a second concurrent reconciliation for the same run.

**Reconciliation oracle = pinned current-state baseline, ALWAYS (CD-1, CD-A)**
- The oracle is the `kind='current', status='active'` `ApiBehaviourBaseline` pinned on the migration run at Migrate time — read `migration_execution_run.pinned_current_baseline_id` when the `deployed` callback drives reconciliation (NOT "most recent active baseline at reconcile time").
- Each target response is compared to the current-state response for the same request; ANY deviation is a break. There is NO v1 mechanism to override the expected response.
- A manually-edited spec that intentionally changes behaviour WILL surface as a break — correct and by design. Intentional deviations are resolved by human disposition (below), never by narrowing or mutating the oracle.

**Full-baseline reconciliation — replay the WHOLE pinned baseline, no deferred-exclusion (CD-B)**
- Replay ALL accepted `kind='current'` `baseline_items` of the pinned baseline against the deployed target; there is NO deferred-exclusion logic and reconciliation is NOT scoped to only the migrated specs.
- A deferred / un-implemented story's behaviour absent or divergent in the migrated system surfaces as a break exactly like any other deviation (the truthful signal); it is then handled by the `accepted / won't-report` disposition.
- Drive the existing `api-migration-validation-service` reconciler headlessly (do not rebuild it): server-side create a `kind='target'` session (`source_baseline_id` = pinned baseline, `api_base_url` = `target_base_url`), load per-invocation creds into `secretsStore`, transition to `running`, fire-and-forget `runTargetReplay`, which auto-triggers `runDiff`. A break == a drifting `api_behaviour_diff_item`.
- The reconciliation run is in-memory fire-and-forget (secrets lost on restart); the trigger and lifecycle must be idempotent and tolerate a re-fired `deployed` callback (mirror Spec 3 CD-6).

**Target credentials — captured once at Migrate, never stored (CD-2)**
- Target-env credentials are captured once at the Migrate confirm step and held in the validation service's in-memory `secretsStore` for the run only — never persisted, never logged; `type:'none'` allowed for an unauthenticated like-for-like target.
- The `deployed` callback supplies `target_base_url` (location) but NO credentials (location ≠ access); creds are sourced our side at reconciliation time.
- Fallback: if creds are absent when the `deployed` callback lands (restart / long-running run), the run PAUSES in a `needs target credentials` state for the user to re-enter — still never stored.

**Breaks review surface — human-gated bug send (CD-4)**
- Reconciliation runs automatically and records ALL breaks; the bug report is NOT auto-fired.
- The human reviews breaks (operation, replayed request, current-state expected, target actual, structured diff) in the breaks surface, selects a batch, and clicks Send. Naming: "break" == drifting `api_behaviour_diff_item` (UI may keep "drift" copy per the existing convention; make the break==diff_item equivalence explicit).
- Breaks the human does NOT send get a disposition (see disposition states); the send is the human gate.

**Bug-report send — one report per selected batch, snake_case (CD-3, CD-5)**
- One `POST /api/v2/bugs` per user-selected batch via the existing authed `implementationLlmProxyClient.request(...)` outbound seam (no new transport); body is snake_case `CreateBugRequest` (`company`, `project`, `bug_type:"reconciliation"`, `title`, `bug_description`) — matches both the round-2 running service and the pinned doc, so NO doc change for the bug send.
- `bug_description` carries one prose entry per break; attach a `breaks.json` `BreakEvidence[]` (operation, request, expected_response, actual_response, diff). Send `callback_url` (Haikai's build-results URL) on every bug report while the verification service is external.
- Persist `bug_id → [break ids]`.

**Break ↔ bug lifecycle persistence (AMS — new changeset 183, CD-8)**
- New `migration_reconciliation_bug` row: `bug_id`; `status`; circuit-breaker round counter; verdict; FK to the Spec 3 `migration_execution_run` (run-scoped). PLUS a thin `bug_id ↔ api_behaviour_diff_item` link table (reference existing diff_item rows only — NO break-data duplication).
- Persist the per-break disposition lifecycle (see disposition states), the attempt/round counter, and the circuit-breaker state. Match Spec 3's run-state persistence style.
- New Liquibase changeset only — 182 is the latest registered (Spec 3); register 183 AFTER it. snake_case wire; boxed PATCH-mutable Java types (Integer/Boolean/Long per `project_primitive_double_dto_overwrite.md`); `@CamelCaseWire` only where a camelCase consumer exists. Never edit applied changesets.

**Disposition states (CD-A, CD-8)**
- Lifecycle: `open` (new) → `reported` (sent-as-bug; bug_id, attempt N) → `fix_reported` → `closed` (re-reconcile clean) | `needs_review` (still-broken after the re-run round, escalated) ; plus the human dispositions `accepted / won't-report` and `disputed`.
- `accepted / won't-report (intentional deviation or deferred)` is TERMINAL: not sent, not re-run — this is how edited-spec and deferred-story deviations are handled WITHOUT changing the oracle.

**Scoped re-reconciliation + circuit breaker (CD-6)**
- On a `bug_id` + `deployed` callback, replay ONLY that bug's breaks' source operations — resolved via each `api_behaviour_diff_item.source_baseline_item_id` — and diff just those (reuse the recompute/create-diff path).
- Close the break on match; on a still-differing break, reopen → `needs_review`.
- Circuit breaker = that single re-run round (max-attempts threshold; configurable): a re-run still differing is NOT auto-re-reported — it escalates to the terminal `needs_review` (human) disposition. `failed`/`rejected` bug outcomes also escalate to `needs_review` with no re-run.

**Verdict round-trip release (CD-7)**
- `POST /api/v2/reconciliation` (via the authed proxy) is sent ONCE after the full reconciliation completes, REGARDLESS of outcome (always release the box), carrying the verdict (`verified` / `breaks_found`) plus the box/cell correlation taken FROM the `deployed` callback.
- CONTRACT DETAIL TO PIN (open by design): this endpoint is absent from the pinned openapi; its exact field shape (modelled on the external `source` + `findings[{ verdict, cell keys }]` intake) MUST be confirmed with the external developer BEFORE this sub-task builds. This is a contract detail, not an unresolved product decision.

**Reconciliation review frontend surface**
- List all breaks for the run's reconciliation; allow break selection → "Send bug report" (batch) action; show per-break disposition, attempt/round counter, and circuit-breaker state; show re-reconcile outcomes and a `needs_review` queue. Surface the `needs target credentials` pause state for re-entry.
- Extend the existing breaks UI (`DriftReportTab` / `DiffItemDetailModal` / `DiffFindingDetailDrawer`) and clients (`apiBehaviourClient`, `diffFindingsApi`); add a new client for the bug-lifecycle/disposition data. vitest + `renderWithProviders`; respect the 616-line tsc baseline.

## Visual Design
No visual assets provided (`planning/visuals/` is empty). Reuse the existing breaks UI structure (counts strip, sortable/filterable diff-item table, View-diff source-vs-target modal, findings drawer) as the design basis for the review/selection/disposition surface.

## Existing Code to Leverage

**`gateway/src/services/buildResultsReceiver.ts` (Spec 3 door)**
- Already validates the `BuildResultCallback`, enforces the inbound service-token guard, and acknowledges `202`. The `deployed` branch records `target_base_url` with a `// TODO(Spec 4)` marker and the `bug_id` branch is a clean acknowledged-no-op seam — Spec 4 fills both, keeping idempotency.

**`gateway/src/services/migrationExecutionDriver.ts` + `architecture-model-service/.../sql/182-migration-execution-run-state.sql`**
- `migration_execution_run` already carries `pinned_current_baseline_id` (the reconciliation oracle anchor) and `target_base_url`; `work_item.deferred` is implementation-exclusion ONLY and its 182 comment already affirms deferred stories stay in reconciliation scope. Read the pinned baseline + run scope from here; mirror this run-state persistence style for changeset 183.

**`api-migration-validation-service` replay/diff engine (drive headlessly; reuse body unchanged)**
- `targetReplayRunner.ts` `runTargetReplay(sessionId)` replays every source baseline_item against the target and auto-triggers `runDiff`; `diffRunner.ts` `runDiff(diffId)` classifies each pair into `api_behaviour_diff_item` rows (carrying `source_baseline_item_id` — the CD-6 scoped-re-reconcile key) and emits findings. `targetCaptureSessionActions.ts` is the create→secrets→start→202-fire-and-forget pattern a headless trigger mirrors server-side; `diffActions.ts` is the recompute/create-diff path for scoped re-reconciliation.

**`secretsStore.ts` + `startupReconciliation.ts`**
- In-memory, sessionId-keyed, never-persisted/never-logged creds bundle (the CD-2 per-invocation pattern); orphaned `running` sessions are marked `failed` on restart (the basis for the CD-2 `needs target credentials` pause fallback).

**`gateway/src/services/implementationLlmProxyClient.ts` + `gateway/src/config.ts`**
- `request(path, { method, body })` is the authed outbound seam (injects `implementationLlmServiceBearerToken`, targets `implementationLlmServiceBaseUrl`) for `POST /api/v2/bugs` and `POST /api/v2/reconciliation` — no new transport. `buildResultsServiceToken` is the existing inbound guard to reuse.

**`frontend` breaks UI + `docs/reconciliation-integration/`**
- `DriftReportTab.tsx` / `DiffItemDetailModal.tsx` / `DiffFindingDetailDrawer.tsx` + `apiBehaviourClient.ts` / `diffFindingsApi.ts` are the breaks table + source-vs-target detail + disposition-drawer pattern to extend for select→send→disposition. The pinned contract (`migration-reconciliation-integration.md` + `.openapi.yaml`) carries `BuildResultCallback`, `CreateBugRequest`/`BreakEvidence`, the dispatch table, and the break lifecycle — align all wire shapes to it.

## Out of Scope
- Spec 1: implementation-ready spec generation (`migration_story_spec_generations`, changeset 181).
- Spec 2: holistic INTEGRATION/E2E TEST work-item creation.
- Spec 3: the Migrate button, the Migration Execution Driver, the shape-spec auto-answerer, and the build-results door ITSELF + its `job_id` paths (Spec 4 only EXTENDS the door with the `deployed`/`bug_id` reconcile paths).
- The external implementation/verification service's bug investigate → fix → redeploy, its CI verification, and the haibox deploy.
- Rebuilding the reconciler — `api-migration-validation-service` is driven, not rebuilt; its own `reconcile.py` their-side fallback is not used in this flow.
- Any deferred-exclusion logic in reconciliation scope (explicitly removed per CD-B — reconcile the full pinned baseline).
- Any oracle-override / expected-response-editing mechanism (no v1 mechanism; intentional deviations are handled by disposition per CD-A).
- Auto-firing bug reports after reconciliation (the send is human-gated per CD-4).
- Pinning the exact `POST /api/v2/reconciliation` field shape in code before it is confirmed with the external developer (open contract detail per CD-7).
