# Specification: API Test Harness — Diff Engine

## Goal

Add a deterministic diff engine in `api-migration-validation-service` that compares the paired source / target API Behaviour Baselines (produced by Spec #4), classifies each scenario by status and body shape/value, and persists the structured drift in two new AMS tables (`api_behaviour_diffs` + `api_behaviour_diff_items`). The diff is auto-triggered at the end of target replay, manually recomputable, and exposed via a new "Drift report" tab on `BaselineDetailView` when `baseline.kind === 'target'` — providing the structured artefact that Spec #6 (findings integration) will consume.

## User Stories

- As an Architect validating a migration cutover, I want a structured drift report automatically produced when a target replay completes — classifying each scenario as matched, status-drift, body-shape-drift, body-value-drift or source-only — so that I can see the migration deltas without diffing JSON in two browser tabs.
- As a Test Engineer reviewing drift, I want to drill into any diff item to see the source response and target response side-by-side with the differing paths annotated, so that I can confirm whether each delta is a real regression or expected drift.
- As an Architect rerunning a target capture after a fix, I want a "Recompute" button on the drift report tab and a "Stale" badge when either baseline has moved on, so that I can refresh the comparison without re-running the whole replay.

## Specific Requirements

**AMS persistence — two Liquibase changesets (additive only)**
- Verify the highest applied changeset slot at implementation time (`ls architecture-model-service/src/main/resources/db/changelog/sql/ | sort -V | tail -5`). Spec #4 landed at slots `156` and `157`; predicted next free slots are `158` and `159`, but other in-flight specs may have intervened — confirm empirically before naming the files. Update `db.changelog-master.yaml` accordingly.
- `<N>-api-behaviour-diffs.sql`: `id UUID PK`, `project_id UUID NOT NULL FK→projects(id) ON DELETE CASCADE`, `architecture_id UUID NOT NULL`, `source_baseline_id UUID NOT NULL FK→api_behaviour_baselines(id) ON DELETE CASCADE`, `target_baseline_id UUID NOT NULL FK→api_behaviour_baselines(id) ON DELETE CASCADE`, `status TEXT NOT NULL DEFAULT 'computing'` (`'computing' | 'completed' | 'failed'`), `matched_count INT`, `status_drift_count INT`, `body_shape_drift_count INT`, `body_value_drift_count INT`, `source_only_count INT`, `target_only_count INT`, `source_baseline_updated_at TIMESTAMPTZ`, `target_baseline_updated_at TIMESTAMPTZ`, `computed_at TIMESTAMPTZ`, `error_message TEXT`, `created_at/updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`. UNIQUE `(source_baseline_id, target_baseline_id)`; indexes on `source_baseline_id` and `target_baseline_id`.
- `<N+1>-api-behaviour-diff-items.sql`: `id UUID PK`, `diff_id UUID NOT NULL FK→api_behaviour_diffs(id) ON DELETE CASCADE`, `method TEXT NOT NULL`, `path TEXT NOT NULL`, `scenario_name TEXT NOT NULL`, `source_baseline_item_id UUID NULL`, `target_baseline_item_id UUID NULL`, `status_classification TEXT NOT NULL` (`'status_match' | 'status_drift' | 'source_only' | 'target_only'`), `body_classification TEXT NULL` (`'body_match' | 'body_shape_drift' | 'body_value_drift'`), `source_response_status INT`, `target_response_status INT`, `body_diff_json JSONB`, `notes TEXT`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`. Indexes on `diff_id` and `(diff_id, method, path)`.
- Register both changesets as new `changeSet` blocks in `db.changelog-master.yaml` using the `preConditions: onFail: MARK_RAN` pattern that existing api-behaviour changesets use; never edit prior changesets.

**AMS Java layer — entities, repositories, services, controllers**
- Two new entities (`ApiBehaviourDiffEntity`, `ApiBehaviourDiffItemEntity`) following the established Lombok + `@JdbcTypeCode(SqlTypes.JSON)` pattern. `body_diff_json` mapped as `Map<String, Object>`.
- Two new repositories with finders: `findByTargetBaselineId(UUID)`, `findBySourceBaselineId(UUID)`, `findByDiffIdOrderByMethodAscPathAsc(UUID)`.
- Two new services (`ApiBehaviourDiffService`, `ApiBehaviourDiffItemService`) — pure CRUD; the diff computation lives in the validation service. AMS is the system of record only.
- Two new controllers under `/api/projects/{projectId}/api-behaviour/diffs/...` mirroring the existing api-behaviour controller pattern, plus a UI-lookup endpoint: `GET /api/projects/{projectId}/api-behaviour/diffs/by-target/{targetBaselineId}`.
- Service-layer validation (no DB enum): a diff's `source_baseline_id` MUST point at a `kind='current'` baseline; `target_baseline_id` MUST point at a `kind='target'` baseline whose `paired_with_baseline_id` equals the diff's source. Reject mismatched pairs with a typed validation error.

**PATCH safety for all new fields**
- All numeric count fields (`matched_count`, `status_drift_count`, `body_shape_drift_count`, `body_value_drift_count`, `source_only_count`, `target_only_count`, `source_response_status`, `target_response_status`) are boxed `Integer` — no `int`. Per `project_primitive_double_dto_overwrite.md`, any DTO field that participates in PATCH semantics must be a boxed type so missing JSON does not silently wipe to `0`.
- All other new fields are reference types (`String`, `UUID`, `Instant`, `Map<String, Object>` for the JSONB `body_diff_json`) — no primitive-type drift risk.
- Note this explicitly in the relevant DTO Javadoc so future maintainers adding count fields know the rule.

**`api-migration-validation-service/src/services/diffRunner.ts` (~300-400 LOC)**
- Entry point: `runDiff(diffId: string, deps?: DiffRunnerDeps): Promise<void>`. Body: load diff via `archModelClient.getDiff` → load source baseline items (paginated) → load target baseline items → build a map keyed `${method}|${path}|${scenario_name}` for both sides → classify each pair via `jsonShapeComparator` → persist diff_items in batch → PATCH diff to `status='completed'` with summary counts + `computed_at` + both baselines' `updated_at` snapshots.
- For source items with no paired target, emit `source_only`; notes field carries the reason (`mutating_skipped` / `transport_failure` / `no_paired_target`).
- For target items with no paired source, emit `target_only` (shouldn't appear in v1 since replay is source-driven, but schema and runner support it for forward compatibility).
- On any unrecoverable error, PATCH diff to `status='failed'` with `error_message`; emit a diagnostic log line and exit cleanly.
- Uses `runManager.start({ sessionId: diffId, projectId, architectureId })` for background-task tracking; the second rapid invocation throws synchronously (caught by the route handler and surfaced as HTTP 409).

**`api-migration-validation-service/src/services/jsonShapeComparator.ts` (~150-250 LOC)**
- `compareJsonShapes(source: unknown, target: unknown): { classification: 'body_match' | 'body_shape_drift' | 'body_value_drift'; diffAnnotation: BodyDiffAnnotation }`.
- **Step 1 — symmetric wrapper unwrap (critical, see `response_json` mismatch below):** if an input JSON is an object whose keys are EXACTLY `headers` and `body` (and nothing else), unwrap to `body` before comparing. Applied to both sides independently. Any other shape: leave verbatim.
- Walks both JSON trees in parallel; at each path classifies as `key_added` / `key_removed` / `type_changed` / `value_changed` / `match`; returns a flat list of differences keyed by JSON pointer.
- Aggregates leaf classifications into the top-level result: `body_shape_drift` wins over `body_value_drift` if any key/type drift exists; `body_match` only when there are zero differences after unwrap.
- Array comparison is **ordered/positional** in v1. Unordered + match-by-id is a v2 concern.
- Compares **response bodies only**. Request bodies are identical-by-construction (the Spec #4 replay carries the source request verbatim) and are not walked.

**`response_json` wrapper-shape normalization (critical implementation pitfall)**
- Source-side `response_json` stores the raw response body (e.g. `{ user: {...} }`).
- Target-side `response_json` stores `{ headers, body }` — actual body nested under `.body`.
- Without normalization, every paired item would be flagged `body_shape_drift` and the feature would look broken on day one.
- The comparator's Step 1 unwrap rule must be covered by a dedicated unit test asserting (a) symmetric unwrap when both sides match the envelope, (b) symmetric unwrap when only one side matches, (c) no unwrap when a body legitimately has both `headers` and `body` keys plus other keys.

**`api-migration-validation-service/src/routes/diffActions.ts` — new route handlers**
- `POST /diffs` — body `{ projectId, architectureId, sourceBaselineId, targetBaselineId }`. Creates the diff row in `status='computing'`, fires `diffRunner.runDiff(diffId)` as a fire-and-forget local call, returns `{ diffId, status: 'computing' }` immediately. Reject with 400 `error='target_baseline_not_finalised'` if the target baseline is still `draft`.
- `POST /diffs/:id/recompute` — re-runs the existing diff. Returns 409 with `currentStatus='computing'` if `runManager` reports the diff is already running.
- `GET /diffs/:id/status` — polling endpoint returning `{ status, matched_count, status_drift_count, body_shape_drift_count, body_value_drift_count, source_only_count, target_only_count, computed_at, error_message }`.
- `POST /diffs/:id/cancel` — calls `runManager.cancel(diffId)`; PATCHes the diff row to `status='failed'` with `error_message='cancelled'`.

**Auto-trigger from `targetReplayRunner.ts` (one-line additive change)**
- After `patchBaseline(...)` to `status='active'` at the happy-path tail (Spec #4's existing `targetReplayRunner.ts` lines ~641), before the final `return { ... finalStatus: 'completed' }`, invoke `diffRunner.runDiff` via **direct local import**, not a self-HTTP-call. The runner has `projectId`, `session.architecture_id`, `session.source_baseline_id`, `targetBaseline.id` already in scope.
- Fail-soft: wrap the trigger in a try/catch; on error, log a diagnostic and continue. The replay session is still marked `completed`; manual Recompute on the drift report tab is the fallback.
- Spawn the diff as a background task that does NOT block the replay runner's return — the replay completes immediately regardless of diff outcome.

**`runManager.ts` reuse with `diffId` in the `sessionId` slot**
- The existing `runManager` is keyed on `sessionId`. The diff runner reuses it by passing `diffId` in the `sessionId` slot — cheapest path, no parallel manager needed.
- Free 409 protection on rapid recompute: `runManager.start({ sessionId: diffId, ... })` throws if the id is already running. The route handler catches and returns HTTP 409.
- Document the semantic stretch in a code comment at the diff invocation site (something to the effect of "sessionId field also holds diffIds for diff runs"). No structural change to `runManager.ts` itself.

**`archModelClient.ts` (validation-service side) extensions**
- New methods: `createDiff`, `patchDiff`, `getDiff`, `getDiffByTargetBaseline`, `createDiffItem`, `listDiffItemsByDiff` (paginated). Follow the existing typed-wrapper pattern from the baseline / baseline-item methods.
- New DTO types mirroring the AMS Java DTOs (snake_case wire, per existing api-behaviour convention).

**Gateway proxy mirrors (`gateway/src/routes/apiMigrationValidation.ts` + AMS-direct proxies)**
- Validation-service proxies: `POST /api/v1/api-migration-validation/diffs`, `POST .../diffs/:id/recompute`, `POST .../diffs/:id/cancel`, `GET .../diffs/:id/status`.
- AMS-direct proxies for diff / diff_items CRUD plus `GET /api/v1/architecture-model/projects/:projectId/api-behaviour/diffs/by-target/:targetBaselineId`.
- Typed wrappers added to `gateway/src/services/apiBehaviourClient.ts` (extended in Spec #4, not a new file): `createDiff`, `recomputeDiff`, `getDiffStatus`, `getDiffByTargetBaseline`, `listDiffItems`.

**Frontend — new components under `frontend/src/components/DashboardView/`**
- `DriftReportTab.tsx` — tab content: header counts (`N matched · N status drift · N body shape drift · N body value drift · N source-only`), a "Computing…" spinner when `status='computing'`, a "Stale" badge when either `baseline.updated_at > diff.computed_at`, a sortable + filterable table of diff items (columns: method, path, scenario name, source status, target status, classification, action), and a "Recompute" button.
- `DiffItemDetailModal.tsx` — side-by-side modal with source response JSON on the left, target response JSON on the right, `body_diff_json` annotations highlighting changed JSON pointer paths.
- Small structural refactor to `frontend/src/components/DashboardView/BaselineDetailView.tsx`: introduce a tab container only when `baseline.kind === 'target'` (Drift report + Baseline detail tabs). When `baseline.kind === 'current'`, the view stays flat — no reverse-drift list. Existing kind=target header banner from Spec #4 is preserved.
- Empty state when source baseline was deleted (CASCADE removed the diff rows): "Source baseline has been deleted; no drift report available" + Recompute button disabled.
- Extensions to `frontend/src/api/apiBehaviourClient.ts` for the new diff endpoints (typed DTOs + client functions).
- **Component location note:** these components sit under `DashboardView/` to colocate with their parent view — NOT under `frontend/src/components/ApiBehaviour/` (no such folder exists; the raw-idea's path was wrong, per Spec #4 implementer-surfaced caveat).

**Naming convention — "diff" vs "drift"**
- Engineering / schema / endpoints / variable names use **"diff"** (precise).
- User-facing UI copy uses **"drift"** (reads naturally — "Drift report", "N items with drift", "Stale badge").
- Apply consistently: the tab label is "Drift report"; the AMS table is `api_behaviour_diffs`; the validation-service module is `diffRunner.ts`.

**Classifications enumerated**
- Status: `status_match` (exact code match) or `status_drift` (codes differ — any 2xx/4xx/5xx mismatch). Single bucket in v1; raw codes recorded per-item in `source_response_status` + `target_response_status`. Per-code severity is a Spec #6 concern.
- Body: `body_match` (deep equality after wrapper unwrap) / `body_shape_drift` (key sets differ OR leaf type changes) / `body_value_drift` (same shape, different leaf values — surfaced as info, not a defect). Shape wins over value if any key/type drift exists.
- Pairing: `source_only` (source has an item, target has none — notes field carries reason: `mutating_skipped` / `transport_failure` / `no_paired_target`) / `target_only` (forward-compat; should not appear in v1).

**Failure modes**
- Diff endpoint called against a target baseline with `status='draft'` → HTTP 400 with `error='target_baseline_not_finalised'`.
- Concurrent recompute (second rapid click) → HTTP 409 with `currentStatus='computing'`; UI disables button while computing and re-polls.
- Auto-diff failure on replay finalise → log and continue; replay session still marked `completed`; manual Recompute is the fallback.
- Source baseline deleted while diff exists → diff rows CASCADE-removed; target baseline survives unmoored; UI renders the empty-state message.

**Verification anchors**
- A fully-replayed target baseline auto-spawns a diff that materialises in AMS with structured per-item classifications visible on the Drift report tab.
- `cd architecture-model-service && mvn test-compile` exits `0` (no `-D` flags).
- All new tests pass; pre-existing test-suite state unchanged across `architecture-model-service`, `api-migration-validation-service`, `gateway`, `frontend`.

## Existing Code to Leverage

**`api-migration-validation-service/src/services/targetReplayRunner.ts` (Spec #4)**
- Auto-trigger insertion point. The happy-path tail (after `patchBaseline` to `status='active'`, before the final return) already has `projectId`, `session.architecture_id`, `session.source_baseline_id`, `targetBaseline.id` in scope.
- A single additive call to `diffRunner.runDiff(...)` (direct local import, fail-soft) is the entire integration surface here. No other change to the runner.

**`api-migration-validation-service/src/services/runManager.ts`**
- Reused verbatim with `diffId` passed in the `sessionId` slot. Provides background-task tracking, cancel hook, and free 409-on-already-running protection. Per-scenario counters on the run object stay unpopulated for diff runs — harmless.
- Add a code comment at the diff invocation site (or atop `runManager.ts`) documenting that `sessionId` also holds `diffId` values for diff runs.

**`api-migration-validation-service/src/services/archModelClient.ts`**
- Existing typed-wrapper file. Add the new diff / diff_item methods (`createDiff`, `patchDiff`, `getDiff`, `getDiffByTargetBaseline`, `createDiffItem`, `listDiffItemsByDiff`) following the established baseline / baseline-item pattern. Existing methods untouched.

**Existing AMS api-behaviour CRUD pattern (`architecture-model-service/.../apibehaviour/ApiBehaviourBaselineItem*`)**
- Style template for the new diff / diff_item entities, repos, services, controllers, DTOs. Lombok + `@JdbcTypeCode(SqlTypes.JSON)` for the JSONB `body_diff_json` field; record DTOs; boxed `Integer` for all numeric counts; service-layer validation pattern for the kind-discriminator + FK-pairing invariants.

**`gateway/src/services/apiBehaviourClient.ts` + `gateway/src/routes/apiMigrationValidation.ts`**
- Already extended by Spec #4. The new diff functions and proxy routes slot into the same files — no new files at the gateway layer. Reuse the existing `:projectId` / `:targetBaselineId` URL-param safety pattern (missing path param → 404 at the Express layer with no fallback resolution).

**`frontend/src/components/DashboardView/BaselineDetailView.tsx` (currently flat)**
- Host for the tab refactor. The kind=target header banner from Spec #4 is preserved. Wrap the existing Summary + Baseline-items in a "Baseline detail" tab; add a tabs nav strip only when `baseline.kind === 'target'`; the "Drift report" tab content is the new `DriftReportTab.tsx`. For `kind='current'`, no tabs — the existing flat view is preserved exactly.

## Out of Scope

- LLM-driven semantic classification (deferred to v2 — reproducibility + test coverage beats smart classification at this stage).
- Volatile-value drift allowlist (timestamps, UUIDs, sequence numbers) — deferred to Spec #6's per-finding "expected drift" overrides.
- Header drift detection — response headers legitimately differ for many reasons (server identifier, timestamp, request-id echo).
- OAS-schema-aware diff (comparing observed shapes against the contract instead of source-observed against target-observed).
- Replay-of-the-replay verification (re-running the source request against the target to confirm the diff).
- Findings integration — Spec #6 turns diff items into Discovery Findings rows.
- Reverse-direction "this source has these targets" tab on the source baseline detail view — deferred to v2; v1 navigation is one-way (target → drift report).
- Per-field severity rules ("drift on field X is critical; drift on field Y is informational") — Spec #6 concern.
- Multi-baseline n-way diff (one source against multiple targets in one view).
- Markdown / HTML / PDF export of the drift report.
- A general-purpose JSON-diff library refactor — v1 is hand-rolled, zero new dependencies.
- Auto-recompute on target baseline item toggle — manual reject changes `updated_at`; "Stale" badge surfaces; user clicks Recompute explicitly.
- Request-body comparison — requests are identical-by-construction (Spec #4 replay carries them verbatim); only response bodies are walked.
- Unordered / match-by-id array comparison — v1 compares arrays positionally; unordered is a v2 concern.
- `@JsonNaming` audit for the new diff DTOs — follow the existing apibehaviour convention (per-field `@JsonProperty` snake_case); no sweep in this spec.
- Any behavioural change to Spec #4's wizard or replay runner beyond the single auto-diff-trigger line.

## Dependencies

- `2026-05-25-api-test-harness-target-side-capture` (Spec #4 — just shipped) — provides the paired baselines, the `targetReplayRunner.ts` auto-trigger insertion point, the `apiBehaviourClient.ts` extensions to build on, and the `kind`/`paired_with_baseline_id` schema columns.
- `2026-05-15-api-behaviour-baseline-capture-service` + `2026-05-16-api-behaviour-capture-fixes` (shipped) — define the `api_behaviour_baseline_items` shape the diff walks (`method`, `path`, `scenario_name` composite key; `request_json` / `response_json` columns).
- `2026-05-25-ams-test-infrastructure-cleanup` (shipped) — `mvn test` works; this spec adds AMS Java test surface.
- `2026-05-25-ams-dto-json-naming-audit-sweep` (shipped) — `@CamelCaseWire` available if needed for new DTOs; new apibehaviour DTOs follow the existing per-field `@JsonProperty` convention.

No new external dependencies. The JSON shape comparator is hand-rolled.

## Commit Boundary

Per-layer, 5 commits matching Spec #4's cadence:

1. **AMS DB layer** — both Liquibase changesets, `db.changelog-master.yaml` registration, `ApiBehaviourDiffEntity` + `ApiBehaviourDiffItemEntity`, two repositories with finders, entity + repo tests.
2. **AMS Java app layer** — `ApiBehaviourDiffService` + `ApiBehaviourDiffItemService` (pure CRUD), DTOs (boxed `Integer` counts, `Map<String, Object>` for the JSONB), two controllers with standard CRUD endpoints plus the `GET .../diffs/by-target/{targetBaselineId}` UI-lookup endpoint, service-layer kind + FK-pairing validation, controller + service tests.
3. **Validation service** — `diffRunner.ts` (load → pair → classify → persist → PATCH summary), `jsonShapeComparator.ts` (with the `{headers, body}` wrapper-unwrap as Step 1), `routes/diffActions.ts` (4 endpoints), the one-line auto-trigger insertion in `targetReplayRunner.ts`, `archModelClient.ts` extensions for the new diff endpoints, comparator + runner + route tests including the wrapper-unwrap test.
4. **Gateway proxy + typed-client wrapper** — 4 validation-service proxies + AMS-direct proxies for diff/diff_items CRUD + the `by-target` lookup, typed wrappers in `apiBehaviourClient.ts`, gateway tests.
5. **Frontend** — `DriftReportTab.tsx`, `DiffItemDetailModal.tsx`, the `BaselineDetailView.tsx` tab-container refactor (target-side only; current-side stays flat), `apiBehaviourClient.ts` extensions, Vitest tests covering counts rendering, recompute fires + re-polls, stale-badge appearance, and side-by-side modal annotation rendering.
