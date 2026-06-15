# Task Breakdown: Cross-Story Context Injection for Migration Shape-Spec Generation

## Overview
Total Task Groups: 10

This feature extends the migration shape-spec batch generator with a bounded two-pass loop that injects sibling story summaries, parent epic decisions, and workstream-deduped references. Work touches three services (architecture-model-service / AMS, gateway, frontend) plus a new persistence layer for epic captured decisions.

## Task List

### Database Layer

#### Task Group 1: Persistence Migrations and Entity Extensions
**Dependencies:** None
**Service:** architecture-model-service

- [x] 1.0 Complete persistence foundation for cross-story context
  - [x] 1.1 Write 2-8 focused JUnit tests for new persistence
    - One test asserting `generation_pass` CHECK constraint rejects values other than 1 or 2
    - One test asserting `epic_captured_decisions` unique key on `(project_id, epic_work_item_id, decision_key)` (or composite uniqueness as designed)
    - One test that a pass-1 entity write round-trips `pass1_spec_text`, `budget_meta_json`, `decisions_json`, `interfaces_json`, `assumptions_json`
    - One test that PATCH semantics on `budget_meta_json` and `no_meaningful_change` do not wipe pre-existing values (per `feedback_primitive_double_dto_overwrite` lesson)
    - Skip exhaustive coverage of all column types and constraints
  - [x] 1.2 Add Liquibase changeset extending `migration_story_spec_generations`
    - New columns: `generation_pass` (smallint, NOT NULL default 1, CHECK 1..2), `pass1_spec_text` (TEXT, nullable), `pass2_changes_summary` (TEXT, nullable), `budget_meta_json` (jsonb, nullable), `no_meaningful_change` (boolean, nullable), `decisions_json` (jsonb, nullable), `interfaces_json` (jsonb, nullable), `assumptions_json` (jsonb, nullable)
    - Create as a NEW changeset file - do not edit existing applied changesets (per `feedback_liquibase_immutable_changesets`)
  - [x] 1.3 Add Liquibase changeset creating `epic_captured_decisions` table
    - Columns: `id` (PK), `project_id`, `epic_work_item_id`, `decision_key`, `decision_text`, `source` (enum: auto_extracted / user_edited / user_added), `source_spec_generation_id` (FK nullable), `status` (enum: draft / confirmed / superseded), `created_at`, `updated_at`, `last_edited_by`
    - Indexes on `(project_id, epic_work_item_id)` and on `status`
    - FK to `migration_story_spec_generations.id` on `source_spec_generation_id` (use ON DELETE SET NULL with capture-and-restore awareness per `project_pg_deferrable_set_null_action`)
  - [x] 1.4 Extend `MigrationStorySpecGenerationEntity`
    - Add boxed-type fields for all new columns (Integer/Boolean, never primitive - per `feedback_primitive_double_dto_overwrite`)
    - Reuse existing `JsonType` for the JSONB columns
    - Update equals/hashCode if affected
  - [x] 1.5 Create `EpicCapturedDecisionEntity` and repository
    - Entity with all columns, JPA annotations, JsonType where needed
    - Spring Data repository with finders: `findByProjectIdAndEpicWorkItemId`, `findByProjectIdAndEpicWorkItemIdAndStatusIn`, `findBySourceSpecGenerationId`
    - Reuse pattern from `DiscoveryFindingRepository`
  - [x] 1.6 Ensure persistence-layer tests pass
    - Run ONLY the 2-8 tests written in 1.1
    - Verify both new changesets apply cleanly against a fresh schema
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass
- Both Liquibase changesets apply cleanly on a fresh database and on the existing dev database
- Entities expose null-safe getters/setters for all new fields
- No edits made to any previously-applied changeset file

---

### Backend - AMS Context Resolver and Heading Parser

#### Task Group 2: Shape-Spec Heading Parser
**Dependencies:** Task Group 1
**Service:** architecture-model-service (parser lives in AMS write path)

