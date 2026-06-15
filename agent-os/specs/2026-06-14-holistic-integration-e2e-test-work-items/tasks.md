# Task Breakdown: Holistic Integration/E2E TEST Work Items (Spec 2 of 4)

## Overview
Total Tasks: 5 task groups

This spec REUSES Spec 1's just-built seams and adds NO new Liquibase changeset (D7):
- changeset 181 columns `structured_tests_json` / `covered_endpoint_ids` (already applied; entity fields present).
- `migrationImplementReadyState.ts`: `buildPersistedImplementStateLiteral`, `buildTestPlannerResponseFromTests`, `ImplementStatePutter` / `defaultPutImplementState`.
- `specGenerationResponseValidator.ts`: `assertSpecGenerationResponse`, `SPEC_TEXT_REQUIRED_PREFIX = '/agent-os:shape-spec'`.
- `migrationShapeSpecGenerationHandler.ts`: the headless batch PATTERN (`runShapeSpecGenerationBatch`, `ShapeSpecGenerationDeps` DI seams, per-item failure isolation, `[diag-gateway]` logs, `toAmsWireShape`, `defaultPersistBatchResults` POSTing `/spec-generations/batch`).
- AMS `GeneratedMigrationBookOfWorkService.persistOne` + the `workItemId` / `saveState="saved"` write-back inside one transaction + the `items/append` atomic blob-merge precedent.

Groups are ordered by dependency: Gateway holistic handler foundation (1) -> Gateway TEST-item creation + per-item spec + implement-state (2) -> AMS support if needed (3) -> Frontend per-node action + chip/filter (4) -> Final strategic gap tests (5).

## Task List

### Gateway Holistic Review Foundation

#### Task Group 1: Generalize holistic prompt + new headless holistic-review handler
**Dependencies:** None (reuses already-built Spec 1 seams)

- [x] 1.0 Generalize the holistic prompt to feature|epic and add the headless holistic-review handler
  - [x] 1.1 Write 2-8 focused tests for the generalized prompt + the headless handler skeleton
    - Limit to 2-8 highly focused tests maximum
    - Cover only critical behaviours: (a) `buildHolisticTestPlanningPrompt` emits level-relative nouns + `### Feature N` headings at EPIC level and `### Story N` at FEATURE level; (b) the new handler gathers spec-complete children, calls the LLM via the generalized prompt (mock LLM), and returns parsed `testPlan[]`; (c) per-item failure isolation — one child/LLM failure does not abort the batch; (d) ALLOW-WITH-WARNING — a child in `insufficient_context` / not-yet-generated is skipped + listed in a warning, never blocks
    - Use the gateway LLM-guard and `architectureModelClientMock` helpers (NEVER hit a live LLM)
    - Skip exhaustive coverage of all prompt strings and all error permutations
  - [x] 1.2 Generalize `gateway/src/services/holisticTestPlanningPrompt.ts` (purely textual)
    - Make `IMPLEMENT_HOLISTIC_TEST_PLANNING_PROMPT_TEMPLATE` nouns level-relative: "a {feature|epic} and all its {stories|features}"; "review each {story|feature} individually... now review ALL {stories|features} together at the {feature|epic} level"
    - Change `formatStorySpec`'s `### Story ${index + 1}` heading to `### {Story|Feature} ${index + 1}` driven by the level
    - Keep `StorySpecSummary` and `buildHolisticTestPlanningPrompt` signatures unchanged in shape (add a level param threaded to the headings; at EPIC level the array elements are the epic's FEATURES' specs)
    - Preserve the output contract verbatim: VALID JSON ONLY `{ schemaVersion:"1.0", message, testPlan:[{title,description,type}], openQuestions:[] }`; `type` MUST be `integration` or `e2e` (never `unit`/`functional`); `testPlan` MAY be empty (no fabrication)
  - [x] 1.3 Add the NEW headless holistic-review handler (new gateway service module)
    - Model on `migrationShapeSpecGenerationHandler.ts` `runShapeSpecGenerationBatch`: dependency-injection seams (mirroring `ShapeSpecGenerationDeps`), per-item failure isolation, structured `[diag-gateway]` logs
    - This is NOT the interactive `test_planning_holistic` chat phase; the `ImplementationAssistantPanel.triggerHolisticReview` `storyResults -> storySpecs[]` mapping is a REFERENCE only for assembling `StorySpecSummary[]`
    - Input: a node selection (feature OR epic) within a book of work. Load the node's immediate children + their `migration_story_spec_generations` rows; build `StorySpecSummary[]`
    - Inject `TEST-STRATEGY.MD` from `{projectParentFolder}/agent-os/product/TEST-STRATEGY.MD` (mirror the `chat.ts` lines ~732-741 read path); tolerate a missing file (pass null)
    - Call the LLM via the generalized prompt (`defaultCallLlm`-style seam) and parse `testPlan[]`
    - Do NOT reuse `selectEligibleStories` (story-only) or `fetchMigrationSpecContext` (migration-context, story-shaped)
  - [x] 1.4 Implement ALLOW-WITH-WARNING gating inside the handler
    - Run the review over children that ARE spec-complete (`generated` / `generated_with_warnings`)
    - Collect + return a warning payload listing any children still `insufficient_context` / not-yet-generated
    - NEVER hard-block: an empty spec-complete set still returns a structured result + warning
  - [x] 1.5 Ensure Task Group 1 tests pass + typecheck
    - Run `npx tsc --noEmit` in `gateway/`
    - Run ONLY the 2-8 tests written in 1.1 (targeted jest), confirming the LLM-guard + `architectureModelClientMock` are engaged
    - Do NOT run the entire gateway suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass; `gateway` `tsc --noEmit` is clean
