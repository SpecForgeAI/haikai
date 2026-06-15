# Spec Requirements: API Test Harness — Findings Integration (Spec #6)

## Initial Description

See `planning/raw-idea.md`. Spec #6 (the smallest) in a 3-spec arc — emit `discovery_findings` rows when an `api_behaviour_diff` completes, link each finding to the originating `api_behaviour_diff_item`, and surface them in the existing Findings tab AND inline on the Drift report tab. Reviewer lifecycle inherits unchanged from the discovery-findings infrastructure.

## Validated Reuse Inventory

### AMS Java side

| Asset | Path | Reuse plan |
|---|---|---|
| `DiscoveryFindingEntity` | `architecture-model-service/.../entity/discovery/DiscoveryFindingEntity.java` | Add nullable `apiBehaviourDiffId`; flip `runId` to nullable. |
| `DiscoveryFindingDto` (record) | `.../model/dto/discovery/DiscoveryFindingDto.java` | Add `apiBehaviourDiffId` field (record component — breaks all callers; needs a careful migration of `MigrationDiscoveryContextService.toFindingHighlight` and the mapper). |
| `DiscoveryFindingMapper` | `.../mapper/discovery/DiscoveryFindingMapper.java` | Add `entity.getApiBehaviourDiffId()` to the constructor call. |
| `DiscoveryFindingRepository` | `.../repository/discovery/DiscoveryFindingRepository.java` | Add `findByApiBehaviourDiffIdOrderByCreatedAtAsc(UUID)`. Existing `search(...)` JPQL has `WHERE f.runId = :runId` baked in — must be relaxed to allow diff-id scoping (or a parallel search method built). |
| `DiscoveryFindingService` | `.../service/discovery/DiscoveryFindingService.java` | Heavy surgery — see "Surprises" below. |
| `DiscoveryFindingController` | `.../controller/discovery/DiscoveryFindingController.java` | New parallel path needed — current `@RequestMapping` bakes `/runs/{runId}` in. See "Surprises". |
| `DiscoveryFindingLinkService` link-target allowlist | `.../service/discovery/DiscoveryFindingService.java` (inline static set `ALLOWED_LINK_TARGET_TYPES`) | Add `api_behaviour_diff_item`. The set explicitly rejects `api_behaviour_baseline` today as a documented-but-unused future value — raw-idea proposes we activate it; revisit (see Q5). |

### `api-migration-validation-service` side

| Asset | Path | Reuse plan |
|---|---|---|
| `diffRunner.ts` | `api-migration-validation-service/src/services/diffRunner.ts` | Append a finding-emission step at the end of the happy-path (after the `status='completed'` PATCH). The diff_item shape carries everything emission rules need: `status_classification`, `body_classification`, `source_response_status`, `target_response_status`, `notes` (where `source_only` sub-reasons live: `mutating_skipped` / `transport_failure` / `no_paired_target`), plus `method`/`path`/`scenario_name`. Confirmed: **clean append, no refactor**. |
| `archModelClient.ts` (validation-service) | `api-migration-validation-service/src/services/archModelClient.ts` | **No finding methods exist today.** Need to add `createFinding(...)`, `createFindingLink(...)`, optional `deleteFindingsByApiBehaviourDiffId(...)`. Pattern to model: discovery-service's `archModelClient.createDiscoveryFinding` / `bulkCreateDiscoveryFindings`. |
| `findingEmissionRules.ts` (new) | new file | Pure function: `classifyDiffItem(item) -> { shouldEmit, severity, findingType, title, summary, detailJson, category }`. |

### Gateway side

| Asset | Path | Reuse plan |
|---|---|---|
| Discovery findings proxy block | `gateway/src/routes/discovery.ts` lines 2460-2700+ | Existing proxies all bake `/runs/:runId/findings` in the path. New gateway routes needed for diff-scoped findings (mirroring the new AMS controller surface). |
| `apiBehaviourClient.ts` (gateway) | `gateway/src/services/apiBehaviourClient.ts` | Add typed wrapper for the AMS POST findings endpoint that targets a diff (the validation-service calls AMS direct, not via gateway — confirm in Q9). |

### Frontend side