- [x] 2.0 Build deterministic heading parser for shape-spec text
  - [x] 2.1 Write 2-8 focused JUnit tests for parser
    - One test extracting decisions, interfaces, and assumptions from a canonical shape-spec template
    - One test for a spec with a missing heading - parser returns empty arrays for that section and emits a warning, does NOT throw
    - One test for a spec with reordered sections - parser still finds each by heading match
    - One test that parser is invoked at write time and persists `decisions_json` / `interfaces_json` / `assumptions_json`
    - Skip exhaustive edge-case coverage of every possible markdown variant
  - [x] 2.2 Implement `ShapeSpecHeadingParser` as a deterministic regex/heading extractor
    - Anchored to the stable headings documented in `gateway/src/config/prompts/product-manager.migration-shape-spec-generation.task.md`
    - Returns `{ decisions: string[], interfaces: string[], assumptions: string[], warnings: string[] }`
    - No LLM call - pure string processing
  - [x] 2.3 Invoke parser at AMS persistence write time
    - In the AMS controller/service that handles the gateway POST of a generated spec, call the parser
    - Populate `decisions_json`, `interfaces_json`, `assumptions_json` on the entity before save
    - On parser warnings, append to `warnings_json` with kind `parser_missing_heading` (or similar)
    - Parser failure must NEVER block persistence of the spec text itself
  - [x] 2.4 Ensure parser tests pass
    - Run ONLY the 2-8 tests written in 2.1
    - Verify parser warnings flow into `warnings_json`
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass
- Spec text is always persisted even when parser yields empty extractions
- Parser is the single canonical source for structured sibling fields - never re-parsed at read time
- Stable headings from the prompt template remain the contract

---

#### Task Group 3: AMS Migration-Spec-Context Endpoint Extensions
**Dependencies:** Task Groups 1, 2
**Service:** architecture-model-service

- [x] 3.0 Extend `MigrationSpecContextResolver` and `POST /api/projects/{projectId}/migration-spec-context`
  - [x] 3.1 Write 2-8 focused JUnit tests for resolver extensions
    - One test that `sibling_summaries[]` returns only `generation_pass = 1` rows for siblings within the same parent epic/feature
    - One test that pass-1 rows with status `failed` or `insufficient_context` are EXCLUDED from `sibling_summaries[]` even if their id appears in `passOneSpecIdsInScope[]` (loop guardrail)
    - One test for `parent_rollup` shape: epic includes capturedDecisions[], feature/initiative 1-sentence summaries
    - One test that `workstream_context` deduplicates API baselines and architecture refs across stories and records `referencedByStoryIds[]`
    - One test that `budget_meta.trimmed` records the count of sibling specs dropped and evidence refs dropped under a small `cross_story_context_token_cap`
    - One test for the tiered-trimming order: sibling specs dropped first, then evidence refs, then findings; story description / parent_rollup / epic capturedDecisions NEVER trimmed
    - Skip exhaustive permutation testing of every trim scenario
  - [x] 3.2 Add request-shape fields to the endpoint DTO
    - Optional `pass` (Integer 1 or 2)
    - Optional `passOneSpecIdsInScope[]` (List<Long>)
    - Backwards compatible: existing callers omitting these still receive today's response shape augmented with the new top-level blocks
  - [x] 3.3 Implement `buildSiblingSummaries(...)` private builder
    - Walk work-item parent chain to find siblings within same parent epic/feature
    - Load only rows where `generation_pass = 1` AND status NOT IN (failed, insufficient_context)
    - Read `decisions_json` / `interfaces_json` / `assumptions_json` directly - never re-parse text
    - Return `[{ workItemId, title, decisions[], interfaces[], assumptions[], generationPass }]`
  - [x] 3.4 Implement `buildParentRollup(...)` private builder
    - Walk parent chain: story -> feature -> epic -> initiative
    - Epic block: title + description + `capturedDecisions[]` from `epic_captured_decisions` where status IN (draft, confirmed)
    - Feature / initiative blocks: title + 1-sentence summary only
  - [x] 3.5 Implement `buildWorkstreamContext(...)` private builder
    - Aggregate API baselines and architecture refs across all stories in the batch
    - Dedupe by stable id; emit `referencedByStoryIds[]` per item
    - Returns one block per workstream, attached at top level (not per-story)
  - [x] 3.6 Implement `BudgetMetaTracker` helper
    - Tracks `used_tokens`, `max_tokens` (from project config `per_story_context_token_cap` and `cross_story_context_token_cap`)
    - Records `trimmed.sibling_specs_dropped` and `trimmed.evidence_refs_dropped` counts
    - Enforces tiered-trimming order: sibling specs by lowest relevance first, then evidence refs, then findings
    - NEVER trims story description, parent_rollup, or epic capturedDecisions
    - Emits `no_sibling_context_available` warning when cross-story budget can't fit even one sibling summary
  - [x] 3.7 Wire the four new top-level fields into the response payload
    - `sibling_summaries`, `parent_rollup`, `workstream_context`, `budget_meta`
    - Reuse existing `KNOWN_CONTEXT_TYPES` guard and `shortPrefix` log helper
    - Add `[diag-ams] spec_generation cross_story_*` log markers
  - [x] 3.8 Ensure AMS resolver tests pass
    - Run ONLY the 2-8 tests written in 3.1
    - Verify the new fields appear in the JSON response
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass
- Endpoint signature is backwards-compatible
- Resolver enforces pass-1-only sibling reads (loop guardrail surfaced at the resolver boundary)
- Tiered trimming preserves story description and parent rollup
- Failed / insufficient_context pass-1 rows never leak into sibling context

