# Task Breakdown: API Test Harness — Diff Engine

## Overview
Total Task Groups: 6

Per-layer 5-commit boundary (accepted Q14, matching Spec #4's cadence), plus a sixth task group for end-to-end manual verification on the running stack. The spec adds a deterministic diff engine in `api-migration-validation-service` that compares paired source / target API Behaviour Baselines produced by Spec #4, classifies each scenario, and persists the structured drift into two new AMS tables. Auto-triggered at the end of target replay; manually recomputable; surfaced via a new "Drift report" tab on `BaselineDetailView` when `baseline.kind === 'target'`.

Total test budget (accepted Q14): ~20-26 tests across 5 layers — 3-4 AMS DB layer, 5-6 AMS Java app, 8-10 validation service, 3-4 gateway, 4 frontend.

## Critical Implementation Pitfalls (read before starting)

1. **`response_json` wrapper-shape normalisation (F2 in requirements).** Source items store the raw response body; target items store `{ headers, body }` (wrapped by `targetReplayRunner.ts`). The `jsonShapeComparator.ts` MUST unwrap `body` symmetrically when an input JSON object has EXACTLY the keys `headers` and `body` (and nothing else). Without this normalisation, every paired item would be flagged `body_shape_drift` and the v1 feature would look broken on day one. Group 3 encodes this as Step 1 of the comparator and adds a dedicated unit test.
2. **Empirical changeset slot verification.** Group 1 sub-task 1.2 MUST run `ls architecture-model-service/src/main/resources/db/changelog/sql/ | sort -V | tail -5` to find the actual highest slot at implementation time. Spec #4's tasks file predicted `140/141`; the actual landed slots were `156/157`. Predicted next free slots for THIS spec are `158/159`, but verify empirically — other in-flight specs may have intervened.
3. **`BaselineDetailView` is flat — small structural refactor needed.** No tab container exists today. Group 5 introduces a tab container ONLY when `baseline.kind === 'target'`. When `kind='current'`, the view stays flat (no reverse-drift list — deferred to v2 per accepted Q9).
4. **`runManager` reuse with `diffId` in the `sessionId` slot.** Group 3's invocation site MUST add a code comment documenting the semantic stretch ("sessionId field also holds diffIds for diff runs"). No structural change to `runManager.ts`.
5. **Auto-trigger via direct local invocation (NOT self-HTTP-call).** Group 3's one-line addition to `targetReplayRunner.ts` is a direct `await diffRunner.runDiff(diffId)` (or fire-and-forget local call). Fail-soft: catch + log + continue. Replay completes immediately regardless of diff outcome.
6. **Component location.** New frontend components live under `frontend/src/components/DashboardView/` (matching `BaselineDetailView.tsx`), NOT under `frontend/src/components/ApiBehaviour/` (which is the wizard home). The raw-idea's proposed paths under `ApiBehaviour/` are wrong — Spec #4 surfaced the same caveat.
7. **PATCH safety for all 6 count fields.** `matched_count`, `status_drift_count`, `body_shape_drift_count`, `body_value_drift_count`, `source_only_count`, `target_only_count` (plus `source_response_status`, `target_response_status`) MUST be boxed `Integer` (never primitive `int`) per `project_primitive_double_dto_overwrite.md`. Group 2 sub-task calls this out explicitly.
8. **Naming convention.** "diff" in code/schema/endpoints/variable names (precise); "drift" in user-facing UI copy (reads naturally). Group 5's button label is **"Recompute"** (action verb); tab label is **"Drift report"**.

## Classifications enumerated (Groups 3 + 5 reference these)

- **Status**: `status_match` (exact code match) | `status_drift` (codes differ — any 2xx/4xx/5xx mismatch). Single bucket in v1; raw codes recorded per-item in `source_response_status` + `target_response_status`. Per-code severity is a Spec #6 concern.
- **Body**: `body_match` (deep equality after wrapper unwrap) | `body_shape_drift` (key sets differ OR leaf type changes) | `body_value_drift` (same shape, different leaf values — informational, not a defect). Shape wins over value if any key/type drift exists.
- **Pairing**: `source_only` (source has an item, target has none — notes field carries reason: `mutating_skipped` / `transport_failure` / `no_paired_target`) | `target_only` (forward-compat; should not appear in v1 since replay is source-driven, but schema + runner support it).

## Failure modes (Group 3 enforces)

- Diff endpoint called against a target baseline with `status='draft'` → HTTP 400 with `error='target_baseline_not_finalised'`.
- Concurrent recompute (second rapid click while compute in flight) → HTTP 409 with `currentStatus='computing'`; UI disables button while computing and re-polls.
- Auto-diff failure on replay finalise → log diagnostic + continue; replay session still marked `completed`; manual Recompute is the fallback.
- Source baseline deleted while diff exists → diff rows CASCADE-removed (per FK); target baseline survives unmoored; UI renders empty-state message + Recompute button disabled.

## Task List

### Persistence Layer

#### Task Group 1: AMS Liquibase + entities + repositories
**Dependencies:** None
**Scope:** Two additive Liquibase changesets creating `api_behaviour_diffs` + `api_behaviour_diff_items`, two new JPA entities with the established Lombok / `@JdbcTypeCode(SqlTypes.JSON)` conventions, two new repositories with the by-target / by-source / by-diff-ordered finders. All numeric count fields are boxed `Integer` on the entity per PATCH safety.
**Test budget:** 3-4 tests (entity persistence, FK invariant, by-target lookup helpers).

- [x] 1.0 Complete AMS persistence layer
  - [x] 1.1 Write 3-4 focused tests for persistence layer
    - One JPA round-trip test on `ApiBehaviourDiffEntity`: insert a diff row tied to a source + target baseline pair, retrieve via `findById`, verify all fields round-trip including the JSONB-mapped `body_diff_json` on the diff-item side
    - One repository finder test: insert two diffs for two different target baselines under the same project; `findByTargetBaselineId(targetA)` returns ONLY the diff tied to `targetA`; `findBySourceBaselineId(source)` returns BOTH (one source → many targets supported by the schema even though v1 won't exercise that path)
    - One repository finder test on `ApiBehaviourDiffItemRepository.findByDiffIdOrderByMethodAscPathAsc(diffId)`: insert four items with mixed `(method, path)` ordering, retrieve, verify they come back ordered `GET /a, GET /b, POST /a, POST /b`
    - One Liquibase CASCADE test: insert diff + diff_items; delete the source baseline via SQL; verify both diff and diff_items rows are CASCADE-removed (the diff's `source_baseline_id` FK has `ON DELETE CASCADE`; diff_items CASCADE off the diff)
    - Skip exhaustive per-column round-trip coverage (the JSONB column is the only non-trivial mapping)
  - [x] 1.2 Verify the highest applied changeset slot empirically
    - Run `ls architecture-model-service/src/main/resources/db/changelog/sql/ | sort -V | tail -5` immediately before authoring the new files
    - Spec #4 landed at slots `156` and `157`; predicted next free slots are `158` and `159`, but other in-flight specs may have intervened — confirm empirically
    - If the highest applied changeset has shifted, use the next two free numbers above whatever you observe — never reuse a number
    - Record the observed slots in an implementation note on this sub-task before continuing
  - [x] 1.3 Author `<N>-api-behaviour-diffs.sql` (predicted `158-`; confirm via 1.2)
    - `CREATE TABLE api_behaviour_diffs (...)` with columns per spec.md:
      - `id UUID PRIMARY KEY`
      - `project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE`
      - `architecture_id UUID NOT NULL`
      - `source_baseline_id UUID NOT NULL REFERENCES api_behaviour_baselines(id) ON DELETE CASCADE`
      - `target_baseline_id UUID NOT NULL REFERENCES api_behaviour_baselines(id) ON DELETE CASCADE`
      - `status TEXT NOT NULL DEFAULT 'computing'` (valid: `computing` | `completed` | `failed`)
      - `matched_count INT`, `status_drift_count INT`, `body_shape_drift_count INT`, `body_value_drift_count INT`, `source_only_count INT`, `target_only_count INT`
      - `source_baseline_updated_at TIMESTAMPTZ`, `target_baseline_updated_at TIMESTAMPTZ`
      - `computed_at TIMESTAMPTZ`, `error_message TEXT`
      - `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
    - `CONSTRAINT api_behaviour_diffs_pair_unique UNIQUE (source_baseline_id, target_baseline_id)`
    - `CREATE INDEX api_behaviour_diffs_target_idx ON api_behaviour_diffs (target_baseline_id)`
    - `CREATE INDEX api_behaviour_diffs_source_idx ON api_behaviour_diffs (source_baseline_id)`
    - `COMMENT ON COLUMN` entries documenting valid `status` values and the kind-discriminator + FK-pairing invariant (enforced at the service layer, not the DB)
    - Register as a NEW `changeSet` block in `db.changelog-master.yaml` using the `preConditions: onFail: MARK_RAN` pattern matching the existing api-behaviour changesets — never edit prior changesets per `feedback_liquibase_immutable_changesets.md`
  - [x] 1.4 Author `<N+1>-api-behaviour-diff-items.sql` (predicted `159-`; confirm via 1.2)
    - `CREATE TABLE api_behaviour_diff_items (...)` with columns per spec.md:
      - `id UUID PRIMARY KEY`
      - `diff_id UUID NOT NULL REFERENCES api_behaviour_diffs(id) ON DELETE CASCADE`
      - `method TEXT NOT NULL`, `path TEXT NOT NULL`, `scenario_name TEXT NOT NULL`
      - `source_baseline_item_id UUID NULL`, `target_baseline_item_id UUID NULL`
      - `status_classification TEXT NOT NULL` (valid: `status_match` | `status_drift` | `source_only` | `target_only`)
      - `body_classification TEXT NULL` (valid: `body_match` | `body_shape_drift` | `body_value_drift`; null for `source_only` / `target_only`)
      - `source_response_status INT`, `target_response_status INT`
      - `body_diff_json JSONB`
      - `notes TEXT`
      - `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
    - `CREATE INDEX api_behaviour_diff_items_diff_idx ON api_behaviour_diff_items (diff_id)`
    - `CREATE INDEX api_behaviour_diff_items_method_path_idx ON api_behaviour_diff_items (diff_id, method, path)`
    - Register as a NEW `changeSet` block in `db.changelog-master.yaml`
  - [x] 1.5 Author `ApiBehaviourDiffEntity`
    - New file under `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/apibehaviour/`
    - Follow the established Lombok pattern (`@Entity`, `@Table`, `@Builder`, `@NoArgsConstructor`, `@AllArgsConstructor`, `@Getter`, `@Setter`) mirroring `ApiBehaviourBaselineEntity`
    - **All 6 count fields MUST be boxed `Integer`, never primitive `int`** — per `project_primitive_double_dto_overwrite.md`, any field that participates in PATCH semantics must be a boxed type so a missing JSON field does not silently wipe to `0`
    - Other fields: `UUID id`, `UUID projectId`, `UUID architectureId`, `UUID sourceBaselineId`, `UUID targetBaselineId`, `String status`, `Instant sourceBaselineUpdatedAt`, `Instant targetBaselineUpdatedAt`, `Instant computedAt`, `String errorMessage`, `Instant createdAt`, `Instant updatedAt` — all reference types
    - Add Javadoc note on the count fields: "Boxed `Integer` required for PATCH safety — primitive `int` would silently wipe to 0 on missing JSON per `project_primitive_double_dto_overwrite.md`."
  - [x] 1.6 Author `ApiBehaviourDiffItemEntity`
    - New file alongside the diff entity
    - Same Lombok conventions
    - `body_diff_json` mapped as `Map<String, Object>` with `@JdbcTypeCode(SqlTypes.JSON)` — mirror the existing `request_json` / `response_json` mapping on `ApiBehaviourBaselineItemEntity`
    - `source_response_status` + `target_response_status` are boxed `Integer` (nullable when classification is `source_only` / `target_only`)
    - Other fields: `UUID id`, `UUID diffId`, `String method`, `String path`, `String scenarioName`, `UUID sourceBaselineItemId`, `UUID targetBaselineItemId`, `String statusClassification`, `String bodyClassification`, `String notes`, `Instant createdAt` — all reference types
    - Javadoc note matching 1.5 on the two status fields
  - [x] 1.7 Author `ApiBehaviourDiffRepository`
    - New `JpaRepository<ApiBehaviourDiffEntity, UUID>` interface
    - Finders:
      - `Optional<ApiBehaviourDiffEntity> findByTargetBaselineId(UUID targetBaselineId)` — primary UI-lookup path; UNIQUE (source, target) means this is at most one row per target
      - `List<ApiBehaviourDiffEntity> findBySourceBaselineIdOrderByCreatedAtDesc(UUID sourceBaselineId)` — supports future reverse-lookup (deferred to v2 UI but the AMS surface is complete)
      - `Optional<ApiBehaviourDiffEntity> findBySourceBaselineIdAndTargetBaselineId(UUID sourceBaselineId, UUID targetBaselineId)` — used by the diff-creation flow to detect existing diffs and recompute in place
  - [x] 1.8 Author `ApiBehaviourDiffItemRepository`
    - New `JpaRepository<ApiBehaviourDiffItemEntity, UUID>` interface
    - Finders:
      - `List<ApiBehaviourDiffItemEntity> findByDiffIdOrderByMethodAscPathAsc(UUID diffId)` — primary listing path for the Drift report tab
      - `void deleteByDiffId(UUID diffId)` — used by recompute to wipe prior items before inserting new ones
  - [x] 1.9 Run ONLY the 3-4 persistence tests written in 1.1
    - Verify Liquibase migration applies cleanly from a fresh DB
    - Verify JPA round-trips work including the JSONB-mapped `body_diff_json`
    - Verify finders return correctly-filtered, ordered lists
    - Verify CASCADE deletion of diff rows when source baseline is deleted
    - Do NOT run the entire AMS test suite

**Acceptance Criteria:**
- The 3-4 tests written in 1.1 pass
- Both new changesets apply cleanly; no edit to any pre-existing changeset
- `db.changelog-master.yaml` registers both new changesets as discrete `changeSet` blocks
- All 8 numeric fields (6 counts + 2 statuses) are boxed `Integer` — no primitive-wipe risk
- New repository finders return correctly-filtered, ordered lists
- CASCADE FK on source-deletion verified (diff + diff_items both removed; target baseline survives unmoored per Spec #4's `ON DELETE SET NULL` on `paired_with_baseline_id`)

---

### AMS Java Application Layer

#### Task Group 2: DTOs + services + controllers (including by-target endpoint)
**Dependencies:** Task Group 1
**Scope:** Two new record DTOs with boxed `Integer` counts and the `Map<String, Object>` body_diff field; two new services with pure CRUD (the diff computation lives in the validation service — AMS is system-of-record only); two new controllers under `/api/projects/{projectId}/api-behaviour/diffs/...` plus the dedicated UI-lookup endpoint `GET .../diffs/by-target/{targetBaselineId}`; service-layer FK-pairing invariant validation (source must be `kind='current'`; target must be `kind='target'` with `paired_with_baseline_id` matching the diff's source).
**Test budget:** 5-6 tests (FK-pairing invariant validation, CRUD basics, by-target controller happy path + 404).

- [x] 2.0 Complete AMS Java application layer
  - [x] 2.1 Write 5-6 focused tests for DTOs + services + controllers
    - One service-layer invariant test on `ApiBehaviourDiffService.create(...)`: source baseline has `kind='target'` (not `'current'`) → service rejects with a clear validation error; mirrored test for target baseline with `kind='current'`; mirrored test for target whose `paired_with_baseline_id` does NOT match the diff's `source_baseline_id` → rejected
    - One service-layer CRUD round-trip test: create a diff row, PATCH it to `status='completed'` with all 6 counts populated, retrieve, verify all fields round-trip (including the boxed `Integer` counts surviving PATCH semantics)
    - One service-layer diff-item round-trip test: create a diff_item with a populated `body_diff_json` map, retrieve via `findByDiffIdOrderByMethodAscPathAsc`, verify the JSONB round-trips intact
    - One MockMvc happy-path test for `GET /api/projects/{projectId}/api-behaviour/diffs/by-target/{targetBaselineId}` → returns the diff DTO for the given target baseline
    - One MockMvc 404 test for the same route when `{targetBaselineId}` does not resolve to a diff under `{projectId}` → returns 404 (matches existing per-project scoping convention)
    - One DTO PATCH-safety test: deserialize a PATCH JSON missing `matched_count` field; verify the entity's existing `matched_count` value is preserved (NOT wiped to 0) — this is the regression test for `project_primitive_double_dto_overwrite.md` on this new surface
    - Skip exhaustive per-route happy-path coverage — the standard CRUD routes follow the existing pattern
  - [x] 2.2 Author `ApiBehaviourDiffDto` (Java record)
    - New file under `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/apibehaviour/`
    - All 6 count fields are boxed `Integer`, never primitive `int`
    - All other fields are reference types (`UUID`, `String`, `Instant`) — no primitive-type drift risk
    - Follow the existing per-field `@JsonProperty` snake_case convention on the api-behaviour DTOs (no `@JsonNaming` sweep; out-of-scope for this spec per the api-behaviour wire-format convention)
    - Add Javadoc note: "All numeric count fields are boxed `Integer` (never primitive `int`) — per `project_primitive_double_dto_overwrite.md`, any field participating in PATCH semantics must be a boxed type so missing JSON does not silently wipe to 0. Future maintainers adding new count fields MUST follow this rule."
  - [x] 2.3 Author `ApiBehaviourDiffItemDto` (Java record)
    - New file alongside the diff DTO
    - `source_response_status` + `target_response_status` are boxed `Integer`
    - `body_diff_json` typed as `Map<String, Object>` to mirror the entity's JSONB mapping
    - All other fields are reference types
    - Same per-field `@JsonProperty` snake_case convention
    - Matching boxed-type Javadoc note
  - [x] 2.4 Author `CreateApiBehaviourDiffRequest` + `UpdateApiBehaviourDiffRequest` (Java records)
    - Request DTOs for the create + update controller endpoints
    - All count fields boxed `Integer` so PATCH (`UpdateApiBehaviourDiffRequest`) can carry partial updates safely
    - Matching `CreateApiBehaviourDiffItemRequest` for the diff-item POST path
  - [x] 2.5 Author mappers under `mapper.apibehaviour`
    - Entity ↔ DTO conversion for both new entity / DTO pairs
    - Match the existing manual-mapping convention used by `ApiBehaviourMapper` (no MapStruct introduction)
  - [x] 2.6 Author `ApiBehaviourDiffService`
    - New file under `service.apibehaviour`; pure CRUD — diff computation lives in the validation service
    - `create(CreateApiBehaviourDiffRequest)`:
      - Validates `status` is one of `computing` | `completed` | `failed` (default `computing` if absent)
      - Validates the FK-pairing invariant: load `source_baseline_id` → assert `kind='current'`; load `target_baseline_id` → assert `kind='target'` AND `paired_with_baseline_id == source_baseline_id`
      - Throws `IllegalArgumentException` (→ HTTP 400 via `GlobalExceptionHandler`) on any invariant breach
    - `update(UUID id, UpdateApiBehaviourDiffRequest)`: PATCH semantics — null fields preserved; non-null fields overwrite. Updates `updated_at = NOW()`.
    - `getById(UUID id)`, `getByTargetBaselineId(UUID targetBaselineId)`, `listBySourceBaselineId(UUID sourceBaselineId)` (read-side)
    - `delete(UUID id)` (cascades to diff_items via FK)
  - [x] 2.7 Author `ApiBehaviourDiffItemService`
    - New file alongside the diff service; pure CRUD
    - `create(CreateApiBehaviourDiffItemRequest)`: validates the parent diff exists; validates `status_classification` ∈ {`status_match`, `status_drift`, `source_only`, `target_only`}; validates `body_classification` (when present) ∈ {`body_match`, `body_shape_drift`, `body_value_drift`}
    - `listByDiffId(UUID diffId)` returning items ordered by `(method, path)`
    - `deleteByDiffId(UUID diffId)` — used by recompute to wipe prior items
  - [x] 2.8 Author `ApiBehaviourDiffController`
    - New file under `controller.apibehaviour`
    - Standard CRUD endpoints mirroring the existing `ApiBehaviourBaselineController` pattern:
      - `POST /api/projects/{projectId}/api-behaviour/diffs` → `create`
      - `PATCH /api/projects/{projectId}/api-behaviour/diffs/{id}` → `update`
      - `GET /api/projects/{projectId}/api-behaviour/diffs/{id}` → `getById`
      - `GET /api/projects/{projectId}/api-behaviour/diffs/by-target/{targetBaselineId}` → `getByTargetBaselineId` (UI-lookup endpoint — most-common path from the Drift report tab)
      - `GET /api/projects/{projectId}/api-behaviour/diffs?sourceBaselineId={sourceId}` → `listBySourceBaselineId` (supports future reverse-lookup)
      - `DELETE /api/projects/{projectId}/api-behaviour/diffs/{id}` → `delete`
    - Per-project scoping enforced via the existing convention (404 if the diff doesn't resolve under `{projectId}`)
  - [x] 2.9 Author `ApiBehaviourDiffItemController`
    - New file alongside the diff controller
    - Endpoints:
      - `POST /api/projects/{projectId}/api-behaviour/diffs/{diffId}/items` → `create` (used by `diffRunner.ts` to persist each computed item)
      - `GET /api/projects/{projectId}/api-behaviour/diffs/{diffId}/items` → `listByDiffId`
      - `DELETE /api/projects/{projectId}/api-behaviour/diffs/{diffId}/items` → `deleteByDiffId` (used by recompute)
  - [x] 2.10 Run ONLY the 5-6 tests written in 2.1
    - Verify FK-pairing invariant rejects all four illegal combos (source not current, target not target, mismatched pair, source-deleted parent)
    - Verify CRUD round-trips work including the JSONB `body_diff_json`
    - Verify the by-target endpoint returns the right DTO and 404s correctly
    - Verify PATCH preserves missing count fields (no silent wipe to 0)
    - Do NOT run the entire AMS test suite

**Acceptance Criteria:**
- The 5-6 tests written in 2.1 pass
- All 6 count fields on `ApiBehaviourDiffDto` are boxed `Integer` — confirmed by the PATCH-safety regression test in 2.1
- Service layer rejects mismatched FK pairs on both create and update (source must be `kind='current'`; target must be `kind='target'` with `paired_with_baseline_id == source_baseline_id`)
- New by-target endpoint returns the DTO, scoped correctly per project, with 404 on unknown target
- Standard CRUD endpoints mirror the existing api-behaviour controller pattern
- Boxed-type Javadoc note present on both new DTOs for the next maintainer

---

### Validation Service Diff Layer

#### Task Group 3: `diffRunner.ts` + `jsonShapeComparator.ts` + routes + auto-trigger
**Dependencies:** Task Group 2 (so AMS reads + writes for the new diff entities work end-to-end)
**Scope:** The new ~300-400 LOC diff runner; the ~150-250 LOC JSON shape comparator with the critical Step 1 wrapper-unwrap normalisation; 4 new route handlers under the existing `/api-migration-validation` router; the one-line auto-trigger insertion in `targetReplayRunner.ts`; additive `archModelClient.ts` extensions. Reuses the existing `runManager` with `diffId` in the `sessionId` slot (documented as a semantic stretch in a code comment).
**Test budget:** 8-10 tests (jsonShapeComparator unit tests including wrapper unwrap, diffRunner happy path + classifications, source_only with mutating_skipped notes, target_only forward-compat, auto-trigger fail-soft, draft target rejection, concurrent recompute 409).

- [x] 3.0 Complete validation-service diff layer
  - [x] 3.1 Write 8-10 focused tests for comparator + runner + routes
    - **Comparator unit test — wrapper unwrap (critical, F2 in requirements):** `compareJsonShapes(rawBody, { headers: {...}, body: rawBody })` → returns `body_match`. Three sub-assertions:
      - (a) Symmetric unwrap when both sides match the envelope shape exactly
      - (b) Symmetric unwrap when only ONE side matches the envelope (the typical source vs target asymmetry — source raw, target wrapped)
      - (c) NO unwrap when a body legitimately has `headers` and `body` keys PLUS other keys (e.g. `{ headers, body, metadata }` — leave verbatim, do not unwrap)
    - Comparator unit test — body shape drift: target has an extra key vs source → `body_shape_drift`
    - Comparator unit test — body value drift: same key set + types, different leaf values → `body_value_drift`
    - Comparator unit test — body shape wins over value: target has both an extra key AND different leaf values on a shared key → `body_shape_drift` (not `body_value_drift`)
    - Runner happy-path unit test: 5 paired items (3 matched, 1 status drift, 1 body shape drift) → diff persists with counts `matched=3, status_drift=1, body_shape_drift=1, body_value_drift=0, source_only=0, target_only=0`; per-item rows persist via stubbed `archModelClient.createDiffItem`
    - Runner `source_only` unit test: source item exists, no paired target → emits a `source_only` diff_item with `notes='mutating_skipped'` (when the source baseline item carries that diagnostic from Spec #4's runner) or `notes='no_paired_target'` (default)
    - Runner `target_only` unit test (forward-compat): manufacture a target item with no source pair → emits a `target_only` diff_item; verifies the schema + runner path works even though v1 won't naturally produce this case
    - Runner auto-trigger fail-soft test: stub `diffRunner.runDiff` to throw; verify `targetReplayRunner.ts` catches the throw, logs a diagnostic, and the replay still returns `{ finalStatus: 'completed' }` — the replay session is NOT marked failed
    - Route handler test — draft target rejected: `POST /diffs` with a target baseline whose `status='draft'` → HTTP 400 with `error='target_baseline_not_finalised'`
    - Route handler test — concurrent recompute 409: register a diffId in `runManager.start({ sessionId: diffId, ... })`; second call to `POST /diffs/:id/recompute` for the same id → HTTP 409 with `currentStatus='computing'`
    - Skip exhaustive per-route happy-path coverage — the routes are thin and follow the existing `targetCaptureSessionActions.ts` pattern
  - [x] 3.2 Author `src/services/jsonShapeComparator.ts`
    - ~150-250 LOC; new file under `api-migration-validation-service/src/services/`
    - Public API: `compareJsonShapes(source: unknown, target: unknown): { classification: 'body_match' | 'body_shape_drift' | 'body_value_drift'; diffAnnotation: BodyDiffAnnotation }`
    - **Step 1 — symmetric wrapper unwrap (THE critical pitfall, must be the first thing the function does):**
      ```ts
      function unwrapBodyEnvelope(json: unknown): unknown {
        if (json === null || typeof json !== 'object' || Array.isArray(json)) return json;
        const keys = Object.keys(json as Record<string, unknown>);
        if (keys.length === 2 && keys.includes('headers') && keys.includes('body')) {
          return (json as Record<string, unknown>).body;
        }
        return json;
      }
      ```
      Apply to BOTH `source` and `target` independently before any walking. Document the rule in a JSDoc block atop the function.
    - Step 2 — parallel walk: recursively compare both JSON trees, classifying each path as `key_added` / `key_removed` / `type_changed` / `value_changed` / `match`; produce a flat list keyed by JSON pointer (`/foo/bar/0/baz`)
    - Step 3 — aggregate: `body_shape_drift` wins over `body_value_drift` if any key/type drift exists; `body_match` only when zero differences after unwrap
    - Array comparison is ordered/positional in v1 (unordered + match-by-id deferred to v2)
    - Compares response bodies only — request bodies are identical-by-construction (Spec #4 replay carries them verbatim) and not walked
  - [x] 3.3 Author `src/services/diffRunner.ts`
    - ~300-400 LOC; new file alongside `targetReplayRunner.ts`
    - Entry point: `runDiff(diffId: string, deps?: DiffRunnerDeps): Promise<void>`
    - Body:
      1. Load the diff row via `archModelClient.getDiff(diffId)`
      2. Load source baseline items (paginated via `listBaselineItems`)
      3. Load target baseline items (paginated)
      4. Build two maps keyed `${method}|${path}|${scenario_name}` for fast lookup
      5. For each source item:
         - Find paired target by composite key
         - If no target: emit `source_only` with notes = `mutating_skipped` (if source item's `notes` from Spec #4 says so) | `transport_failure` (if source item's `notes` indicates that) | `no_paired_target` (default)
         - Else: classify status (`status_match` / `status_drift`), classify body via `jsonShapeComparator.compareJsonShapes(source.response_json, target.response_json)`, populate `body_diff_json`
      6. For target items without a source match: emit `target_only` (forward-compat; shouldn't appear in v1)
      7. Persist all diff_items via `archModelClient.createDiffItem` (batch where possible)
      8. PATCH diff to `status='completed'` with summary counts + `computed_at` + both baselines' `updated_at` snapshots
      9. On unrecoverable error: PATCH diff to `status='failed'` with `error_message`; emit diagnostic; exit cleanly
    - Uses `runManager.start({ sessionId: diffId, projectId, architectureId })` for background-task tracking
    - **CRITICAL — add a code comment at the `runManager.start(...)` invocation site:**
      ```ts
      // NOTE: We reuse runManager (Spec #4) for diff runs. The `sessionId` field
      // also holds diffIds here — diff runs have no session of their own. The
      // per-scenario counters on the run object stay unpopulated (harmless).
      // See requirements F5 / accepted Q5 for the decision rationale.
      ```
    - Second rapid invocation throws synchronously from `runManager.start(...)` (already-running protection) → caught by the route handler and surfaced as HTTP 409
  - [x] 3.4 Author `src/routes/diffActions.ts`
    - New file under `api-migration-validation-service/src/routes/`
    - 4 route handlers mirroring the existing `targetCaptureSessionActions.ts` patch-status-first / fire-and-forget pattern:
      - `POST /diffs` — body `{ projectId, architectureId, sourceBaselineId, targetBaselineId }`. Steps:
        1. Validate target baseline status via `archModelClient.getBaseline(targetBaselineId)` — if `status === 'draft'`, return HTTP 400 `{ error: 'target_baseline_not_finalised' }`
        2. Look up existing diff via `archModelClient.getDiffByTargetBaseline(targetBaselineId)`; if present, reuse the existing diff id (recompute semantics); else `archModelClient.createDiff(...)` with `status='computing'`
        3. Fire `diffRunner.runDiff(diffId)` as a fire-and-forget local call (`spawnRunner(...).catch(log)` pattern)
        4. Return `{ diffId, status: 'computing' }` immediately
      - `POST /diffs/:id/recompute` — re-runs the existing diff. Wipes prior diff_items via `archModelClient.deleteDiffItemsByDiff(diffId)`, PATCHes diff back to `status='computing'`, fires `runDiff`. Returns HTTP 409 with `{ currentStatus: 'computing' }` if `runManager` reports the diff is already running.
      - `GET /diffs/:id/status` — polling endpoint returning `{ status, matched_count, status_drift_count, body_shape_drift_count, body_value_drift_count, source_only_count, target_only_count, computed_at, error_message }`
      - `POST /diffs/:id/cancel` — calls `runManager.cancel(diffId)`; PATCHes diff to `status='failed'` with `error_message='cancelled'`
  - [x] 3.5 Extend `src/services/archModelClient.ts` additively
    - Add methods (~50-100 LOC; existing methods untouched):
      - `createDiff(req: CreateDiffRequest): Promise<ApiBehaviourDiffDto>`
      - `patchDiff(diffId: string, patch: UpdateDiffRequest): Promise<ApiBehaviourDiffDto>`
      - `getDiff(diffId: string): Promise<ApiBehaviourDiffDto>`
      - `getDiffByTargetBaseline(targetBaselineId: string): Promise<ApiBehaviourDiffDto | null>` — returns `null` on 404
      - `createDiffItem(diffId: string, req: CreateDiffItemRequest): Promise<ApiBehaviourDiffItemDto>`
      - `listDiffItemsByDiff(diffId: string): Promise<ApiBehaviourDiffItemDto[]>` (paginated if needed)
      - `deleteDiffItemsByDiff(diffId: string): Promise<void>` — used by recompute
    - Add new DTO types (snake_case wire, per existing api-behaviour convention) mirroring the AMS Java DTOs from Task Group 2
    - Follow the existing typed-wrapper pattern from the baseline / baseline-item methods (lines 712-975 in the existing file)
  - [x] 3.6 Add the auto-trigger one-liner to `src/services/targetReplayRunner.ts`
    - **Direct local import — NOT a self-HTTP-call (accepted Q4).** At the top of the file add `import { runDiff } from './diffRunner';`
    - Insertion point: immediately after `patchBaseline(...)` to `status='active'` at the happy-path tail (~line 641 per Spec #4 anchor), BEFORE the final `return { ..., finalStatus: 'completed' }`
    - The shape of the insertion (fail-soft, fire-and-forget):
      ```ts
      // Auto-trigger the diff engine as a background task. Fail-soft: replay
      // session is still marked `completed` regardless of diff outcome; the
      // manual Recompute button on the Drift report tab is the fallback.
      try {
        const diff = await archModelClient.createDiff({
          projectId,
          architectureId: session.architecture_id,
          sourceBaselineId: session.source_baseline_id,
          targetBaselineId: targetBaseline.id,
        });
        // Fire-and-forget — do NOT await; replay returns immediately
        runDiff(diff.id).catch((err) => {
          console.error('op=auto_diff_trigger_failed', { diffId: diff.id, err: String(err) });
        });
      } catch (err) {
        console.error('op=auto_diff_create_failed', { err: String(err) });
      }
      ```
    - Replay runner's return is unaffected — the diff is its own background task
  - [x] 3.7 Wire the new routes into `src/routes/index.ts` barrel
    - Mount under the same `/api-migration-validation` router prefix
    - Existing target-capture-session + current-state routes untouched
  - [x] 3.8 Run ONLY the 8-10 tests written in 3.1
    - Verify all 3 wrapper-unwrap sub-assertions pass (the most critical correctness gate for this spec)
    - Verify body-shape-wins-over-value precedence
    - Verify runner happy path + classifications
    - Verify source_only / target_only paths
    - Verify auto-trigger fail-soft (replay still completes)
    - Verify draft-target rejection (HTTP 400)
    - Verify concurrent recompute 409
    - Do NOT run the full Jest suite

**Acceptance Criteria:**
- The 8-10 tests written in 3.1 pass
- `jsonShapeComparator.ts` Step 1 wrapper-unwrap correctly handles all three sub-cases (both wrapped, one wrapped, legitimately-three-key bodies left verbatim) — covered by the dedicated unit test
- `diffRunner.ts` walks paired baselines, classifies each scenario per the enumerated classifications, persists all diff_items, PATCHes the diff to `status='completed'` with summary counts
- `runManager.start({ sessionId: diffId, ... })` semantic stretch documented in a code comment at the invocation site
- Auto-trigger added to `targetReplayRunner.ts` as a single fail-soft fire-and-forget block; replay session is still marked `completed` regardless of diff outcome
- All 4 routes mounted; draft-target rejection returns HTTP 400 with the right error code; concurrent recompute returns HTTP 409
- `archModelClient.ts` extensions are additive only; existing methods untouched
- `runManager.ts` itself is NOT modified — pure reuse with `diffId` in the `sessionId` slot

---

### Gateway Layer

#### Task Group 4: Gateway proxy + typed-client wrapper
**Dependencies:** Task Group 3
**Scope:** 4 validation-service proxy routes mirroring the new diff endpoints; AMS-direct proxies for diff / diff_items CRUD plus the by-target lookup; additive typed wrappers in the existing `gateway/src/services/apiBehaviourClient.ts` (extended by Spec #4, not a new file).
**Test budget:** 3-4 tests (proxy pass-through, AMS-direct proxy, typed-client wrapper).

- [x] 4.0 Complete gateway proxy layer
  - [x] 4.1 Write 3-4 focused tests for gateway proxies + wrappers
    - One supertest test proxying `POST /api/v1/api-migration-validation/diffs` to the validation service (mock axios → assert URL forwarded with body intact)
    - One supertest test for the AMS-direct by-target proxy: `GET /api/v1/projects/:projectId/api-behaviour/diffs/by-target/:targetBaselineId` → forwarded verbatim to AMS with both path params preserved
    - One unit test on the typed client wrapper: `getDiffByTargetBaseline(...)` GETs the right gateway URL and returns the typed DTO shape with all 6 boxed `Integer` count fields
    - Optional fourth test: missing-path-param 404 safety on a `:projectId`-required route (mirrors the existing per-surface convention used by Spec #4's target-capture proxies)
    - Skip exhaustive per-route coverage
  - [x] 4.2 Add 4 validation-service proxy routes to `gateway/src/routes/apiMigrationValidation.ts`
    - `POST /api/v1/api-migration-validation/diffs`
    - `POST /api/v1/api-migration-validation/diffs/:id/recompute`
    - `POST /api/v1/api-migration-validation/diffs/:id/cancel`
    - `GET /api/v1/api-migration-validation/diffs/:id/status`
    - All routes forward verbatim to the validation service at the matching path
    - Reuse the existing URL safety properties (missing path param produces a 404 at Express layer with no fallback resolution — mirrors Spec #4's target-capture-session proxies)
  - [x] 4.3 Add AMS-direct proxies for diff / diff_items CRUD + the by-target lookup
    - `POST /api/v1/projects/:projectId/api-behaviour/diffs` → forwarded to AMS
    - `GET /api/v1/projects/:projectId/api-behaviour/diffs/:id` → forwarded
    - `PATCH /api/v1/projects/:projectId/api-behaviour/diffs/:id` → forwarded
    - `DELETE /api/v1/projects/:projectId/api-behaviour/diffs/:id` → forwarded
    - `GET /api/v1/projects/:projectId/api-behaviour/diffs/by-target/:targetBaselineId` → forwarded (UI-lookup endpoint)
    - `GET /api/v1/projects/:projectId/api-behaviour/diffs/:diffId/items` → forwarded
    - `POST /api/v1/projects/:projectId/api-behaviour/diffs/:diffId/items` → forwarded (used by validation-service-side `archModelClient.createDiffItem`)
    - Follow the same `/api/v1/projects/...` shape (no `/architecture-model/` segment) used by Spec #4's AMS-direct proxies for consistency within `apiMigrationValidation.ts`
  - [x] 4.4 Add typed client wrappers to `gateway/src/services/apiBehaviourClient.ts`
    - File already exists (extended in Spec #4) — additive only; no new file at the gateway service layer
    - New DTO types mirroring the AMS Java DTOs from Task Group 2 (snake_case wire fields): `ApiBehaviourDiffDto`, `ApiBehaviourDiffItemDto`, `CreateDiffRequest`, etc.
    - **All 6 count fields on `ApiBehaviourDiffDto` typed as `number | null`** (TypeScript equivalent of boxed `Integer`) — never typed as plain `number` without `| null`
    - New wrapper functions:
      - `createDiff(req: CreateDiffRequest): Promise<ApiBehaviourDiffDto>`
      - `recomputeDiff(diffId: string): Promise<ApiBehaviourDiffDto>`
      - `getDiffStatus(diffId: string): Promise<DiffStatusDto>`
      - `getDiffByTargetBaseline(targetBaselineId: string): Promise<ApiBehaviourDiffDto | null>` (returns null on 404)
      - `listDiffItems(diffId: string): Promise<ApiBehaviourDiffItemDto[]>`
      - `cancelDiff(diffId: string): Promise<void>`
    - Errors surface as the existing `ApiBehaviourClientError` (per Spec #4's pattern) carrying upstream status + body
  - [x] 4.5 Run ONLY the 3-4 gateway tests written in 4.1
    - Verify URL forwarding for one representative validation-service proxy
    - Verify AMS-direct by-target proxy
    - Verify typed wrapper signature + DTO shape
    - Verify (optional) missing-path-param 404 safety
    - Do NOT run the full gateway suite

**Acceptance Criteria:**
- The 3-4 tests written in 4.1 pass
- All 4 validation-service proxy routes reachable through gateway
- All AMS-direct diff / diff_items proxy routes reachable, including the by-target lookup
- Typed wrappers additive only; existing wrappers untouched
- All 6 count fields on `ApiBehaviourDiffDto` typed as `number | null` (matching the boxed `Integer` contract from Task Group 2)
- Pre-existing failing tests listed in project memory remain in the same state (verify via `git stash`/`pop` cycle if a new failure appears)

---

### Frontend Layer

#### Task Group 5: `DriftReportTab` + `DiffItemDetailModal` + `BaselineDetailView` tab refactor
**Dependencies:** Task Group 4
**Scope:** Two NEW components under `frontend/src/components/DashboardView/` (colocated with `BaselineDetailView.tsx` per the component-location caveat); a small structural refactor to `BaselineDetailView.tsx` to introduce a tab container ONLY when `baseline.kind === 'target'`; additive extensions to `frontend/src/api/apiBehaviourClient.ts` for the new diff endpoints.
**Test budget:** 4 tests (tab renders counts, recompute button fires + re-polls, stale badge appearance, side-by-side modal renders annotations).

- [x] 5.0 Complete frontend layer
  - [x] 5.1 Write 4 focused tests for tab + button + modal
    - One Vitest test mounting `DriftReportTab` with a fully-populated diff DTO (matched=3, status_drift=1, body_shape_drift=1, body_value_drift=0, source_only=2): asserts the header counts render correctly and the diff-items table shows all 7 rows with the right classification labels
    - One Vitest test asserting the **"Recompute"** button click fires `POST /api/v1/api-migration-validation/diffs/:id/recompute` via the typed client and the tab re-polls `/status` until terminal — mock the polling so the test doesn't sleep; verify the button is disabled while `status='computing'`
    - One Vitest test asserting the **"Stale"** badge appears when `baseline.updated_at > diff.computed_at` on EITHER baseline (source OR target); does NOT appear when both `updated_at`s are ≤ `computed_at`
    - One Vitest test mounting `DiffItemDetailModal` with a diff_item that has a populated `body_diff_json`: source response JSON renders on the left, target response JSON renders on the right, and the JSON-pointer paths from `body_diff_json` are highlighted in both panes
    - Skip exhaustive per-row sorting / filtering coverage
  - [x] 5.2 Create `frontend/src/components/DashboardView/DriftReportTab.tsx`
    - **Component location: `DashboardView/` — NOT `ApiBehaviour/` (per the component-location caveat in spec.md / requirements F7).** The new tab content sits alongside its parent `BaselineDetailView.tsx`.
    - Tab content includes:
      - Header counts strip: `N matched · N status drift · N body shape drift · N body value drift · N source-only` — using **"drift"** language in user-facing copy (per accepted Q15)
      - "Computing…" spinner when `status='computing'`
      - "Stale" badge when either `baseline.updated_at > diff.computed_at` (source OR target)
      - Sortable + filterable table of diff items — columns: method, path, scenario name, source status, target status, classification, action ("View diff" → opens `DiffItemDetailModal`)
      - **"Recompute"** button (action verb; placement: top-right of the tab; disabled while `status='computing'`)
    - Empty-state when source baseline was deleted (CASCADE removed the diff rows): "Source baseline has been deleted; no drift report available" — Recompute button disabled (no source to diff against)
    - Polling: re-poll `/status` at 2-3s cadence when `status='computing'`; stop on `completed` / `failed` (matches the existing capture-session polling cadence)
    - Imports the new client functions from `apiBehaviourClient.ts` (extended in 5.5)
  - [x] 5.3 Create `frontend/src/components/DashboardView/DiffItemDetailModal.tsx`
    - **Component location: `DashboardView/` — NOT `ApiBehaviour/`.** Colocated with `DriftReportTab`.
    - Side-by-side layout: source response JSON on the left, target response JSON on the right (the `response_json` blob as stored, not the unwrapped form — the user wants to see what's actually persisted)
    - Annotations: walk `body_diff_json` (JSON pointers); for each pointer, highlight the corresponding path in both panes with a colour-coded marker (e.g. red for `key_removed`, green for `key_added`, yellow for `value_changed`, blue for `type_changed`)
    - Uses existing design system primitives — no new visual primitives introduced
    - Closes on backdrop click or `Esc`
  - [x] 5.4 Refactor `frontend/src/components/DashboardView/BaselineDetailView.tsx` for the tab container
    - **Small structural refactor — flat → tabbed ONLY when `baseline.kind === 'target'`** (per requirements F7)
    - When `baseline.kind === 'target'`:
      - Wrap the existing Summary + Baseline-items in a "Baseline detail" tab
      - Add a "Drift report" tab containing `DriftReportTab`
      - Add a tabs nav strip above the content area
      - The Spec #4 kind=target header banner ("Target-side API capture (paired with: ...)") stays above the tabs nav, NOT inside either tab
    - When `baseline.kind === 'current'`:
      - View stays FLAT — no tabs nav, no "Drift report" tab — no reverse-drift list (deferred to v2 per accepted Q9)
      - The existing flat layout is preserved EXACTLY; existing snapshot/rendering tests for the current-state path must not break
    - Refactor footprint: ~50 LOC across the file; no new design-system primitives
  - [x] 5.5 Extend `frontend/src/api/apiBehaviourClient.ts`
    - Additive only — no edits to existing client functions
    - Add typed DTOs:
      - `ApiBehaviourDiffDto` — all 6 count fields typed `number | null` (matching the boxed `Integer` contract)
      - `ApiBehaviourDiffItemDto` — `source_response_status` / `target_response_status` typed `number | null`; `body_diff_json` typed `Record<string, unknown> | null`
      - `CreateDiffRequest`, `DiffStatusDto`
    - Add client functions:
      - `createDiff(req: CreateDiffRequest): Promise<ApiBehaviourDiffDto>`
      - `recomputeDiff(diffId: string): Promise<ApiBehaviourDiffDto>`
      - `getDiffStatus(diffId: string): Promise<DiffStatusDto>`
      - `getDiffByTargetBaseline(targetBaselineId: string): Promise<ApiBehaviourDiffDto | null>`
      - `listDiffItems(diffId: string): Promise<ApiBehaviourDiffItemDto[]>`
      - `cancelDiff(diffId: string): Promise<void>`
  - [x] 5.6 Run ONLY the 4 frontend tests written in 5.1
    - Verify tab counts render correctly
    - Verify Recompute button fires + re-polls + disabled-while-computing
    - Verify Stale badge appearance logic (both source and target `updated_at` paths)
    - Verify side-by-side modal renders body_diff_json annotations
    - Do NOT run the full Vitest suite

**Acceptance Criteria:**
- The 4 tests written in 5.1 pass
- `DriftReportTab.tsx` and `DiffItemDetailModal.tsx` exist as NEW files under `frontend/src/components/DashboardView/` (NOT `ApiBehaviour/`)
- `BaselineDetailView.tsx` introduces a tab container ONLY when `baseline.kind === 'target'`; the `kind='current'` path stays flat with the existing layout preserved exactly
- Header banner from Spec #4 (Target-side API capture paired-with link) is preserved above the tabs nav
- All UI copy uses **"drift"** language (Drift report tab, Stale badge, "N items with drift" header text); engineering / endpoints / variables use **"diff"** (accepted Q15)
- Recompute button label is **"Recompute"** (action verb)
- Stale badge appears when either baseline's `updated_at > diff.computed_at`
- Empty-state renders correctly when source baseline is deleted (CASCADE-removed diff rows surface as "Source baseline has been deleted; no drift report available")
- All 6 count DTO fields typed `number | null` in the frontend client (matching the gateway + AMS contract)
- No new design-system primitives introduced
- Pre-existing failing tests listed in project memory remain in the same state

---

### End-to-End Verification

#### Task Group 6: End-to-end manual verification on the running stack
**Dependencies:** Task Groups 1-5
**Scope:** Single happy-path replay-then-diff verification end-to-end against the running stack. Confirms the per-layer 5-commit chain integrates correctly, the auto-trigger fires, and the Drift report tab renders the structured drift. No automated end-to-end test added (the test budget is already met by the per-layer tests).
**Test budget:** 0 automated tests — this group is manual verification only.

- [ ] 6.0 Complete end-to-end manual verification
  - [ ] 6.1 Spin up the stack
    - AMS on its usual port; `api-migration-validation-service` on 8092; gateway; frontend
    - Confirm `/health` on the validation service returns `ok`
    - Confirm `cd architecture-model-service && mvn test-compile` exits 0 (constant invariant per the test-infrastructure-cleanup spec; no `-D` flags)
  - [ ] 6.2 Reach a finalised target baseline (precondition)
    - Either: use an existing paired `kind='current'` + `kind='target'` baseline from Spec #4's verification (if still present in the dev DB), OR
    - Run a full Spec #4 flow: create a current-state baseline, then trigger a target replay via "Capture target API behaviour" against any non-prod API. End state: a `kind='target'` baseline with `status='active'` paired with a `kind='current'` source baseline
    - **Watch the validation-service logs during the replay's tail.** The auto-trigger should fire — look for either a `createDiff` HTTP call to AMS or the diagnostic log line if it fails. The replay session should still mark `completed` regardless.
  - [ ] 6.3 Verify the auto-spawned diff materialises
    - Open `BaselineDetailView` for the target baseline (the auto-spawn happened in 6.2)
    - Verify the new tabs nav appears at the top (Drift report + Baseline detail) — the kind=target header banner from Spec #4 stays above the tabs
    - Click the "Drift report" tab
    - Verify the header counts populate correctly; the diff-items table renders one row per source item
    - Verify the classifications look sane: identical-API replays produce mostly `matched`; replays against a different sibling URL produce a mix of `status_drift` / `body_shape_drift` / `body_value_drift`
  - [ ] 6.4 Verify the wrapper-unwrap normalisation works end-to-end
    - On a paired item where source response was `{ user: { id: 1, name: "alice" } }` and target's `response_json` was wrapped as `{ headers: {...}, body: { user: { id: 1, name: "alice" } } }`:
    - The classification MUST be `body_match` (NOT `body_shape_drift`)
    - If this fails (every item shows `body_shape_drift`), the wrapper-unwrap rule in `jsonShapeComparator.ts` Step 1 is broken — return to Task Group 3 and check the unit test from 3.1
  - [ ] 6.5 Verify Recompute + Stale badge
    - Click **"Recompute"** on the Drift report tab; verify the button disables, the tab shows a "Computing…" spinner, and the counts re-populate when status flips to `completed`
    - Click "Recompute" twice in rapid succession; verify the second click is a no-op (button disabled while computing — UI side) OR the request returns HTTP 409 (server side, if the disabled state was bypassed somehow)
    - Manually reject one of the target items via the existing `CaptureReviewPanel` toggle from Spec #4 — this updates the target baseline's `updated_at`
    - Return to the Drift report tab; verify the **"Stale"** badge now appears (target's `updated_at > diff.computed_at`)
    - Click Recompute; verify the Stale badge disappears once recompute completes
  - [ ] 6.6 Verify the side-by-side modal
    - Click "View diff" on a row with `body_shape_drift` or `body_value_drift`
    - Verify the modal opens with source response JSON on the left, target response JSON on the right
    - Verify the differing JSON-pointer paths are highlighted in both panes (per `body_diff_json` annotations)
    - Close via backdrop or `Esc`
  - [ ] 6.7 Verify draft-target rejection
    - Start a target replay; while it's still `draft` (session has been created but `start` not yet called, or the replay is mid-flight), manually POST to `/api/v1/api-migration-validation/diffs` with the in-progress target baseline id
    - Verify the response is HTTP 400 with `error='target_baseline_not_finalised'`
  - [ ] 6.8 Verify the source-deletion empty state
    - Delete the source baseline (via the existing baseline-delete UI or a direct AMS API call)
    - Reload the target baseline detail view; verify the Drift report tab still loads but shows the empty state ("Source baseline has been deleted; no drift report available") and the Recompute button is disabled

**Acceptance Criteria:**
- End-to-end diff flow completes: target replay → auto-spawn diff → drift report tab populates → recompute works → side-by-side modal renders
- Wrapper-unwrap normalisation works on real persisted data (identical source / target bodies produce `body_match`, not spurious `body_shape_drift`)
- Recompute concurrency handled correctly (button disabled while computing; second rapid POST returns HTTP 409)
- Stale badge appears when either baseline's `updated_at` advances after `computed_at`
- Draft-target rejection returns HTTP 400 with the right error code
- Source-deletion empty state renders correctly
- `mvn test-compile` exits 0 on AMS (no `-D` flags)
- Pre-existing broken tests listed in project memory remain untouched

---

## Execution Order

Strictly sequential by dependency (no parallelisable groups — the layers stack cleanly, matching Spec #4's pattern):

1. AMS Liquibase + entities + repositories (Group 1)
2. AMS DTOs + services + controllers including by-target endpoint (Group 2)
3. `diffRunner.ts` + `jsonShapeComparator.ts` + routes + auto-trigger in `targetReplayRunner.ts` (Group 3)
4. Gateway proxy + typed-client wrapper (Group 4)
5. `DriftReportTab` + `DiffItemDetailModal` + `BaselineDetailView` tab refactor (Group 5)
6. End-to-end manual verification (Group 6)

Per accepted Q14, each of Groups 1-5 corresponds to one commit. Group 6 is verification only — no commit.

## Standing Constraints (apply to every group)

- Liquibase changesets `<=157` (or whatever the highest pre-existing number is at implementation time — confirm via 1.2) are immutable. NEW files only; never edit prior changesets per `feedback_liquibase_immutable_changesets.md`.
- All 6 count fields on `ApiBehaviourDiffEntity` / `ApiBehaviourDiffDto` are boxed `Integer` (Java) / `number | null` (TS) — never primitive `int` / plain `number` — per `project_primitive_double_dto_overwrite.md`. The Javadoc note added in Task Group 2 records this rule for the next maintainer.
- Reused infrastructure (`runManager.ts`, `httpExecutor.ts`, `secretsStore.ts`, `redactor.ts`, `startupReconciliation.ts`) MUST NOT be edited — the diff runner reuses `runManager` with `diffId` in the `sessionId` slot, documented as a semantic stretch in a code comment at the invocation site.
- Diff engine v1 is fully deterministic — no LLM, no semantic enrichment, no scenario regeneration.
- The `jsonShapeComparator.ts` Step 1 wrapper-unwrap rule is non-negotiable — without it, every paired item is flagged `body_shape_drift` and the feature looks broken on day one. Covered by the dedicated unit test in 3.1.
- Auto-trigger from `targetReplayRunner.ts` is a direct local function call (NOT a self-HTTP-call) per accepted Q4. Fail-soft: caught + logged + replay still completes.
- New frontend components live under `frontend/src/components/DashboardView/`, NOT `frontend/src/components/ApiBehaviour/`. The raw-idea's proposed paths under `ApiBehaviour/` are wrong (no such folder for new top-level components — `ApiBehaviour/` is the wizard home).
- Naming convention: **"diff"** in engineering / schema / endpoints / variable names; **"drift"** in user-facing UI copy. Apply consistently per accepted Q15.
- Recompute button label is **"Recompute"** (action verb); tab label is **"Drift report"** (drift, not diff).
- Pre-existing broken tests listed in project memory must NOT be modified by this feature's work.
- Do NOT edit `discovery-service/src/**` if a discovery run is active (tsx watch reload kills runs per `feedback_no_src_edits_during_run.md`).
