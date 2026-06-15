# Specification: Holistic Integration/E2E TEST Work Items (Spec 2 of 4)

## Goal
After a feature's (or epic's) children are spec-complete, run a headless holistic Test-Engineer review across the children's specs to define a SMALL number of cross-cutting INTEGRATION and E2E tests, and create each as a first-class `TEST`-type work item placed as a SIBLING, with its own implementation-ready spec so it is implemented (test code written) by the Migrate loop (Spec 3) and executed in Verification (Spec 4).

## User Stories
- As a Product Manager, I want a per-node "Define Integration/E2E Tests" action on a feature or epic in the Migration Delivery Dashboard so that the tool reviews its children's specs and proposes the few cross-cutting tests they imply.
- As a Product Manager, I want each generated test to become a real `TEST` work item (sibling, distinct chip, own implementation-ready spec) so that it flows through Migrate and Verification exactly like a story rather than being a verification-time note.

## Specific Requirements

**Generalize the holistic prompt to feature|epic (gateway)**
- Generalize `gateway/src/services/holisticTestPlanningPrompt.ts` so the same review runs at FEATURE level (review its stories' specs) OR EPIC level (review its features' specs).
- Change is purely textual: prompt nouns become level-relative ("a {feature|epic} and all its {stories|features}"); `formatStorySpec`'s `### Story N` heading becomes `### {Story|Feature} N`.
- Keep `StorySpecSummary` and `buildHolisticTestPlanningPrompt` signatures unchanged in shape — at EPIC level the array elements are the epic's FEATURES' specs instead of a feature's STORIES' specs ("review the immediate children's specs").
- Preserve the output contract verbatim: VALID JSON ONLY `{ schemaVersion:"1.0", message, testPlan:[{title,description,type}], openQuestions:[] }`; `type` MUST be `integration` or `e2e` (never `unit`/`functional`); `testPlan` MAY be empty (no fabrication).