---

#### Task Group 4: Epic Captured Decisions API
**Dependencies:** Task Group 1
**Service:** architecture-model-service (can run in parallel with Task Group 3)

- [x] 4.0 Build CRUD API for epic-level captured decisions
  - [x] 4.1 Write 2-8 focused JUnit tests for the controller
    - One test for GET list returns rows filtered by project + epic
    - One test for POST creates a `user_added` row
    - One test that PATCH on an `auto_extracted` row flips `source` to `user_edited` and pins against further auto-overwrite
    - One test that DELETE removes the row and audits `last_edited_by` + `updated_at` via a separate audit channel (or soft-delete if that is the established pattern)
    - One test that only status IN (draft, confirmed) is exposed via the resolver's parent_rollup feed (cross-check)
    - Skip exhaustive permission/auth coverage if reused from existing controllers
  - [x] 4.2 Implement `EpicCapturedDecisionsController`
    - `GET /api/projects/{projectId}/epics/{epicWorkItemId}/captured-decisions` - list
    - `POST /api/projects/{projectId}/epics/{epicWorkItemId}/captured-decisions` - create (`source = user_added`)
    - `PATCH /api/projects/{projectId}/epics/{epicWorkItemId}/captured-decisions/{id}` - update (flip source to user_edited, pin)
    - `DELETE /api/projects/{projectId}/epics/{epicWorkItemId}/captured-decisions/{id}` - delete
    - Reuse pattern from existing project-scoped controllers
  - [x] 4.3 Implement service logic for source-flag transitions
    - Auto-seeded inserts carry `source = auto_extracted` and a non-null `sourceSpecGenerationId`
    - Any user PATCH/POST flips `source = user_edited` or `user_added`
    - Re-running pass 1 must NOT overwrite rows where `source IN (user_edited, user_added)` - persistence layer enforces this
  - [x] 4.4 Ensure epic-decisions controller tests pass
    - Run ONLY the 2-8 tests written in 4.1
    - Verify audit fields (`last_edited_by`, `updated_at`) populate
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass
- User-edited and user-added rows are protected from auto-overwrite by re-runs of pass 1
- Only `draft` and `confirmed` rows feed pass-2 parent rollup

---

### Backend - Gateway

#### Task Group 5: Gateway Two-Pass Orchestration and Auto-Seed Extraction
**Dependencies:** Task Groups 1, 2, 3, 4
**Service:** gateway