| Asset | Path | Reuse plan |
|---|---|---|
| `findingsApi.ts` | `frontend/src/api/findingsApi.ts` | All URL builders use `findingsPathPrefix(projectId, architectureId, runId)` — non-trivial to extend. Options: (a) add a parallel `diffFindingsPathPrefix(...)` + parallel methods; (b) make `runId` optional + add `diffId` optional, dynamically pick the URL. (a) is safer (no breaking changes to existing callers). |
| `FindingsTab.tsx` | `frontend/src/components/Discovery/FindingsTab.tsx` | Hosted on Discovery Run Detail View today — props `{projectId, architectureId, runId, onOpenLinkedTarget?}`. The "Source" column already shows `f.source ?? '-'` (a string). Filter strip is a flex row of 5 selects + 1 search input + Clear button — easy to add an "Origin" select. **But: the tab is scoped to a run; raw-idea Q3 settled this with option (a) — diff-sourced findings live exclusively on the Drift report tab.** If we hold to that, no change to `FindingsTab.tsx`. If we want to surface diff-sourced findings in `FindingsTab`, the component needs to be detached from `runId`-only scoping. (See Q3.) |
| `FindingDetailDrawer.tsx` | `frontend/src/components/Discovery/FindingDetailDrawer.tsx` | **Hard barrier**: requires `runId: string` (not optional) and uses it for every API call (`reviewFinding`, `updateFinding`, link CRUD). For diff-sourced findings without a runId we either (a) extend drawer signature to accept `diffId` as an alternative scope, or (b) call diff-scoped variants of the findings API. See Q4. |
| `DriftReportTab.tsx` | `frontend/src/components/DashboardView/DriftReportTab.tsx` | Per-item row structure exists with a clean trailing "Action" column ("View diff" button) — can add a "Findings" badge column before "Action". No structural barriers to importing `FindingDetailDrawer` from `../Discovery/`. |

### Spec-shaper note on existing related infra

- `discovery-service/.../findings/FindingEmitter.ts` already implements a soft-fail emission pattern; **good template** for the validation-service emission step's error handling.
- Existing severity emissions in `discovery-service/src/services/findings/**`: only `info`, `low`, `medium`, `high`. **No `critical` is emitted anywhere in the platform today.** The raw-idea's proposed `status_drift (2xx→5xx) → critical` would be the **first-ever `critical` finding**. This is a real product call (see Q1).

## Surprises and Constraints

### 1. The controller path bakes `/runs/{runId}` in — no-new-controller claim is wrong

`DiscoveryFindingController` has class-level `@RequestMapping(.../discovery/runs/{runId}/findings)`. Every route requires a runId path param, every service method has `runGuard.verify(runId, projectId, architectureId)` as its first line, and `findScoped` checks `!runId.equals(entity.getRunId())`. Creating a diff-sourced finding through these endpoints is **impossible** without a runId.

**The raw-idea's claim "No new controller. Existing DiscoveryFindingController endpoints already handle CRUD; the new origin shape and target_type values flow through unchanged" is factually wrong.** 

Options to fix:
- **Option A**: Add a new controller mapping at `/api/model/projects/{projectId}/architectures/{architectureId}/api-behaviour-diffs/{diffId}/findings[...]` mirroring the existing surface. The service grows a parallel set of methods (`createForDiff`, `listForDiff`, `getForDiff`, `updateForDiff`, `reviewForDiff`, `deleteForDiff`, `linksForDiff`) that swap `runGuard` for a new `ApiBehaviourDiffArchitectureGuard` (verifying diff belongs to project+architecture).
- **Option B**: Hoist the controller path to project-architecture scope (`.../findings/{findingId}`) and accept `runId` OR `apiBehaviourDiffId` in the body for create, plus filter param for list. Bigger surgery — also breaks the existing URL contracts the gateway and frontend depend on.

**My instinct: Option A.** Doubles the controller surface but it's mechanical and keeps existing surfaces stable.

### 2. The repository search JPQL has `f.runId = :runId` hard-coded

`DiscoveryFindingRepository.search(...)` JPQL filters on `f.runId = :runId` as a non-optional clause. Either:
- Make it nullable in the search (filter on runId OR diff_id depending on origin scope), or
- Add a parallel `searchByApiBehaviourDiffId(...)` method.

**My instinct: parallel method.** Simpler, fewer null branches.

### 3. `MigrationDiscoveryContextService.toFindingHighlight` reads `f.getRunId()` directly

`MigrationDiscoveryContextDto.FindingHighlight` is a record with `UUID runId` as one of its fields, and is populated unconditionally. If diff-sourced findings flow into this resolver (via `findByProjectIdAndArchitectureId(...)` in `MigrationSpecContextResolver.loadFindings`), `f.getRunId()` will return `null` for diff-sourced rows — fine for the record component (`UUID` is nullable) but downstream consumers (template renderers, spec generation) may NPE.

**Mitigation**: In v1, **filter diff-sourced findings out** of the migration spec context resolver's `loadFindings`. Add `WHERE f.runId IS NOT NULL` to the project+architecture finder OR add an explicit `findByProjectIdAndArchitectureIdAndRunIdNotNull` variant. This is a tiny additional change to flag in the AMS Java commit. (See Q7.)

