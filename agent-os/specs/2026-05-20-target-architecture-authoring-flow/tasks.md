# Task Breakdown: Target Architecture Authoring Flow

## Overview
Total Task Groups: 10

This breakdown sequences persistence first, then service code, then gateway, then frontend, with cross-cutting test gap-fill at the end. Foundation work (Group 1) is strictly first; Groups 2-4 are AMS-internal and must land before gateway proxying (Group 5); gateway must land before the frontend (Groups 6-8); the migration delivery dashboard integration (Group 9) needs the stale-mark pipeline live; and Group 10 closes test coverage gaps across layers.

Cross-spec coupling note: `MigrationStorySpecGenerationEntity` from the cross-story-context spec is treated as STABLE. Only additive Liquibase changesets touch it.

## Task List

### Database Layer

#### Task Group 1: Schema Foundations (Liquibase changesets + JPA boxed fields)
**Dependencies:** None

- [x] 1.0 Land all new persistence shape before any service / endpoint code reads or writes it
  - [x] 1.1 Write 2-8 focused tests for the new schema
    - Test 1: `architecture` row with `draft_state='active'` and `kind='current'` is the default on insert (backfill smoke test).
    - Test 2: CHECK constraint on `draft_state` rejects an invalid value (e.g., `archived`).
    - Test 3: CHECK constraint on `architecture.kind` rejects an invalid value.
    - Test 4: `migration_story_spec_generations.stale` defaults to NULL (not false) so PATCH preserves null per `feedback project_primitive_double_dto_overwrite.md`.
    - Test 5: New index `(project_id, stale)` exists and is used by the dashboard count query (EXPLAIN or repository-level assertion).
    - Limit to 5 tests; do not exhaustively probe every constraint.
  - [x] 1.2 Add `draft_state` and `kind` columns on `architecture`
    - One new changeset file per change (never edit applied Liquibase changesets per `feedback_liquibase_immutable_changesets.md`).
    - `draft_state` VARCHAR, CHECK in (`active`, `draft`), default `active` on insert, NOT NULL after backfill.
    - `kind` VARCHAR, CHECK in (`current`, `target`), default `current` on insert, NOT NULL after backfill.
    - Idempotent backfill: existing imported-target rows (detected via existing import metadata) are stamped `kind='target'`; all others `kind='current'`.
  - [x] 1.3 Add `provenance` and `decommissioning_status` columns on every architecture element supertype table
    - Identify tables: component, API, data entity, infrastructure element.
    - `provenance` VARCHAR, nullable, CHECK in (`cloned-from`, `imported`, `user-authored`, `llm-suggested`).
    - `decommissioning_status` VARCHAR, nullable, CHECK in (`not-applicable`, `proposed`, `decommissioned`).
    - Defaults applied only on insert; never overwrite existing rows.
  - [x] 1.4 Add `stale` BOOLEAN + `stale_marked_at` TIMESTAMPTZ on `migration_story_spec_generations`
    - Both nullable (boxed `Boolean` / `Instant` on the JPA entity, NEVER primitives).
    - New index `(project_id, stale)` for dashboard count.
    - Treat this table as additive-only; existing tests must not need changes.
  - [x] 1.5 Update JPA entities to expose new fields as boxed types
    - `ArchitectureEntity`: `String draftState`, `String kind`.
    - Element entities: `String provenance`, `String decommissioningStatus`.
    - `MigrationStorySpecGenerationEntity`: `Boolean stale`, `Instant staleMarkedAt`.
  - [x] 1.6 Ensure schema-foundation tests pass
    - Run ONLY the tests written in 1.1.
    - Run Liquibase update against H2 and Postgres test profiles.
    - Do NOT run the entire suite at this stage.

**Acceptance Criteria:**
- The 5 schema tests from 1.1 pass.
- All new fields are boxed reference types on the JPA layer.
- Backfill flips the prior imported-target row to `kind='target'` idempotently.
- No applied Liquibase changeset was edited.

### AMS Service Layer

#### Task Group 2: Seeding Service (clone-current / blank / from-template)
**Dependencies:** Task Group 1