- [x] 5.0 Extend `migrationShapeSpecGenerationHandler` with bounded two-pass loop
  - [x] 5.1 Write 2-8 focused Jest tests for the handler
    - **Loop guardrail test:** pass 2 NEVER triggers a pass 3, even if the gateway is asked to re-run; handler refuses any third-pass request at the boundary
    - **Loop guardrail test:** pass 2 reads ONLY pass-1 outputs - assert the AMS context request payload carries `pass: 2` and `passOneSpecIdsInScope[]` populated only with pass-1 ids
    - **Loop guardrail test:** stories whose pass-1 status is `failed` or `insufficient_context` are NOT used as sibling context for other stories' pass 2 (cross-checked against resolver behaviour)
    - One test that `pass2_changes_summary` is generated and persisted alongside the pass-2 spec text
    - One test that `no_meaningful_change` flips true when pass-2 output is byte-equivalent to pass-1 after normalized whitespace compare
    - One test for the contradiction-detection signal: a sibling decision conflicting with the current spec decision appends `contradicts_sibling` to `warnings_json`
    - One test that `aligned_with_epic_decision` warning fires and bumps confidence up one notch (capped at high) when matching a confirmed epic decision
    - One test for the concurrency lock: a second concurrent batch for the same workstream is refused with a structured error
    - Skip exhaustive token-budget edge cases (those are covered at the resolver layer)
  - [x] 5.2 Wrap existing handler in a pass-1 / pass-2 loop
    - Pass 1 runs unchanged from today's behaviour
    - After pass 1 fully completes (all stories: success / failed / insufficient_context), invoke pass 2 unless the per-batch auto-run flag is OFF
    - Reuse `applyTokenBudgetCascade`, `assertSpecGenerationResponse`, story-title substring validation verbatim
    - Reuse per-story failure-isolation pattern verbatim
    - Pass 1 prompt now also receives `parent_rollup` and `workstream_context` (no sibling summaries on pass 1)
    - Pass 2 prompt receives `sibling_summaries`, `parent_rollup`, `workstream_context`
    - Emit `[diag-gateway] pm_migration_shape_spec_generation pass=1` / `pass=2` and `cross_story_*` log markers
  - [x] 5.3 Hard-cap enforcement at handler boundary
    - Refuse any caller-requested third pass with a structured error (regardless of caller intent)
    - Add a unit-level assertion that the handler's max-pass constant is 2
  - [x] 5.4 Pass-1 captured-decisions auto-seed
    - After each pass-1 spec is persisted to AMS, take its parser-extracted `decisions[]` and seed `epic_captured_decisions` rows via the new AMS endpoint
    - Each seeded row carries `source = auto_extracted`, non-null `sourceSpecGenerationId`, `status = draft`
    - Existing rows where `source IN (user_edited, user_added)` are skipped (pinned)
  - [x] 5.5 Pass-2 "what changed and why" summary generation
    - Use a small LLM call (or template-driven prompt) to produce a short summary citing the sibling spec / epic decision that caused each change
    - Persist on `pass2_changes_summary`
    - On no-meaningful-change, write a short canned message and flip `no_meaningful_change = true`
  - [x] 5.6 Contradiction detection
    - After pass-2 persist, compare its parser-extracted `decisions[]` and `interfaces[]` against relevant sibling summaries and parent rollup
    - Append `contradicts_sibling` warning entries for disagreements (`{ kind, siblingWorkItemId, conflictingDecisionKey, severity: 'review' }`)
    - Append `aligned_with_epic_decision` informational entries when matching a confirmed epic decision; bump confidence one notch (capped at high)
    - NEVER auto-rollback pass-2 output - warning only
  - [x] 5.7 Concurrency lock per workstream
    - Track active batch state per workstream (in-memory map keyed by workstream id, with pass number)
    - Refuse a second concurrent batch for the same workstream with a structured error (UI translates to banner)
    - Lock is released when batch completes or is cancelled via existing cancel flow
  - [x] 5.8 Ensure gateway handler tests pass
    - Run ONLY the 2-8 tests written in 5.1
    - Verify log markers emit
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 5.1 pass
- Hard cap at 2 passes is enforced and tested
- Pass 2 never reads pass-2 outputs - resolver + handler both enforce this
- Concurrency lock disables a second batch for the same workstream
- Manual-edit protection (`confirmOverwrite`) continues to apply at pass-2 write time

