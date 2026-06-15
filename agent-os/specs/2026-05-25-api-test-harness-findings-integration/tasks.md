# Task Breakdown: API Test Harness — Findings Integration

## Overview
Total Task Groups: 5

Per-layer 4-commit boundary (accepted Q10, leaner than Spec #5's 5-commit cadence because there's no separate persistence vs Java-app commit — both fold into one AMS commit), plus a fifth task group for end-to-end manual verification on the running stack. The spec emits `discovery_findings` rows automatically when an `api_behaviour_diff` completes in `api-migration-validation-service`, links each finding to the originating `api_behaviour_diff_item`, and surfaces them inline as a "Findings" badge column on the Drift report tab from Spec #5 with a new `DiffFindingDetailDrawer` for the reviewer lifecycle.

Total test budget (accepted Q10): ~15-20 tests across 4 layers — leaner than Specs #4 / #5. 5-7 AMS, 5-7 validation service, 2-3 gateway, 3-4 frontend.

## Critical Implementation Pitfalls (read before starting)

1. **MANDATORY explicit `deleteFindingsByApiBehaviourDiffId(diffId)` BEFORE re-emit in `diffRunner.ts` — load-bearing, NOT defensive (accepted Q6).** The `api_behaviour_diff_id ON DELETE CASCADE` only fires when the diff row itself is deleted. Recompute keeps the diff row alive while replacing diff_items; without this explicit call the runner would silently accumulate duplicate findings across recomputes (two recomputes = 2x the finding count, three = 3x, etc.). Group 2 MUST have a dedicated regression test asserting that two consecutive recomputes leave the SAME finding count, not 2x the count.
2. **`MigrationSpecContextResolver` will NPE on diff-sourced findings (accepted Q7).** The resolver reads `f.getRunId()` directly to populate the `MigrationDiscoveryContextDto.FindingHighlight` record; null `runId` will either NPE downstream or render "Run: -" garbage in spec context templates. Group 1 MUST:
   - Add a `findByProjectIdAndArchitectureIdAndRunIdNotNull(UUID, UUID)` finder on `DiscoveryFindingRepository`.
   - Switch `MigrationSpecContextResolver.loadFindings` to use the new `RunIdNotNull` finder.
   - Add a regression test asserting that calling the resolver with diff-sourced findings present does NOT NPE AND does NOT include them in the result.
3. **New `DiffFindingDetailDrawer` (~150 LOC copy-modify), NOT refactor of `FindingDetailDrawer` (accepted Q4).** Group 4 must create the new file under `frontend/src/components/DashboardView/` (matches the Drift report tab's location and its parent view, NOT `frontend/src/components/Discovery/` where the original drawer lives). Do NOT modify the existing `FindingDetailDrawer.tsx`, `FindingsTab.tsx`, or `findingsApi.ts`. Refactor to a shared base is deferred to v2 if surfaces diverge further; v1 accepts ~150 LOC duplication for lower risk to the existing reviewer flow.
4. **Schema CHECK constraint must enforce exactly-one-of-origin.** The new constraint `discovery_finding_exactly_one_origin CHECK ((run_id IS NOT NULL)::int + (api_behaviour_diff_id IS NOT NULL)::int = 1)` MUST reject both:
   - Findings with BOTH `run_id` AND `api_behaviour_diff_id` set
   - Findings with NEITHER set
   Group 1 MUST have a dedicated CHECK constraint test asserting both rejection paths.
5. **Empirical changeset slot verification.** Group 1 sub-task 1.2 MUST run `ls architecture-model-service/src/main/resources/db/changelog/sql/ | sort -V | tail -5` to find the actual highest slot at implementation time. Spec #5 landed at slots `158` and `159`; predicted next free slot for THIS spec is `160`, but verify empirically — other in-flight specs may have intervened.
6. **First-ever `critical` severity in the platform.** No existing emission anywhere in `discovery-service` or `architecture-model-service` produces `critical` — the ceiling today is `high`. Group 2 deliberately introduces `critical` for the `status_drift` 2xx → 5xx case (a previously-200 endpoint now 500ing is the highest-stakes drift signal). MUST add a code comment in `findingEmissionRules.ts` documenting this deliberate product call.
7. **No create-proxy in gateway (accepted Q9).** Emission goes from validation-service DIRECT to AMS via the validation-service's `archModelClient.ts` (mirrors `discovery-service/.../findings/FindingEmitter.ts`). Gateway sub-tasks must NOT add a POST proxy. Only read/review proxies: list-by-diff, list-by-diff-item, and PATCH-finding (reviewer status transitions).
8. **Only `api_behaviour_diff_item` activated as `target_type` in v1 (accepted Q5).** The `DiscoveryFindingLinkService` allowlist (`ALLOWED_LINK_TARGET_TYPES`, currently inline in `DiscoveryFindingService`) extension MUST include `api_behaviour_diff_item` and ONLY `api_behaviour_diff_item`. The pre-existing `api_behaviour_baseline` value stays documented-but-unused — leave it rejected in v1 (no consumer; minimises blast radius).

## Severity ladder + wording table (Group 2 reference)

**Severity ladder per accepted answers Q1 + Q2.** The `status_drift` mapping deliberately breaks the discovery-service `high` ceiling to flag the highest-stakes signal.

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

**Title + summary wording table (pin verbatim per accepted Q8).**

| Trigger | title format | summary template |
| --- | --- | --- |
| `status_drift` (any) | `Status drift: {METHOD} {path} responded {sourceStatus} -> {targetStatus}` | `Source baseline captured a {sourceStatus} response; target baseline captured {targetStatus} for scenario "{scenarioName}".` |
| `body_shape_drift` | `Body shape drift: {METHOD} {path}` | `Response body shape changed for scenario "{scenarioName}": {N} keys added, {M} keys removed, {K} type changes.` |
| `body_value_drift` only | `Body value drift: {METHOD} {path}` | `Response body shape unchanged but {N} value(s) differ for scenario "{scenarioName}".` |
| `source_only` `mutating_skipped` | `Source-only: {METHOD} {path} (mutating call skipped on replay)` | `Mutating source scenario "{scenarioName}" was skipped during target replay because mutating_calls_confirmed was false.` |
| `source_only` `transport_failure` | `Source-only: {METHOD} {path} (target replay transport failure)` | `Target replay for scenario "{scenarioName}" hit a transport-level failure; no target response captured.` |
| `source_only` `no_paired_target` | `Source-only: {METHOD} {path} (no paired target capture)` | `Source baseline contains scenario "{scenarioName}" but no matching target capture was produced.` |
| `target_only` | `Target-only: {METHOD} {path}` | `Target baseline contains scenario "{scenarioName}" but no source captured this scenario for comparison.` |

## Task List

### AMS Persistence + Java Application Layer

#### Task Group 1: Liquibase + entity/DTO/mapper/repo/service + new diff-scoped controller + `ApiBehaviourDiffArchitectureGuard` + `MigrationSpecContextResolver` filter
**Dependencies:** None
**Scope:** One additive Liquibase changeset on `discovery_findings` (drop `run_id NOT NULL`, add nullable `api_behaviour_diff_id` FK with `ON DELETE CASCADE`, partial index, exactly-one-of-origin CHECK constraint, column comments); add `apiBehaviourDiffId` to the `DiscoveryFindingEntity` + DTO + mapper; flip `runId` to nullable on the entity; two new repository finders (the diff-scoped lookup + the load-bearing `RunIdNotNull` filter for the migration spec resolver); service-layer exactly-one-of-origin validation + new `deleteFindingsByApiBehaviourDiffId` method; extend the inline `ALLOWED_LINK_TARGET_TYPES` allowlist to include `api_behaviour_diff_item` ONLY; new `ApiBehaviourDiffArchitectureGuard`; new diff-scoped controller (NOT a refactor of `DiscoveryFindingController` — its `@RequestMapping` bakes `/runs/{runId}` in); switch `MigrationSpecContextResolver.loadFindings` to the `RunIdNotNull` finder.
**Test budget:** 5-7 tests.

- [x] 1.0 Complete AMS persistence + Java application layer
  - [x] 1.1 Write 5-7 focused tests for AMS layer
    - One CHECK constraint test: insert a `discovery_findings` row with BOTH `run_id` AND `api_behaviour_diff_id` set → constraint rejects with SQL error; insert with NEITHER set → constraint rejects; insert with exactly one set → succeeds (covers both rejection paths of the exactly-one-of-origin invariant)
    - One FK CASCADE test: insert a diff + a diff-sourced finding linked to that diff via `api_behaviour_diff_id`; delete the diff row via SQL; verify the finding row is CASCADE-removed
    - One service-layer exactly-one-of-origin test on `DiscoveryFindingService.createFinding(...)`: passing both `runId` AND `apiBehaviourDiffId` non-null → throws `IllegalArgumentException`; passing neither → throws; passing exactly one → succeeds (mirrors the DB CHECK at the service layer for fail-fast errors)
    - One repository finder test on `findByApiBehaviourDiffIdOrderByCreatedAtAsc(UUID)`: insert three findings under one diff + two under another diff; verify the finder returns exactly the three for the queried diff, ordered by `created_at` ascending
    - One regression test on `MigrationSpecContextResolver.loadFindings(...)` for the `findByProjectIdAndArchitectureIdAndRunIdNotNull` filter: insert one run-sourced finding (`run_id` set) AND one diff-sourced finding (`api_behaviour_diff_id` set) under the same project + architecture; call the resolver; verify (a) the call does NOT NPE and (b) the result contains the run-sourced finding ONLY (diff-sourced finding is filtered out)
    - One controller MockMvc test on the new diff-scoped surface: `GET /api/projects/{projectId}/architectures/{architectureId}/api-behaviour/diffs/{diffId}/findings` returns the diff-sourced findings ordered ascending by `created_at`; `GET .../by-diff-item/{diffItemId}` returns only findings linked to that specific diff_item; `PATCH .../{findingId}` transitions reviewer status (e.g. `new` → `accepted`) and the change persists
    - One link-target allowlist extension test on `DiscoveryFindingLinkService.createLink(...)`: `target_type='api_behaviour_diff_item'` is accepted; `target_type='api_behaviour_baseline'` is still rejected in v1 (the documented-but-unused future value)
    - Skip exhaustive per-route happy-path coverage on the new controller — the surface is small and follows the existing pattern
  - [x] 1.2 Verify the highest applied changeset slot empirically
    - Run `ls architecture-model-service/src/main/resources/db/changelog/sql/ | sort -V | tail -5` immediately before authoring the new file
    - Spec #5 landed at slots `158` and `159`; predicted next free slot is `160`, but other in-flight specs may have intervened — confirm empirically
    - If the highest applied changeset has shifted, use the next free number above whatever you observe — never reuse a number
    - Record the observed slot in an implementation note on this sub-task before continuing
  - [x] 1.3 Author `<N>-discovery-findings-api-behaviour-diff-origin.sql` (predicted `160-`; confirm via 1.2)
    - `ALTER TABLE discovery_findings ALTER COLUMN run_id DROP NOT NULL` (existing rows all have `run_id` set, so this is fully backward-compatible)
    - `ALTER TABLE discovery_findings ADD COLUMN api_behaviour_diff_id UUID NULL REFERENCES api_behaviour_diffs(id) ON DELETE CASCADE`
    - `CREATE INDEX idx_discovery_finding_api_behaviour_diff_id ON discovery_findings (api_behaviour_diff_id) WHERE api_behaviour_diff_id IS NOT NULL` (partial index — only indexes diff-sourced findings)
    - `ALTER TABLE discovery_findings ADD CONSTRAINT discovery_finding_exactly_one_origin CHECK ((run_id IS NOT NULL)::int + (api_behaviour_diff_id IS NOT NULL)::int = 1)` (the load-bearing invariant — verified by the CHECK constraint test in 1.1)
    - `COMMENT ON COLUMN discovery_findings.api_behaviour_diff_id IS 'Origin: the api_behaviour_diff that produced this finding (alternative to run_id). Exactly one of run_id / api_behaviour_diff_id MUST be non-null. CASCADE deletes findings when the source diff is deleted (mirrors discovery_run cascade for discovery-sourced findings).'`
    - `COMMENT ON COLUMN discovery_findings.run_id IS 'Origin: the discovery_run that produced this finding. Now nullable per 2026-05-25 api-test-harness-findings-integration spec. Exactly one of run_id / api_behaviour_diff_id MUST be non-null. CASCADE intact via fk_discovery_finding_run.'`
    - Register as a NEW `changeSet` block in `db.changelog-master.yaml` using the `preConditions: onFail: MARK_RAN` pattern matching the existing changesets — never edit prior changesets per `feedback_liquibase_immutable_changesets.md`
    - **No second changeset for link-table vocabulary** — `discovery_finding_links.target_type` is `TEXT` and the allowlist is service-layer-enforced (extended in 1.7)
  - [x] 1.4 Update `DiscoveryFindingEntity`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/discovery/DiscoveryFindingEntity.java`
    - Add `UUID apiBehaviourDiffId` field (nullable)
    - Flip existing `UUID runId` to nullable (it was non-null at the JPA level — relax)
    - Both are reference types — no primitive-drift risk per `project_primitive_double_dto_overwrite.md`
    - Standard Lombok / `@Column` annotations matching the existing fields
  - [x] 1.5 Update `DiscoveryFindingDto` (record) + `DiscoveryFindingMapper`
    - DTO file: `.../model/dto/discovery/DiscoveryFindingDto.java`
    - Add `UUID apiBehaviourDiffId` record component (optional in semantics; null when run-sourced)
    - **Provide a backward-compatible delegating constructor** that defaults `apiBehaviourDiffId` to `null` for all existing callers — mapper, `MigrationDiscoveryContextService.toFindingHighlight`, controllers, and tests should compile without a fan-out edit
    - Follows the snake_case wire convention via the global Jackson config — no per-field `@JsonProperty` needed
    - Add a Javadoc note on the new field: "All new fields on this DTO are reference types (`UUID`, `Instant`, `String`). No primitive-drift risk per `project_primitive_double_dto_overwrite.md`. Future maintainers adding numeric fields MUST use boxed types (`Integer`, `Long`, `Double`, `Boolean`) — primitives silently wipe to 0 / false on missing JSON during PATCH."
    - Mapper file: `.../mapper/discovery/DiscoveryFindingMapper.java`
    - Pass `entity.getApiBehaviourDiffId()` through to the DTO constructor in `toDto(...)`
  - [x] 1.6 Extend `DiscoveryFindingRepository` with two new finders
    - File: `.../repository/discovery/DiscoveryFindingRepository.java`
    - Add `List<DiscoveryFindingEntity> findByApiBehaviourDiffIdOrderByCreatedAtAsc(UUID apiBehaviourDiffId)` — primary diff-scoped list path used by the new controller
    - Add `List<DiscoveryFindingEntity> findByProjectIdAndArchitectureIdAndRunIdNotNull(UUID projectId, UUID architectureId)` — **LOAD-BEARING** for `MigrationSpecContextResolver.loadFindings` (filters out diff-sourced findings to preserve existing migration-spec semantics; resolver reads `f.getRunId()` directly and would NPE or render "Run: -" garbage on null per accepted Q7)
    - **Optional:** if the existing `search(...)` JPQL is needed for diff-scoped queries, add a parallel `searchByApiBehaviourDiffId(...)` method — its current `WHERE f.runId = :runId` is hard-coded; do not relax the existing search to keep the surface stable
  - [x] 1.7 Extend `DiscoveryFindingService`
    - File: `.../service/discovery/DiscoveryFindingService.java`
    - In `createFinding(...)`: enforce exactly-one-of-origin (`runId XOR apiBehaviourDiffId`); throw `IllegalArgumentException` with a clear message on violation (mirrors the DB CHECK at the service layer for fail-fast errors — verified by the service-layer test in 1.1)
    - Add new method `void deleteFindingsByApiBehaviourDiffId(UUID diffId)` — **MANDATORY, NOT defensive (accepted Q6)**. The `ON DELETE CASCADE` only fires when the diff row itself is deleted; recompute keeps the diff row alive, so without this explicit call the validation-service `diffRunner.ts` would accumulate duplicates. Called by Group 2 BEFORE re-emit.
    - Add a Javadoc note on `deleteFindingsByApiBehaviourDiffId`: "Load-bearing for diff recompute — NOT defensive. The api_behaviour_diff_id ON DELETE CASCADE only fires on diff-row deletion; recompute keeps the diff row alive while replacing diff_items, so this method MUST be called by diffRunner.ts before re-emit. Without it, findings accumulate across recomputes (2x, 3x, ...)."
    - Extend the inline `ALLOWED_LINK_TARGET_TYPES` static set (currently in `DiscoveryFindingService` per the requirements inventory) to include `api_behaviour_diff_item` — and ONLY `api_behaviour_diff_item`. Leave `api_behaviour_baseline` rejected in v1 (per accepted Q5 — documented-but-unused; no consumer in this spec; minimises blast radius)
  - [x] 1.8 Author `ApiBehaviourDiffArchitectureGuard`
    - New file under `.../controller/apibehaviour/` (or wherever `DiscoveryRunArchitectureGuard` lives — colocate)
    - Shape mirrors the existing `DiscoveryRunArchitectureGuard`: verifies the `diffId` in a URL belongs to the `projectId` + `architectureId` in the URL
    - Throws an appropriate 404 / 403 (whichever the existing guard uses) on mismatch
    - First-line guard on every new diff-scoped controller endpoint in 1.9
  - [x] 1.9 Author new diff-scoped controller surface
    - **NEW controller, NOT a refactor of `DiscoveryFindingController`** — its class-level `@RequestMapping(.../discovery/runs/{runId}/findings)` bakes `runId` in and is incompatible with diff-scoped access (the raw-idea's "no new controller" claim was factually wrong; confirmed in requirements §Surprises §1)
    - Class-level `@RequestMapping("/api/projects/{projectId}/architectures/{architectureId}/api-behaviour/diffs/{diffId}/findings")`
    - Endpoints needed by the frontend:
      - `GET /` → list all findings emitted by this diff (uses the new `findByApiBehaviourDiffIdOrderByCreatedAtAsc` finder)
      - `GET /by-diff-item/{diffItemId}` → list findings linked to a specific diff_item (used by the per-row badge on the Drift report tab — single batch query at tab load)
      - `PATCH /{findingId}` → reviewer status transitions (same body shape as the existing run-scoped PATCH on `DiscoveryFindingController` — `new` / `accepted` / `ignored` / `needs_review` / `resolved`)
    - Every endpoint calls `apiBehaviourDiffArchitectureGuard.verify(diffId, projectId, architectureId)` as the first line
    - Parallel service methods on `DiscoveryFindingService` (or a thin facade) to back the controller — match the existing pattern of `findScoped` / `reviewScoped` on the run-scoped controller, but with `apiBehaviourDiffId` in the scoping slot
  - [x] 1.10 Switch `MigrationSpecContextResolver.loadFindings` to the `RunIdNotNull` finder
    - File: wherever `MigrationSpecContextResolver` lives (per requirements inventory: `.../service/migration/MigrationSpecContextResolver.java` or similar)
    - Replace the existing project+architecture finder call with `findByProjectIdAndArchitectureIdAndRunIdNotNull(...)` from 1.6
    - This filters diff-sourced findings out of migration spec contexts entirely (per accepted Q7) — preserves existing migration-spec semantics; resolver would otherwise NPE on `f.getRunId()` being null for diff-sourced rows
    - Add a code comment at the call site: "Filters out diff-sourced findings (api_behaviour_diff_id set, run_id null). Resolver reads f.getRunId() directly into FindingHighlight.runId; null would NPE downstream. Revisit in v2 if migration specs want API-drift findings as context. See accepted Q7."
    - Verified by the resolver regression test in 1.1
  - [x] 1.11 Run ONLY the 5-7 tests written in 1.1
    - Verify CHECK constraint rejects both illegal combos (both-set, neither-set)
    - Verify FK CASCADE on diff deletion
    - Verify service-layer exactly-one-of-origin validation
    - Verify new repository finders return correctly-filtered, ordered lists
    - Verify `MigrationSpecContextResolver` does NOT NPE on diff-sourced findings AND filters them out
    - Verify the new diff-scoped controller endpoints work end-to-end
    - Verify `ALLOWED_LINK_TARGET_TYPES` extension accepts `api_behaviour_diff_item` and still rejects `api_behaviour_baseline`
    - Do NOT run the entire AMS test suite

**Acceptance Criteria:**
- The 5-7 tests written in 1.1 pass
- New changeset applies cleanly; no edit to any pre-existing changeset
- `db.changelog-master.yaml` registers the new changeset as a discrete `changeSet` block
- Schema CHECK constraint enforces exactly-one-of-origin (both rejection paths verified)
- `MigrationSpecContextResolver.loadFindings` no longer NPEs on diff-sourced findings AND no longer surfaces them in migration spec contexts
- New `ApiBehaviourDiffArchitectureGuard` exists and is first-line on every new endpoint
- New diff-scoped controller surface is mounted (list / by-diff-item / PATCH)
- `ALLOWED_LINK_TARGET_TYPES` extended with `api_behaviour_diff_item` ONLY; `api_behaviour_baseline` left rejected
- All new fields on `DiscoveryFindingDto` are reference types — boxed-type Javadoc note present for the next maintainer
- `DiscoveryFindingService.deleteFindingsByApiBehaviourDiffId` exists with the load-bearing Javadoc note

---

### Validation Service Emission Layer

#### Task Group 2: `findingEmissionRules.ts` + `diffRunner.ts` extension + `archModelClient.ts` extensions + explicit recompute cleanup
**Dependencies:** Task Group 1 (so AMS findings create + delete + diff-scoped list work end-to-end)
**Scope:** New ~80-120 LOC pure deterministic classifier file encoding the severity ladder + wording table verbatim (with the explicit code comment flagging the first-ever `critical` severity); extension to the `diffRunner.ts` happy-path tail — MANDATORY `deleteFindingsByApiBehaviourDiffId(diffId)` call FIRST, then per-item classify → create → link, fail-soft; additive extensions to `archModelClient.ts` (no finding methods exist there today — these are net-new).
**Test budget:** 5-7 tests.

- [x] 2.0 Complete validation-service emission layer
  - [x] 2.1 Write 5-7 focused tests for emission rules + runner extension + cleanup
    - One emission-rule branch test per representative classification (implementer picks a representative subset of 5-7 from the 11 rows in the ladder table — MUST cover at minimum):
      - `status_match` + `body_match` → no emit (asserts `shouldEmit=false`)
      - `status_drift` 2xx → 5xx → emits with `severity='critical'` and `findingType='api_behaviour_status_drift'` (covers the deliberate first-ever `critical` emission)
      - `body_shape_drift` → emits with `severity='medium'` and `findingType='api_behaviour_shape_drift'`
      - `source_only` notes=`mutating_skipped` → emits with `severity='info'` and `findingType='api_behaviour_unreplayed'`
      - `target_only` → emits with `severity='info'` and `findingType='api_behaviour_extra_target'`
    - Each emission-rule test also asserts the rendered `title` and `summary` strings match the wording table verbatim (substitute `{METHOD}`, `{path}`, `{scenarioName}`, `{sourceStatus}`, `{targetStatus}` placeholders)
    - One fail-soft test on the `diffRunner.ts` extension: stub `archModelClient.createFinding` to throw on one item; verify (a) the throw is caught + logged, (b) emission continues to the next item, (c) the diff itself still PATCHes to `status='completed'` (not `failed`)
    - **One recompute-cleanup regression test (THE load-bearing pitfall):** invoke the runner twice in succession against the same `diffId` with the same `diff_items` input; assert the finding count after the second invocation EQUALS the count after the first invocation (NOT 2x). This regression test exists specifically to catch the case where `deleteFindingsByApiBehaviourDiffId` is forgotten or moved AFTER the create loop — without the explicit pre-delete, two recomputes would silently double the findings.
    - Skip exhaustive coverage of every row in the ladder table — the deterministic classifier is small and uniform
  - [x] 2.2 Author `src/services/findingEmissionRules.ts`
    - ~80-120 LOC; new file under `api-migration-validation-service/src/services/`
    - Public API: `classifyDiffItem(item: ApiBehaviourDiffItemDto): { shouldEmit: boolean; findingType: string; severity: string; title: string; summary: string; detailJson: object; category: 'api_behaviour_drift' }`
    - Encode the severity ladder table VERBATIM (all 11 rows from the table at the top of this file)
    - Encode the wording table VERBATIM (all 7 rows — title format + summary template with placeholder substitution)
    - `detailJson` payload: `{ method, path, scenarioName, sourceStatus, targetStatus, statusClassification, bodyClassification, notes, bodyDiffJson (truncated if oversize — e.g. > 8KB) }`
    - `category` is always the string literal `'api_behaviour_drift'` (new category value, distinct from the existing `ambiguity` / `runtime_usage` / `evidence_gap`; added via the TEXT-extensible category vocabulary — no schema change)
    - **MUST add a top-of-file code comment flagging the first-ever `critical` severity:**
      ```ts
      // NOTE: This file deliberately introduces the FIRST-EVER `critical` severity
      // in the platform. No existing emission in discovery-service or anywhere
      // else in architecture-model-service produces `critical` — the ceiling
      // today is `high`. The `status_drift` 2xx → 5xx mapping below breaks
      // that ceiling on purpose: a previously-200 endpoint now 500ing is the
      // highest-stakes drift signal we can detect. Confirmed via accepted Q1.
      ```
    - Pure deterministic function — no side effects, no async, no I/O. Easy to unit test.
  - [x] 2.3 Extend `src/services/archModelClient.ts` additively
    - File: `api-migration-validation-service/src/services/archModelClient.ts`
    - **No finding methods exist today — these are net-new.** Follow the existing typed-wrapper pattern from the baseline / baseline-item / diff methods (added in Spec #4 / #5)
    - Add methods:
      - `createFinding(req: CreateDiscoveryFindingRequest): Promise<DiscoveryFindingDto>`
      - `createFindingLink(req: CreateDiscoveryFindingLinkRequest): Promise<DiscoveryFindingLinkDto>`
      - `deleteFindingsByApiBehaviourDiffId(diffId: string): Promise<void>` — calls the new AMS service method via the diff-scoped controller surface or a dedicated admin endpoint (implementer picks the smaller URL surface; if no admin endpoint exists, call the new diff-scoped controller — but a bulk-delete admin route is cleaner)
      - `listFindingsByDiffId(diffId: string): Promise<DiscoveryFindingDto[]>`
      - `listFindingsByDiffItemId(diffId: string, diffItemId: string): Promise<DiscoveryFindingDto[]>`
    - Add new DTO types (snake_case wire, per existing convention) mirroring the AMS Java DTOs from Task Group 1 — `DiscoveryFindingDto` (extended), `DiscoveryFindingLinkDto`, request bodies
    - Reviewer-PATCH is NOT needed from the validation service (the frontend drawer calls the gateway directly, not via validation service)
  - [x] 2.4 Extend `src/services/diffRunner.ts` with the emission step
    - File: `api-migration-validation-service/src/services/diffRunner.ts` (from Spec #5)
    - **Insertion point:** at the end of the existing successful-completion happy-path, AFTER the PATCH to `status='completed'` (clean append — no refactor needed)
    - Shape of the insertion:
      ```ts
      // -------------------------------------------------------------------
      // Finding emission (Spec #6). Fail-soft: per-finding errors logged +
      // skipped; diff stays status='completed' regardless.
      // -------------------------------------------------------------------
      
      // STEP 1 (MANDATORY): explicit cleanup of prior diff-sourced findings.
      // Load-bearing — NOT defensive. The api_behaviour_diff_id ON DELETE
      // CASCADE only fires when the diff row itself is deleted; recompute
      // keeps the diff row alive while replacing diff_items, so without this
      // explicit call we'd accumulate duplicate findings across recomputes
      // (2x, 3x, ...). See accepted Q6 + the regression test in 2.1.
      try {
        await archModelClient.deleteFindingsByApiBehaviourDiffId(diffId);
      } catch (err) {
        console.error('op=finding_recompute_cleanup_failed', { diffId, err: String(err) });
        // Continue to emission — better to risk a small duplication than skip the spec
      }
      
      // STEP 2: classify + emit + link per item.
      for (const item of justPersistedDiffItems) {
        try {
          const classification = classifyDiffItem(item);
          if (!classification.shouldEmit) continue;
          const finding = await archModelClient.createFinding({
            project_id: projectId,
            architecture_id: architectureId,
            api_behaviour_diff_id: diffId,
            finding_type: classification.findingType,
            category: classification.category,
            severity: classification.severity,
            title: classification.title,
            summary: classification.summary,
            detail_json: classification.detailJson,
            source: 'api_behaviour_diff',
            created_by_stage: 'diffRunner.findingEmission',
          });
          await archModelClient.createFindingLink({
            finding_id: finding.id,
            target_type: 'api_behaviour_diff_item',
            target_id: item.id,
            link_type: 'derived_from',
          });
        } catch (err) {
          console.error('op=finding_emission_failed', { diffId, diffItemId: item.id, err: String(err) });
          // Continue to next item — fail-soft per accepted Q9 + the FindingEmitter pattern
        }
      }
      ```
    - The fail-soft pattern models `discovery-service/.../findings/FindingEmitter.ts`
    - **Verify ordering — `deleteFindingsByApiBehaviourDiffId` MUST be FIRST, before the create loop.** If the implementer moves it AFTER the loop or removes it, the regression test in 2.1 will catch it.
  - [x] 2.5 Run ONLY the 5-7 tests written in 2.1
    - Verify each representative emission-rule branch (no-emit, critical, medium, info, info)
    - Verify `title` + `summary` strings match the wording table verbatim
    - Verify fail-soft: emission failure on one item does not stop subsequent items and does not fail the diff
    - Verify recompute-cleanup: two consecutive runs leave the SAME finding count (NOT 2x)
    - Do NOT run the full Jest suite

**Acceptance Criteria:**
- The 5-7 tests written in 2.1 pass
- `findingEmissionRules.ts` encodes the severity ladder + wording table verbatim — placeholder substitution matches the wording table exactly
- Top-of-file code comment in `findingEmissionRules.ts` flags the first-ever `critical` severity with reference to accepted Q1
- `diffRunner.ts` extension is a clean append after the PATCH to `status='completed'`; no refactor of pre-existing happy-path logic
- `deleteFindingsByApiBehaviourDiffId(diffId)` is called FIRST, before the create/link loop — verified by the recompute-cleanup regression test
- Per-finding emission errors are caught + logged + skipped; diff stays `status='completed'` regardless
- `archModelClient.ts` extensions are additive only; existing methods untouched
- New `category` value `api_behaviour_drift` flows through unchanged (no schema work needed — TEXT-extensible vocabulary)

---

### Gateway Layer

#### Task Group 3: Gateway read/review proxies + typed wrappers (NO create-proxy)
**Dependencies:** Task Group 2 (so the AMS surface and the validation-service emission both work end-to-end)
**Scope:** Three diff-scoped read/review proxies mirroring the new AMS controller surface from Task Group 1; typed wrappers added to the existing `apiBehaviourClient.ts` (extended in Specs #4 / #5 — additive only). **No create-proxy** per accepted Q9 — emission goes from validation-service DIRECT to AMS via the validation-service's `archModelClient.ts`, mirroring `discovery-service/.../findings/FindingEmitter.ts`. The existing discovery findings proxy block in `gateway/src/routes/discovery.ts` (lines ~2460-2700+) is NOT touched — it stays run-scoped; the new block is diff-scoped.
**Test budget:** 2-3 tests.

- [x] 3.0 Complete gateway proxy layer
  - [x] 3.1 Write 2-3 focused tests for gateway proxies + wrappers
    - One supertest test proxying `GET /api/v1/projects/:projectId/api-behaviour/diffs/:diffId/findings` to AMS (mock axios → assert URL forwarded with path params preserved verbatim, response body passes through)
    - One supertest test for the by-diff-item proxy: `GET /api/v1/projects/:projectId/api-behaviour/diffs/:diffId/findings/by-diff-item/:diffItemId` → forwarded verbatim to AMS
    - Optional third test: typed client wrapper unit test — `listDiffFindings(...)` GETs the right gateway URL and returns the typed DTO shape (`DiscoveryFindingDto[]` with optional `api_behaviour_diff_id`)
    - Skip exhaustive per-route coverage — the routes are thin and follow the existing pattern
  - [x] 3.2 Add 3 diff-scoped read/review proxy routes
    - Insertion point: under the existing api-behaviour route prefix in the appropriate gateway routes file (most likely `gateway/src/routes/apiMigrationValidation.ts` or a new sibling block — implementer picks based on existing structure)
    - Routes:
      - `GET /api/v1/projects/:projectId/api-behaviour/diffs/:diffId/findings` — forwarded verbatim to AMS at the matching path
      - `GET /api/v1/projects/:projectId/api-behaviour/diffs/:diffId/findings/by-diff-item/:diffItemId` — forwarded verbatim
      - `PATCH /api/v1/projects/:projectId/api-behaviour/diffs/:diffId/findings/:findingId` — forwarded verbatim (reviewer status transitions)
    - **NO POST proxy** — accepted Q9 confirms emission goes validation-service direct to AMS, not via gateway
    - Reuse the existing `:projectId` / `:diffId` URL-param safety pattern (missing path param → 404 at the Express layer with no fallback resolution — mirrors Spec #4 / #5's proxies)
    - The existing run-scoped findings proxy block in `gateway/src/routes/discovery.ts` (lines ~2460-2700+) MUST NOT be touched — it stays run-scoped; this is a parallel diff-scoped block
  - [x] 3.3 Add typed client wrappers to `gateway/src/services/apiBehaviourClient.ts`
    - File already exists (extended in Specs #4 / #5) — additive only; no new file at the gateway service layer
    - Add wrapper functions:
      - `listDiffFindings(projectId: string, diffId: string): Promise<DiscoveryFindingDto[]>`
      - `listDiffFindingsByDiffItem(projectId: string, diffId: string, diffItemId: string): Promise<DiscoveryFindingDto[]>`
      - `patchDiffFinding(projectId: string, diffId: string, findingId: string, patch: ReviewFindingPatch): Promise<DiscoveryFindingDto>`
    - Reuse the existing `DiscoveryFindingDto` type (extended in 1.5 with optional `api_behaviour_diff_id`) — extend the gateway-side type definition to mirror
    - **No `createDiffFinding` wrapper** — validation-service calls AMS direct
    - Errors surface as the existing `ApiBehaviourClientError` (per Spec #4 / #5 pattern) carrying upstream status + body
  - [x] 3.4 Run ONLY the 2-3 gateway tests written in 3.1
    - Verify URL forwarding for one representative read proxy
    - Verify URL forwarding for the by-diff-item proxy
    - Verify (optional) typed wrapper signature + DTO shape
    - Do NOT run the full gateway suite

**Acceptance Criteria:**
- The 2-3 tests written in 3.1 pass
- All 3 diff-scoped read/review proxy routes reachable through gateway
- NO create-proxy (`POST .../findings`) added — gateway is read/review only per accepted Q9
- Typed wrappers additive only; existing wrappers untouched
- Existing run-scoped findings proxy block in `gateway/src/routes/discovery.ts` NOT touched
- Pre-existing failing tests listed in project memory remain in the same state

---

### Frontend Layer

#### Task Group 4: `diffFindingsApi.ts` + `DriftReportTab` badge column + `DiffFindingDetailDrawer`
**Dependencies:** Task Group 3
**Scope:** New `diffFindingsApi.ts` (or parallel methods on `findingsApi.ts` — implementer picks the cleaner split; default is the new dedicated file to keep callers explicit about scope); add a "Findings" badge column to the existing `DriftReportTab.tsx` between the classification column and the trailing "Action" column; **NEW `DiffFindingDetailDrawer.tsx` (~150 LOC copy-modify of the existing `FindingDetailDrawer.tsx`)** under `frontend/src/components/DashboardView/` — NOT a refactor of the existing drawer (accepted Q4). **No changes** to `FindingsTab.tsx`, `findingsApi.ts` URL builders, or `FindingDetailDrawer.tsx` (per accepted Q3 — diff-sourced findings live exclusively on the Drift report tab in v1).
**Test budget:** 3-4 tests.

- [x] 4.0 Complete frontend layer
  - [x] 4.1 Write 3-4 focused tests for badge column + drawer + reviewer transitions
    - One Vitest test mounting `DriftReportTab` with a fully-populated diff DTO + a stubbed `listDiffFindingsByDiffItem` returning 2 findings for one diff_item and 0 for others; asserts the "Findings" badge column renders the correct count per row (`2`, `0`, `0`, etc.)
    - One Vitest test asserting badge click opens `DiffFindingDetailDrawer` pre-loaded with the linked findings for that diff_item (mock the drawer or assert the drawer mounts with the right props)
    - One Vitest test on `DiffFindingDetailDrawer`: render with a diff-sourced finding, trigger the `accepted` status transition via the existing reviewer button, assert `patchDiffFinding` is called with the right `{ status: 'accepted' }` body and the new status is reflected in the drawer
    - Optional fourth test: regression assertion that the existing `FindingsTab.tsx` (mounted in isolation with the existing test fixtures) continues to render WITHOUT any diff-sourced findings — proves no leakage from the new infrastructure into the existing surface
    - Skip exhaustive per-state coverage of the drawer — it's a copy-modify of an already-tested component
  - [x] 4.2 Create `frontend/src/api/diffFindingsApi.ts`
    - New file (parallel to the existing `findingsApi.ts`) — implementer may instead add parallel methods to `findingsApi.ts` if the resulting file is small and stays cohesive; default is the new dedicated file for explicit scoping
    - Typed wrappers for the gateway diff-scoped endpoints from Task Group 3:
      - `listDiffFindings(projectId: string, diffId: string): Promise<DiscoveryFindingDto[]>`
      - `listDiffFindingsByDiffItem(projectId: string, diffId: string, diffItemId: string): Promise<DiscoveryFindingDto[]>`
      - `patchDiffFinding(projectId: string, diffId: string, findingId: string, patch: ReviewFindingPatch): Promise<DiscoveryFindingDto>`
    - Reuse the existing `DiscoveryFindingDto` TypeScript type — extend with optional `api_behaviour_diff_id?: string | null`
    - URL builder: parallel to `findingsPathPrefix(...)` from `findingsApi.ts`, but bakes `diffId` instead of `runId` (e.g. `diffFindingsPathPrefix(projectId, diffId)` returning `/api/v1/projects/${projectId}/api-behaviour/diffs/${diffId}/findings`)
    - **Do NOT modify `findingsApi.ts`** — the existing run-scoped URL builder and methods stay untouched
  - [x] 4.3 Extend `frontend/src/components/DashboardView/DriftReportTab.tsx`
    - **Additive only — small extension to the existing tab from Spec #5; no structural refactor.**
    - Add a "Findings" badge column to the per-item row, positioned **between the existing classification column and the trailing "Action" column** ("View diff" button)
    - Badge shows the count of findings linked to that diff_item via `listDiffFindingsByDiffItem`
    - Single batch query at tab load (NOT per-row N+1 queries) — keyed by diff_item id, results memoised in component state (Map<diffItemId, DiscoveryFindingDto[]>)
    - Badge click handler: opens `DiffFindingDetailDrawer` pre-loaded with that diff_item's findings (pass them as props to avoid a second fetch)
    - Badge visual: numeric count when > 0; no badge / dash when 0 — use the existing design system primitives, no new visual primitives
  - [x] 4.4 Create `frontend/src/components/DashboardView/DiffFindingDetailDrawer.tsx`
    - **NEW file under `DashboardView/` — NOT `Discovery/` (colocate with its parent `DriftReportTab.tsx`).**
    - **~150 LOC copy-modify of `frontend/src/components/Discovery/FindingDetailDrawer.tsx`** per accepted Q4 — NOT a refactor of the existing drawer to accept `runId | diffId`
    - Same reviewer workflow (`new` / `accepted` / `ignored` / `needs_review` / `resolved`), same drawer layout, same accept / ignore / resolve buttons, same status transitions
    - **Differences from the original:** calls the diff-scoped endpoints in `diffFindingsApi.ts` instead of the run-scoped endpoints in `findingsApi.ts`. The component accepts a `diffId: string` prop instead of `runId: string`.
    - **Do NOT modify the original `FindingDetailDrawer.tsx`** — accept ~150 LOC duplication for lower risk to the existing reviewer flow; refactor to a shared base is deferred to v2 if surfaces diverge further
  - [x] 4.5 Verify no regressions to the existing Drift report tab or Findings tab
    - Manual smoke check (or use the optional fourth test from 4.1): mount the existing `FindingsTab.tsx` in isolation — should continue to render run-sourced findings only with no diff-sourced findings leaking in (per accepted Q3, diff-sourced findings live exclusively on the Drift report tab in v1)
    - Manual smoke check on the existing `DriftReportTab` per-item row: column ordering should be (existing columns) → classification → **Findings (new)** → Action
    - No new design-system primitives introduced
    - No edits to `FindingsTab.tsx`, `findingsApi.ts`, or `FindingDetailDrawer.tsx`
  - [x] 4.6 Run ONLY the 3-4 frontend tests written in 4.1
    - Verify badge column renders correct count per row
    - Verify badge click opens drawer pre-loaded with linked findings
    - Verify reviewer status transition via drawer
    - Verify (optional) no regression to the existing `FindingsTab.tsx`
    - Do NOT run the full Vitest suite

**Acceptance Criteria:**
- The 3-4 tests written in 4.1 pass
- `diffFindingsApi.ts` (or parallel methods on `findingsApi.ts`) exists with the 3 typed wrappers; URL builder bakes `diffId` not `runId`
- `DriftReportTab.tsx` gains the "Findings" badge column between classification and Action; per-item counts loaded via a single batch query at tab load
- `DiffFindingDetailDrawer.tsx` exists as a NEW file under `frontend/src/components/DashboardView/` (NOT `Discovery/`); ~150 LOC copy-modify of `FindingDetailDrawer.tsx`
- **Existing `FindingsTab.tsx`, `findingsApi.ts`, and `FindingDetailDrawer.tsx` are unmodified** — verified by inspection (and optionally by the fourth regression test)
- No Origin filter dropdown added (deferred to v2 per accepted Q3)
- No new design-system primitives introduced
- Pre-existing failing tests listed in project memory remain in the same state

---

### End-to-End Verification

#### Task Group 5: End-to-end manual verification on the running stack
**Dependencies:** Task Groups 1-4
**Scope:** Single happy-path replay-then-diff-then-emit-then-review verification end-to-end against the running stack. Confirms the per-layer 4-commit chain integrates correctly, the auto-emission fires after a successful diff, the badge column populates on the Drift report tab, the drawer opens with the linked findings, and reviewer transitions persist. No automated end-to-end test added (the test budget is already met by the per-layer tests).
**Test budget:** 0 automated tests — this group is manual verification only.

- [ ] 5.0 Complete end-to-end manual verification
  - [ ] 5.1 Spin up the stack
    - AMS on its usual port; `api-migration-validation-service` on 8092; gateway; frontend
    - Confirm `/health` on the validation service returns `ok`
    - Confirm `cd architecture-model-service && mvn test-compile` exits 0 (constant invariant per the test-infrastructure-cleanup spec; no `-D` flags)
  - [ ] 5.2 Reach a completed diff (precondition)
    - Either: use an existing finalised target baseline + completed diff from Spec #5's verification (if still present in the dev DB), OR
    - Run a full Spec #4 → Spec #5 flow: create a current-state baseline, run a target replay against a sibling URL, wait for the auto-spawned diff to complete on the Drift report tab
    - **Watch the validation-service logs during the diff's tail.** The new emission step should fire — look for either successful `createFinding` HTTP calls to AMS or fail-soft diagnostic log lines.
  - [ ] 5.3 Verify findings emitted into AMS
    - Query AMS directly via the new diff-scoped controller: `GET /api/projects/{projectId}/architectures/{architectureId}/api-behaviour/diffs/{diffId}/findings`
    - Verify findings exist with `source='api_behaviour_diff'`, `category='api_behaviour_drift'`, `api_behaviour_diff_id` matching the diff
    - Verify severities match the ladder table — at minimum, identical-API replays should produce no emit on matched items; a sibling URL with different status codes should produce `critical` / `high` / `medium` / `low` per the ladder
    - Verify each finding's `title` and `summary` match the wording table verbatim
    - Verify each finding has exactly one link to an `api_behaviour_diff_item` with `link_type='derived_from'`
  - [ ] 5.4 Verify the badge column on the Drift report tab
    - Open `BaselineDetailView` for the target baseline; click the "Drift report" tab
    - Verify the new "Findings" badge column appears between the classification column and the Action column
    - Verify counts are correct per row: matched items show 0 / no badge; classified items show a non-zero count matching what AMS returned in 5.3
  - [ ] 5.5 Verify the drawer + reviewer transitions
    - Click a non-zero "Findings" badge
    - Verify `DiffFindingDetailDrawer` opens pre-loaded with the linked findings for that diff_item
    - Verify the drawer layout matches the existing `FindingDetailDrawer` (same accept / ignore / resolve buttons, same status transitions)
    - Click "Accept" on a finding; verify the status transitions to `accepted` and the change persists (re-open the drawer; status should still read `accepted`)
    - Repeat for `ignored`, `needs_review`, `resolved` — all 4 status transitions should work via the diff-scoped PATCH endpoint
  - [ ] 5.6 Verify recompute cleanup (THE load-bearing pitfall)
    - Note the current finding count on the Drift report tab (sum of all badges)
    - Click "Recompute" on the Drift report tab; wait for the diff to complete
    - Re-query the badge counts; verify the total finding count is the SAME as before recompute (NOT 2x — this is the regression test from 2.1 reproduced manually on real data)
    - If counts have doubled, return to Task Group 2 and check that `deleteFindingsByApiBehaviourDiffId(diffId)` is called BEFORE the create loop in `diffRunner.ts`
  - [ ] 5.7 Verify the `MigrationSpecContextResolver` filter (no NPE on diff-sourced findings)
    - If a migration spec exists for this project + architecture, regenerate it (or trigger any flow that calls `MigrationSpecContextResolver.loadFindings`)
    - Verify the flow does NOT NPE
    - Verify the migration spec context contains run-sourced findings ONLY (no diff-sourced findings leak through) — inspect the rendered context or the resolver's output
  - [ ] 5.8 Verify the existing `FindingsTab.tsx` is unmodified (no leakage)
    - Open the existing `FindingsTab.tsx` on the Discovery Run Detail View
    - Verify it continues to render run-sourced findings ONLY (no diff-sourced findings appear here in v1 per accepted Q3)
    - Verify no Origin filter dropdown appeared (deferred to v2)

**Acceptance Criteria:**
- End-to-end emission flow completes: target replay → auto-spawn diff → diff completes → findings emitted → badge column populates → drawer opens → reviewer transitions persist
- Severities + wording match the ladder table + wording table verbatim on real persisted data
- Recompute cleanup works on real data (finding count does not double across recomputes)
- `MigrationSpecContextResolver.loadFindings` does NOT NPE on diff-sourced findings AND does NOT include them in the resolver's output
- Existing `FindingsTab.tsx` continues to render run-sourced findings only (no leakage)
- `mvn test-compile` exits 0 on AMS (no `-D` flags)
- Pre-existing broken tests listed in project memory remain untouched

---

## Execution Order

Strictly sequential by dependency (no parallelisable groups — the layers stack cleanly, matching Spec #4 / #5's pattern):

1. AMS Liquibase + entity/DTO/mapper/repo/service + new diff-scoped controller + `ApiBehaviourDiffArchitectureGuard` + `MigrationSpecContextResolver` filter (Group 1)
2. `findingEmissionRules.ts` + `diffRunner.ts` extension + `archModelClient.ts` extensions + explicit recompute cleanup (Group 2)
3. Gateway read/review proxies + typed wrappers (Group 3)
4. `diffFindingsApi.ts` + `DriftReportTab` badge column + `DiffFindingDetailDrawer` (Group 4)
5. End-to-end manual verification (Group 5)

Per accepted Q10, each of Groups 1-4 corresponds to one commit. Group 5 is verification only — no commit.

## Standing Constraints (apply to every group)

- Liquibase changesets `<=159` (or whatever the highest pre-existing number is at implementation time — confirm via 1.2) are immutable. NEW file only; never edit prior changesets per `feedback_liquibase_immutable_changesets.md`.
- All new fields on `DiscoveryFindingDto` are reference types (`UUID`, `Instant`, `String`). No primitive-drift risk per `project_primitive_double_dto_overwrite.md`. The Javadoc note added in Task Group 1 records this rule for the next maintainer who might add a numeric field.
- The `deleteFindingsByApiBehaviourDiffId(diffId)` call in `diffRunner.ts` MUST be the FIRST step in the emission block, BEFORE the per-item create loop. This is load-bearing, NOT defensive — see accepted Q6. Covered by the dedicated regression test in 2.1 + the manual verification in 5.6.
- The new `DiffFindingDetailDrawer` is a ~150 LOC copy-modify, NOT a refactor of `FindingDetailDrawer`. Lives under `frontend/src/components/DashboardView/`, NOT `Discovery/`. The existing `FindingDetailDrawer.tsx`, `FindingsTab.tsx`, and `findingsApi.ts` are UNMODIFIED per accepted Q3 + Q4.
- Only `api_behaviour_diff_item` is activated in the link-target allowlist in v1 per accepted Q5. `api_behaviour_baseline` stays documented-but-unused — leave it rejected.
- Emission goes from validation-service DIRECT to AMS via `archModelClient.ts`, matching `discovery-service/.../findings/FindingEmitter.ts`. The gateway does NOT proxy `createFinding` per accepted Q9 — read/review proxies only.
- First-ever `critical` severity in the platform is introduced deliberately for `status_drift` 2xx → 5xx per accepted Q1. Code comment in `findingEmissionRules.ts` records this for future maintainers.
- `MigrationSpecContextResolver.loadFindings` MUST be switched to the new `findByProjectIdAndArchitectureIdAndRunIdNotNull` finder per accepted Q7. Without this, the resolver will NPE or render "Run: -" garbage on diff-sourced findings.
- Schema CHECK constraint `discovery_finding_exactly_one_origin` MUST reject both `both-set` and `neither-set` cases. Both rejection paths verified by the test in 1.1.
- Pre-existing broken tests listed in project memory must NOT be modified by this feature's work.
- Do NOT edit `discovery-service/src/**` if a discovery run is active (tsx watch reload kills runs per `feedback_no_src_edits_during_run.md`). This spec does not touch `discovery-service` directly, but the manual verification in Group 5 may trigger discovery flows for the `MigrationSpecContextResolver` check in 5.7.
