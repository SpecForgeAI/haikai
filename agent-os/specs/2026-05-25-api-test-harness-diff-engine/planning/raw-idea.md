# Raw Idea: API Test Harness — Diff Engine

## Why this spec exists

Spec #4 (just shipped) lets an architect replay an existing current-state API behaviour baseline against a deployed target service and persists the target responses as a paired `kind=target` baseline. The paired baselines now sit in AMS as two columns of data — source request/response per accepted scenario, target request/response for the same scenario — with no machine-readable comparison between them.

A human can open the source baseline detail view and the target baseline detail view in two browser tabs and squint at the JSON, but that's not a workflow. The migration cutover gate, the backlog regression check, and the future findings surface all need a **structured drift report**: per-scenario classification of "match" / "status drift" / "body shape drift" / "source-only", scoped to the paired baselines, persisted, reproducible, and reference-able from elsewhere in the platform.

This spec adds the **diff engine**: a deterministic comparator that walks the paired baselines, classifies each scenario, persists the result as a new AMS-side artefact (`api_behaviour_diffs` + `api_behaviour_diff_items`), and exposes it in a new "Drift report" tab on `BaselineDetailView` when `kind=target`. The engine is **not LLM-driven** for v1 — same decision as Spec #4's replay-only choice. Reproducibility and testability beat smart classification at this stage.

The output is the **input** to Spec #6 (findings integration), which turns the structured diff into Discovery Findings rows so the drift surfaces in the existing migration-evidence views.

This spec is **only the diff half**. It does not write findings, does not push to Discovery, and does not propose remediation.

## What this spec is (and isn't)

**This spec is:**