---

#### Task Group 6: Gateway Cost-Preview Endpoint and Pass-2 Prompt Variant
**Dependencies:** Task Group 5 (can be developed in parallel with 5 after 5.2 lands)
**Service:** gateway

- [x] 6.0 Build cost-preview endpoint and pass-2 prompt
  - [x] 6.1 Write 2-8 focused Jest tests
    - One test that `POST /api/migration-shape-spec/cost-preview` returns `{ estimatedTokens, estimatedWallClockSeconds, perStoryEstimates[] }` for a project + bookOfWorkId
    - One test that `includePass2 = true` roughly doubles the estimate vs `includePass2 = false`
    - One test for the configurable tokens-per-second model (changing config changes the estimate)
    - One test that the pass-2 prompt variant is selected when `pass = 2` is in the prompt context
    - Skip exhaustive token-arithmetic coverage
  - [x] 6.2 Implement `POST /api/migration-shape-spec/cost-preview`
    - Accepts `{ projectId, bookOfWorkId, includePass2 }`
    - Computes estimated tokens from the existing focused-context payload sizes (call the AMS endpoint with a `dry_run` style request, OR replicate the sizing)
    - Returns wall-clock estimate via a configurable tokens-per-second model
  - [x] 6.3 Add pass-2 prompt variant
    - Add a conditional pass-2 section to `gateway/src/config/prompts/product-manager.migration-shape-spec-generation.task.md` (or a sibling task config) that explicitly instructs the LLM to use `sibling_summaries` and `parent_rollup`
    - CRITICAL: do NOT change the spec template heading structure - the regex parser depends on stable headings
  - [x] 6.4 Ensure cost-preview tests pass
    - Run ONLY the 2-8 tests written in 6.1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 6.1 pass
- Cost-preview returns plausible numbers and respects `includePass2`
- Pass-2 prompt variant preserves spec template headings verbatim

---

### Frontend

#### Task Group 7: Frontend Pass-2 Surfaces and Inline Diff
**Dependencies:** Task Groups 3, 5
**Service:** frontend

- [x] 7.0 Extend MigrationDeliveryDashboard and StoryDrawer with pass-2 surfaces
  - [x] 7.1 Write 2-8 focused Vitest tests
    - One test that the story row renders a `Pass 2` badge when `generation_pass = 2`
    - One test that the `Pass 2: no meaningful change` badge renders when `no_meaningful_change = true` AND that the pass-2 status is NOT hidden in that case
    - One test that the inline diff view renders red/green highlights from `pass1_spec_text` vs `generated_spec_text`
    - One test that the "what changed and why" summary renders above the diff
    - One test that `contradicts_sibling` warnings render in the warnings panel with the sibling work-item id
    - One test that the budget warning ("Trimmed N sibling specs", "Trimmed M evidence refs", "no_sibling_context_available") renders inline when `budget_meta.trimmed` has non-zero counts
    - One test that the per-batch auto-run pass-2 toggle defaults to the project setting and is overrideable in the dialog
    - Skip exhaustive component-state coverage
  - [x] 7.2 Extend `MigrationDeliveryStoryDrawer`
    - Pass-2 badge (chip styling consistent with confidence/status chips)
    - No-meaningful-change badge alongside the pass-2 badge
    - Inline diff view: red/green highlights between `pass1_spec_text` and current `generated_spec_text` (use an existing diff library or a simple line-diff)
    - "What changed and why" summary block rendered above the diff from `pass2_changes_summary`
    - Contradiction warnings rendered in the existing warnings panel
    - Budget warning rendered inline using existing `MigrationDeliverySectionRetryPlaceholder` pattern
  - [x] 7.3 Extend `MigrationDeliveryDashboard`
    - "Workstream context" expandable section above the hierarchy tree
      - Lists deduped API baselines and architecture refs from `workstream_context`
      - Per-item shows `referencedByStoryIds[]` so the user sees which stories would otherwise have repeated each ref
    - Read-only collapsed summary of epic captured decisions (counts + status mix), linking to the epic detail page for full edit
    - Active-batch banner: "Batch in progress (pass 1 of 2 / pass 2 of 2)" while concurrency lock is held
  - [x] 7.4 Build the "Generate all" dialog enhancements
    - Per-batch auto-run pass-2 toggle defaulting to the project setting
    - Call `POST /api/migration-shape-spec/cost-preview` before submit and show estimated tokens + wall-clock time
    - Disable the Generate-all action when concurrency lock indicates a batch is in flight; show the banner
  - [x] 7.5 Build the post-batch summary
    - Render actual tokens and wall-clock per pass from `budget_meta_json` + handler-side timing
    - Surface the count of `no_meaningful_change` pass-2 rows and the count of `contradicts_sibling` warnings
  - [x] 7.6 Update AppShell cache invalidation
    - After pass 2 persists, dispatch LOAD_MODEL (same-arch) so the in-memory model cache surfaces the new pass-2 entities (per `project_appshell_model_cache.md`)
  - [x] 7.7 Ensure frontend pass-2 surface tests pass
    - Run ONLY the 2-8 tests written in 7.1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 7.1 pass