### 4. `FindingDetailDrawer` requires `runId: string` and uses it for every reviewer API call

If diff-sourced findings are reviewed via the existing drawer, the drawer must either (a) accept an alternative `diffId?` and pick the right API endpoint, OR (b) be wrapped in a thin adapter that swaps the API calls. Either way, more than a "tiny" change. (See Q4.)

### 5. `findingsApi.ts` URL builder bakes runId in

`findingsPathPrefix(projectId, architectureId, runId)` is the single URL builder for all 8 frontend methods. New diff-scoped variants need either a parallel builder + 8 parallel methods, or a runtime-discriminated URL builder. **My instinct: parallel builder + parallel methods.** Keeps callers explicit about scope.

### 6. Gateway proxy is per-method, runId baked in

The gateway proxies under `/api/v1/discovery/projects/:projectId/architectures/:architectureId/runs/:runId/findings[...]` all hard-code the runId path segment in both the inbound Express route and the outbound AMS URL. New diff-scoped proxies needed (or a parallel route block). Suggest: new prefix `/api/v1/api-behaviour-diffs/:diffId/findings[...]` (or under api-behaviour: `/api/v1/projects/:projectId/architectures/:architectureId/api-behaviour/diffs/:diffId/findings`).

### 7. **Critical**: no `critical` severity emitted anywhere in the platform today

A platform-wide grep shows existing emissions hit `info`, `low`, `medium`, `high`. Raw-idea's `status_drift (2xx→5xx) → critical` would be the first. This is fine in principle but warrants confirmation. (See Q1.)

### 8. Predicted Liquibase slot 160 is confirmed empirically

`ls db/changelog/sql/ | sort -V | tail -5` shows 156, 157, 158 (api-behaviour-diffs), 159 (api-behaviour-diff-items). **Next free slot: 160.** Predicted correctly.

### 9. No in-flight "unified findings" view conflicts

Searched spec folders + frontend + gateway. No half-built parallel findings surface exists. The only reference to "unified findings" is in the raw-idea's own Q3 deferral.

### 10. Recompute cascade — defensive belt-and-braces

The proposed FK `api_behaviour_diff_id REFERENCES api_behaviour_diffs ON DELETE CASCADE` would handle row-deletion cascade. But **recompute** doesn't delete the diff — Spec #5's `recomputeDiff` PATCHes the same diff back to `status='computing'` and the runner deletes/re-inserts `api_behaviour_diff_items` (CASCADE-delete is on `diff_id`, not on the diff row itself). So:

- **Diff-item CASCADE-delete will not delete the finding rows** because findings link to the diff via `api_behaviour_diff_id`, NOT to the diff_item via FK. The link table (`discovery_finding_links`) has a polymorphic non-FK pointer.
- **The CASCADE that does fire on recompute (diff_items CASCADE on diff_id) leaves findings dangling, pointing at deleted diff_items via the link table.**

This means the raw-idea's "trust the FK" stance (Q5 instinct: skip explicit delete) is **wrong for the recompute path**. The runner MUST explicitly call `deleteFindingsByApiBehaviourDiffId(diffId)` before re-emitting. The FK CASCADE only matters when the diff row itself is deleted (uncommon). **Override raw-idea Q5: explicit delete IS required.** (See Q6.)

### 11. Validation-service archModelClient has no finding methods

The validation-service `archModelClient.ts` references finding-related types only in DTOs for migration spec context aggregation — it does **not** have a `createFinding` / `createFindingLink` / `deleteFindings` method. These need to be added from scratch in this spec.

## Predicted Liquibase Slot

**Predicted: 160.** Empirically verified — `ls db/changelog/sql/ | sort -V | tail -5` shows 156, 157, 158, 159 as the latest. Spec implementation must re-verify at code time per the standard cadence.

## Reusability Opportunities

- **Pattern**: `discovery-service/.../findings/FindingEmitter.ts` — soft-fail emission with one-call bulk POST. Validation-service should model its emitter on this.
- **Pattern**: `apiBehaviourClient.ts` (validation-service) `getDiff` / `updateDiff` / `createDiffItem` — same URL-builder + axios wrapper pattern for the new finding-emit methods.
- **Pattern**: `apiBehaviourClient.ts` (frontend) `ApiBehaviourDiffDto` — carries `project_id` and `architecture_id` directly; the frontend can resolve the scoping ids off the diff DTO without an extra lookup.
- **Pattern**: `DiscoveryRunArchitectureGuard` — model a new `ApiBehaviourDiffArchitectureGuard` (project+architecture sanity check on diffId) following the same shape.
- **Pattern**: `DiscoveryFindingService.persistNewFinding` / `persistLinks` — almost-identical shape for the diff-scoped variants; consider extracting shared `persistNewFinding(common state)` private helper.