- The prompt runs level-relative at FEATURE (review stories) and EPIC (review features) with the output contract preserved verbatim
- The headless handler gathers spec-complete children, calls the LLM via the generalized prompt, parses `testPlan[]`, isolates per-item failures, and emits `[diag-gateway]` logs
- Gating is ALLOW-WITH-WARNING: insufficient/not-generated children are skipped + listed, never block

### Gateway TEST Work-Item Creation, Spec Assembly & Implement-State

#### Task Group 2: One TEST item per test (blob + work_item), holistic->spec row, implement-state.json
**Dependencies:** Task Group 1

- [x] 2.0 For each generated test, create ONE TEST work item with its own spec row + implement-state.json
  - [x] 2.1 Write 2-8 focused tests for TEST-item creation + spec assembly + implement-state
    - Limit to 2-8 highly focused tests maximum
    - Cover only critical behaviours: (a) ONE TEST item per generated test (N tests -> N items, never one bundle); (b) BOTH representations requested — a `book_of_work_json.items[]` blob item (`type:"TEST"`, `parentId` = the feature/epic blob item id) AND a `work_item` row, with `workItemId` stamped back onto the blob; (c) `sequenceOrder`/`sortOrder` = max spanned-child order + 1, incrementing (+1, +2, ...) for multiple TEST items; (d) the holistic->spec assembler emits a `/agent-os:shape-spec`-prefixed body that passes `assertSpecGenerationResponse`, persisted via `/spec-generations/batch` keyed on the TEST item's `work_item_id`; (e) `implement-state.json` is written for the TEST item with the right scope/Test Pack/flags; (f) empty `testPlan` -> NO items created
    - Use the gateway LLM-guard + `architectureModelClientMock`; mock the AMS persistence client
    - Skip exhaustive coverage of every field and every isolation permutation
  - [x] 2.2 Create ONE TEST work item per generated test (both representations) [D2/D3]
    - Mirror save-to-backlog `persistOne` + the `items/append`-style atomic blob-merge: write the blob item AND the `work_item` row, then stamp `workItemId` + `saveState="saved"` back onto the blob item and persist the mutated `book_of_work_json` (dashboard join is by stored `workItemId`; title-matching forbidden)
    - `type` = literal uppercase `TEST`; `status` = `PLANNED` (default created status); `parentId` = the feature node (sibling to stories) OR the epic node (sibling to features)
    - Each test is isolated — one failure marks that item and never aborts the batch (R-12 posture)
  - [x] 2.3 Compute placement / sortOrder after the last spanned child [D4]
    - `sortOrder` (and blob `sequenceOrder`) = max(child `sequenceOrder`/`sortOrder` among the feature's/epic's existing children) + 1
    - Apply an incrementing offset for multiple TEST items (+1, +2, ...)
    - This sets SIBLING display order ONLY (Migrate-loop execution sequencing is Spec 3 and is not touched)
  - [x] 2.4 Build the DEDICATED lighter holistic->spec assembler [D6]
    - Produce each TEST item's implementation-ready spec body: a canonical `/agent-os:shape-spec` test-plan body instructing Claude Code to WRITE the integration/E2E test code aligned to `TEST-STRATEGY.MD` (the test definitions are its input)
    - This is NOT Spec 1's per-story generator; DO NOT REUSE `fetchMigrationSpecContext` / the six mappings/baselines/contracts context types (a TEST item has no migration discovery context)
    - Validate the assembled body with `assertSpecGenerationResponse` + `SPEC_TEXT_REQUIRED_PREFIX` (`/agent-os:shape-spec`)
  - [x] 2.5 Persist the TEST item's spec row via the reused AMS client [D6]
    - REUSE the `migration_story_spec_generations` row schema (incl. changeset 181 `structured_tests_json` / `covered_endpoint_ids`), `toAmsWireShape`, and `defaultPersistBatchResults` POSTing `/spec-generations/batch`
    - Key the row on the TEST item's `work_item_id` (NOT NULL); leave `book_of_work_id` / `book_item_id` nullable (no uniqueness constraint on `work_item_id`)
    - Populate `structured_tests_json` from the holistic `testPlan[]` definitions
  - [x] 2.6 Write `implement-state.json` for each TEST item [D6, mirrors Spec 1 D1/D2]
    - REUSE `migrationImplementReadyState.ts`: `buildPersistedImplementStateLiteral` (+ `buildTestPlannerResponseFromTests`) and the `ImplementStatePutter` / `defaultPutImplementState` disk-write contract
    - Scope = "write these integration/E2E tests"; Test Pack = the test definitions; set `plannerReadyForSpec` and `hasTestPlan`
    - Write is best-effort/isolated (R-12 posture) — a failed implement-state write never aborts the item or the batch
  - [x] 2.7 Add the NEW gateway route for the per-feature/epic action
    - The delivery-dashboard route (`migrationDeliveryDashboard.ts`) is a thin GET/repair-orphan proxy and Generate-All is book-of-work-scoped, so add a NEW node-scoped route that invokes the Group 1 handler then runs 2.2-2.6 for each generated test
    - Return the warning payload (insufficient/not-generated children) + the created TEST-item summary so the frontend can surface both
  - [x] 2.8 Ensure Task Group 2 tests pass + typecheck
    - Run `npx tsc --noEmit` in `gateway/`
    - Run ONLY the 2-8 tests written in 2.1 (targeted jest) with the LLM-guard + `architectureModelClientMock` + mocked AMS client engaged
    - Do NOT run the entire gateway suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass; `gateway` `tsc --noEmit` is clean