- All four user-visible signals render: pass-2 badge, no-meaningful-change badge, contradiction warning, budget warning
- Inline diff plus "what changed and why" summary appear in the story drawer
- Cost-preview values render in the Generate-all dialog
- Concurrency lock is reflected as a banner; Generate-all is disabled while a batch is active

---

#### Task Group 8: Epic Captured Decisions Panel
**Dependencies:** Task Group 4, Task Group 7 (for dashboard summary placement only - panel itself can build in parallel with 7)
**Service:** frontend

- [x] 8.0 Build epic-decisions edit panel and dashboard read-only summary
  - [x] 8.1 Write 2-8 focused Vitest tests
    - One test that the panel lists decisions from `GET /api/projects/{projectId}/epics/{epicWorkItemId}/captured-decisions`
    - One test that creating a new decision calls POST and refreshes the list
    - One test that editing an auto-seeded decision calls PATCH and the row's source flips to `user_edited` in the UI
    - One test that the `source: auto-extracted from spec X, unedited` chip is visible on auto-seeded rows and disappears after edit
    - One test for the read-only collapsed summary on the dashboard
    - Skip exhaustive CRUD-state coverage
  - [x] 8.2 Build the dedicated edit panel on the epic detail page
    - List view with status filter (draft / confirmed / superseded)
    - Inline edit on each row; status change to `confirmed` is a single-click action
    - Show the `source` chip prominently for auto-extracted rows (with link to source spec)
    - "Add decision" affordance creates a `user_added` row
  - [x] 8.3 Build the read-only collapsed summary on the dashboard / batch-results view
    - Renders count by status and a link to the epic detail panel
    - Reuse styling conventions from `MigrationDeliveryDashboard` cards
  - [x] 8.4 Wire up project config UI for auto-run pass-2 flag
    - Per-project setting in project config (persisted)
    - Wire to existing project-config screen if present, or add a small section
  - [x] 8.5 Ensure epic-decisions panel tests pass
    - Run ONLY the 2-8 tests written in 8.1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 8.1 pass
- Auto-seeded rows render the source chip and link back to the source spec
- User edits flip the source chip and pin the row against auto-overwrite
- Read-only summary renders on the dashboard with a link to the edit panel
- Per-project auto-run setting is editable and persists

---

### Configuration

#### Task Group 9: Project Config Fields for Budgets and Auto-Run
**Dependencies:** Task Group 1 (for storage), can run in parallel with 3, 4
**Service:** architecture-model-service + gateway + frontend (config plumbing)

