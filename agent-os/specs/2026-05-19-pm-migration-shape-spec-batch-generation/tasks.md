# Task Breakdown: PM Migration Shape-Spec Batch Generation (Spec 2)

## Overview
Total Task Groups: 13
Total Tasks: ~95 (across 13 groups)

This spec adds a Product Manager task `product-manager--migration-shape-spec-generation` that consumes a saved `GeneratedMigrationBookOfWork` (Spec 1 output) plus saved `WorkItem`s plus a NEW focused-migration-context resolver and produces literal `/agent-os:shape-spec [spec details]` implementation specs in configurable batches (default 25). Each generated spec is linked to its saved `WorkItem` row with per-story status, confidence, warnings, missingInputs, evidenceRefs, and predicted-vs-actual readiness comparison preserved.

The 13 task groups are ordered Foundation -> Gateway -> AMS -> Frontend -> Docs, with explicit parallelism markers in the Execution Order section at the end. Foundation (Groups 1 and 2) is fully parallel and must land first. Gateway groups open up once Group 1's persistence path decision is recorded and Group 2's LLM-output fixtures exist. AMS groups land in parallel with Gateway. Frontend lands once Gateway + AMS contracts exist.

## Standing Constraints (apply to every group)

- Per `feedback_liquibase_immutable_changesets.md`: never edit applied Liquibase changesets. Spec 1's `139-generated-migration-books-of-work` is treated as immutable; this spec's NEW changeset id is `140` (exact filename depends on Group 1's path-decision outcome).
- Per `project_primitive_double_dto_overwrite.md`: any DTO field participating in PATCH semantics MUST be boxed (`Boolean`, `Long`, `Double`, `String`, `Map<String,Object>`, `JsonNode`) with null guards in the update handler. All JSONB-backed DTO fields in this spec are boxed `JsonNode` / `Map<String, Object>` / `String`, never primitives.
- All JSONB columns (`spec_generation_warnings_json`, `spec_generation_missing_inputs_json`, `spec_generation_focused_context_refs_json`, `spec_generation_evidence_refs_json`) use the `JsonType` Hibernate mapping precedent established in `DiscoveryRunEntity` (per `fix-hibernate-jsonb-mapping`).
- Gateway is the **sole orchestrator** for LLM generation (R-2). AMS owns persistence + the new focused-context endpoint only; there is NO AMS-side generation endpoint.
- Per-batch processing is **synchronous** (R-3); per-batch internal loop is **serial** (R-4). No token streaming in v1.
- Auth gating is **verbatim from `product-manager--migration-delivery-plan.json`** (R-11, Spec 1 task). No new role, permission flag, or gating layer is introduced.
- Per-story failure isolation (R-12): a single story's exception / validator failure / persistence failure NEVER aborts the batch. Every per-story result is persisted whenever possible (including `{ status: 'failed', errorMessage: '...' }`). When persistence itself fails, the batch response surfaces a `resultsCouldNotPersist` count plus unpersisted failure details inline.
- `not_attempted` is LAZY (A-6): no row is written until first attempt. The "not attempted" count is computed in-memory as `book_of_work_json.stories - rows-in-generations-table`.
- `skipped_blocked` is only reachable when the explicit "Skip blocked stories" UI toggle is ON (R-6, default OFF).
- Re-run idempotency (R-8): default re-run skips rows already at `status='generated'`. Explicit "Regenerate all (including generated)" toggle bumps `spec_generation_attempt_number`. NEVER overwrite a manually-edited spec without explicit `confirmOverwrite=true` (acceptance signal 17).
- Reuse Spec 1's `applyTokenBudgetCascade` + `TokenBudgetOverflowError` from `gateway/src/services/migrationBookOfWorkHandler.ts` (R-5, A-3). DO NOT duplicate.
- All new structured AMS log lines use the prefix `[diag-ams] spec_generation ...`. Gateway log lines use `[diag-gateway] pm_migration_shape_spec_generation ...`. Frontend stage markers are scripted client-side.
- No standalone `.md` documentation files — all docs live as inline TSDoc/JSDoc/Javadoc headers per the standing CLAUDE.md instruction.

---

## Task List

### Foundation Layer (cross-cutting; must land before gateway/AMS/frontend work)

#### Task Group 1: AMS Persistence Path Decision + Liquibase Changeset 140
**Dependencies:** None

- [x] 1.0 Decide the spec-generation persistence path (extend-in-place vs new table), record the decision, and land the supporting changeset + entity/DTO/repo/mapper quintet
  - [x] 1.1 Inspect the existing WorkItemImplementWorkspace quintet (read-only audit)
    - Files to read (spec-writer/implementer locates via grep on `WorkItemImplementWorkspace`):
      - `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/WorkItemImplementWorkspaceEntity.java`
      - `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/ImplementWorkspaceDto.java` (or equivalent DTO)
      - `architecture-model-service/src/main/java/com/example/architecturemodel/controller/WorkItemImplementWorkspaceController.java`
      - `architecture-model-service/src/main/java/com/example/architecturemodel/service/WorkItemImplementWorkspaceService.java`
      - `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/WorkItemImplementWorkspaceRepository.java`
    - Determine: does the existing workspace row carry one record per WorkItem? Is the FK to `WorkItemEntity` clean? Are there existing JSONB columns we can sit alongside?
  - [x] 1.2 Decide Path A (extend in place) vs Path B (new table) per R-1
    - **Path A — extend in place** (preferred IFF the workspace entity carries one row per WorkItem and has FK to WorkItem):
      - New nullable columns added to `work_item_implement_workspace`:
        - `generated_spec_text TEXT NULL`
        - `spec_generation_status VARCHAR NULL CHECK (spec_generation_status IN ('generated','generated_with_warnings','insufficient_context','failed','skipped_blocked'))`
        - `spec_generation_confidence VARCHAR NULL CHECK (spec_generation_confidence IN ('high','medium','low'))`
        - `spec_generation_predicted_readiness VARCHAR NULL`
        - `spec_generation_warnings_json JSONB NULL`
        - `spec_generation_missing_inputs_json JSONB NULL`
        - `spec_generation_focused_context_refs_json JSONB NULL`
        - `spec_generation_evidence_refs_json JSONB NULL`
        - `spec_generated_at TIMESTAMPTZ NULL`
        - `spec_generation_attempt_number INTEGER NULL DEFAULT 0`
        - `spec_generation_error_message TEXT NULL`
        - `spec_generation_book_of_work_id UUID NULL`
        - `spec_generation_book_item_id VARCHAR NULL`
        - `spec_generation_created_by_task VARCHAR NULL`
      - Changeset filename: `140-work-item-implement-workspace-spec-generation-fields.sql`
    - **Path B — new table** (used IFF Path A is unclean — e.g. workspace entity is multi-row per WorkItem, or shape would clash with attempt-history):
      - New table `migration_story_spec_generations` with fields from the raw-idea:
        - `id UUID PRIMARY KEY`
        - `project_id UUID NOT NULL`
        - `work_item_id UUID NOT NULL` (FK to `work_items.id`)
        - `book_of_work_id UUID NULL`
        - `book_item_id VARCHAR NULL`
        - `status VARCHAR NOT NULL CHECK (status IN ('generated','generated_with_warnings','insufficient_context','failed','skipped_blocked'))`
        - `confidence VARCHAR NULL CHECK (confidence IN ('high','medium','low'))`
        - `predicted_readiness VARCHAR NULL`
        - `generated_spec_text TEXT NULL`
        - `warnings_json JSONB NULL`
        - `missing_inputs_json JSONB NULL`
        - `focused_context_refs_json JSONB NULL`
        - `evidence_refs_json JSONB NULL`
        - `generated_at TIMESTAMPTZ NULL`
        - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
        - `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`
        - `error_message TEXT NULL`
        - `generation_attempt_number INTEGER NOT NULL DEFAULT 0`
        - `created_by_task VARCHAR NULL DEFAULT 'product-manager--migration-shape-spec-generation'`
      - Indexes: `(book_of_work_id, status)`, `(work_item_id)` UNIQUE in lazy/one-row model OR non-unique if future regeneration history is preserved
      - Changeset filename: `140-migration-story-spec-generations.sql`
  - [x] 1.3 Record the path decision inline + in planning notes
    - Inline Javadoc header at the top of either the extended `WorkItemImplementWorkspaceEntity.java` OR the new `MigrationStorySpecGenerationEntity.java`, citing R-1
    - Plus a brief planning file `agent-os/specs/2026-05-19-pm-migration-shape-spec-batch-generation/planning/group-1-persistence-decision.txt` so downstream groups know which path was chosen (one of: `"PATH_A_extend_in_place"` or `"PATH_B_new_table"`, with a 2-3 sentence rationale)
  - [x] 1.4 Write 4-6 focused persistence tests
    - Test file (Path A): `architecture-model-service/src/test/java/com/example/architecturemodel/repository/entity/WorkItemImplementWorkspaceSpecGenerationPersistenceTest.java`
    - Test file (Path B): `architecture-model-service/src/test/java/com/example/architecturemodel/repository/entity/MigrationStorySpecGenerationEntityPersistenceTest.java`
    - Test 1: Liquibase changeset 140 applies cleanly on an existing populated database (Spec 1's 139 still applies; no row corruption)
    - Test 2: a row with all JSONB blobs populated round-trips through persist + reload (byte-for-byte intact)
    - Test 3: a row with all JSONB blobs NULL persists and reloads cleanly (lazy `not_attempted` model — A-6 — never persists a row, but an explicit "first attempt" insert may carry nulls if the LLM/persistence path leaves them unpopulated)
    - Test 4: PATCH semantics — an update touching only `status` does NOT wipe the JSONB blobs (boxed-type + null-guard per `project_primitive_double_dto_overwrite.md`)
    - Test 5: the `status` check constraint rejects any value outside the six-value set
    - Test 6 (optional): the index on `(book_of_work_id, status)` is present and usable for the list-per-book lookup
  - [x] 1.5 Author Liquibase changeset 140 + entity/DTO/repo/mapper
    - Path A entity: extend `WorkItemImplementWorkspaceEntity.java` with the new nullable columns (boxed types, `JsonType` Hibernate mapping on JSONB)
    - Path B entity file: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/MigrationStorySpecGenerationEntity.java`
    - Path B DTO file: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MigrationStorySpecGenerationDto.java`
    - Path B repository: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/MigrationStorySpecGenerationRepository.java`
      - Query method: `findByBookOfWorkId(UUID bookOfWorkId)` for the list-per-book endpoint
      - Query method: `findByWorkItemId(UUID workItemId)` for the WorkItem-Implement-tab chip lookup (R-9)
    - Path B mapper: `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/MigrationStorySpecGenerationMapper.java`
    - Add changeset 140 entry to `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` immediately after Spec 1's 139 — verify by reading the tail of the master yaml
    - DO NOT edit any changeset <= 139 (per `feedback_liquibase_immutable_changesets.md`)
  - [x] 1.6 Run ONLY the 4-6 tests from 1.4
    - Do NOT run the entire AMS test suite

**Acceptance Criteria:**
- The 4-6 tests written in 1.4 pass
- Liquibase 140 applies cleanly; no changeset at or below 139 was touched
- All JSONB columns nullable; PATCH semantics preserve them when fields are omitted
- Status check constraint matches the six-value set from spec.md
- Path decision is recorded inline in code AND in `planning/group-1-persistence-decision.txt`
- WorkItem FK is the source of truth (R-9); no new field on `WorkItemEntity` itself

---

#### Task Group 2: LLM-Output Test Fixtures (Generated / Insufficient-Context / Failed)
**Dependencies:** None (can run in parallel with Group 1)

- [x] 2.0 Author the three LLM-output JSON fixtures used by Groups 4, 6, and 7
  - [ ] 2.1 Write 1-2 sanity tests for the fixtures
    - Test file: `gateway/src/__tests__/migrationShapeSpecFixtures.test.ts`
    - Test 1: each of the three fixtures parses cleanly and exposes its top-level `status` field with the expected value
    - Test 2 (optional): each fixture's shape conforms to the corresponding response variant from spec.md (generated / insufficient_context / failed) — this is structural, not strict validator-driven (the validator lands in Group 5)
  - [x] 2.2 Author `llm-output-generated.json` (R-13, A-7)
    - Place in BOTH locations:
      - `agent-os/specs/2026-05-19-pm-migration-shape-spec-batch-generation/planning/visuals/llm-output-generated.json`
      - `gateway/src/__tests__/fixtures/llm-output-generated.json`
    - Shape: `{ status: 'generated', confidence: 'high'|'medium'|'low', specText: '/agent-os:shape-spec ...', warnings: [], evidenceRefs: ['ev-...', 'ev-...'], assumptions: [...], tests: [...], affectedAreas: [...] }`
    - `specText` MUST start with the literal `/agent-os:shape-spec` (validator hard rule per A-4)
    - `specText` MUST reference a story title/scope drawn from Spec 1's fixture `fixture-migration-delivery-plan-scenario.json` (e.g. one of the two target services, the data migration, or the contract change)
    - `affectedAreas` non-empty (or `tests` non-empty) so the validator's "actionable detail" rule passes
    - `evidenceRefs` non-empty (acceptance signal 11 — generated specs include evidence/traceability refs)
  - [x] 2.3 Author `llm-output-insufficient-context.json` (R-13, A-7)
    - Place in BOTH locations:
      - `agent-os/specs/2026-05-19-pm-migration-shape-spec-batch-generation/planning/visuals/llm-output-insufficient-context.json`
      - `gateway/src/__tests__/fixtures/llm-output-insufficient-context.json`
    - Shape: `{ status: 'insufficient_context', missingInputs: [{ kind: 'mapping', id: '...', reason: '...' }, ...], reason: '...', recommendedNextAction: '...', evidenceRefs: [...] }`
    - `missingInputs` REQUIRED non-empty (validator hard rule per A-4)
    - Scenario: a story whose mapping is absent in Spec 1's fixture — see integration test "Missing-mapping path" in spec.md
  - [x] 2.4 Author `llm-output-failed.json` (R-13, A-7)
    - Place in BOTH locations:
      - `agent-os/specs/2026-05-19-pm-migration-shape-spec-batch-generation/planning/visuals/llm-output-failed.json`
      - `gateway/src/__tests__/fixtures/llm-output-failed.json`
    - Shape: `{ status: 'failed', errorMessage: 'LLM call timed out after 60s' }` (or similar plausible error string)
    - `errorMessage` REQUIRED (validator hard rule per A-4)
  - [x] 2.5 Provenance comment at the top of each fixture
    - Top-level `"_provenance"` string field: `"LLM-output fixture for Spec 2 PM migration shape-spec batch generation; consumed by gateway response-validator tests + batch-handler tests; implementer artefact per R-13 / A-7, not a user-supplied design asset."`
  - [ ] 2.6 Run ONLY the 1-2 tests from 2.1
    - Do NOT run the entire gateway test suite

**Acceptance Criteria:**
- The 1-2 tests written in 2.1 pass
- All three fixtures exist at BOTH paths (`planning/visuals/` AND `gateway/src/__tests__/fixtures/`)
- Each fixture conforms structurally to its corresponding spec.md response variant
- `llm-output-generated.json` carries a `/agent-os:shape-spec`-prefixed `specText` referencing a Spec 1 fixture story
- Each fixture carries a top-level `_provenance` field

---

### Gateway Layer (PM task config + prompt + validator + focused-context client + batch handler)

#### Task Group 3: PM Task Config + Markdown Prompt
**Dependencies:** Task Group 2 (fixtures referenced by prompt-content test in 3.1)

- [x] 3.0 Create the `product-manager--migration-shape-spec-generation` task config + markdown prompt
  - [x] 3.1 Write 4-6 focused tests
    - Test file: `gateway/src/__tests__/productManagerMigrationShapeSpecGenerationTaskConfig.test.ts`
    - Test 1: task config file exists at `gateway/src/config/tasks/product-manager--migration-shape-spec-generation.json` and parses cleanly; `id='product-manager--migration-shape-spec-generation'`, `personaId='product-manager'`, `menuLabel='Generate Migration Shape-Specs'`, `mode` matches Spec 1's PM-task mode
    - Test 2: `contextNeeds` array includes the NEW migration-spec-context resolver identifier (registered in Group 5) plus the saved-book-of-work + saved-WorkItems context entries; the existing migration-summary resolver is permitted but the new resolver is the primary entry
    - Test 3: `responseFormat` references the three structured-response variants (Generated / InsufficientContext / Failed) validated by `assertSpecGenerationResponse` (A-4 — validator lands in Group 4)
    - Test 4: `persistence` scope keys on `(projectId, bookOfWorkId)` per spec.md
    - Test 5: `availableFrom` and auth gating match `product-manager--migration-delivery-plan.json` (Spec 1) verbatim (R-11) — deep-equal compare against Spec 1's config's gating fields
    - Test 6: the markdown task prompt at `gateway/src/config/prompts/product-manager.migration-shape-spec-generation.task.md` contains the eight numbered prompt rules from spec.md verbatim
  - [x] 3.2 Create the task config file
    - Path: `gateway/src/config/tasks/product-manager--migration-shape-spec-generation.json`
    - Shape mirrors `gateway/src/config/tasks/product-manager--migration-delivery-plan.json` key-for-key (R-2, R-11) — only contents differ
    - Required fields per spec.md:
      - `id: "product-manager--migration-shape-spec-generation"`
      - `personaId: "product-manager"`
      - `mode`: copy verbatim from Spec 1's PM task
      - `menuLabel: "Generate Migration Shape-Specs"`
      - `contextNeeds`: saved book of work + saved WorkItems + the NEW focused migration context resolver (A-5) + API baselines + ArchitectureElementMappings + Discovery Findings/Evidence
      - `responseFormat`: references the three variants (Generated / InsufficientContext / Failed)
      - `persistence`: scope keyed on `(projectId, bookOfWorkId)`
      - `availableFrom`: copy verbatim from Spec 1 (R-11)
      - Auth / role gating: copy verbatim from Spec 1 (R-11)
  - [x] 3.3 Create the markdown task prompt
    - Path: `gateway/src/config/prompts/product-manager.migration-shape-spec-generation.task.md` (sibling to Spec 1's prompt file)
    - Prompt rules (each as a numbered hard constraint, restated verbatim from spec.md):
      1. Output MUST be literal `/agent-os:shape-spec [spec details]` — no preamble, no commentary outside the spec body
      2. Do NOT invent missing contracts, mappings, data details, or architecture details — if context is insufficient, return `status='insufficient_context'`, never fake a complete spec
      3. Use the provided focused migration context and evidence references; cite them in the spec body
      4. Include implementation steps, affected files / modules / components where known, acceptance criteria, test requirements, and evidence references
      5. Preserve the functional like-for-like migration goal — never propose a non-equivalent target
      6. Keep each spec scoped to its single story / WorkItem; no unrelated roadmap or backlog context
      7. Prerequisite-work stories must describe the prerequisite clearly rather than pretending to implement final functionality
      8. The LLM self-rates `confidence` per the focused-context payload it received; the gateway validates and may downgrade (R-7)
    - Body sections cover: the inputs the LLM will receive (focused-context payload shape per A-5), the structured-response schema reference, the status vocabulary (`generated` / `generated_with_warnings` / `insufficient_context` / `failed`), the confidence vocabulary (`high|medium|low`), and the per-variant required fields enumerated in spec.md
  - [x] 3.4 Run ONLY the 4-6 tests from 3.1

**Acceptance Criteria:**
- The 4-6 tests written in 3.1 pass
- Task config matches Spec 1's PM-task config key-for-key in shape
- Auth / role gating matches Spec 1 verbatim (R-11)
- Markdown prompt contains the eight numbered rules verbatim
- `contextNeeds` includes the NEW migration-spec-context resolver (A-5)

---

#### Task Group 4: Hand-Rolled Response Validator (`assertSpecGenerationResponse`)
**Dependencies:** Task Group 2 (fixtures) + Task Group 3 (validator referenced by responseFormat)

- [x] 4.0 Implement the hand-rolled response validator with three branches
  - [x] 4.1 Write 6-8 focused tests
    - Test file: `gateway/src/__tests__/specGenerationResponseValidator.test.ts` (NOTE: original tasks.md draft named this `migrationShapeSpecResponseSchema.test.ts`; the on-disk file matches the validator filename `specGenerationResponseValidator.ts`)
    - Test 1 (generated happy path): `llm-output-generated.json` passes validation; returns the parsed `GeneratedShapeSpecResponse` with `status='generated'`
    - Test 2 (insufficient_context happy path): `llm-output-insufficient-context.json` passes validation; `status='insufficient_context'` returned with `missingInputs[]` intact
    - Test 3 (failed happy path): `llm-output-failed.json` passes validation; `status='failed'` returned with `errorMessage` intact
    - Test 4 (specText prefix rule): a `status='generated'` payload whose `specText` does NOT start with the literal `/agent-os:shape-spec` is rejected with a clear error message naming the missing prefix
    - Test 5 (specText scope rule): a `status='generated'` payload whose `specText` does NOT reference the story title/scope is rejected
    - Test 6 (actionable-detail rule): a `status='generated'` payload with empty `affectedAreas` AND empty `tests` AND `specText` length below the heuristic content-length floor is rejected
    - Test 7 (insufficient_context required field): a `status='insufficient_context'` payload with empty `missingInputs[]` is rejected
    - Test 8 (failed required field): a `status='failed'` payload missing `errorMessage` is rejected
  - [x] 4.2 Implement the validator
    - File: `gateway/src/services/specGenerationResponseValidator.ts` (NOTE: original tasks.md draft named this `migrationShapeSpecResponseSchema.ts`; on-disk filename aligns with the gateway's validator family — `plannerResponseValidator.ts`, `implementerResponseValidator.ts`, `productManagerResponseValidator.ts`, etc.)
    - Export: `assertSpecGenerationResponse(value: unknown, storyTitle?: string): ValidationResult<GeneratedShapeSpecResponse>` returning a discriminated union `{ ok: true, value }` or `{ ok: false, errors: string[] }`. This matches Spec 1's `validateMigrationBookOfWork` precedent in `generatedMigrationBookOfWorkSchema.ts` (also returns `ValidationResult<T>`, NOT throws). The original draft called for a throwing API; on-disk shape aligns with Spec 1.
    - Pattern: hand-rolled per-status branch checks, modelled on Spec 1's `generatedMigrationBookOfWorkSchema.ts` (A-4) — NO Zod, NO Ajv, NO schema library
    - Three branches by explicit `value.status` switch:
      - **A. Generated** (`'generated'` / `'generated_with_warnings'`): require `confidence ∈ {high,medium,low}`, `specText: string`, `warnings: array`, `evidenceRefs: array`, `assumptions: array`, `tests: array`, `affectedAreas: array`
      - **B. Insufficient context** (`'insufficient_context'`): require non-empty `missingInputs: array`, `reason: string`, `recommendedNextAction: string`, `evidenceRefs: array`
      - **C. Failed** (`'failed'`): require non-empty `errorMessage: string`
    - Hard rules inside the Generated branch:
      - `specText` MUST start with the literal `/agent-os:shape-spec` (use `String.prototype.startsWith`)
      - `specText` MUST reference the story title or scope (case-insensitive substring check against the story's title / WorkItem name supplied as a second function arg)
      - Actionable detail: non-empty `affectedAreas` OR non-empty `tests` OR `specText.length` >= heuristic floor (e.g. 500 chars — implementer to confirm)
    - Validator failures return `{ ok: false, errors: [...] }` with a clear field path + reason per error; callers in Group 6 read `result.ok` and map to per-story `failed` results (not whole-batch failures). Matches Spec 1's `ValidationResult<T>` precedent.
    - Inline TSDoc header citing A-4 + R-12
  - [x] 4.3 Run ONLY the 6-8 tests from 4.1

**Acceptance Criteria:**
- The 6-8 tests written in 4.1 pass
- Validator has three explicit branches and rejects malformed payloads per the spec.md hard rules
- NO schema library used (hand-rolled per A-4)
- Validator returns `ValidationResult<T>` (`{ ok: true, value }` or `{ ok: false, errors }`) that downstream handler (Group 6) can map to per-story `failed` — Spec 1 precedent, NOT a throwing API

---

#### Task Group 5: Gateway Focused-Context Client + Resolver Registration
**Dependencies:** Task Group 7 (AMS focused-context endpoint exists OR dev-mocked) — see Execution Order below

- [x] 5.0 Implement the gateway-side client + resolver for the new AMS focused-context endpoint
  - [x] 5.1 Write 3-5 focused tests
    - Test file: `gateway/src/__tests__/migrationSpecContextClient.test.ts`
    - Test 1: `fetchMigrationSpecContext(...)` POSTs to `/api/projects/{projectId}/migration-spec-context` with the documented body shape (`bookOfWorkId`, `bookItemId`, `workItemId`, `currentArchitectureId`, `targetArchitectureId`, `contextTypes: string[]`, `maxFindings`, `maxEvidenceItems`, `maxBaselineItems`) — assert with a mocked `fetch` / `axios` spy
    - Test 2: a successful AMS response is parsed into `MigrationSpecContextDto` with one populated block per requested context type (one of: `service`, `api`, `soap`, `data`, `infrastructure`, `test_pack`)
    - Test 3: an AMS response carrying `missingInputs[]` blockers is surfaced via the DTO (not thrown as an error — gateway decides between `insufficient_context` and an LLM attempt)
    - Test 4: a network / 5xx error is surfaced as a typed `MigrationSpecContextClientError` (NOT mapped silently to `insufficient_context`)
    - Test 5: the new `MigrationSpecContextResolver` is registered in `gateway/src/services/contextResolvers.ts` alongside the existing migration-summary resolver
  - [x] 5.2 Implement the client
    - File: `gateway/src/services/migrationSpecContextClient.ts`
    - Export: `fetchMigrationSpecContext(input: { projectId, bookOfWorkId, bookItemId, workItemId, currentArchitectureId, targetArchitectureId, contextTypes, maxFindings, maxEvidenceItems, maxBaselineItems }): Promise<MigrationSpecContextDto>`
    - HTTP shape: `POST /api/projects/{projectId}/migration-spec-context` with JSON body per spec.md
    - Return type `MigrationSpecContextDto` with one optional block per supported context type (`service`, `api`, `soap`, `data`, `infrastructure`, `test_pack`) plus optional top-level `missingInputs[]`
    - On error: throw `MigrationSpecContextClientError` with status + body
    - Structured log on success: `[diag-gateway] pm_migration_shape_spec_generation focused_context_fetched workItemId=<id> bookItemId=<id> contextTypes=<list> blocksReturned=<count> missingInputs=<count>`
  - [x] 5.3 Register the resolver
    - File: `gateway/src/services/contextResolvers.ts`
    - Add a new resolver entry sibling to the existing migration-summary resolver (A-5)
    - The new resolver MAY internally call the migration-summary resolver to obtain project-level base context, then layer story-scoped drill-down on top
    - Resolver key: a stable identifier (e.g. `'migration-spec-context'`) referenced from the task config in Group 3
  - [x] 5.4 Run ONLY the 3-5 tests from 5.1

**Acceptance Criteria:**
- The 3-5 tests written in 5.1 pass
- Client POSTs the documented body shape to the new AMS endpoint
- `MigrationSpecContextDto` carries one populated block per requested context type
- New resolver is registered in `contextResolvers.ts` and may internally call the existing summary resolver
- Network / 5xx errors are surfaced as a typed error, not swallowed

---

#### Task Group 6: Batch Generation Handler (`migrationShapeSpecGenerationHandler.ts`)
**Dependencies:** Task Group 3 + Task Group 4 + Task Group 5

- [x] 6.0 Implement the gateway-only batch generation handler with serial-per-batch + per-story failure isolation
  - [x] 6.1 Write 10 focused tests (matches spec.md "Tests — gateway" count)
    - Test file: `gateway/src/__tests__/migrationShapeSpecGenerationHandler.test.ts`
    - Test 1: batch selection picks the next 25 unattempted saved-story WorkItems from the book of work
    - Test 2: batch selection preserves book-of-work `sequenceOrder` and parent hierarchy ordering
    - Test 3: per-story focused-context call invokes the new `MigrationSpecContextResolver` (via Group 5's client) with the story's IDs and the six context types
    - Test 4: LLM output that starts with the literal `/agent-os:shape-spec` passes `assertSpecGenerationResponse`; output without it is rejected (delegates to Group 4's validator)
    - Test 5: `specText` that does not reference the story title or scope is rejected (delegates to Group 4)
    - Test 6: a `status='generated'` row is persisted to AMS via the batch endpoint (Group 8) and links to the saved WorkItem
    - Test 7: when the focused-context payload is missing mappings / contracts / baselines, the handler records `status='insufficient_context'` with `missingInputs[]` populated — never fakes a complete spec
    - Test 8: one story raising mid-batch does NOT abort the batch; per-story `failed` result is still persisted; remaining stories still process (R-12)
    - Test 9: re-running batch generation does NOT overwrite rows already at `status='generated'` unless the `regenerateAll` flag is passed (R-8)
    - Test 10: a `status='generated'` result row includes non-empty `evidenceRefs` (acceptance signal 11)
  - [x] 6.2 Implement the handler
    - File: `gateway/src/services/migrationShapeSpecGenerationHandler.ts`
    - Modelled on Spec 1's `migrationBookOfWorkHandler.ts`
    - Public entry: `runShapeSpecGenerationBatch(input: { projectId, bookOfWorkId, batchSize?, regenerateAll?, skipBlockedStories? }): Promise<BatchResult>` where `BatchResult = { perStoryResults: SpecGenerationResult[], persistedCount: number, resultsCouldNotPersist: number, unpersistedResults: SpecGenerationResult[], nextBatchStart: number, summary: { generated, generated_with_warnings, insufficient_context, failed, skipped_blocked } }`
    - Sequence (per spec.md "Gateway orchestration handler" section):
      1. Load book of work + saved WorkItems + per-story metadata via AMS (existing AMS read endpoints from Spec 1)
      2. Select next N unattempted saved-story WorkItems in book-of-work `sequenceOrder` (default N=25, configurable via env var `SHAPE_SPEC_BATCH_SIZE`)
      3. Filter: skip stories already at `status='generated'` unless `regenerateAll=true`; re-attempt `failed`/`insufficient_context`/`generated_with_warnings` rows by default; mark `skipped_blocked` ONLY when `skipBlockedStories=true` (R-6, default OFF)
      4. For each story in batch, SERIALLY (R-4):
         a. Call `fetchMigrationSpecContext(...)` (Group 5) with story IDs + six context types + caps
         b. Apply `applyTokenBudgetCascade(...)` (R-5, A-3 — reuse Spec 1's helper) at ~24K-per-story cap; truncation cascade order: drop oldest evidence, then trim mapping-rationale text, then collapse baseline detail; ALWAYS retain architecture refs + mappings touching the story + contract / baseline IDs
         c. On `TokenBudgetOverflowError`: mark story `status='insufficient_context'` with overflow recorded as `missingInputs[0]`; SKIP the LLM call (acceptance signal 9 — no fabricated spec)
         d. Single synchronous LLM call (R-3)
         e. `assertSpecGenerationResponse(...)` (Group 4); validator failure -> per-story `failed`
         f. Confidence post-validation (R-7): if LLM rated `high` and any one of `mappings`/`baselines`/`contracts` is empty for an API/SOAP story OR `evidenceRefs` empty for a story whose type expects discovery evidence -> downgrade to `medium`; if two-or-more of those signals missing -> downgrade to `low`; on downgrade append `warnings[].push({ code: 'CONFIDENCE_DOWNGRADED', from, to, missingSignals: [...] })` and flip status to `generated_with_warnings`
         g. POST result to AMS batch persistence endpoint (Group 8)
      5. Return per-story result list + batch summary
    - Per-story failure isolation (R-12): catch every per-story exception (focused-context fetch / token cascade / LLM call / validator / persistence) and record a per-story result rather than aborting. When persistence itself fails, increment `resultsCouldNotPersist` and include the result in `unpersistedResults` inline so the UI can render it without a refetch
    - Auth gating: copy from Spec 1's PM-task entry point (R-11)
    - Structured log markers:
      - `[diag-gateway] pm_migration_shape_spec_generation batch_started projectId=<id> bookOfWorkId=<id> batchSize=<n> regenerateAll=<bool>`
      - `[diag-gateway] pm_migration_shape_spec_generation story_started workItemId=<id> seq=<n>`
      - `[diag-gateway] pm_migration_shape_spec_generation story_result workItemId=<id> status=<s> confidence=<c> warnings=<n> missingInputs=<n>`
      - `[diag-gateway] pm_migration_shape_spec_generation confidence_downgraded workItemId=<id> from=<c1> to=<c2> missingSignals=<list>`
      - `[diag-gateway] pm_migration_shape_spec_generation batch_completed generated=<n> generated_with_warnings=<n> insufficient_context=<n> failed=<n> skipped_blocked=<n> couldNotPersist=<n>`
  - [x] 6.3 Wire the handler into the existing PM-task dispatch
    - Match the dispatch surface used by Spec 1's `migrationBookOfWorkHandler.ts` (implementer locates by reading the registered tasks index in `gateway/src/services/`)
    - Auth + role gating verbatim from Spec 1's entry point (R-11)
  - [x] 6.4 Run ONLY the 10 tests from 6.1

**Acceptance Criteria:**
- The 10 tests written in 6.1 pass
- Handler is gateway-only (R-2); no AMS-side generation endpoint exists or is called
- Per-batch processing is synchronous (R-3); within-batch is serial (R-4)
- Per-story failure isolation (R-12) verified by Test 8 — one story raising does NOT abort the batch
- Re-run idempotency (R-8) verified by Test 9 — `generated` rows skipped unless `regenerateAll=true`
- Token budget cascade reuses Spec 1's helper (A-3); on unresolvable overflow -> `insufficient_context`
- Confidence downgrade (R-7) appends a structured `warnings[]` entry and flips status appropriately

---

### AMS Layer (focused-context endpoint + spec-generation persistence + summary)

#### Task Group 7: AMS Focused-Context Endpoint + `MigrationSpecContextResolver`
**Dependencies:** None (can run in parallel with Groups 1, 2, 3, 4)

- [x] 7.0 Implement the new AMS `POST /api/projects/{projectId}/migration-spec-context` endpoint
  - [x] 7.1 Write 7 focused tests (matches spec.md "Tests — AMS" count for this endpoint)
    - Test file: `architecture-model-service/src/test/java/com/example/architecturemodel/controller/MigrationSpecContextControllerTest.java`
    - Test 1: endpoint returns a populated `service` block for a service story
    - Test 2: endpoint returns a populated `api` block for an API operation story
    - Test 3: endpoint returns a populated `soap` block for a SOAP operation story
    - Test 4: endpoint returns a populated `data` block for a data-entity story
    - Test 5: endpoint returns a populated `infrastructure` block for an infra story
    - Test 6: endpoint returns a populated `test_pack` block for a migration-test-pack / reconciliation story
    - Test 7: endpoint reports `missingInputs[]` when mappings / baselines / contracts are absent (returns 200 with partial DTO, NOT 4xx — gateway decides between `insufficient_context` and an LLM attempt)
  - [x] 7.2 Create the controller
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/MigrationSpecContextController.java`
    - Endpoint: `POST /api/projects/{projectId}/migration-spec-context`
    - Request body DTO: `MigrationSpecContextRequestDto` with `bookOfWorkId`, `bookItemId`, `workItemId`, `currentArchitectureId`, `targetArchitectureId`, `contextTypes: List<String>`, `maxFindings`, `maxEvidenceItems`, `maxBaselineItems` (all boxed types)
    - Response DTO: `MigrationSpecContextDto` with one optional block per supported context type plus top-level `missingInputs[]`
  - [x] 7.3 Implement the service + resolver
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/MigrationSpecContextService.java`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/MigrationSpecContextResolver.java`
    - Resolver responsibility: given the request, gather a bounded payload per requested context type by joining `WorkItem` -> `ArchitectureElementMappings` -> source/target architecture elements -> contracts -> baselines -> discovery findings/evidence
    - Six context-type shapes (per spec.md):
      - `service` — service/application: id, name, current-state architecture refs, target-state refs, related component IDs
      - `api` — REST/OAS operation: operation ID, OAS contract ID, behaviour baseline IDs, mapping IDs (current -> target)
      - `soap` — SOAP/WSDL operation: operation name, WSDL ref, expected request/response shape, baseline IDs, mapping IDs
      - `data` — data entity / table: entity ID, schema refs, mapping IDs, reconciliation refs
      - `infrastructure` — infra refs: deployment targets, env refs
      - `test_pack` — migration test pack / reconciliation: test pack IDs, reconciliation hooks
    - Bounded by request caps (`maxFindings`, `maxEvidenceItems`, `maxBaselineItems`) — NO unbounded raw dump
    - Missing-detail behaviour: when required detail is absent, attach the `missingInputs[]` blocker shape (e.g. `[{ kind: 'mapping', id: '...', reason: 'no mapping found' }]`) on the context-type block AND/OR at the top level; return partial DTO with HTTP 200 (NOT 4xx)
    - Resolver MAY reuse the existing migration-summary resolver internally for project-level base context (A-5)
    - Structured log: `[diag-ams] spec_generation focused_context_resolved projectId=<id> workItemId=<id> contextTypes=<list> blocksReturned=<count> missingInputs=<count>`
  - [x] 7.4 Run ONLY the 7 tests from 7.1

**Acceptance Criteria:**
- The 7 tests written in 7.1 pass
- Endpoint returns a populated block for each of the six story types (service / api / soap / data / infrastructure / test_pack)
- Missing-detail case returns 200 with `missingInputs[]` populated (NOT 4xx — gateway decides)
- Each block is bounded by the requested caps (no unbounded raw dump)
- New resolver may internally call the existing migration-summary resolver (A-5)

---

#### Task Group 8: AMS Spec-Generation Persistence Endpoints + Summary
**Dependencies:** Task Group 1 (persistence path decision + entity/changeset must exist first)

- [x] 8.0 Expose the spec-generation CRUD + batch + summary endpoints used by the gateway and frontend
  - [x] 8.1 Write 4 focused tests (covers the remaining 4 of spec.md "Tests — AMS" 11-case set)
    - Test file: `architecture-model-service/src/test/java/com/example/architecturemodel/controller/MigrationStorySpecGenerationControllerTest.java` (Path B) OR `WorkItemImplementWorkspaceSpecGenerationControllerTest.java` (Path A)
    - Test 1: spec-generation result persisted via batch endpoint is linked to the WorkItem (FK present + retrievable via `/work-items/{workItemId}/spec-generations`)
    - Test 2: `spec-generation-summary` returns correct counts (total saved stories, attempted, by status, remaining, `nextBatchStart`, `nextBatchSize`) — lazy `not_attempted` per A-6 (`notAttempted = totalSavedStories - rowsInGenerationsTable`)
    - Test 3: `nextBatchStart` identifies the first unattempted saved story in book-of-work `sequenceOrder`
    - Test 4: manual-edit-protected spec is NOT overwritten on regenerate without `confirmOverwrite=true`; the request returns the per-row failure with `errorMessage='manual_edit_protected'` and leaves the stored spec untouched (acceptance signal 17)
  - [x] 8.2 Implement the controller
    - File (Path B): `architecture-model-service/src/main/java/com/example/architecturemodel/controller/MigrationStorySpecGenerationController.java`
    - File (Path A): extend `WorkItemImplementWorkspaceController.java` with the new spec-generation endpoints
    - Endpoints (both paths expose the same controller surface for the gateway):
      - `POST /api/projects/{projectId}/migration-books-of-work/{bookId}/spec-generations/batch` — accepts a batch result array from the gateway; per-item insert/upsert; partial-failure tolerant; response shape: `{ persistedCount, resultsCouldNotPersist, perStoryResults: [...] }` (R-12)
      - `GET /api/projects/{projectId}/migration-books-of-work/{bookId}/spec-generations` — list per book
      - `GET /api/projects/{projectId}/work-items/{workItemId}/spec-generations` — list per WorkItem (1:1 in the lazy model on Path A; possibly multi-row on Path B with attempt history)
      - `PUT /api/projects/{projectId}/spec-generations/{generationId}` — update single row (regeneration attempts, manually-corrected spec text); honours manual-edit protection
      - `GET /api/projects/{projectId}/migration-books-of-work/{bookId}/spec-generation-summary` — counts (total saved, attempted, generated, generated_with_warnings, insufficient_context, failed, skipped_blocked, remaining), `nextBatchStart`, `nextBatchSize`; lazy `not_attempted` per A-6
  - [x] 8.3 Implement the service
    - File (Path B): `architecture-model-service/src/main/java/com/example/architecturemodel/service/MigrationStorySpecGenerationService.java`
    - File (Path A): extend `WorkItemImplementWorkspaceService.java`
    - Batch persist: iterate the gateway's per-story result list; for each result `upsert` by `work_item_id`; on row-level failure, accumulate the failure into the response payload rather than throwing
    - Manual-edit protection: if a stored spec row's `created_by_task` is NOT the generator's task id OR an explicit edit-timestamp marker is set, REJECT overwrite unless the gateway sends `confirmOverwrite=true`; save-back without the flag -> per-row failure with `errorMessage='manual_edit_protected'`, stored spec untouched
    - NEVER destructively overwrite a manually-edited spec without explicit confirm (acceptance signal 17)
    - Summary computation (lazy `not_attempted` per A-6):
      - `totalSavedStories` = count of saved-story WorkItems in `book_of_work_json` (per Spec 1's BoW JSONB blob)
      - `attempted` = count of rows in the spec-generations table for this `book_of_work_id`
      - `notAttempted` = `totalSavedStories - attempted`
      - `nextBatchStart` = first `sequenceOrder` in BoW for a story NOT yet present in the spec-generations table
      - `nextBatchSize` = `min(configuredBatchSize, notAttempted)`
    - Structured log markers:
      - `[diag-ams] spec_generation batch_persisted bookOfWorkId=<id> received=<n> persistedCount=<n> resultsCouldNotPersist=<n>`
      - `[diag-ams] spec_generation overwrite_rejected workItemId=<id> reason=manual_edit_protected`
      - `[diag-ams] spec_generation summary_computed bookOfWorkId=<id> totalSavedStories=<n> attempted=<n> notAttempted=<n> nextBatchStart=<n>`
  - [x] 8.4 Run ONLY the 4 tests from 8.1

**Acceptance Criteria:**
- The 4 tests written in 8.1 pass
- Five endpoints (batch persist + list-per-book + list-per-WorkItem + PUT + summary) exposed on the same controller surface regardless of path A/B
- Manual-edit protection enforced (acceptance signal 17): no overwrite without `confirmOverwrite=true`
- Summary correctly computes `notAttempted` lazily (A-6) and `nextBatchStart` in book-of-work order
- WorkItem FK is the source of truth (R-9); no new field added to `WorkItemEntity`

---

### Frontend Layer (spec generation workspace + WorkItem Implement-tab integration)

#### Task Group 9: Spec-Generation Workspace Shell + Summary Header
**Dependencies:** Task Group 8 (summary endpoint contract must exist)

- [x] 9.0 Build the workspace shell + summary header surface
  - [x] 9.1 Write 2-3 focused tests
    - Test file: `frontend/src/components/ProductManager/MigrationShapeSpecGeneration/__tests__/SpecGenerationWorkspace.test.tsx`
    - Test 1: workspace shell renders the summary header with totals (saved stories, attempted, generated, generated_with_warnings, insufficient_context, failed, skipped_blocked, remaining), current batch size, next batch range, and optional predicted-vs-actual metric (R-10)
    - Test 2: workspace fetches the spec-generation summary from `GET /api/projects/{projectId}/migration-books-of-work/{bookId}/spec-generation-summary` on mount
    - Test 3 (optional): summary header re-fetches when the user returns to the workspace after navigating away (A-9 — navigating away does NOT cancel a batch; on return, re-fetch)
  - [x] 9.2 Inspect existing modelling shell + Implement-tab components (read-only audit at write time)
    - Files to read:
      - `frontend/src/components/ProductManager/MigrationDeliveryPlan/*` (Spec 1 workspace; modelling precedent for the new workspace)
      - `frontend/src/components/ProductView/ImplementTab.tsx`
      - `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
      - `frontend/src/components/ProductView/ImplementationPlanSection.tsx`
      - `frontend/src/components/ProductView/WorkItemDetailsPanel.tsx`
      - `frontend/src/api/implementWorkspaceApi.ts` + `frontend/src/api/workItemsApi.ts` (API call patterns)
    - Confirm: workspace placement (under the book-of-work detail page is primary entry; WorkItem Implement-tab is drill-in entry per spec.md)
  - [x] 9.3 Implement the workspace shell
    - File: `frontend/src/components/ProductManager/MigrationShapeSpecGeneration/SpecGenerationWorkspace.tsx`
    - Shell components: page header, summary header card, primary action button row, results table area (filled by Group 10), filter panel (filled by Group 11), drawer host (filled by Group 11)
    - Wire `GET .../spec-generation-summary` via a new `frontend/src/api/specGenerationApi.ts` client (mirror `implementWorkspaceApi.ts` patterns)
  - [x] 9.4 Implement the summary header
    - File: `frontend/src/components/ProductManager/MigrationShapeSpecGeneration/SpecGenerationSummaryHeader.tsx`
    - Renders: totals (saved stories, attempted, by-status counts, remaining), current batch size, next batch range (`nextBatchStart`-`nextBatchStart + nextBatchSize - 1`), optional predicted-vs-actual metric (R-10 — e.g. "12 of 14 predicted-ready actually generated"; metric is OPTIONAL — implementer may stub if Spec 1's predicted-readiness signal is not yet wired through the summary endpoint)
  - [x] 9.5 Run ONLY the 2-3 tests from 9.1

**Acceptance Criteria:**
- The 2-3 tests written in 9.1 pass
- Summary header renders totals + by-status counts + remaining + next batch range + optional predicted-vs-actual metric
- Workspace re-fetches summary on mount AND on return from navigation (A-9)

---

#### Task Group 10: Primary Action + Batch Progress + Results Table
**Dependencies:** Task Group 6 (gateway batch endpoint) + Task Group 9

- [x] 10.0 Build the primary action button row, in-progress banner, and batch results table
  - [x] 10.1 Write 3-4 focused tests
    - Test file: `frontend/src/components/ProductManager/MigrationShapeSpecGeneration/__tests__/BatchGenerationControls.test.tsx`
    - Test 1: clicking "Generate specs for all stories" starts the first batch via the gateway endpoint (mocked POST -> handler from Group 6)
    - Test 2: while a batch is in-flight, the "Generate next batch" button is DISABLED and the in-progress banner `Batch in progress (story X of 25)` is visible (A-9)
    - Test 3: "Generate next 25" continues from `nextBatchStart` (re-fetched from summary) and appends new rows to the results table
    - Test 4: results table renders each story with predicted readiness, actual status, and confidence columns side-by-side (R-10)
  - [x] 10.2 Implement the action controls
    - File: `frontend/src/components/ProductManager/MigrationShapeSpecGeneration/BatchGenerationControls.tsx`
    - Buttons: "Generate specs for all stories" (loops batches until `notAttempted=0`), "Generate next 25", "Stop after current batch", plus two toggles: "Regenerate all (including generated)" (R-8 -> sets `regenerateAll=true` on the gateway call) and "Skip blocked stories" (R-6, default OFF -> sets `skipBlockedStories=true`)
    - In-flight state: all buttons disabled; banner `Batch in progress (story X of 25)` (A-9). Navigating away does NOT cancel the batch; on return the workspace re-fetches summary (handled by Group 9)
  - [x] 10.3 Implement the batch results table
    - File: `frontend/src/components/ProductManager/MigrationShapeSpecGeneration/BatchResultsTable.tsx`
    - Columns: story title, parent feature/epic, **predicted readiness** | **actual status** (side-by-side per R-10), confidence, warnings count, missingInputs count, generated-spec link (opens drawer — Group 11), recommendedNextAction
    - Each row's click handler opens the story drawer (Group 11)
    - Failed rows expose a retry control that triggers a single-story regenerate via the gateway (acceptance test 9 in spec.md "Tests — frontend")
  - [x] 10.4 Run ONLY the 3-4 tests from 10.1

**Acceptance Criteria:**
- The 3-4 tests written in 10.1 pass
- "Generate specs for all stories" starts the first batch via the gateway
- "Generate next batch" button disabled while in-flight; in-progress banner visible (A-9)
- Results table renders predicted / actual / confidence side-by-side (R-10)
- Failed rows expose a retry control

---

#### Task Group 11: Filters + Story Result Drawer
**Dependencies:** Task Group 10

- [x] 11.0 Build the filter panel and story-result detail drawer
  - [x] 11.1 Write 2-3 focused tests
    - Test file: `frontend/src/components/ProductManager/MigrationShapeSpecGeneration/__tests__/StoryResultDrawer.test.tsx` + `Filters.test.tsx`
    - Test 1: filters narrow the table by status, confidence, predicted readiness, workstream, and parent epic/feature
    - Test 2: story drawer renders generated spec text for a `generated` row with a working copy button
    - Test 3: story drawer renders `missingInputs[]` and `recommendedNextAction` for an `insufficient_context` row
  - [x] 11.2 Implement the filter panel
    - File: `frontend/src/components/ProductManager/MigrationShapeSpecGeneration/SpecGenerationFilters.tsx`
    - Filters per spec.md UI surface 4: by actual status, by confidence, by predicted readiness, by workstream, by parent epic/feature
    - Filter state managed locally in the workspace shell (Group 9)
  - [x] 11.3 Implement the story result drawer
    - File: `frontend/src/components/ProductManager/MigrationShapeSpecGeneration/StoryResultDrawer.tsx`
    - Right-hand side-panel drawer ~480-560px wide (A-8); overlays the batch results table; dismissible via Esc key, backdrop click, or explicit X close button
    - Contents per spec.md UI surface 5: story description, predicted readiness, actual status, confidence, generated spec text (with copy button), missingInputs, warnings, evidence refs, focused-context refs, recommendedNextAction, link to WorkItem + Implement tab
    - Manual-edit-protected dialog confirm flow for regen attempts that would overwrite an edited spec — surfaced when the gateway returns `errorMessage='manual_edit_protected'`; dialog asks the user to confirm; on confirm, retry the regenerate with `confirmOverwrite=true`
  - [x] 11.4 Run ONLY the 2-3 tests from 11.1

**Acceptance Criteria:**
- The 2-3 tests written in 11.1 pass
- Filter panel narrows by all five filter dimensions
- Drawer is right-hand ~480-560px wide and dismissible via Esc / backdrop / X (A-8)
- Generated spec text exposed with a working copy button
- Insufficient-context rows render `missingInputs[]` + `recommendedNextAction`
- Manual-edit-protected dialog appears before overwrite

---

#### Task Group 12: WorkItem Implement-Tab Integration (Chip + Drill-Back + Stored Spec Display)
**Dependencies:** Task Group 8 (list-per-WorkItem endpoint) + Task Group 11 (drawer surface to drill back to)

- [x] 12.0 Integrate the generated shape-spec into the existing WorkItem Implement tab
  - [x] 12.1 Write 2-3 focused tests
    - Test file: `frontend/src/components/ProductView/__tests__/ImplementTabShapeSpec.test.tsx`
    - Test 1: WorkItem Implement tab renders the "Generated shape-spec available" chip when `GET /api/projects/{projectId}/work-items/{workItemId}/spec-generations` returns a row (R-9)
    - Test 2: clicking the chip drills back to the workspace and opens the story drawer for that WorkItem
    - Test 3: the generated spec text is rendered inline (or via drawer) with a copy button and status / confidence indicators visible
  - [x] 12.2 Inspect the existing Implement-tab component (read-only audit at write time)
    - Files to read (re-read from Group 9 if not already in working memory):
      - `frontend/src/components/ProductView/ImplementTab.tsx`
      - `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
      - `frontend/src/components/ProductView/ImplementationPlanSection.tsx`
      - `frontend/src/components/ProductView/WorkItemDetailsPanel.tsx`
    - Decide whether to extend an existing sub-component or add a new sibling component for the chip + stored-spec display
  - [x] 12.3 Implement the integration
    - Add a new sub-component (or extend an existing one) under `frontend/src/components/ProductView/`:
      - "Generated shape-spec available" chip (R-9) — only rendered when a spec-generation row exists for the WorkItem
      - Drill-back link to the workspace drawer for this WorkItem (the workspace route accepts a `workItemId` query param that auto-opens the drawer on mount)
      - Inline stored spec text + copy button + generation status + confidence indicator
      - Regenerate action ONLY if the existing implementation flow already supports a regenerate affordance (otherwise defer)
    - NO new field on `WorkItem` entity (R-9); the chip queries `GET .../work-items/{workItemId}/spec-generations` via a new wrapper in `frontend/src/api/specGenerationApi.ts` (added in Group 9)
  - [x] 12.4 Run ONLY the 2-3 tests from 12.1

**Acceptance Criteria:**
- The 2-3 tests written in 12.1 pass
- "Generated shape-spec available" chip (R-9) renders on the Implement tab when a generation row exists
- Drill-back link opens the workspace drawer for the WorkItem
- Generated spec text + copy button + status + confidence visible from the Implement tab
- NO new field added to `WorkItemEntity` (R-9 confirmed)

---

### Documentation

#### Task Group 13: Inline TSDoc / Javadoc / JSDoc Headers on All Major New Modules
**Dependencies:** All prior groups

- [x] 13.0 Add inline documentation headers tracing each major new module back to the R-x / A-y design points
  - [x] 13.1 Gateway module headers
    - File: `gateway/src/services/migrationShapeSpecGenerationHandler.ts` — TSDoc header citing R-2 (gateway-only orchestration), R-3 (sync per batch), R-4 (serial per batch), R-5/A-3 (token cascade reuse), R-7 (confidence downgrade), R-8 (re-run idempotency), R-12 (failure isolation), R-13/A-7 (fixture provenance)
    - File: `gateway/src/services/specGenerationResponseValidator.ts` — TSDoc header citing A-4 (hand-rolled, no schema library)
    - File: `gateway/src/services/migrationSpecContextClient.ts` — TSDoc header citing A-5 (new resolver, separate from migration-summary)
    - File: `gateway/src/config/tasks/product-manager--migration-shape-spec-generation.json` — JSON-comment header is not valid; add the inline rationale to the markdown prompt file at `gateway/src/config/prompts/product-manager.migration-shape-spec-generation.task.md` instead, citing R-11 (auth-gating verbatim from Spec 1)
  - [x] 13.2 AMS module headers
    - File: `architecture-model-service/.../MigrationSpecContextController.java` — Javadoc header citing A-5 (focused-context resolver) and the six supported context-type shapes
    - File: `architecture-model-service/.../MigrationSpecContextResolver.java` — Javadoc header citing A-5 + R-5 (bounded payload, no unbounded raw dump)
    - File: Path B `MigrationStorySpecGenerationEntity.java` OR Path A extended `WorkItemImplementWorkspaceEntity.java` — Javadoc header citing R-1 (persistence path decision recorded in `planning/group-1-persistence-decision.txt`), R-9 (WorkItem FK source of truth), A-6 (lazy `not_attempted`), R-12 (failure rows persisted)
    - File: Path B `MigrationStorySpecGenerationController.java` OR Path A extended `WorkItemImplementWorkspaceController.java` — Javadoc header citing manual-edit protection (acceptance signal 17)
  - [x] 13.3 Frontend module headers
    - File: `frontend/src/components/ProductManager/MigrationShapeSpecGeneration/SpecGenerationWorkspace.tsx` — JSDoc header citing A-1 (existing UI inspected), A-9 (batch concurrency control), R-10 (predicted-vs-actual side-by-side)
    - File: `frontend/src/components/ProductManager/MigrationShapeSpecGeneration/StoryResultDrawer.tsx` — JSDoc header citing A-8 (drawer width + dismissibility)
    - File: `frontend/src/components/ProductView/` (the new chip sub-component file from Group 12) — JSDoc header citing R-9 (read-only chip, no WorkItem field)
  - [x] 13.4 Verify no standalone `.md` documentation files were created (per the standing CLAUDE.md instruction "NEVER create documentation files (*.md) or README files unless explicitly requested")
    - The only `.md` deliverable produced by this spec is the gateway prompt file at `gateway/src/config/prompts/product-manager.migration-shape-spec-generation.task.md`, which is a runtime prompt artefact (consumed by the LLM), NOT documentation

**Acceptance Criteria:**
- Every major new module (handler, validator, client, controller, resolver, entity, workspace shell, drawer, chip) carries an inline doc header citing the relevant R-x / A-y design points
- No standalone `.md` documentation files have been created (only the runtime prompt file is permitted)

---

## Integration Tests (cross-group — spec.md "Tests — integration" 7-case set)

The 7 integration tests from spec.md are slotted across the relevant groups rather than gathered in a separate group. They are listed here so the spec-writer / implementer can confirm full coverage:

- Happy path (saved BoW + saved WorkItems -> batch generation -> spec-generation rows visible from each WorkItem) — Group 6 Test 6 + Group 12 Test 1
- API story integration (generated spec references OAS contract ID + API behaviour baseline ID + mapping ID from Spec 1's fixture) — Group 6 Test 6 + Group 7 Test 2
- SOAP story integration (generated spec references SOAP operation details from the fixture) — Group 6 Test 6 + Group 7 Test 3
- Data-migration story integration (generated spec references the data mapping + reconciliation hooks from the fixture) — Group 6 Test 6 + Group 7 Test 4
- Missing-mapping path (a story whose mapping is absent in the fixture produces `status='insufficient_context'` with the missing mapping listed in `missingInputs[]`) — Group 6 Test 7
- 60-story scenario with default batch size 25 -> exactly 3 batches required; the third batch is correctly sized (10 stories) — Group 6 Test 1 + Test 9 (combined extension required at implementation time)
- Reload persistence (after a full generate run, refreshing the workspace re-fetches summaries from AMS and renders the same spec-generation rows linked to the same WorkItems) — Group 9 Test 3

Any integration test not covered by an existing group test SHOULD be added as an additional case to the most relevant group's test file rather than as a standalone integration test file.

---

## Execution Order

Recommended implementation sequence with explicit parallelism markers:

1. **Foundation Layer (parallel)** — must land first:
   - Group 1 (AMS persistence path decision + changeset 140 + entity/DTO/repo/mapper)
   - Group 2 (LLM-output JSON fixtures in both locations)
   - Groups 1 + 2 are fully parallel — neither depends on the other

2. **Gateway Layer + AMS Focused-Context (parallel after Foundation)**:
   - Group 3 (PM task config + markdown prompt) — depends on Group 2 (fixtures referenced by prompt-content test)
   - Group 4 (hand-rolled response validator) — depends on Group 2 + Group 3
   - Group 7 (AMS focused-context endpoint + resolver) — independent of Group 1; can start in parallel with Group 3 + Group 4
   - Group 5 (gateway focused-context client + resolver registration) — depends on Group 7's endpoint contract being settled (OR Group 5 dev-mocks the endpoint and adopts the real one when Group 7 lands)
   - Group 3 + Group 4 + Group 7 can run in parallel; Group 5 follows Group 7

3. **Gateway Batch Handler + AMS Persistence Endpoints**:
   - Group 6 (gateway batch handler) — depends on Group 3 + Group 4 + Group 5
   - Group 8 (AMS spec-generation persistence + summary endpoints) — depends on Group 1's persistence decision
   - Group 6 + Group 8 can run in parallel; Group 6's persistence calls go to Group 8's batch endpoint

4. **Frontend Layer (largely parallel after Gateway + AMS contracts exist)**:
   - Group 9 (workspace shell + summary header) — depends on Group 8 (summary endpoint contract)
   - Group 10 (primary action + batch progress + results table) — depends on Group 6 (gateway batch endpoint) + Group 9
   - Group 11 (filters + story drawer) — depends on Group 10
   - Group 12 (WorkItem Implement-tab integration) — depends on Group 8 (list-per-WorkItem) + Group 11 (drawer to drill back to)
   - Group 10 + Group 11 + Group 12 can run with overlapping parallelism once Group 9 lands

5. **Documentation (last)**:
   - Group 13 — depends on all prior groups; inline doc headers added once each module is in its final shape
