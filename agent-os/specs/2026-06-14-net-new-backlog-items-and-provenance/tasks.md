# Task Breakdown: Net-new backlog items + provenance (D5)

## Overview
Total Tasks: 5 task groups

D5 of the 6-spec discovery-completeness program. D1-D4 are BUILT (D4 = changeset 185, `source_capability_id`). D5 adds ONE column (changeset 186, `provenance`), the add-item path, description-grounded spec-gen for manual adds, and the latent `applyManualEdit` status-promotion fix. D5 only SETS the `provenance` marker; the reconcile consumer (program D6) reads it.

## Task List

### AMS Layer

#### Task Group 1: `provenance` column (changeset 186) + `applyManualEdit` status-promotion fix
**Dependencies:** None

- [x] 1.0 Complete the `provenance` column plumbing + the `applyManualEdit` fix
  - [x] 1.1 Write 2-8 focused tests for the provenance column + the applyManualEdit fix
    - Limit to 2-8 highly focused tests maximum
    - Mirror the existing `deferred`-column migration test: (a) `provenance` column exists and defaults to `'carry_over'` on a builder that omits it (`@PrePersist` mirror); (b) a null-guarded PATCH — an `updateEntityFromDto` with `provenance == null` never wipes an existing value
    - One test for the fix: `MigrationStorySpecGenerationService.applyManualEdit` PROMOTES `status` to `generated` when the supplied `specText` is non-empty (an `insufficient_context` row becomes `generated`)
    - Skip exhaustive enum-validation / all-status-transition coverage
  - [x] 1.2 Create changeset `186-work-item-provenance.sql`
    - `ALTER TABLE work_item ADD COLUMN provenance VARCHAR NOT NULL DEFAULT 'carry_over'`
    - Register AFTER `185-work-item-source-capability-id.sql` in `db.changelog-master.yaml` (185 is the highest applied on disk; its header reserves 186 for D5)
    - ONE column only; `carry_over` default means every existing/discovered row is correct with NO backfill
  - [x] 1.3 Map `provenance` on `WorkItemEntity` using the `deferred` precedent (changeset 182)
    - Boxed-friendly field defaulting to `'carry_over'`, NOT NULL column
    - `@PrePersist` mirror so a builder omitting `provenance` still inserts `'carry_over'`
    - Follow the exact shape of `WorkItemEntity.deferred`
  - [x] 1.4 Add `provenance` to `WorkItemDto` + the mapper null-guard
    - `@JsonProperty("provenance")` (snake_case wire); the record arity grows (D4 took it to 21 args)
    - Append a NEW backward-compatible positional constructor defaulting `provenance` to `'carry_over'`
    - `WorkItemMapper.updateEntityFromDto`: null-guard exactly like `deferred`/`sourceCapabilityId` — `if (dto.provenance() != null) entity.setProvenance(...)`
    - `toEntity`: default `provenance` similarly to `deferred`/`status`
  - [x] 1.5 Fix `MigrationStorySpecGenerationService.applyManualEdit` (AMS, ~lines 634-691)
    - Today it sets `generatedSpecText` + the 4 manual-edit audit columns and re-runs parser/scorer but NEVER calls `setStatus` — a hand-authored `insufficient_context` row stays un-dispatchable
    - When the supplied `specText` is non-empty, PROMOTE `status` to `generated` before save
    - Keep the existing scorer skip-rule coherent: the row is no longer `insufficient_context`/`failed` once promoted, so scoring runs normally on the now-`generated` row
    - `applyManualEdit` ownership is AMS; the gateway `manualEditSpec` caller is a pass-through and needs NO behavioural change
  - [x] 1.6 Ensure Task Group 1 tests pass
    - FOREGROUND `mvn` (H2) running ONLY the 2-8 tests from 1.1
    - Verify changeset 186 applies cleanly after 185
    - Do NOT run the entire AMS test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass
- Changeset 186 registers after 185 and applies on H2; `provenance` defaults to `'carry_over'`
- `WorkItemDto`/`WorkItemMapper` null-guard `provenance` (omitted PATCH never wipes the column)
- `applyManualEdit` promotes `status` to `generated` on non-empty hand-authored text

### AMS Layer

#### Task Group 2: Append-`*`-item AMS endpoint that stamps provenance
**Dependencies:** Task Group 1

