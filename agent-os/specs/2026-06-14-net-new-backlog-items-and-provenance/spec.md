# Specification: Net-new backlog items + provenance (D5)

## Goal
Add a `provenance` marker (`carry_over` default / `net_new`) to work items and a first-class "Add work item" path on the Migration Delivery Dashboard that flows a human-described item through description-grounded spec-gen into an implementation-ready spec and the built Migrate dispatch. D5 only SETS the marker; the reconcile consumer (program D6) reads it.

## User Stories
- As a migration owner, I want to add genuinely-new work (a new job, a new feature) to the backlog before Migrate so it gets an implementation-ready spec and rides the dispatch without being treated as a current-state coverage obligation.
- As a migration owner, I want to add undiscoverable carry_over work (OS cron, vacuum/index schedules, ops runbooks no parser finds) so the like-for-like envelope is complete even though discovery could not find it.

## Specific Requirements

**`provenance` column on `work_item` (changeset 186)**
- New Liquibase changeset `186-work-item-provenance.sql`: `ALTER TABLE work_item ADD COLUMN provenance VARCHAR NOT NULL DEFAULT 'carry_over'` (185 is the highest applied on disk — D4's `source_capability_id`; register AFTER it in `db.changelog-master.yaml`).
- Values are `{carry_over (default), net_new}` ONLY. The `carry_over` default means every existing/discovered row is correct with NO backfill.
- Add the field to `WorkItemEntity` mirroring the `deferred` precedent (changeset 182): boxed-friendly default, `@PrePersist` mirror so a builder omitting it still inserts `carry_over`, NOT NULL column.
- Add `@JsonProperty("provenance")` to `WorkItemDto` (snake_case wire) and append a new backward-compatible positional constructor defaulting `provenance` to `'carry_over'` (the record arity grows again — D4 took it to 21 args via `source_capability_id`).
- Null-guarded PATCH in `WorkItemMapper.updateEntityFromDto` exactly like `deferred`/`sourceCapabilityId`: an omitted `provenance` on update never wipes the column.
- COLUMN authoritative and COLUMN-only: dispatch ignores it; the reconcile consumer reads rows directly. NO blob mirror unless the reconcile-shaping spec surfaces a need.

**Append-`*`-item AMS endpoint that stamps provenance**
- New endpoint on `GeneratedMigrationBookOfWorkController` modelled exactly on `appendTestItem` (`GeneratedMigrationBookOfWorkService`): create the `WorkItem` via `itemSaver.persistOne` + append the `book_of_work_json.items[]` blob (stamping `workItemId` + `saveState="saved"`) in ONE `@Transactional`.
- Request DTO modelled on `AppendTestItemRequest` (snake_case wire): `provenance`, `kind` flavour (API vs operational/non-API), `title`, `description`; parent is optional (a manual add is a top-level story by default, like `appendCapabilityStory`).
- After `persistOne`, set `provenance` on the minted `work_item` row inside the same transaction (load by id, set, save) — mirrors how `appendCapabilityStory` back-writes `source_capability_id` to the column.
- The minted blob item `type` is the LOWERCASE `"story"` so the gateway's `selectEligibleStories` (matches `it.type === 'story'` + non-null `workItemId`) consumes it unchanged; `persistOne` uppercases the `work_item.type` to `STORY`.
- The item carries NO `source_capability_id` and NO `discoveryFindingReferences` (a manual add has no discovered capability/finding) — this is what keeps it OUT of D4's discovered must-account set with no gate code.

**Description-grounded spec-gen for manual adds (PRIMARY path)**
- After the add-item endpoint mints the story, the gateway triggers `migrationShapeSpecGenerationHandler` for that one `workItemId` — the normal generate path that reaches `generated`, hydrating implement-state + the test pack.
- Add a description-grounded MODE: the human's `description` (carried on the STORY METADATA the per-story prompt already emits) IS the context, REPLACING the discovered-context resolver. Manual adds never route through D3's `appendCapabilityStory` / discovered-capability resolver path (that is for DISCOVERED capabilities only).
- For `net_new` the no-fabrication / insufficient-context short-circuit RELAXES: the human description is the authoritative intent, not something to guess — generation proceeds to a full spec rather than parking at `insufficient_context`.
- `kind` tunes ONLY the prompt FLAVOUR: `API` → API-endpoint orientation; `operational`/non-API → operational-effect-test orientation. Clean split: discovered work = resolver-grounded; manual adds = description-grounded.

**`applyManualEdit` status-promotion fix (FALLBACK / escape hatch)**
- Bug confirmed: `MigrationStorySpecGenerationService.applyManualEdit` overwrites `generatedSpecText` + the 4 manual-edit audit columns and re-runs parser/scorer but NEVER calls `entity.setStatus(...)`, so a hand-authored `insufficient_context` row stays un-dispatchable.
- Fix: when the supplied `specText` is non-empty, PROMOTE `status` to `generated` before save. A precise hand-author escape hatch AND the latent-bug closure.
- Keep the existing scorer skip-rule coherent (the row is no longer `insufficient_context`/`failed` once promoted, so scoring runs normally on the now-`generated` row).
- Confirm ownership: `applyManualEdit` lives in AMS; the gateway `manualEditSpec` caller is a pass-through and needs no behavioural change.

**Dispatch + D4-gate interaction (read-only / no new code)**
- A `net_new` spec-ready story dispatches UNCHANGED: `migrationExecutionDriver.ts` `evaluateHardBlock` / `buildOrderedDispatchSet` key on `workItemId` + spec-ready (status ∈ `{generated, generated_with_warnings}` + non-stale) + non-deferred, and read NO provenance.
- `net_new` is excluded from D4's carry_over gate PURELY by the marker — D4's must-account set is DISCOVERED capabilities/findings, never manual adds; NO gate code is added beyond the marker existing.
- A manually-added `carry_over` item is ALSO not in D4's discovered must-account set; its safety net is the reconcile consumer / effect-tests, NOT the D4 gate. HONESTY: for a NON-API manual `carry_over` add there is no replay surface, so "absence is a reconciliation break" does not literally apply — its assurance is effect-tests (same backstop as a `net_new` non-API item). Do not over-promise a reconciliation backstop non-API work cannot have.

**Add-item action on the Migration Delivery Dashboard (frontend)**
- ONE "Add work item" action on the Migration Delivery Dashboard (net-new UI — no add-work-item surface there today), opening a form reusing `WorkItemCreateModal.tsx` patterns (validation, field layout) but mounted on the dashboard.
- Form fields: `provenance` (carry_over/net_new), `kind` flavour (API / operational), `title` (required), `description`; the describe→generate trigger (PRIMARY) and the hand-author field that hits the `applyManualEdit` escape hatch (FALLBACK per D3).
- On submit: call the append-`*`-item endpoint, then surface the spec-gen progress for the new item the same way existing generate flows do; the new story then appears in the hierarchy tree and dispatch set.

**Provenance badge + filter in the backlog/hierarchy tree (frontend)**
- A provenance badge (`net_new` / `carry_over`) rendered on items in `MigrationDeliveryHierarchyTree.tsx` (alongside the existing Edited/Quality chips).
- A provenance filter (show only `net_new` / only `carry_over` / all) on the dashboard tree, sibling to the existing grade filter.
- NO bulk re-classify in v1.
- Keep within the frontend tsc baseline (515).

## Visual Design
No visual assets were provided (`planning/visuals/` confirmed empty). Reuse the existing dashboard add-modal and hierarchy-tree chip/filter styling; no new visual spec.

## Existing Code to Leverage

**`WorkItemEntity.deferred` + `WorkItemMapper` (changeset 182 / 185 precedents)**
- `deferred` (boxed Boolean, NOT NULL DEFAULT, `@PrePersist` mirror) and `sourceCapabilityId` (boxed, null-guarded PATCH) are the EXACT precedents for the `provenance` column.
- `WorkItemMapper.updateEntityFromDto` already null-guards both — copy the `if (dto.provenance() != null) entity.setProvenance(...)` shape; `toEntity` already defaults `deferred`/`status` similarly.
- `WorkItemDto` is a Java record at 21 args after D4 (`source_capability_id`); add the field + a new compatibility constructor defaulting `provenance` to `'carry_over'`.

**`GeneratedMigrationBookOfWorkService.appendTestItem` / `appendCapabilityStory`**
- `appendTestItem` is the add-item precedent: `persistOne` + defensive `book_of_work_json` working-copy + stamp `workItemId`/`saveState` + persist, one transaction. Model the new endpoint on it (top-level/optional parent like `appendCapabilityStory`).
- `appendCapabilityStory` shows the column back-write pattern (load minted row by id, set the new column, save in the same tx) — reuse it for the `provenance` stamp; do NOT route manual adds through it (it is the DISCOVERED-capability path).

**`migrationShapeSpecGenerationHandler.ts`**
- `buildStoryUserPrompt` already emits STORY METADATA (title/description) + per-story context; `selectEligibleStories` gates on `type === 'story'` + non-null `workItemId`. Extend with the description-grounded mode (description replaces the discovered-context resolver) and relax the `insufficient_context` short-circuit for `net_new`.

**`MigrationStorySpecGenerationService.applyManualEdit` (AMS)**
- The status-promotion bug lives here (lines ~634-691: sets text + 4 audit columns, re-runs parser/scorer, never `setStatus`). Add the promote-to-`generated`-on-non-empty-text fix here; the gateway caller is a pass-through.

**`MigrationDeliveryHierarchyTree.tsx` + `WorkItemCreateModal.tsx`**
- The hierarchy tree already renders Edited/Quality chips and has a sibling grade filter — add the provenance badge + filter alongside them. `WorkItemCreateModal.tsx` (title/description/validation/submit patterns) is the form-pattern source for the dashboard add-item form.

## Out of Scope
- Reconcile-time verification / `net_new` `target_only` handling — that is the program's D6 (a separate spec that EXTENDS `migration-reconciliation-and-bug-loop`); D5 only SETS provenance.
- Any blob mirror of `provenance` (column-only unless the reconcile-shaping spec surfaces a need).
- Bulk re-classify of provenance in v1.
- Any change to D4's gate code or D3's discovered-capability (`appendCapabilityStory`) path beyond the `provenance` marker existing.
- Any change to dispatch keying — it stays provenance-blind and dispatches `net_new` unchanged.
- Routing a manual add through the discovered `operational_capability` resolver path (manual adds are ALWAYS description-grounded; `kind` only tunes the prompt flavour).
