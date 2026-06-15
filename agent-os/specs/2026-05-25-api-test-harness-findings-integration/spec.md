# Specification: API Test Harness — Findings Integration

## Goal

Emit `discovery_findings` rows automatically when an `api_behaviour_diff` completes in `api-migration-validation-service`, link each finding to the originating `api_behaviour_diff_item`, and surface them inline as a "Findings" badge column on the Drift report tab with a new `DiffFindingDetailDrawer` for reviewer lifecycle. This is the smallest of the three-spec arc (#4 capture, #5 diff engine, #6 findings integration): the diff classifications, the findings infrastructure, and the Drift report tab all already exist — this spec is a schema unlock, a deterministic emission rule set, a new diff-scoped AMS controller, and one new copy-modified drawer component.

## User Stories

- As an Architect reviewing a target replay, I want each drift item on the Drift report tab to surface a "Findings" badge with a count, so that I can see at a glance which deltas have been raised as durable reviewable findings without leaving the tab.
- As a Test Engineer triaging drift, I want to click a Findings badge and open a reviewer drawer where I can transition the finding through `accepted` / `ignored` / `needs_review` / `resolved`, so that drift triage carries the same lifecycle and audit trail as Discovery findings.
- As an Architect recomputing a diff after a fix, I want the previous diff-sourced findings to be cleanly replaced (not accumulated) when the diff re-emits, so that the badge counts always reflect the current diff and stale findings don't pollute the dashboard.

## Specific Requirements

**AMS persistence — single Liquibase changeset (additive only)**
- Verify the highest applied changeset slot at implementation time (`ls architecture-model-service/src/main/resources/db/changelog/sql/ | sort -V | tail -5`). Spec #5 landed at slots `158` and `159`; predicted next free slot is `160`, but re-verify empirically before naming the file. Update `db.changelog-master.yaml` accordingly with a new `changeSet` block using the `preConditions: onFail: MARK_RAN` pattern that existing changesets use; never edit prior changesets.
- `<N>-discovery-findings-api-behaviour-diff-origin.sql`:
  - `ALTER TABLE discovery_findings ALTER COLUMN run_id DROP NOT NULL`.
  - `ALTER TABLE discovery_findings ADD COLUMN api_behaviour_diff_id UUID NULL REFERENCES api_behaviour_diffs(id) ON DELETE CASCADE`.
  - Partial index `idx_discovery_finding_api_behaviour_diff_id ON discovery_findings (api_behaviour_diff_id) WHERE api_behaviour_diff_id IS NOT NULL`.
  - `ALTER TABLE discovery_findings ADD CONSTRAINT discovery_finding_exactly_one_origin CHECK ((run_id IS NOT NULL)::int + (api_behaviour_diff_id IS NOT NULL)::int = 1)`.
  - `COMMENT ON COLUMN` updates on both `run_id` and `api_behaviour_diff_id` documenting the exactly-one-of-origin invariant and the CASCADE semantics.
- **No changeset for link-table vocabulary** — `discovery_finding_links.target_type` is `TEXT` and the controller validates against a service-layer allowlist that is extended programmatically. Only `api_behaviour_diff_item` is activated in v1; `api_behaviour_baseline` stays documented-but-unused (per accepted answer to Q5 — no consumer; minimises blast radius).

**AMS Java layer — entity / DTO / mapper / repository / service / controller**
- `DiscoveryFindingEntity` gains nullable `UUID apiBehaviourDiffId`; existing `runId` flipped to nullable. Both are reference types — no primitive drift risk.
- `DiscoveryFindingDto` (record) gains optional `apiBehaviourDiffId` field. Provide a backward-compatible delegating constructor so existing callers (mapper, `MigrationDiscoveryContextService.toFindingHighlight`, controllers, tests) keep working without a fan-out edit. Follows the snake_case wire convention via the global Jackson config — no per-field `@JsonProperty` needed.
- `DiscoveryFindingMapper` extended to pass `entity.getApiBehaviourDiffId()` through to the DTO constructor.
- `DiscoveryFindingRepository` new finders:
  - `findByApiBehaviourDiffIdOrderByCreatedAtAsc(UUID diffId)` — for the diff-scoped list endpoint.
  - `findByProjectIdAndArchitectureIdAndRunIdNotNull(UUID projectId, UUID architectureId)` — **load-bearing** for `MigrationSpecContextResolver.loadFindings` (filters out diff-sourced findings to preserve existing migration-spec semantics; resolver reads `f.getRunId()` directly and would NPE or render "Run: -" garbage on null).
  - Parallel `searchByApiBehaviourDiffId(...)` if the existing `search(...)` JPQL pattern is needed for diff-scoped queries (its current `WHERE f.runId = :runId` is hard-coded).
- `DiscoveryFindingService.createFinding(...)` enforces exactly-one-of-origin (`runId XOR apiBehaviourDiffId`); throws `IllegalArgumentException` on violation (mirrors the DB CHECK constraint at the service layer for fail-fast error messages).
- New service method `deleteFindingsByApiBehaviourDiffId(UUID diffId)` — **MANDATORY, NOT defensive** (per accepted answer to Q6). The `api_behaviour_diff_id ON DELETE CASCADE` only fires when the diff row itself is deleted; recompute keeps the diff row alive while replacing diff_items, so without this explicit call the runner would accumulate duplicate findings across recomputes. Called by `diffRunner.ts` before re-emit.
- `DiscoveryFindingLinkService` (allowlist `ALLOWED_LINK_TARGET_TYPES`, currently inline in `DiscoveryFindingService`) extended with `api_behaviour_diff_item`. `api_behaviour_baseline` left rejected in v1.
- **New `ApiBehaviourDiffArchitectureGuard`** — verifies the diffId in a URL belongs to the projectId + architectureId in the URL. Mirrors the existing `DiscoveryRunArchitectureGuard` shape. First-line guard on every new diff-scoped controller endpoint.
- **New diff-scoped controller surface** (the raw-idea's "no new controller" claim was wrong — `DiscoveryFindingController` has class-level `@RequestMapping(.../discovery/runs/{runId}/findings)` and every endpoint bakes runId in). New mapping at `/api/projects/{projectId}/architectures/{architectureId}/api-behaviour/diffs/{diffId}/findings[...]` with parallel service methods. Endpoints needed by the frontend:
  - `GET /api/projects/{projectId}/architectures/{architectureId}/api-behaviour/diffs/{diffId}/findings` — list all findings emitted by this diff.
  - `GET /api/projects/{projectId}/architectures/{architectureId}/api-behaviour/diffs/{diffId}/findings/by-diff-item/{diffItemId}` — list findings linked to a specific diff_item (used by the per-row badge).
  - `PATCH /api/projects/{projectId}/architectures/{architectureId}/api-behaviour/diffs/{diffId}/findings/{findingId}` — reviewer status transitions on diff-sourced findings (same body shape as the existing run-scoped PATCH).
- `MigrationSpecContextResolver.loadFindings` switches from the existing project-architecture finder to the new `findByProjectIdAndArchitectureIdAndRunIdNotNull` variant — filters diff-sourced findings out of migration spec contexts entirely (Q7). Revisit in v2 if migration specs want API-drift findings as context.

**PATCH safety for all new fields**
- All new fields are reference types (`UUID apiBehaviourDiffId`, `Instant`, `String`). No primitive drift risk per `project_primitive_double_dto_overwrite.md`.
- Note this explicitly in the DTO Javadoc so future maintainers adding numeric fields know the boxed-type rule.

**`api-migration-validation-service/src/services/findingEmissionRules.ts` (new file, ~80-120 LOC)**
- Pure deterministic function: `classifyDiffItem(item) -> { shouldEmit: boolean, findingType: string, severity: string, title: string, summary: string, detailJson: object, category: 'api_behaviour_drift' }`.
- Severity ladder per accepted answers Q1 + Q2 (introduces the **first-ever `critical` severity** in the platform — discovery-service caps at `high`; emitting `critical` for `status_drift` 2xx → 5xx is a deliberate product call to flag a previously-200 endpoint now 500ing as the highest-stakes drift signal):

  | Diff item classification | findingType | severity |
  | --- | --- | --- |
  | `status_match` + `body_match` | — | (no emit) |
  | `status_match` + `body_value_drift` only | `api_behaviour_value_drift` | `info` |
  | `status_match` + `body_shape_drift` | `api_behaviour_shape_drift` | `medium` |
  | `status_drift` (2xx → 5xx) | `api_behaviour_status_drift` | `critical` |
  | `status_drift` (2xx → 4xx) | `api_behaviour_status_drift` | `high` |
  | `status_drift` (2xx → 2xx differing) | `api_behaviour_status_drift` | `medium` |
  | `status_drift` (other, e.g. 3xx changes) | `api_behaviour_status_drift` | `low` |
  | `source_only` notes=`mutating_skipped` | `api_behaviour_unreplayed` | `info` |
  | `source_only` notes=`transport_failure` | `api_behaviour_unreplayed` | `low` |
  | `source_only` notes=`no_paired_target` | `api_behaviour_missing_target` | `high` |
  | `target_only` | `api_behaviour_extra_target` | `info` |

- Title + summary wording table (pin verbatim per accepted answer to Q8; product copy worth pinning to avoid implementer drift between interpretations):

  | Trigger | title format | summary template |
  | --- | --- | --- |
  | `status_drift` (any) | `Status drift: {METHOD} {path} responded {sourceStatus} -> {targetStatus}` | `Source baseline captured a {sourceStatus} response; target baseline captured {targetStatus} for scenario "{scenarioName}".` |
  | `body_shape_drift` | `Body shape drift: {METHOD} {path}` | `Response body shape changed for scenario "{scenarioName}": {N} keys added, {M} keys removed, {K} type changes.` |
  | `body_value_drift` only | `Body value drift: {METHOD} {path}` | `Response body shape unchanged but {N} value(s) differ for scenario "{scenarioName}".` |
  | `source_only` `mutating_skipped` | `Source-only: {METHOD} {path} (mutating call skipped on replay)` | `Mutating source scenario "{scenarioName}" was skipped during target replay because mutating_calls_confirmed was false.` |
  | `source_only` `transport_failure` | `Source-only: {METHOD} {path} (target replay transport failure)` | `Target replay for scenario "{scenarioName}" hit a transport-level failure; no target response captured.` |
  | `source_only` `no_paired_target` | `Source-only: {METHOD} {path} (no paired target capture)` | `Source baseline contains scenario "{scenarioName}" but no matching target capture was produced.` |
  | `target_only` | `Target-only: {METHOD} {path}` | `Target baseline contains scenario "{scenarioName}" but no source captured this scenario for comparison.` |

- `detailJson` payload: `{ method, path, scenarioName, sourceStatus, targetStatus, statusClassification, bodyClassification, notes, bodyDiffJson (truncated if oversize) }`.
- New category value `api_behaviour_drift` — distinct from existing `ambiguity`, `runtime_usage`, `evidence_gap`. Added via the TEXT-extensible category vocabulary (no schema change).

**Extension to `api-migration-validation-service/src/services/diffRunner.ts`**
- At the end of the existing successful-completion happy-path (after the PATCH to `status='completed'`):
  1. **FIRST** call `archModelClient.deleteFindingsByApiBehaviourDiffId(diffId)` (load-bearing recompute cleanup; see Q6 — without this, recompute accumulates duplicates).
  2. For each just-persisted `diff_item`, call `findingEmissionRules.classifyDiffItem(item)`.
  3. For each item where `shouldEmit=true`, call `archModelClient.createFinding(...)` with `apiBehaviourDiffId=diffId`, `projectId`, `architectureId` from the diff, plus `findingType` / `category` / `severity` / `title` / `summary` / `detailJson` from the classifier, `source='api_behaviour_diff'`, `createdByStage='diffRunner.findingEmission'`.
  4. Then call `archModelClient.createFindingLink(...)` once per finding with `targetType='api_behaviour_diff_item'`, `targetId=<diffItem.id>`, `linkType='derived_from'`.
- **Fail-soft**: any per-finding emission error is logged and the runner continues to the next item; the diff itself stays `status='completed'`. Models `discovery-service/.../findings/FindingEmitter.ts` soft-fail pattern.

**`api-migration-validation-service/src/services/archModelClient.ts` extensions**
- New typed wrappers (no finding methods exist today — these are net-new): `createFinding`, `createFindingLink`, `deleteFindingsByApiBehaviourDiffId`, `listFindingsByDiffId`, `listFindingsByDiffItemId`. Follow the existing typed-wrapper pattern from the baseline / baseline-item / diff methods.
- Reviewer-PATCH is not needed from the validation service (the drawer calls the gateway directly).
- New DTO types mirroring the AMS Java DTOs (snake_case wire).

**Gateway proxy — read/review only, NO create proxy (per accepted answer to Q9)**
- Emission goes from validation-service direct to AMS via the validation-service's `archModelClient`; the gateway does NOT proxy `createFinding`. This matches the discovery-service `FindingEmitter` pattern.
- New gateway routes (mirroring the new AMS diff-scoped controller surface, all under the existing api-behaviour route prefix):
  - `GET /api/v1/projects/:projectId/api-behaviour/diffs/:diffId/findings`
  - `GET /api/v1/projects/:projectId/api-behaviour/diffs/:diffId/findings/by-diff-item/:diffItemId`
  - `PATCH /api/v1/projects/:projectId/api-behaviour/diffs/:diffId/findings/:findingId` (reviewer status transitions)
- Typed wrappers added to `gateway/src/services/apiBehaviourClient.ts` (extended in Specs #4 / #5): `listDiffFindings`, `listDiffFindingsByDiffItem`, `patchDiffFinding`. Reuse the `:projectId` / `:diffId` URL-param safety pattern (missing path param → 404 at the Express layer with no fallback resolution).
- The existing discovery findings proxy block (`gateway/src/routes/discovery.ts` lines ~2460-2700+) is NOT touched — it stays run-scoped, the new block is diff-scoped.

**Frontend — minimal threading, ONE new component**
- `frontend/src/api/diffFindingsApi.ts` (new) OR parallel methods in `findingsApi.ts` — implementer picks the cleaner split. Typed wrappers for the gateway diff-scoped endpoints (`listDiffFindings`, `listDiffFindingsByDiffItem`, `patchDiffFinding`). Reuse the existing `DiscoveryFindingDto` type, extended with optional `apiBehaviourDiffId`.
- **Extension to `frontend/src/components/DashboardView/DriftReportTab.tsx`**: add a "Findings" badge column to the per-item row (between the existing classification column and the trailing "Action" column). Badge shows the count of findings linked to that diff_item via `listDiffFindingsByDiffItem` (single batch query at tab load, keyed by diff_item id). Badge click opens `DiffFindingDetailDrawer` pre-loaded with that diff_item's findings.
- **`frontend/src/components/DashboardView/DiffFindingDetailDrawer.tsx` (new, ~150 LOC copy-modify of `frontend/src/components/Discovery/FindingDetailDrawer.tsx`)** — per accepted answer to Q4. NOT a refactor of the existing drawer to accept `runId | diffId`. Lower risk to the existing reviewer flow; acceptable duplication for v1. Same reviewer workflow (`new` / `accepted` / `ignored` / `needs_review` / `resolved`), same drawer layout, but calls the diff-scoped endpoints in `diffFindingsApi.ts` instead of the run-scoped endpoints in `findingsApi.ts`. Lives under `DashboardView/` (NOT `Discovery/`) to colocate with its parent view.
- **No changes** to existing `FindingsTab.tsx`, `findingsApi.ts` URL builders, or `FindingDetailDrawer.tsx`. Per accepted answer to Q3, diff-sourced findings live exclusively on the Drift report tab in v1; the existing Findings tab keeps showing run-sourced findings only. Unified view = v2.
- No Origin filter dropdown in this spec.

**Verification anchors**
- A target replay completes -> diff completes -> findings emitted automatically per the rules + wording tables.
- Drift report tab shows "Findings" badges per diff_item with correct counts.
- Badge click opens `DiffFindingDetailDrawer`; reviewer transitions (`accepted` / `ignored` / `needs_review` / `resolved`) work end-to-end.
- Diff recompute -> previous findings explicitly deleted via `deleteFindingsByApiBehaviourDiffId` (NOT relying on FK CASCADE — diff row stays alive across recompute) -> fresh emission.
- Schema CHECK constraint rejects findings with both or neither origin set.
- `MigrationSpecContextResolver.loadFindings` does NOT NPE on diff-sourced findings (the `RunIdNotNull` filter is in place).
- `cd architecture-model-service && mvn test-compile` exits `0` (no `-D` flags).
- All new tests pass (~15-20 total — leaner than Specs #4 / #5); pre-existing test-suite state unchanged across `architecture-model-service`, `api-migration-validation-service`, `gateway`, `frontend`.

## Existing Code to Leverage

**`api-migration-validation-service/src/services/diffRunner.ts` (Spec #5)**
- Insertion point for the finding-emission step. The happy-path tail (after the PATCH to `status='completed'`) has the just-persisted `diff_items` array, `diffId`, `projectId`, `architectureId` already in scope.
- Extension is a clean append — no refactor needed. Mandatory `deleteFindingsByApiBehaviourDiffId(diffId)` call FIRST, then per-item classify + create + link.

**`discovery-service/.../findings/FindingEmitter.ts`**
- Template for the validation-service emission step's soft-fail pattern. One-call bulk POST with per-item error swallowing and diagnostic logging. The validation-service emitter models its shape after this.

**`architecture-model-service/.../entity/discovery/DiscoveryFindingEntity.java` + DTO + mapper + repo + service**
- Existing entity, DTO record, mapper, repository, service all in place from `2026-05-16-discovery-findings-first-class`. This spec adds one nullable field on the entity + DTO + mapper, two finder methods on the repository, two service methods (`createFinding` validation tightening + `deleteFindingsByApiBehaviourDiffId`), and the `ALLOWED_LINK_TARGET_TYPES` extension. No new entity, no new DTO record.

**`architecture-model-service/.../controller/discovery/DiscoveryRunArchitectureGuard`**
- Shape template for the new `ApiBehaviourDiffArchitectureGuard` — project + architecture sanity check on diffId, called as the first line of every new diff-scoped controller endpoint.

**`frontend/src/components/Discovery/FindingDetailDrawer.tsx`**
- Source for the ~150 LOC copy-modify into `DiffFindingDetailDrawer.tsx`. Reviewer workflow, status transitions, drawer layout, accept/ignore/resolve buttons all copied verbatim; only the API call surface differs (diff-scoped endpoints in `diffFindingsApi.ts` instead of run-scoped in `findingsApi.ts`).

**`frontend/src/components/DashboardView/DriftReportTab.tsx` (Spec #5)**
- Host for the new "Findings" badge column. Per-item row structure already has a clean trailing "Action" column — the badge column slots before it. No structural refactor.

## Out of Scope

- LLM-assisted severity classification or "this drift is expected" overrides.
- Cross-diff finding deduplication.
- A top-level Findings page or unified findings view (diff-sourced findings in `FindingsTab.tsx` deferred to v2).
- Origin filter dropdown on the existing `FindingsTab.tsx` (also v2).
- Backfill of findings for diffs that completed before this spec ships — manual recompute on the Drift report tab is the user's path.
- Reviewer workflow changes (status transitions, drawer UI logic, bulk actions) — all inherited unchanged from the existing reviewer infrastructure.
- Findings analytics / dashboards / notifications / webhooks / emails on finding creation.
- Activation of `api_behaviour_baseline` as a link `target_type` — stays documented-but-unused in v1 (no consumer; minimises blast radius).
- `@JsonNaming` audit for the new `apiBehaviourDiffId` field — existing snake_case Jackson convention applies via the global config.
- Refactoring `FindingDetailDrawer.tsx` to a shared base — deferred to v2 if surfaces diverge further. v1 accepts ~150 LOC duplication for lower risk to the existing reviewer flow.
- Change to Spec #5's `api_behaviour_diff_items` schema or classifications — the emission rules read existing fields verbatim.

## Dependencies

- `2026-05-25-api-test-harness-diff-engine` (Spec #5, shipped) — provides `api_behaviour_diffs` + `api_behaviour_diff_items` tables, the `diffRunner.ts` insertion point, and the Drift report tab host surface.
- `2026-05-25-api-test-harness-target-side-capture` (Spec #4, shipped) — provides the paired baselines that feed Spec #5.
- `2026-05-16-discovery-findings-first-class` (shipped) — provides `discovery_findings` + `discovery_finding_links` tables, the AMS Java + DTO surface, the controller / mapper / repository / service, and the frontend `FindingDetailDrawer.tsx` / `findingsApi.ts` reused for copy-modify.
- `2026-05-25-ams-test-infrastructure-cleanup` + `2026-05-25-ams-dto-json-naming-audit-sweep` (shipped) — `mvn test` works; new apibehaviour DTOs follow the existing per-field `@JsonProperty` convention.

No new external dependencies.

## Commit Boundary

Per-layer, 4 commits matching the accepted answer to Q10:

1. **AMS DB + Java** — Liquibase changeset (slot ~160, verify empirically), `DiscoveryFindingEntity` + DTO + mapper changes, two new repository finders (`findByApiBehaviourDiffIdOrderByCreatedAtAsc` + `findByProjectIdAndArchitectureIdAndRunIdNotNull`), `DiscoveryFindingService` exactly-one-of-origin validation + `deleteFindingsByApiBehaviourDiffId`, `ALLOWED_LINK_TARGET_TYPES` extension, new `ApiBehaviourDiffArchitectureGuard`, new diff-scoped controller (list / by-diff-item / PATCH), `MigrationSpecContextResolver.loadFindings` switch to the `RunIdNotNull` finder, AMS Java tests (schema CHECK enforcement, FK CASCADE on diff delete, service exactly-one-of-origin validation, new finders, target_type allowlist extension, resolver filter).
2. **Validation service emission** — new `findingEmissionRules.ts` (deterministic classifier + wording table), `diffRunner.ts` extension (MANDATORY `deleteFindingsByApiBehaviourDiffId` cleanup FIRST, then classify + create + link per item, fail-soft), `archModelClient.ts` extensions (`createFinding`, `createFindingLink`, `deleteFindingsByApiBehaviourDiffId`, `listFindingsByDiffId`, `listFindingsByDiffItemId`), tests covering each emission-rule branch + fail-soft + recompute-cleanup behaviour.
3. **Gateway** — three diff-scoped read/review proxies (list / by-diff-item / PATCH), typed wrappers on `apiBehaviourClient.ts` (`listDiffFindings`, `listDiffFindingsByDiffItem`, `patchDiffFinding`), gateway tests for the new routes. No create-proxy.
4. **Frontend** — new `diffFindingsApi.ts` (or parallel methods on `findingsApi.ts`), `DriftReportTab.tsx` Findings badge column + per-item count loading, new `DiffFindingDetailDrawer.tsx` (~150 LOC copy-modify of `FindingDetailDrawer.tsx`), Vitest tests for badge count rendering, drawer open from badge click, and reviewer transitions through the diff-scoped endpoints.

Total test budget: ~15-20 tests across all four commits (leaner than Specs #4 / #5; this is the smallest spec in the arc). Per-layer budgets refined in `tasks.md`.