- [x] 2.0 Complete the add-item endpoint
  - [x] 2.1 Write 2-8 focused tests for the add-item endpoint
    - Limit to 2-8 highly focused tests maximum
    - Test the round-trip: the endpoint creates a `type='story'` WorkItem, stamps `provenance` on BOTH the `work_item` column and the `book_of_work_json.items[]` blob, and the minted item is `selectEligibleStories`-eligible (blob `type === 'story'` + non-null `workItemId`)
    - Cover both `provenance` values (`carry_over` / `net_new`) at least once
    - Skip exhaustive request-validation / parent-permutation coverage
  - [x] 2.2 Add the append-`*`-item endpoint on `GeneratedMigrationBookOfWorkController`
    - Model EXACTLY on `GeneratedMigrationBookOfWorkService.appendTestItem` / `appendCapabilityStory`: create the `WorkItem` via `itemSaver.persistOne` + append the `book_of_work_json.items[]` blob (stamping `workItemId` + `saveState="saved"`) in ONE `@Transactional`
    - The minted blob item `type` is LOWERCASE `"story"` so the gateway's `selectEligibleStories` consumes it unchanged; `persistOne` uppercases `work_item.type` to `STORY`
    - Parent is optional — a manual add is a top-level story by default (like `appendCapabilityStory`)
  - [x] 2.3 Add the request DTO modelled on `AppendTestItemRequest`
    - snake_case wire: `provenance`, `kind` flavour (API vs operational/non-API), `title` (required), `description`
    - Optional parent field
  - [x] 2.4 Stamp `provenance` on the minted `work_item` row inside the same transaction
    - After `persistOne`, load the minted row by id, set `provenance`, save — mirrors how `appendCapabilityStory` back-writes `source_capability_id` to the column
    - Stamp `provenance` on the blob item too (column + blob both carry it)
    - The item carries NO `source_capability_id` and NO `discoveryFindingReferences` — this is what keeps it OUT of D4's discovered must-account set with NO gate code
  - [x] 2.5 Ensure Task Group 2 tests pass
    - FOREGROUND `mvn` (H2) running ONLY the 2-8 tests from 2.1
    - Verify the story is created, provenance is stamped on column + blob, and the item is eligible
    - Do NOT run the entire AMS test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass
- The endpoint creates a `type='story'` WorkItem + appends the blob in one transaction
- `provenance` is stamped on BOTH the column and the blob item
- The minted item is `selectEligibleStories`-eligible and carries no `source_capability_id`/finding refs

### Gateway Layer

#### Task Group 3: Description-grounded spec-gen for manual adds + add-item route
**Dependencies:** Task Groups 1-2

- [x] 3.0 Complete description-grounded spec-gen + the gateway add-item route
  - [x] 3.1 Write 2-8 focused tests for the description-grounded mode + the add-item route
    - Limit to 2-8 highly focused tests maximum; use the LLM-guard (mock `llmClient`) + architectureModelClientMock
    - Test: a manual add (API kind) runs description-grounded (the human description is the sole context, NOT the discovered-context resolver) and reaches `generated`
    - Test: a `net_new` manual add does NOT short-circuit at `insufficient_context` (the no-fab constraint is relaxed — description is authoritative)
    - Test (read-only assertion, no new code): a `net_new` spec-ready story is in `buildOrderedDispatchSet` and is NOT in D4's must-account set
    - Skip exhaustive prompt-shape / all-kind-flavour coverage
  - [x] 3.2 Add a description-grounded MODE to `migrationShapeSpecGenerationHandler`
    - The human `description` (carried on the STORY METADATA `buildStoryUserPrompt` already emits) IS the context, REPLACING the discovered-context resolver fetch
    - Use the handler's existing generator (or a thin sibling path reusing it) — do NOT fork the generator
    - `selectEligibleStories` already gates on `type === 'story'` + non-null `workItemId`; the new story qualifies unchanged
    - Manual adds NEVER route through D3's `appendCapabilityStory` / discovered operational_capability resolver path (that is for DISCOVERED capabilities only)
  - [x] 3.3 Relax the `insufficient_context` / no-fabrication short-circuit for `net_new`
    - For `net_new` the human description is the authoritative intent, not something to guess — generation proceeds to a full spec (`generated`) rather than parking at `insufficient_context`
    - Generation hydrates implement-state + the test pack the normal way
  - [x] 3.4 Make `kind` tune ONLY the prompt FLAVOUR
    - `API` → API-endpoint orientation; `operational`/non-API → operational-effect-test orientation
    - The CONTEXT is ALWAYS the description for manual adds (clean split: discovered = resolver-grounded; manual = description-grounded)
  - [x] 3.5 Add the gateway add-item handler/route
    - Calls the AMS add-item endpoint (Task Group 2), then triggers description-grounded generation for that one `workItemId`
    - Reaches `generated` + writes implement-state + the test pack
  - [x] 3.6 Confirm dispatch + D4-gate stay provenance-blind (no new code — assert via test)
    - `migrationExecutionDriver.ts` `evaluateHardBlock` / `buildOrderedDispatchSet` key on `workItemId` + spec-ready (status ∈ {generated, generated_with_warnings} + non-stale) + non-deferred, and read NO provenance → `net_new` dispatches unchanged
    - `net_new` is excluded from D4's gate PURELY by the marker; NO gate code is added beyond the marker existing
  - [x] 3.7 Ensure Task Group 3 tests pass
    - Run ONLY the 2-8 tests from 3.1 (targeted jest, LLM-guard + architectureModelClientMock)
    - Run `npx tsc --noEmit` (gateway)
    - Do NOT run the entire gateway test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass; gateway `npx tsc --noEmit` is clean