- A new deterministic diff service in `api-migration-validation-service` (TypeScript). The validation service is the established home of cross-baseline operations (the Spec #4 replay runner already lives there). Adds a new `diffRunner.ts` and supporting modules.
- A new AMS persistence layer: 2 tables (`api_behaviour_diffs`, `api_behaviour_diff_items`), JPA entities + repos + services + DTOs + controller (CRUD), and Liquibase changesets. The number-sequence is whatever's next at implementation time — Group 1 verifies empirically (Spec #4 landed at 156-157, so this will be 158+).
- A gateway proxy mirror for the new endpoints.
- A new "Drift report" tab on `BaselineDetailView` when `baseline.kind === 'target'`. Header counts (matched / status-drift / shape-drift / source-only); per-item drill-down showing the source response vs target response side-by-side with the structured diff annotated.
- **Auto-compute** on target-baseline finalisation (when the target session moves `running → completed` and the baseline `draft → active`, the diff is computed immediately as part of that transition) **plus a manual "Recompute" button** on the drift report.

**This spec is not:**

- LLM-driven semantic classification. v1 is structural: status codes, JSON key sets, JSON leaf-type matching. Things like "the timestamps differ but mean the same business event" or "this object is a renamed equivalent" are explicitly deferred to a v2.
- Findings integration. Spec #6 is the bridge that turns diff items into Discovery Findings rows.
- A general-purpose JSON-diff utility. The diff logic is scoped to the api-behaviour response shape only.
- A real-time live diff during target replay. Diff runs at finalise-time over the persisted captures — not interleaved with the per-item HTTP execution.
- A change to Spec #4's auto-accept policy. The diff engine compares whatever's in the baseline_items; users can still toggle items off afterwards on the target side, which would simply be excluded from a subsequent recompute.
- A new authentication / authorisation surface. Whatever the existing api-behaviour endpoints require, the diff endpoints inherit.
- An OpenAPI-schema-aware diff. The diff compares **observed** request/response payloads from baseline_items. It does NOT load the original OAS spec and check whether the target conforms to the contract.
- Header drift detection in v1. Response headers legitimately differ for many reasons (server identifier, timestamp, request-id echo). Out of scope for v1.
- A replay-of-the-replay (re-run the source request against the target to confirm the diff). The diff operates on persisted baseline_items only.

## Decisions already made (don't re-litigate in shape-spec)

These were settled while drafting this raw idea:

1. **Service location: `api-migration-validation-service` (TypeScript), not AMS.** The validation service already owns the cross-baseline plumbing from Spec #4. Putting diff logic in AMS would duplicate the typed access patterns. The validation service writes results to AMS via its existing `archModelClient.ts`.
2. **Persistence: durable AMS rows, not compute-on-demand.** Spec #6 (findings integration) needs a stable artefact to reference. Baselines are immutable-once-active per Spec #4's contract, so the staleness problem is small; we still record a `computed_at` timestamp and the persisted baseline `updated_at` of both sides so a "may be stale" badge can fire when either side has moved on.
3. **Deterministic v1, no LLM.** Reproducibility + test coverage > smart classification. LLM-assisted enrichment is a v2.
4. **Item pairing key: `(method, path, scenario_name)`.** The Spec #4 replay carries those three through verbatim from source to target. They're the natural composite key for matching diff items.
5. **Status drift classification:** `status_match` (exact status code match), `status_drift` (codes differ — both 2xx and 4xx vs 5xx differences count), `source_only` (source has an item, target has no paired item — e.g. mutating-skipped or replay-failed), `target_only` (shouldn't happen in v1 because replay is source-driven; but the schema supports it for forward compatibility).
6. **Body comparison categories:** `body_match` (deep equality), `body_shape_drift` (key sets differ OR leaf type changes), `body_value_drift` (same shape, different values — surface as info, not a defect). v1 records the diff JSON for the UI to render.
7. **Auto-compute on target-finalise + manual recompute button.** First diff happens automatically when the target replay session completes; users can recompute anytime.
8. **JSON-diff implementation: hand-rolled, no library.** Lightweight (we control the input shape — these are HTTP response bodies, depth bounded by what services typically return). Adding `deep-diff` or `microdiff` is more dep weight than the simple recursive walker needs.
9. **No new wizard step.** The drift report is a tab on the target baseline detail view, not a separate workflow.

## Specific requirements (rough — let shape-spec refine)

### AMS persistence — 2 new tables

**Liquibase changeset `<next-1>-api-behaviour-diffs.sql`** (verify highest changeset number at implementation time):

```sql
CREATE TABLE api_behaviour_diffs (
  id                            UUID PRIMARY KEY,
  project_id                    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  architecture_id               UUID NOT NULL,
  source_baseline_id            UUID NOT NULL REFERENCES api_behaviour_baselines(id) ON DELETE CASCADE,
  target_baseline_id            UUID NOT NULL REFERENCES api_behaviour_baselines(id) ON DELETE CASCADE,
  status                        TEXT NOT NULL DEFAULT 'computing',
    -- 'computing' | 'completed' | 'failed'
  matched_count                 INT,
  status_drift_count            INT,
  body_shape_drift_count        INT,
  body_value_drift_count        INT,
  source_only_count             INT,
  target_only_count             INT,
  source_baseline_updated_at    TIMESTAMPTZ,   -- snapshot at compute time
  target_baseline_updated_at    TIMESTAMPTZ,   -- snapshot at compute time
  computed_at                   TIMESTAMPTZ,
  error_message                 TEXT,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT api_behaviour_diffs_pair_unique
    UNIQUE (source_baseline_id, target_baseline_id)
);

CREATE INDEX api_behaviour_diffs_target_idx ON api_behaviour_diffs (target_baseline_id);
CREATE INDEX api_behaviour_diffs_source_idx ON api_behaviour_diffs (source_baseline_id);
```

**Liquibase changeset `<next>-api-behaviour-diff-items.sql`**:

```sql
CREATE TABLE api_behaviour_diff_items (
  id                          UUID PRIMARY KEY,
  diff_id                     UUID NOT NULL REFERENCES api_behaviour_diffs(id) ON DELETE CASCADE,
  method                      TEXT NOT NULL,
  path                        TEXT NOT NULL,
  scenario_name               TEXT NOT NULL,
  source_baseline_item_id     UUID,    -- nullable: target_only items have no source
  target_baseline_item_id     UUID,    -- nullable: source_only items have no target
  status_classification       TEXT NOT NULL,
    -- 'status_match' | 'status_drift' | 'source_only' | 'target_only'
  body_classification         TEXT,
    -- 'body_match' | 'body_shape_drift' | 'body_value_drift' | null when no pair
  source_response_status      INT,
  target_response_status      INT,
  body_diff_json              JSONB,   -- structured drift annotation; null when bodies match
  notes                       TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX api_behaviour_diff_items_diff_idx
  ON api_behaviour_diff_items (diff_id);

CREATE INDEX api_behaviour_diff_items_method_path_idx
  ON api_behaviour_diff_items (diff_id, method, path);
```

Register both in `db.changelog-master.yaml` using the `columnExists`/`tableExists` precondition pattern that the existing api-behaviour changesets use.

### AMS Java layer

- Two new entities (`ApiBehaviourDiffEntity`, `ApiBehaviourDiffItemEntity`) following the existing Lombok / `@JdbcTypeCode(SqlTypes.JSON)` pattern.
- Two new repositories with finder methods (`findByTargetBaselineId`, `findBySourceBaselineId`, `findByDiffIdOrderByMethodAscPathAsc`).
- Two new services (`ApiBehaviourDiffService`, `ApiBehaviourDiffItemService`) — pure CRUD; the diff *computation* lives in the validation service, not here. AMS is the system of record only.
- Two new controllers exposing standard CRUD under `/api/projects/{projectId}/api-behaviour/diffs/...`. Mirror the existing api-behaviour controller pattern.
- All numeric count fields are `Integer` (not `int`) — PATCH safety per `project_primitive_double_dto_overwrite.md`.
- A new endpoint specifically for the UI: `GET /api/projects/{projectId}/api-behaviour/diffs/by-target/{targetBaselineId}` — returns the diff for a given target baseline (most common UI lookup path).
- Validation: a diff's `source_baseline_id` MUST point at a `kind='current'` baseline; `target_baseline_id` MUST point at a `kind='target'` baseline whose `paired_with_baseline_id` equals the diff's source. Enforced at service layer (matches Spec #4's FK-pairing invariant pattern).

### `api-migration-validation-service` — new diff runner

**New file `src/services/diffRunner.ts`** (~300-400 LOC):

```
runDiff(diffId): Promise<void>
  1. Load diff via archModelClient.getDiff(diffId).
  2. Load source baseline items (paginated if needed).
  3. Load target baseline items.
  4. Build a Map keyed by `${method}|${path}|${scenarioName}` for fast lookup on both sides.
  5. For each source item:
     a. Find paired target item by composite key.
     b. If no target item: emit source_only diff_item.
     c. Else: classify status (match/drift), classify body (match/shape-drift/value-drift),
        compute body_diff_json via the JSON-shape comparator.
  6. For any target items without a source match: emit target_only diff_item.
     (Shouldn't happen in v1 but the schema supports it.)
  7. Compute summary counts.
  8. Persist diff_items via archModelClient.createDiffItem (batch where possible).
  9. PATCH diff to status='completed', set counts + computed_at + baseline updated_at snapshots.
 10. On any unrecoverable error: PATCH diff to status='failed' with error_message, emit diagnostic.
```

**New file `src/services/jsonShapeComparator.ts`** (~150-250 LOC):

```
compareJsonShapes(source: unknown, target: unknown): { classification, diffAnnotation }
  - Walks both JSON trees in parallel.
  - At each path: classify as key_added | key_removed | type_changed | value_changed | match.
  - Returns a flat list of differences with JSON-pointer paths.
  - Aggregates into top-level classification: body_match | body_shape_drift | body_value_drift.
  - body_shape_drift wins over body_value_drift if any key/type drift exists.
```

**New route handlers in `src/routes/diffActions.ts`**:

- `POST /diffs` — create + run a new diff. Body: `{ projectId, architectureId, sourceBaselineId, targetBaselineId }`. Returns `{ diffId, status }`. Spawns the runner as a fire-and-forget background task via `runManager` (reuse the pattern from Spec #4's target capture).
- `POST /diffs/:id/recompute` — manual re-run.
- `GET /diffs/:id/status` — polling.
- `POST /diffs/:id/cancel` — abort in-flight compute.

### `api-migration-validation-service` — auto-compute hook

When Spec #4's `targetReplayRunner.ts` finalises a target session (session `running → completed`, target baseline `draft → active`), it now also POSTs to its own `/diffs` endpoint with the source + target baseline ids. **Small additive change to `targetReplayRunner.ts`** — one new call at the end of the existing happy-path. On failure of the auto-diff trigger: log and continue (the manual recompute button is the fallback).

### Gateway proxy surface

Mirror the existing api-migration-validation proxy pattern:

- `POST /api/v1/api-migration-validation/diffs` → forwards to validation service.
- `POST /api/v1/api-migration-validation/diffs/:id/recompute`
- `POST /api/v1/api-migration-validation/diffs/:id/cancel`
- `GET /api/v1/api-migration-validation/diffs/:id/status`
- AMS-direct proxies for the diff/diff-items CRUD endpoints + the new `GET .../diffs/by-target/{targetBaselineId}` lookup.

Add typed wrappers in `gateway/src/services/apiBehaviourClient.ts` (extended in Spec #4): `createDiff`, `recomputeDiff`, `getDiffStatus`, `getDiffByTargetBaseline`, `listDiffItems`.

### Frontend

**New tab on `BaselineDetailView.tsx` when `baseline.kind === 'target'`**: "Drift report".

- Tab header shows counts: ✅ N matched · ⚠ N status drift · ⚠ N body shape drift · ℹ N body value drift · ⏭ N source-only · "Recompute" button.
- "Computing…" spinner when the diff is in `status='computing'`.
- "Stale" badge if the baseline `updated_at` of either side is newer than the diff's `computed_at`.
- Below: a sortable, filterable table of diff items. Columns: method, path, scenario name, source status, target status, classification, action ("View diff" → opens a side-by-side modal).
- Side-by-side modal: source response JSON on the left, target response JSON on the right, with the `body_diff_json` annotations highlighting changed paths.

**Files added:**
- `frontend/src/components/ApiBehaviour/DriftReportTab.tsx` — the new tab content.
- `frontend/src/components/ApiBehaviour/DiffItemDetailModal.tsx` — the side-by-side body comparison.
- Extensions to `frontend/src/api/apiBehaviourClient.ts` for the new diff endpoints.

**Tests (4 frontend tests budget):**
- Tab shows correct counts pulled from the diff DTO.
- "Recompute" button fires the recompute endpoint and re-polls.
- "Stale" badge appears when computed_at < either baseline's updated_at.
- Side-by-side modal renders body_diff_json annotations.

### Tests (per layer)

- AMS: 4-6 tests (entity persistence, FK-pairing invariant, by-target lookup, CRUD basics).
- Validation service: 8-12 tests (diff runner happy path, status drift, shape drift, value drift, source-only, target-only, cancellation, auto-trigger hook from targetReplayRunner, jsonShapeComparator unit tests for the recursive walker — depth, arrays, type changes, key adds/removes).
- Gateway: 3-4 tests (proxy pass-through, AMS-direct proxy, typed-client wrapper).
- Frontend: 4 tests as listed above.
- Total target: ~20-26 tests.

### Verification

- After this spec: a fully-replayed target baseline auto-spawns a diff that materialises in AMS. The drift report tab on the target baseline detail view shows the structured per-item classification. Recompute works. Stale badge appears appropriately.
- `cd architecture-model-service && mvn test-compile` exits 0 (no `-D` flags). New tests pass.
- `cd api-migration-validation-service && npm test` — new tests pass; existing tests stay green.
- `cd gateway && npm test` — new tests pass; existing pre-existing failures unchanged.
- `cd frontend && npm test` — new tests pass; existing pre-existing failures unchanged.

## Out of Scope

- Findings integration. Spec #6 turns diff items into Discovery Findings.
- LLM-assisted semantic classification.
- Header drift detection.
- OAS-contract-aware diff (comparing observed shapes against the OAS schema instead of source observed against target observed).
- Replay-of-the-replay verification flows.
- A general-purpose JSON-diff library refactor.
- Live streaming diff during replay.
- Multi-baseline n-way diff (compare 1 source against 3 targets).
- Per-field severity rules (e.g. "drift on field X is critical; drift on field Y is informational"). v2.
- An API to export the diff as Markdown / HTML / PDF.
- Any change to Spec #4's wizard or replay runner beyond the single auto-diff-trigger line.
- `@JsonNaming` audit for the new diff DTOs (follow existing api-behaviour convention — snake_case wire by default, `@CamelCaseWire` only if a consumer specifically needs camelCase).

## Dependencies

- `2026-05-25-api-test-harness-target-side-capture` (Spec #4, just shipped) — provides the paired baselines this spec consumes.
- `2026-05-15-api-behaviour-baseline-capture-service` and `2026-05-16-api-behaviour-capture-fixes` (shipped) — define the baseline_items shape the diff walks.
- `2026-05-25-ams-test-infrastructure-cleanup` (shipped) — `mvn test` works.
- `2026-05-25-ams-dto-json-naming-audit-sweep` (shipped) — `@CamelCaseWire` available if needed for new DTOs whose consumer is camelCase.

No new external dependencies. JSON shape comparator is hand-rolled.

## Open questions for shape-spec to clarify

1. **Service location.** Diff engine in `api-migration-validation-service` (raw-idea's pick) or in AMS Java? My instinct: **validation service** — already owns cross-baseline plumbing. But AMS could also work if there's a preference for putting compute next to the data.

2. **Persistence vs compute-on-demand.** Raw-idea proposes durable AMS tables. Alternative: compute on every request, no persistence. My instinct: **persist**. Spec #6 needs stable artefacts; baselines are immutable-once-active so staleness is bounded.

3. **Auto-trigger boundary.** The auto-diff happens at the end of `targetReplayRunner.runTargetReplay()`. Should the diff be considered part of the replay session's "completed" state (i.e. session stays `running` until diff finishes), or a separate after-the-fact compute (session marks completed first, diff is a sibling activity)? My instinct: **separate**. Replay completes immediately; diff is a background sibling. If diff fails, the replay isn't retroactively unwound.

4. **Body-value-drift surfacing.** v1 records body_value_drift as a separate classification but the raw-idea suggests surfacing it as info, not a defect. Confirm? My instinct: **yes, informational**. Many API responses include timestamps, ids, computed values that legitimately differ between source and target without indicating a real defect.

5. **`source_only` vs `mutating_skipped` distinction.** Spec #4's replay emits a `mutating_skipped` diagnostic when it skips a mutating source item. Should the diff engine distinguish "source-only because target didn't reply at all" from "source-only because we deliberately skipped the target replay"? My instinct: **distinguish them via the `notes` field** on diff_item — the classification stays `source_only`, but notes carry the diagnostic-derived reason. Avoids adding more classification values.

6. **Auto-trigger on diff staleness.** If the user toggles a manual-reject on a target baseline item (per Spec #4's preserved accept/reject toggle), the target baseline's `updated_at` changes. Should the existing diff auto-recompute? My instinct: **no, surface as stale** (the existing "Stale" badge in the UI). Auto-recompute on every toggle is too aggressive; the user has a Recompute button.

7. **JSON shape comparator: arrays as ordered vs unordered.** API responses often return arrays that are conceptually unordered (lists of items). Comparing them as ordered would surface false drift for every-element-reordering. My instinct: **ordered for v1** — simpler, deterministic, fits the bounded-input scope. Unordered + matching-by-id is a v2 concern.

8. **Diff item granularity for body changes.** The `body_diff_json` records all changes as a flat list of JSON-pointer-keyed entries. Should there be a per-field severity / category beyond just "different"? My instinct: **no, just record the change for v1**. Severity is what Spec #6 (findings integration) decides per-finding.

9. **Failure mode if diff runs against a target baseline whose status is still `draft` (not yet finalised).** Reject with 400 ("target baseline not yet finalised") or proceed? My instinct: **reject**. Diffing a draft baseline produces a misleading result.

10. **Test cap and commit boundary.** ~20-26 tests total spread across 4 layers (AMS, validation service, gateway, frontend). Commit boundary: same per-layer 5-commit pattern as Spec #4? My instinct: **yes — 5 commits per layer**, matches the established cadence.

11. **Naming: "diff" or "drift"?** Engineering and AMS persistence terms use **diff** (precise). UI surface uses **drift** (reads naturally). My instinct: **keep the split** — diff in code/schema/endpoints, drift in user-facing copy.

## Verification

After this spec:
- Target baseline detail view shows a "Drift report" tab populated automatically.
- Counts are correct for a known-shape test scenario (e.g. 5 items: 3 match, 1 status drift, 1 body shape drift).
- Recompute button works; stale badge appears when expected.
- AMS diff/diff_item rows are addressable via the new CRUD endpoints (for Spec #6).
- No new test failures introduced; pre-existing test-suite state unchanged.

## Commit boundary

Per-layer in 5 commits, matching Spec #4's cadence:
1. AMS DB layer (2 changesets + entities + repos + tests).
2. AMS Java app layer (services + DTOs + controllers + tests).
3. `diffRunner.ts` + `jsonShapeComparator.ts` + new routes + auto-trigger line in `targetReplayRunner.ts` + tests.
4. Gateway proxy + typed-client wrapper + tests.
5. Frontend `DriftReportTab.tsx` + `DiffItemDetailModal.tsx` + client extensions + tests.

Shape-spec may merge or split if the layer boundaries don't line up neatly.