- [x] 2.0 Land the target-architecture seeding service before any authoring UI consumes it
  - [x] 2.1 Write 2-8 focused tests for seeding
    - Test 1: `clone-current` produces a new architecture with `kind='target'`, `draft_state='draft'`, and exactly N elements where N = source element count; every cloned element has `provenance='cloned-from'`.
    - Test 2: `clone-current` auto-creates `mapping_type='equivalent'` rows in `architecture_element_mappings` with `confidence=1.0` and `createdByTask='target-arch-seed-clone'`.
    - Test 3: `blank` produces an empty target architecture (no elements, no mappings) with correct `kind` and `draft_state`.
    - Test 4: `from-template` returns 501 in v1 when no template registry exists, with a clean error envelope so the UI can render a disabled-tooltip state.
    - Limit to 4 tests.
  - [x] 2.2 Wrap `ArchitectureCloneService.cloneArchitecture` for clone-current mode
    - Thin wrapper; do NOT reimplement cloning.
    - After the underlying clone returns, stamp every copied element with `provenance='cloned-from'` and a back-reference to the source element id.
    - Auto-create the equivalent mappings in `architecture_element_mappings`.
  - [x] 2.3 Implement blank-mode seeding
    - Insert the architecture row with `kind='target'`, `draft_state='draft'`, no children.
  - [x] 2.4 Stub from-template mode
    - Endpoint contract is wired (accepts `templateId`); returns 501 with the AMS-standard error envelope.
    - Do NOT scaffold a template registry; it is out of scope.
  - [x] 2.5 Auto-name the new draft
    - Default to "Draft YYYY-MM-DD #n" (project-scoped #n increments) or "Draft from LLM suggest" when called by the LLM task.
    - Inline-editable later via the standard architecture PATCH.
  - [x] 2.6 Ensure seeding-service tests pass
    - Run ONLY the tests written in 2.1.

**Acceptance Criteria:**
- The 4 seeding tests from 2.1 pass.
- Clone-current reuses `ArchitectureCloneService` verbatim (no parallel clone path).
- Blank and from-template behave per spec.

#### Task Group 3: Stale-Marking + Promote + Unmapped-Elements Pipelines
**Dependencies:** Task Groups 1, 2

- [x] 3.0 Land the AMS-side staleness, promotion, and unmapped-elements logic before any frontend uses it
  - [x] 3.1 Write 2-8 focused tests for stale-marking, promote, and unmapped-elements
    - Test 1: `mark-stale` flips `stale=true` and stamps `stale_marked_at` on every `MigrationStorySpecGenerationEntity` whose `focused_context_refs_json.architecture_element_ids` intersects the changed-element set; idempotent on second call.
    - Test 2: `mark-stale` ALSO catches rows referencing changed elements transitively via `mapping_refs`.
    - Test 3: `promote` flips the chosen draft to `draft_state='active'`, demotes the prior active to `draft_state='draft'` and renames it with the " (superseded YYYY-MM-DD)" suffix.
    - Test 4: `promote` returns an impact-preview count BEFORE transitioning, and the preview matches the actual marked-stale count after the transition.
    - Test 5: `delete` returns 409 when called on an architecture whose `draft_state='active'`.
    - Test 6: `unmapped-current-elements` returns exactly the LEFT JOIN gap (current elements with no mapping into the active target).
    - Test 7: Draft edits never invoke `mark-stale` (regression).
    - Limit to 7 tests.
  - [x] 3.2 Implement `POST /api/projects/{projectId}/specs/mark-stale`
    - Body `{ activeTargetArchId, changedElementIds[] }`.
    - Single AMS-side join query against `migration_story_spec_generations.focused_context_refs_json`.
    - Idempotent; second call on the same set is a no-op for already-stale rows but updates `stale_marked_at`.
  - [x] 3.3 Implement `POST /api/projects/{projectId}/target-architectures/{targetArchId}/promote`
    - Compute impact preview (covered specs count) BEFORE transition.
    - Transition: chosen draft -> `active`; prior active -> `draft` + renamed.
    - Invoke `mark-stale` against every element id present in the new active.
    - Return the impact-preview count in the response so the UI confirm modal can render it.
  - [x] 3.4 Implement `DELETE /api/projects/{projectId}/target-architectures/{targetArchId}`
    - Soft-delete via `archived=true`.
    - 409 if `draft_state='active'`.
  - [x] 3.5 Implement `GET /api/projects/{projectId}/target-architectures`
    - Returns every `kind='target'` row, active-first then most-recent.
  - [x] 3.6 Implement `GET /api/projects/{projectId}/architectures/{archId}/unmapped-current-elements`
    - LEFT JOIN current elements against active-target mappings; return the gap.
  - [x] 3.7 Implement active-target debounce field
    - `last_marked_stale_at` TIMESTAMPTZ on the architecture row (additive changeset).
    - Save path on the active target consults this stamp; if the gap is < N seconds (default 5s, fixed in v1), skip the stale-mark; else fire it.
    - Document this decision in the AMS-side handler header comment so future readers see why frontend coordination is unnecessary.
  - [x] 3.8 Ensure stale-mark / promote / unmapped tests pass
    - Run ONLY the tests written in 3.1.

**Acceptance Criteria:**
- The 7 tests from 3.1 pass.
- Promote returns an accurate impact preview computed before the transition.
- Server-side debounce avoids stale-mark storms.
- Draft edits never propagate staleness.

#### Task Group 4: Decommissioning + Mapping-Suggest Read Path
**Dependencies:** Task Groups 1, 2

- [x] 4.0 Land the decommissioning write path and mapping-suggest read-only endpoint
  - [x] 4.1 Write 2-8 focused tests for decommissioning + mapping-suggest contract
    - Test 1: "Mark decommissioned" on a current-architecture element writes a NEW target-side row with `provenance='user-authored'`, `decommissioning_status='decommissioned'`, plus an `architecture_element_mappings` row with `mapping_type='decommissioned'` and `createdByTask='unmapped-panel-mark-decom'`.
    - Test 2: Derived "decommissioned in target" annotation surfaces on a current element when it has no active-target mapping.
    - Test 3: Derived annotation surfaces when every mapping points at a target element with `decommissioning_status='decommissioned'`.
    - Test 4: `mapping-suggest` is read-only (no row mutations); persistence assertion across before/after.
    - Limit to 4 tests.
  - [x] 4.2 Implement decommissioning write path
    - New service method invoked from the unmapped-elements panel via a dedicated AMS endpoint or as part of the architecture-element write controller (whichever matches the existing pattern).
    - Atomically inserts the target-side row and the mapping row.
  - [x] 4.3 Implement derived current-side "decommissioned in target" annotation
    - Compute at read time on element fetch for the current architecture when an active target exists.
    - Two conditions: (a) no mapping to active target, OR (b) every mapping points at a decommissioned target element.
  - [x] 4.4 Implement `POST /api/projects/{projectId}/architectures/{archId}/mapping-suggest` AMS-side stub
    - AMS endpoint accepts `{ targetElementId, targetElementSnapshot }`; persists nothing.
    - LLM call itself lives in gateway (Group 5); AMS endpoint exists only to host the contract on the AMS side IF the project pattern requires it. If the established pattern places the LLM-touching endpoint entirely in gateway, this sub-task collapses to "no AMS code change" -- document the decision in the endpoint header.
  - [x] 4.5 Ensure decommissioning + mapping-suggest tests pass
    - Run ONLY the tests written in 4.1.

**Acceptance Criteria:**
- The 4 tests from 4.1 pass.
- Decommissioning is target-side only; current-side stays clean.
- Mapping-suggest never mutates rows.

### Gateway Layer

#### Task Group 5: Gateway Proxy Routes + LLM Tasks
**Dependencies:** Task Groups 2, 3, 4

- [x] 5.0 Wire every new AMS endpoint through the gateway and host the two LLM calls
  - [x] 5.1 Write 2-8 focused tests for the gateway layer
    - Test 1: `target-architectures/seed` (each mode) proxies through to AMS unchanged and returns the AMS body verbatim.
    - Test 2: `mapping-suggest` calls the LLM with a bounded payload (current architecture element index trimmed to id+name+type only) and returns top-3 candidates.
    - Test 3: `product-manager--suggest-target-architecture` task assembles focused-context, calls the LLM with a fixed token envelope, parses the JSON response, POSTs `seed` (mode=blank) then inserts each element with `provenance='llm-suggested'`.
    - Test 4: Active-target debounce: 5 saves within 5s produce exactly 1 `mark-stale` call (fake timers).
    - Test 5: Draft saves never call `mark-stale` (regression).
    - Limit to 5 tests.
  - [x] 5.2 Add proxy routes for all new AMS endpoints
    - Follow the selective-copy proxy pattern in `gateway/src/routes/architectures.ts` (around L537-600).
    - Endpoints: `target-architectures/seed`, `target-architectures/{id}/promote`, `target-architectures/{id}` (DELETE), `target-architectures` (GET), `architectures/{archId}/unmapped-current-elements`, `architectures/{archId}/mapping-suggest`, `specs/mark-stale`.
  - [x] 5.3 Implement `mapping-suggest` LLM call
    - Small / fast prompt; bounded payload (id+name+type for the current-element index).
    - Returns top-3 candidate current-element ids with confidence + one-sentence rationale.
    - Read-only; never POSTs to AMS.
  - [x] 5.4 Implement `product-manager--suggest-target-architecture` task in `gateway/src/routes/chatV2.ts`
    - Mirror the `product-manager--roadmap` / `product-manager--backlog` block.
    - One-shot, non-conversational.
    - Focused-context bundle: current architecture + discovery findings + active mappings + API baselines.
    - Fixed token envelope chosen at implementation time (no UI knob per Q9).
    - Parse JSON response into a draft architecture payload.
    - POST `target-architectures/seed` with mode=blank, then insert each element via the existing element-create routes, stamping `provenance='llm-suggested'`.
  - [x] 5.5 Confirm the debounce decision lives in AMS, not gateway
    - Per spec direction: AMS-side debounce via `last_marked_stale_at` is the durable choice.
    - The gateway proxy passes saves straight through. If a stop-gap in-memory debounce buffer is needed during rollout, document it as transitional with a TODO to remove once AMS-side debounce is verified.
  - [x] 5.6 Ensure gateway tests pass
    - Run ONLY the tests written in 5.1.

**Acceptance Criteria:**
- The 5 tests from 5.1 pass.
- All AMS endpoints reachable via gateway with the established pass-through shape.
- Two LLM calls live: `mapping-suggest` and `product-manager--suggest-target-architecture`.
- Debounce decision documented.

### Frontend Layer

#### Task Group 6: Target-Architecture Workspace Shell + Drafts Panel + Table Editor
**Dependencies:** Task Group 5

- [x] 6.0 Land the authoring workspace shell, drafts panel, and core table editor
  - [x] 6.1 Write 2-8 focused tests for shell + drafts + table editor
    - Test 1: New "Target Architecture" tab renders as a peer to the current-architecture view, reachable from both the workspace tabs and the dashboard "Author target" button.
    - Test 2: Drafts panel lists every `kind='target'` row, active-first then most-recent, with the auto-name format ("Draft YYYY-MM-DD #n" / "Draft from LLM suggest").
    - Test 3: Draft name is inline-editable in the drafts panel; never blocked by a "name your draft" modal.
    - Test 4: Table editor renders rows grouped by element type (component / API / data entity / infrastructure).
    - Test 5: Every successful target-architecture mutation dispatches `LOAD_MODEL` (same-arch) per `project_appshell_model_cache.md`.
    - Test 6: Seed dialog exposes `clone-current` (default), `blank`, and `from-template` (disabled tooltip when 501).
    - Limit to 6 tests.
  - [x] 6.2 Build the workspace shell
    - New top-level tab; same component reachable from the dashboard "Author target" button.
    - NOT nested under the current-architecture view.
  - [x] 6.3 Build the drafts panel
    - List, auto-name format, inline-rename, view, delete (with 409 active-rejection surfaced).
  - [x] 6.4 Build the table editor
    - Rows grouped by element type.
    - Inline edit per row (no modal for editing).
    - Provenance and decommissioning_status columns on the target side.
  - [x] 6.5 Build the seed dialog
    - `clone-current` as default; `blank`; `from-template` as disabled with explanatory tooltip when the v1 501 is returned.
  - [x] 6.6 Wire AppShell model cache invalidation on every mutation
    - `LOAD_MODEL` (same-arch) or invalidate cache (cross-arch) per `project_appshell_model_cache.md`.
  - [x] 6.7 Ensure shell + drafts + table editor tests pass
    - Run ONLY the tests written in 6.1.

**Acceptance Criteria:**
- The 6 tests from 6.1 pass.
- Workspace tab + dashboard entry both reach the same component.
- Auto-named drafts inline-editable; 409-on-delete-active surfaced cleanly.

#### Task Group 7: Add-Element Inline Expansion + Unmapped-Elements Panel + Promote Modal
**Dependencies:** Task Group 6

- [x] 7.0 Land the add-element mapping picker, unmapped-elements panel, and promote-to-active modal
  - [x] 7.1 Write 2-8 focused tests for these three interactions
    - Test 1: Add-new-element opens an inline row expansion (NOT a modal) with the mapping picker showing "replaces current element X" / "brand-new" / "no current equivalent".
    - Test 2: LLM mapping hint chip displays when `mapping-suggest` returns candidates, but the suggestion is never auto-applied -- the user must click to accept.
    - Test 3: Save is gated on a mapping choice; an unmapped save never persists.
    - Test 4: Unmapped-elements panel lists the LEFT JOIN gap returned by AMS; the "mark decommissioned" action writes the target-side row + mapping in one click.
    - Test 5: Promote-to-active opens a single confirm modal showing the impact-preview line ("This will mark N specs stale") fetched from the promote endpoint BEFORE the user confirms.
    - Test 6: Confirming the promote modal commits the transition; cancelling closes the modal with no AMS call.
    - Limit to 6 tests.
  - [x] 7.2 Build the add-element inline expansion
    - Mapping picker with three options.
    - LLM hint chip; user-accept-required (never auto-apply).
    - Save disabled until mapping choice is made.
  - [x] 7.3 Build the unmapped-elements panel
    - Right-side panel in the workspace.
    - Inline "mark decommissioned" + "add mapping" actions.
    - "Mark decommissioned" hits the AMS write path from Task Group 4.
  - [x] 7.4 Build the promote-to-active confirm modal
    - Fetches impact preview from the promote endpoint with a dry-run flag (or uses the preview-then-commit shape returned by Task Group 3).
    - Single confirm; no undo toast; no wizard.
  - [x] 7.5 Ensure these interaction tests pass
    - Run ONLY the tests written in 7.1.

**Acceptance Criteria:**
- The 6 tests from 7.1 pass.
- LLM hint never auto-applies.
- Unmapped panel's "mark decommissioned" writes the target row + mapping atomically.
- Promote modal shows the impact preview before commit.

#### Task Group 8: LLM "Suggest target architecture" Button + Read-Only Diagram + Compare View
**Dependencies:** Task Groups 5, 6

- [x] 8.0 Land the LLM one-shot suggest, the read-only target diagram, and the stacked-rows compare view
  - [x] 8.1 Write 2-8 focused tests for the LLM button + diagram + compare view
    - Test 1: "Suggest target architecture from current" button invokes the gateway task and opens the resulting auto-named draft ("Draft from LLM suggest").
    - Test 2: LLM-produced elements carry `provenance='llm-suggested'`.
    - Test 3: Read-only diagram view renders below the table from the existing diagram pipeline; no editing affordances.
    - Test 4: Compare view renders stacked rows (current element | mapping | target element) grouped by element type, with provenance + decommissioning columns on the target side.
    - Test 5: Compare view has NO visual side-by-side diagrams (deferred per Q6).
    - Limit to 5 tests.
  - [x] 8.2 Build the "Suggest target architecture" button
    - Lives on the drafts panel.
    - Calls `product-manager--suggest-target-architecture` task.
    - Opens the resulting draft.
  - [x] 8.3 Embed the read-only diagram view
    - Reuse the existing diagram pipeline.
    - Rendered below the table; no editing affordances.
  - [x] 8.4 Build the stacked-rows compare view
    - Each row: (current element, mapping, target element).
    - Grouped by element type.
    - Provenance + decommissioning columns on target side.
    - NO visual side-by-side diagrams.
  - [x] 8.5 Ensure LLM + diagram + compare tests pass
    - Run ONLY the tests written in 8.1.

**Acceptance Criteria:**
- The 5 tests from 8.1 pass.
- LLM-produced draft is auto-named and carries `provenance='llm-suggested'`.
- Compare view is table-only.

### Migration Delivery Dashboard Integration

#### Task Group 9: Stale-Spec Card + Filter Chip + Regenerate Action
**Dependencies:** Task Groups 3, 5, 7

- [x] 9.0 Surface stale specs on the existing migration delivery dashboard
  - [x] 9.1 Write 2-8 focused tests for dashboard integration
    - Test 1: New summary card in `MigrationDeliverySummaryCards.tsx` shows the count from `migration_story_spec_generations WHERE stale=true`, using the new `(project_id, stale)` index path.
    - Test 2: `MigrationDeliveryNeedsAttentionPanel.tsx` filter chip set includes "Stale (target arch changed)".
    - Test 3: "Regenerate stale specs" action invokes the existing batch generation entrypoint pre-filtered to `stale=true`.
    - Test 4: After successful regeneration, the entity's `stale` clears (and `stale_marked_at` reset behaviour matches the AMS contract).
    - Limit to 4 tests.
  - [x] 9.2 Add the stale-spec count card
    - Wire to the GET query that uses the `(project_id, stale)` index.
  - [x] 9.3 Extend the filter chip set
    - Add "Stale (target arch changed)".
  - [x] 9.4 Wire the "Regenerate stale specs" action
    - Reuse the existing batch generation entrypoint; pre-filter the input list to `stale=true`.
    - Never auto-trigger; user-initiated only.
  - [x] 9.5 Ensure dashboard tests pass
    - Run ONLY the tests written in 9.1.

**Acceptance Criteria:**
- The 4 tests from 9.1 pass.
- Dashboard surfaces the stale count + filter chip + regenerate action.
- Regeneration clears the stale flag.

### Testing

#### Task Group 10: Cross-Layer Test Review and Gap Fill
**Dependencies:** Task Groups 1-9

- [x] 10.0 Review existing tests and fill critical gaps only
  - [x] 10.1 Review tests from Task Groups 1-9
    - Schema (5), seeding (4), stale/promote/unmapped (7), decommissioning + mapping-suggest (4), gateway (5), workspace shell + table (6), add-element + unmapped panel + promote (6), LLM + diagram + compare (5), dashboard (4) -> approximately 46 tests in place.
  - [x] 10.2 Analyze test-coverage gaps for THIS feature only
    - Focus ONLY on this spec's feature requirements.
    - Critical gap candidates: (a) end-to-end stale-fires-on-promote across all three layers, (b) end-to-end stale-debounce on active-target save across all three layers, (c) draft-edit regression (no stale fired) across layers, (d) decommissioning-row write-then-derived-current-annotation round trip, (e) promote-modal impact-preview number equals post-confirm stale-mark count.
    - Do NOT assess application-wide coverage; do NOT add edge-case / performance / accessibility tests unless business-critical.
  - [x] 10.3 Write up to 10 additional strategic tests maximum
    - Cap at 10 tests.
    - Prioritize the five candidates listed in 10.2; trim from there.
    - Skip exhaustive coverage of all scenarios.
  - [x] 10.4 Run feature-specific tests only
    - Run ONLY tests related to this spec (everything written in 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, 8.1, 9.1, and 10.3).
    - Expected total: approximately 46-56 tests.
    - Do NOT run the entire application test suite.

**Acceptance Criteria:**
- All feature-specific tests pass (~46-56 tests total).
- The five critical end-to-end behaviours listed in 10.2 have at least one explicit test each.
- No more than 10 additional tests added.
- Testing scoped exclusively to this spec.

## Execution Order

Recommended implementation sequence:
1. Schema Foundations (Task Group 1)
2. Seeding Service (Task Group 2)
3. Stale-Marking + Promote + Unmapped-Elements (Task Group 3) -- can begin once Group 1 lands; Group 2 only required for the promote-against-a-seeded-draft test
4. Decommissioning + Mapping-Suggest Read Path (Task Group 4) -- parallelizable with Group 3
5. Gateway Proxy Routes + LLM Tasks (Task Group 5)
6. Frontend Workspace Shell + Drafts Panel + Table Editor (Task Group 6)
7. Add-Element Inline Expansion + Unmapped-Elements Panel + Promote Modal (Task Group 7)
8. LLM Suggest Button + Diagram + Compare View (Task Group 8) -- parallelizable with Group 7 once Group 6 lands
9. Migration Delivery Dashboard Integration (Task Group 9)
10. Cross-Layer Test Review and Gap Fill (Task Group 10)