## Visual Assets

No visual assets provided (code-only spec; two small UI threadings reuse existing components).

## Accepted Answers (2026-05-25)

User accepted all defaults. Decisions to encode in the spec:

- **Q1 First-ever `critical` severity.** Emit `critical` for `status_drift`
  2xx → 5xx. Breaks the discovery-service's `high` ceiling deliberately —
  a previously-200 endpoint now 500ing is the highest-stakes drift signal
  we can detect.
- **Q2 Refined `status_drift` severity ladder.**
  - 2xx → 5xx = `critical`
  - 2xx → 4xx = `high`
  - 2xx → 2xx differing = `medium`
  - other (e.g. 3xx changes) = `low`
  Avoids `high`-flooding dashboards with benign 200→201 noise.
- **Q3 Scope: diff-sourced findings ONLY on the Drift report tab in v1.**
  No changes to `FindingsTab.tsx`, `FindingDetailDrawer.tsx`,
  `findingsApi.ts` URL builders, or the gateway findings proxy block.
  No `Origin` filter dropdown in this spec. Unified view = v2.
- **Q4 New `DiffFindingDetailDrawer` (~150 LOC copy-modify).** Don't
  refactor `FindingDetailDrawer` to accept `runId | diffId`. Lower risk
  to the existing reviewer flow; acceptable duplication for v1. Refactor
  to a shared base in v2 if surfaces diverge further.
- **Q5 Only `api_behaviour_diff_item` activated as link target_type.**
  `api_behaviour_baseline` stays documented-but-unused in v1 (no consumer).
  Minimises blast radius and avoids needing a baseline-FK existence guard
  in this spec.
- **Q6 ⚠️ MANDATORY explicit `deleteFindingsByApiBehaviourDiffId` before
  re-emit.** Load-bearing, NOT defensive. The `api_behaviour_diff_id ON
  DELETE CASCADE` only fires on diff-row deletion; recompute keeps the
  diff row alive while replacing diff_items, so findings would
  accumulate across recomputes without an explicit delete call. Calling
  this from `diffRunner.ts` before re-emit is the only correct path.
- **Q7 Filter diff-sourced findings out of
  `MigrationSpecContextResolver.loadFindings`.** Resolver reads
  `f.getRunId()` directly into migration-context templates; null `runId`
  will NPE or produce "Run: -" garbage. Add a
  `findByProjectIdAndArchitectureIdAndRunIdNotNull` variant (or
  equivalent `WHERE f.runId IS NOT NULL` clause) and switch the
  resolver to it. Preserves existing migration-spec semantics. Revisit
  in v2 if migration specs want API-drift findings as context.
- **Q8 Spec pins the full emission wording table.** 7 rows (one per
  emission rule) with title format + summary template. Product copy
  worth pinning to avoid implementer drift between interpretations.
- **Q9 Direct AMS call for emission; gateway grows read/review proxies
  only.** `diffRunner.ts` calls AMS directly via the validation
  service's internal `archModelClient` (same pattern as discovery
  service's `FindingEmitter`). Gateway adds only the diff-scoped
  findings *read/review* proxies that `DiffFindingDetailDrawer` needs —
  NOT a create-proxy.
- **Q10 4-commit per-layer cadence.**
  1. AMS DB + Java (Liquibase 160, entity, DTO, mapper, repository,
     service, new diff-scoped controller, new
     `ApiBehaviourDiffArchitectureGuard`, `MigrationSpecContextResolver`
     filter)
  2. Validation-service emission (rules file + `diffRunner.ts`
     extension + new `archModelClient` methods + explicit
     recompute-cleanup + tests)
  3. Gateway diff-scoped findings read/review proxies + tests
  4. Frontend: new `diffFindingsApi.ts` (or parallel methods in
     `findingsApi.ts`) + `DriftReportTab.tsx` findings badge column +
     `DiffFindingDetailDrawer.tsx` + tests

**Net effect on sizing:** This is now **Small-Medium** rather than Small.
Corrections Q4 (new drawer), Q6 (explicit delete), Q7
(MigrationSpecContextResolver filter), and Q9 (split create vs
read/review proxy) absorbed during shaping. Still 4 commits; still
~15-20 tests; still no top-level new pages.

## Open Questions for User

(Surfaced in the final message; recorded here for the spec-writer's reference.)

---

## Requirements Discussion

### First Round Questions

_(Recorded verbatim in the final assistant message; user answers will be inserted here by the spec-writer.)_