- A manual add runs description-grounded (description replaces the discovered-context resolver) and reaches `generated`
- `net_new` adds do not short-circuit at `insufficient_context`; `kind` tunes only the prompt flavour
- `net_new` dispatches unchanged and is NOT in D4's must-account set (no gate/dispatch code change)

### Frontend Layer

#### Task Group 4: Add-item form + provenance badge/filter
**Dependencies:** Task Group 3

- [x] 4.0 Complete the add-item form + the provenance badge/filter
  - [x] 4.1 Write 2-8 focused tests for the add-item form + the badge/filter
    - Limit to 2-8 highly focused tests maximum; use renderWithProviders
    - Test: the "Add work item" form renders with `provenance` choice + `kind` flavour + `title`/`description` and submits to the gateway add-item route
    - Test: the provenance badge (`net_new` / `carry_over`) renders on tree items and the provenance filter (show only `net_new` / only `carry_over` / all) filters the tree
    - Skip exhaustive field-validation / all-filter-permutation coverage
  - [x] 4.2 Build the "Add work item" action + form on the Migration Delivery Dashboard
    - ONE action on the dashboard (net-new UI — no add-work-item surface there today)
    - Reuse `WorkItemCreateModal.tsx` form patterns (validation, field layout), mounted on the dashboard
    - Fields: `provenance` (carry_over/net_new), `kind` flavour (API / operational), `title` (required), `description`
  - [x] 4.3 Wire the describe→generate trigger (PRIMARY) + the hand-author fallback field
    - On submit: call the gateway add-item route, then surface the spec-gen progress for the new item the same way existing generate flows do
    - The hand-author field is the FALLBACK that hits the `applyManualEdit` escape hatch (the now-fixed status-promotion path from Task Group 1)
    - The new story then appears in the hierarchy tree + dispatch set
  - [x] 4.4 Add the provenance badge + filter to `MigrationDeliveryHierarchyTree.tsx`
    - Provenance badge (`net_new` / `carry_over`) alongside the existing Edited/Quality chips
    - Provenance filter (show only `net_new` / only `carry_over` / all) sibling to the existing grade filter
    - NO bulk re-classify in v1
  - [x] 4.5 Ensure Task Group 4 tests pass
    - Run ONLY the 2-8 tests from 4.1 (targeted vitest, renderWithProviders)
    - Keep within the frontend tsc baseline (515)
    - Do NOT run the entire frontend test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass; frontend stays within the tsc baseline (515)
- The dashboard "Add work item" form captures provenance + kind + title/description and submits
- The describe→generate trigger surfaces spec-gen progress; the hand-author fallback is present
- The provenance badge + filter render on the hierarchy tree alongside the Edited/Quality chips + grade filter

### Testing

#### Task Group 5: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the AMS tests (Tasks 1.1 + 2.1), the gateway tests (Task 3.1), and the frontend tests (Task 4.1)
    - Total existing tests: approximately 8-32 tests
  - [x] 5.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows that lack coverage; focus ONLY on this spec's requirements
    - Do NOT assess entire-application coverage
  - [x] 5.3 Write up to 10 additional strategic tests maximum, covering the gaps below if not already covered
    - add-`net_new` (API kind) → describe→generate → `generated` spec + implement-state → dispatches in the Migrate set
    - add-`net_new` (operational kind) → effect-oriented spec (description-grounded, NOT the capability path)
    - the manual-author→promote-status fix makes a hand-authored item dispatchable
    - a `net_new` item is NOT in D4's `carry_over` must-account set (gate ignores it)
    - an undiscoverable manual `carry_over` item is added + marked `carry_over`
    - the frontend add-form + provenance badge/filter render
    - Add a MAXIMUM of 10 new tests; focus on integration points + end-to-end workflows
    - Skip edge cases / performance / accessibility unless business-critical
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to this spec across AMS (FOREGROUND mvn, H2), gateway (jest, LLM-guard + architectureModelClientMock), and frontend (vitest, renderWithProviders)
    - Expected total: approximately 18-42 tests maximum
    - Do NOT run any entire application test suite
    - Verify critical workflows pass; respect gateway `tsc --noEmit` clean + frontend tsc baseline 515

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 18-42 tests total)
- Critical workflows for D5 are covered (add net_new API/operational, hand-author promotion, D4-gate exclusion, undiscoverable carry_over, frontend form + badge/filter)
- No more than 10 additional tests added when filling gaps
- Testing focused exclusively on this spec's requirements

## Execution Order

Recommended implementation sequence:
1. AMS — `provenance` column (changeset 186) + `applyManualEdit` fix (Task Group 1)
2. AMS — append-`*`-item endpoint that stamps provenance (Task Group 2)
3. Gateway — description-grounded spec-gen for manual adds + add-item route (Task Group 3)
4. Frontend — add-item form + provenance badge/filter (Task Group 4)
5. Test Review & Gap Analysis (Task Group 5)