**New headless holistic-review handler (gateway)**
- Add a NEW headless, batch-style gateway handler modelled on `runShapeSpecGenerationBatch` (`migrationShapeSpecGenerationHandler.ts`): dependency-injection seams, per-item failure isolation, structured `[diag-gateway]` logs.
- It is NOT the interactive `test_planning_holistic` chat phase (finding #2's in-memory-only consumer is a reference only for the `storyResults → storySpecs[]` mapping).
- Input is a node selection (feature OR epic) within a book of work; it loads the node's immediate children + their `migration_story_spec_generations` rows, builds `StorySpecSummary[]`, injects `TEST-STRATEGY.MD` from `{projectParentFolder}/agent-os/product/TEST-STRATEGY.MD`, calls the LLM via the generalized prompt, and parses the `testPlan[]`.
- Per generated test it then creates the TEST work item, writes the blob item, persists the spec row, and writes implement-state.json (see requirements below); each test is isolated so one failure never aborts the batch.

**New per-node action + trigger surface (gateway route + frontend)**
- Add a NEW gateway route for the per-feature/epic action; the delivery-dashboard route (`migrationDeliveryDashboard.ts`) is a thin GET/repair-orphan proxy today and Generate-All is book-of-work-scoped, so a new node-scoped surface is required.
- Add a NEW per-node "Define Integration/E2E Tests" control in the Migration Delivery Dashboard hierarchy tree, next to the existing Generate-All control (model on `MigrationDeliveryGenerateAllDialog` / `MigrationDeliveryHierarchyTree` / `MigrationDeliveryDashboard.tsx`); it is shown on FEATURE and EPIC nodes only.
- Re-point the existing `BacklogTab` `onDefineIntegrationTests(itemId)` entry to this NEW headless flow, replacing today's navigate-to-`holistic_only`-interactive-chat behaviour.

**One TEST work item per generated test (AMS)**
- Emit ONE `TEST` work item per generated test (not a single bundle item); each has its own title, own implementation-ready spec, and is independently implementable/verifiable.
- `type` is the literal uppercase `TEST` — already in `WorkItemService.ALLOWED_TYPES`; no new sub-type column, no enum/schema change.
- Status = `PLANNED` (the default created-item status); `parentId` = the feature node (sibling to stories) OR the epic node (sibling to features). `validateParentRelationship` is intentionally loose (existence + same project only), so both placements are permitted.

**Write BOTH representations (AMS)**
- For each TEST item write BOTH, mirroring the save-to-backlog write-back (`GeneratedMigrationBookOfWorkService` `persistOne` lines 1115–1166 + the `workItemId` stamp): a `book_of_work_json.items[]` blob item (`type:"TEST"`, `parentId` = the feature/epic blob item id, `sequenceOrder` per the placement rule) AND a `work_item` row.
- Inside the same transaction, stamp the created `workItemId` (+ `saveState="saved"`) back onto the blob item, then persist the mutated `book_of_work_json` — the dashboard join is exclusively by stored `workItemId`; title-matching is forbidden.
- Writing both is what makes the TEST sibling appear in the delivery-dashboard tree (built strictly from `book_of_work_json`) AND in the flat backlog (reads the work-items table).
- No new Liquibase changeset: reuse the existing WorkItem create + the existing `items/append`-style atomic blob merge pattern.

**Placement / sortOrder after the last spanned child (AMS)**
- `sortOrder` (and blob `sequenceOrder`) = `max(child sequenceOrder/sortOrder among the feature's/epic's existing children) + 1`, with an incrementing offset for multiple TEST items (`+1, +2, …`).
- This sets SIBLING display order only; Migrate-loop execution sequencing of TEST items after their covered children is Spec 3 and is not changed here.

**Dedicated lighter holistic→spec assembler (gateway)**
- Add a DEDICATED, lighter holistic→spec assembler (NOT Spec 1's per-story generator) that produces each TEST item's implementation-ready spec body: a canonical `/agent-os:shape-spec` test-plan body instructing Claude Code to WRITE the integration/E2E test code aligned to `TEST-STRATEGY.MD` (the test definitions are its input).
- REUSE from Spec 1: the `migration_story_spec_generations` row schema (incl. Spec 1's structured-tests/`covered_endpoint_ids` columns from changeset 181), the validator (`assertSpecGenerationResponse` + `SPEC_TEXT_REQUIRED_PREFIX` = `/agent-os:shape-spec`), and the AMS persistence client (`/spec-generations/batch`).
- Persist a row keyed on the TEST item's `work_item_id` (NOT NULL); leave `book_of_work_id` / `book_item_id` nullable as needed (no uniqueness constraint on `work_item_id`).
- DO NOT REUSE Spec 1's per-story migration-context fetch (`fetchMigrationSpecContext` / the six mappings/baselines/contracts context types) — a TEST item has no migration discovery context; its inputs are the holistic review output + the sibling specs + `TEST-STRATEGY.MD`.

**Populate implement-state.json for each TEST item (gateway)**
- Also write the gateway `implement-state.json` for the TEST item (reuse `migrationImplementReadyState.ts`: `buildPersistedImplementStateLiteral` + the `ImplementStatePutter`/`defaultPutImplementState` disk-write contract), mirroring Spec 1 D1/D2 so the TEST item's Implement screen hydrates uniformly like a story's.
- Scope = "write these integration/E2E tests"; Test Pack = the test definitions; `plannerReadyForSpec` and `hasTestPlan` set; write is best-effort/isolated (R-12 posture).

**TEST chip + show/hide filter (frontend)**
- The hierarchy tree (`MigrationDeliveryHierarchyTree.tsx`) and the flat backlog (`ProductBacklogPage` / `BacklogTab`) render a distinct TEST chip/badge so a `TEST` sibling is visibly distinguishable from stories/features.
- Add a show/hide filter for TEST items in the tree and backlog (model on the existing `filterStoryWorkItemIds` pruning pattern); node `type` is free-text and arrives as `"TEST"` from `book_of_work_json`.

**Allow-with-warning gating (gateway + frontend)**
- Gating is ALLOW-WITH-WARNING, not a hard block: run the holistic review over the children that ARE spec-complete (`generated` / `generated_with_warnings`), and prominently warn + list any children still `insufficient_context` / not-yet-generated.
- The user may proceed (review only the spec-complete children) or close the gaps first and re-run; surface the warning + the insufficient/not-generated child list on the trigger surface.

## Visual Design
No visual assets were provided (`planning/visuals/` is empty). Model the new per-node action and the TEST chip/filter on the existing `MigrationDeliveryDashboard` controls and badge styling.

## Existing Code to Leverage

**`gateway/src/services/holisticTestPlanningPrompt.ts`**
- `StorySpecSummary` + `buildHolisticTestPlanningPrompt` + `formatStorySpec` + `IMPLEMENT_HOLISTIC_TEST_PLANNING_PROMPT_TEMPLATE`; already emits integration|e2e only and returns empty when none.
- Generalize the prompt nouns to feature|epic; reuse the input shape and JSON output contract verbatim.

**`gateway/src/services/migrationShapeSpecGenerationHandler.ts`**
- The headless batch PATTERN: DI seams (`ShapeSpecGenerationDeps`), per-item failure isolation, `[diag-gateway]` structured logs, `defaultCallLlm`, `toAmsWireShape`, and `defaultPersistBatchResults` POSTing `/spec-generations/batch`.
- Reuse the persistence client + the row DTO shape; do NOT reuse `selectEligibleStories` (story-only) or `fetchMigrationSpecContext`.

**`gateway/src/services/migrationImplementReadyState.ts` + `specGenerationResponseValidator.ts`**
- `buildPersistedImplementStateLiteral` / `buildTestPlannerResponseFromTests` / `ImplementStatePutter` / `defaultPutImplementState` for the TEST item's implement-state.json hydration.
- `assertSpecGenerationResponse` + `SPEC_TEXT_REQUIRED_PREFIX` (`/agent-os:shape-spec`) to validate the assembled TEST spec body.

**`architecture-model-service/.../GeneratedMigrationBookOfWorkService.java` (`persistOne` + write-back) + `WorkItemService`/`WorkItemEntity`/`WorkItemController`**
- `persistOne` (single WorkItem create with `type`, `parentId`, `sortOrder`, `status`) + the `workItemId` stamp back into `book_of_work_json` (+ `saveState`) inside one transaction — the model for a sibling that surfaces in the tree; the `items/append` endpoint is the atomic blob-merge precedent.
- `TEST` already allowed; loose `validateParentRelationship`; single-POST create today (a per-item loop or new batch step is needed).

**`frontend/.../MigrationDeliveryHierarchyTree.tsx` + `MigrationDeliveryDashboard.tsx` + `MigrationDeliveryGenerateAllDialog.tsx`; `ProductView/BacklogTab.tsx`**
- The tree, the Generate-All trigger (`setGenerateAllOpen` / `handleGenerateAllConfirm`), and the badge/chip + `pruneHierarchy` filter pattern — the model for the per-node action surface and the TEST chip/filter.
- `BacklogTab` `onDefineIntegrationTests` (line 68–73) is the entry point to re-point to the new headless flow.

## Out of Scope
- Per-story unit/functional tests (Spec 1).
- The Migrate button + Driver + external shape-spec auto-answerer that IMPLEMENTS the TEST items (writes the test code) — Spec 3.
- Verification execution of the TEST items — Spec 4.
- Migrate-loop EXECUTION sequencing of TEST items after their covered children — Spec 3 (the sequencing handler has no TEST awareness and is not changed here).
- Any new Liquibase changeset (default expectation: none; coordinate numbering with Spec 1 ONLY if a TEST-specific column proves unavoidable).
- Any new WorkItem sub-type column, enum, or `type` constraint change (`TEST` is already allowed).
- Reuse of Spec 1's per-story migration-context fetch / the six mappings/baselines/contracts context types for the TEST spec body.
- Changing the interactive `test_planning_holistic` chat phase behaviour (it remains; this spec adds a separate headless path).