- Each generated test yields exactly ONE TEST work item written as BOTH a blob item and a `work_item` row, with `workItemId` stamped back into `book_of_work_json`
- `sequenceOrder`/`sortOrder` = max spanned-child order + 1, incrementing for multiple items
- Each TEST item has a `/agent-os:shape-spec` spec row (validator-passing, keyed on its `work_item_id`) and a populated `implement-state.json`
- Empty `testPlan` creates no items; per-item failures are isolated
- No reuse of `fetchMigrationSpecContext` / the per-story migration-context types

### AMS Support (only if a real gap forces it)

#### Task Group 3: Confirm AMS permits TEST-item creation + write-back as-is (NO new changeset)
**Dependencies:** Task Group 2 (driven by what the gateway flow actually calls)

- [x] 3.0 Confirm AMS support; touch AMS ONLY if the gateway flow surfaces a real gap
  - [x] 3.1 Confirm `TEST` type + feature/epic parenting are permitted as-is (no code change expected)
    - `WorkItemService.ALLOWED_TYPES` already contains `TEST`; `validateParentRelationship` is intentionally loose (existence + same-project only), so a TEST item parented to a FEATURE (sibling to stories) or an EPIC (sibling to features) is permitted
    - Confirm `MigrationStorySpecGenerationEntity` accepts a row keyed on `work_item_id` (NOT NULL) with nullable `book_of_work_id` / `book_item_id` and no uniqueness on `work_item_id`
    - If confirmed, NO AMS code change is required for parenting/type/spec-row
  - [x] 3.2 Confirm the blob items/append + `workItemId` stamp path covers TEST siblings
    - Verify `GeneratedMigrationBookOfWorkService.persistOne` + the `workItemId` / `saveState="saved"` write-back into `book_of_work_json` (one transaction) and the `items/append` atomic blob-merge endpoint support the gateway's TEST blob-item write
    - Confirm `MigrationDeliveryDashboardService` builds the tree strictly from `book_of_work_json` and surfaces a `type:"TEST"` node (free-text `type`) joined by stored `workItemId`
    - ONLY if a real gap is found (e.g., the create/append path cannot accept the gateway's TEST payload as-is): make the MINIMAL AMS change; add a NEW Liquibase changeset ONLY if a TEST-specific column proves unavoidable (coordinate numbering with Spec 1) — default expectation is none
  - [x] 3.3 Write 2-8 focused AMS tests ONLY if AMS code was changed in 3.1/3.2
    - If no AMS code changed, SKIP this and the run step; record the confirmation instead
    - If changed: limit to 2-8 highly focused tests for the changed behaviour only
  - [x] 3.4 Ensure AMS tests pass ONLY if AMS code was changed
    - If AMS was touched: run the targeted tests via FOREGROUND `mvn` (e.g. `mvn -q -pl architecture-model-service -Dtest=<TestClass> test`); do NOT run the entire AMS suite
    - If AMS was not touched: no run needed

**Acceptance Criteria:**
- TEST type + feature/epic parenting + the `work_item_id`-keyed spec row + the blob write-back path are confirmed to work as-is
- AMS is changed ONLY if a real gap is found, and any change is minimal with NO new changeset unless truly unavoidable
- If AMS code changed, the 2-8 targeted tests pass via foreground `mvn`; otherwise the no-change confirmation is recorded

### Frontend Per-Node Action, TEST Chip & Filter

#### Task Group 4: "Define Integration/E2E Tests" node action + TEST chip + show/hide filter
**Dependencies:** Task Group 2 (the new gateway route)

- [x] 4.0 Add the per-node action, the TEST chip, and the show/hide filter
  - [x] 4.1 Write 2-8 focused tests for the action, chip, and filter
    - Limit to 2-8 highly focused tests maximum
    - Cover only critical behaviours: (a) the "Define Integration/E2E Tests" control renders on FEATURE and EPIC nodes only (not on stories/initiatives) and calls the new gateway route; (b) the ALLOW-WITH-WARNING surface shows the insufficient/not-generated child list and still lets the user proceed; (c) a `type:"TEST"` node renders the distinct TEST chip/badge; (d) the show/hide TEST filter prunes/restores TEST items in the tree and backlog
    - Use `renderWithProviders` and the frontend mock patterns; mock the new gateway call
    - Skip exhaustive coverage of every node type and every dialog state
  - [x] 4.2 Add the NEW per-node "Define Integration/E2E Tests" control [D1]
    - Model the surface on `MigrationDeliveryGenerateAllDialog` / `MigrationDeliveryHierarchyTree.tsx` / `MigrationDeliveryDashboard.tsx`, placed next to the existing Generate-All control
    - Shown on FEATURE and EPIC nodes ONLY; on activate, call the new node-scoped gateway route and render the result (created TEST items + warning payload)
  - [x] 4.3 Re-point `BacklogTab.onDefineIntegrationTests` to the new headless flow [D1]
    - Replace today's `navigate('../implement/{itemId}', { state:{ refinementMode:'holistic_only' }})` behaviour with the NEW headless flow (the interactive `test_planning_holistic` chat phase remains for other entry points; only this entry is re-pointed)
  - [x] 4.4 Surface the ALLOW-WITH-WARNING state on the trigger surface [D5(b)(c)]
    - Prominently warn + list any children still `insufficient_context` / not-yet-generated returned by the route
    - Let the user proceed (review the spec-complete children only) or close gaps and re-run
  - [x] 4.5 Render the distinct TEST chip/badge [D5(a)]
    - In the hierarchy tree (`MigrationDeliveryHierarchyTree.tsx`) and the flat backlog (`ProductBacklogPage` / `BacklogTab`), render a distinct TEST chip/badge so a `TEST` sibling is visibly distinguishable from stories/features (model on existing badge/chip styling); node `type` arrives as free-text `"TEST"` from `book_of_work_json`
  - [x] 4.6 Add the show/hide TEST filter [D5(a)]
    - Add a show/hide filter for TEST items in the tree and backlog, modelled on the existing `filterStoryWorkItemIds` / `pruneHierarchy` pruning pattern
  - [x] 4.7 Ensure Task Group 4 tests pass + typecheck + baseline
    - Run the frontend `tsc` against the established baseline (no new errors above baseline)
    - Run ONLY the 2-8 tests written in 4.1 (targeted vitest) using `renderWithProviders`
    - Do NOT run the entire frontend suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass; frontend `tsc` shows no new errors above the baseline
- The "Define Integration/E2E Tests" control appears on FEATURE/EPIC nodes only and drives the new headless gateway route; `BacklogTab.onDefineIntegrationTests` is re-pointed
- The ALLOW-WITH-WARNING list is surfaced and proceed/re-run both work
- TEST siblings render a distinct chip and can be shown/hidden via the filter in the tree and backlog

### Testing

#### Task Group 5: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 2-8 tests from Group 1 (prompt generalization + headless handler)
    - Review the 2-8 tests from Group 2 (TEST-item creation + spec row + implement-state)
    - Review the 2-8 tests from Group 3 (only if AMS was changed)
    - Review the 2-8 tests from Group 4 (node action + chip + filter)
  - [x] 5.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows that lack coverage; focus ONLY on this spec's requirements
    - Prioritize the cross-layer holistic-run -> TEST-item -> spec-row -> implement-state flow over unit gaps
    - Do NOT assess entire-application coverage
  - [x] 5.3 Write up to 10 additional strategic tests maximum (only if needed)
    - Maximum of 10 new tests to fill identified critical gaps. Prioritize:
      - Feature-level holistic run -> integration/e2e defs -> ONE TEST item per test as a SIBLING (blob item + `work_item` row, `sequenceOrder`/`sortOrder` after children) -> its `/agent-os:shape-spec` spec row + `implement-state.json` written
      - Epic-level holistic run -> same end-to-end outcome (children are the epic's features)
      - ALLOW-WITH-WARNING: a run with some `insufficient_context` children reviews only the spec-complete children, lists the skipped ones, and still creates TEST items
      - Empty-plan: when no cross-cutting tests are warranted, NO TEST items / blob items / spec rows / implement-state are created
    - Do NOT write exhaustive coverage; skip edge/performance/accessibility unless business-critical
    - Use the gateway LLM-guard + `architectureModelClientMock` and frontend `renderWithProviders` as applicable; never hit a live LLM
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY the tests for this spec (Groups 1, 2, 4, the 5.3 additions, and Group 3 if AMS changed)
    - Re-run the per-stack verification commands once for the touched stacks: gateway `npx tsc --noEmit` + targeted jest; frontend `tsc` baseline + targeted vitest; AMS targeted foreground `mvn` only if touched
    - Do NOT run the entire application test suite

**Acceptance Criteria:**
- All feature-specific tests pass across the touched stacks
- Critical user workflows for this feature are covered (feature-level + epic-level holistic run -> TEST items as siblings -> spec rows + implement-state; allow-with-warning; empty-plan no-op)
- No more than 10 additional tests were added when filling gaps
- Testing is focused exclusively on this spec's feature requirements

## Execution Order

Recommended implementation sequence:
1. Gateway Holistic Review Foundation (Task Group 1) — generalize the prompt + the headless handler
2. Gateway TEST Work-Item Creation, Spec Assembly & Implement-State (Task Group 2) — items (blob + work_item), spec rows, implement-state.json, the new route
3. AMS Support (Task Group 3) — confirm-only unless a real gap forces a minimal change (NO new changeset)
4. Frontend Per-Node Action, TEST Chip & Filter (Task Group 4) — the node action, chip, and show/hide filter
5. Test Review & Gap Analysis (Task Group 5) — up to 10 strategic end-to-end tests

## Notes on Scope (from the spec — do NOT build here)
- Per-story unit/functional tests (Spec 1).
- The Migrate button / Driver / external shape-spec auto-answerer that IMPLEMENTS the TEST items (writes the test code) — Spec 3.
- Verification execution of the TEST items — Spec 4.
- Migrate-loop EXECUTION sequencing of TEST items after their covered children — Spec 3 (sequencing handler is not changed here).
- Any new Liquibase changeset (D7 default: none; coordinate with Spec 1 ONLY if a TEST-specific column proves unavoidable).
- Any new WorkItem sub-type column, enum, or `type` constraint change (`TEST` is already allowed).
- Changing the interactive `test_planning_holistic` chat phase behaviour (it remains; only the `BacklogTab` entry point is re-pointed).