- [x] 9.0 Add project-level config for token budgets and auto-run flag
  - [x] 9.1 Write 2-8 focused tests across the layers
    - One AMS test that `per_story_context_token_cap` and `cross_story_context_token_cap` are loaded by the resolver
    - One AMS test that `auto_run_pass_2` defaults to true when not set
    - One gateway test that the cost-preview honours the project's `auto_run_pass_2` and budget caps
    - One Vitest test that the project config screen edits and saves the three new fields
    - Skip exhaustive config-validation coverage
  - [x] 9.2 Add config columns or JSONB keys on the existing project-config persistence
    - `per_story_context_token_cap` (int, default 24000)
    - `cross_story_context_token_cap` (int, default 12000)
    - `auto_run_pass_2` (boolean, default true)
    - Liquibase changeset added as a NEW file
  - [x] 9.3 Wire AMS resolver to read the new caps from project config
  - [x] 9.4 Wire gateway handler + cost-preview to read `auto_run_pass_2` and treat it as the per-project default
  - [x] 9.5 Wire frontend project-config screen to edit the three fields
  - [x] 9.6 Ensure config-plumbing tests pass
    - Run ONLY the 2-8 tests written in 9.1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 9.1 pass
- Token-cap defaults are loaded by the resolver
- Auto-run flag defaults to true and is editable per project
- Per-batch toggle (from Task Group 7) correctly defaults to the project setting

---

### Testing

#### Task Group 10: Loop Guardrail Tests and Cross-Layer Gap Analysis
**Dependencies:** Task Groups 1-9

- [x] 10.0 Review existing tests and fill critical gaps focused on guardrails and end-to-end workflows
  - [x] 10.1 Review tests from Task Groups 1-9
    - Review the persistence tests from 1.1
    - Review the parser tests from 2.1
    - Review the AMS resolver tests from 3.1
    - Review the epic-decisions controller tests from 4.1
    - Review the gateway handler tests from 5.1 (especially the three loop guardrails)
    - Review the cost-preview tests from 6.1
    - Review the frontend tests from 7.1, 8.1
    - Review the config tests from 9.1
    - Total existing tests: approximately 16-64 tests across layers
  - [x] 10.2 Analyze test-coverage gaps for THIS feature only
    - Confirm explicit, named tests exist for the four required loop guardrails:
      - Hard cap: pass 2 never triggers a pass 3
      - Pass 2 reads ONLY pass-1 outputs (resolver + handler boundaries)
      - Failed / insufficient_context pass-1 stories are excluded from sibling context (resolver boundary)
      - Token-budget tiered trimming preserves story description, parent rollup, and epic capturedDecisions
    - Identify any missing end-to-end workflow tests across handler -> AMS -> persistence -> UI
    - Do NOT assess entire application test coverage
    - Skip edge-case, performance, and accessibility tests unless business-critical
  - [x] 10.3 Write up to 10 additional strategic tests maximum
    - At most one test PER missing guardrail not already covered
    - Up to a few cross-layer integration tests for the end-to-end Generate-all -> pass 1 -> pass 2 -> UI signals path
    - Skip exhaustive coverage of all branches
  - [x] 10.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, 8.1, 9.1, and 10.3)
    - Expected total: approximately 26-74 tests
    - Do NOT run the entire application test suite
    - Verify all four loop guardrails are green

**Acceptance Criteria:**
- All feature-specific tests pass
- Each of the four loop guardrails has at least one explicit, named test
- No more than 10 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1 (Persistence migrations + entities)** - foundation; blocks everything else
2. **Task Group 2 (Heading parser)** - depends on 1; runs at write time so must land before pass 1 starts persisting structured fields
3. **Task Groups 3 and 4 (AMS resolver extensions, epic-decisions API)** - depend on 1, 2; can run in parallel
4. **Task Group 9 (Project config plumbing)** - depends on 1; can run in parallel with 3, 4
5. **Task Group 5 (Gateway two-pass orchestration)** - depends on 1, 2, 3, 4 (and benefits from 9)
6. **Task Group 6 (Cost-preview + pass-2 prompt)** - can run in parallel with 5 once 5.2 has landed
7. **Task Group 7 (Frontend pass-2 surfaces)** - depends on 3, 5
8. **Task Group 8 (Epic-decisions panel)** - depends on 4; can run in parallel with most of 7
9. **Task Group 10 (Loop-guardrail and gap-analysis tests)** - depends on 1-9; final layer
