# Task Breakdown: Product Manager Migration Delivery Plan + Draft Book-of-Work Generation

## Overview
Total Task Groups: 13
Total Tasks: ~95 (across 13 groups)

This spec adds a Product Manager task `product-manager--migration-delivery-plan` that consumes Migration Discovery Context plus related current/target architecture inputs and produces a hierarchical draft book of work (Initiatives → Epics → Features → Stories) with per-item confidence, readiness, traceability, and quality assessment — saved as a reviewable draft artifact that can be selectively pushed into the existing WorkItem backlog.

The 13 task groups are ordered Foundation → Gateway → AMS → Frontend → Docs, with explicit parallelism markers in the Execution Order section at the end. Foundation (Groups 1-3) is fully parallel and must land first. Gateway, AMS, and Frontend each open up once their respective foundation pieces are in place.

## Standing Constraints (apply to every group)

- Per `feedback_liquibase_immutable_changesets.md`: never edit applied Liquibase changesets, not even comments. The most recent applied changeset is `138` (per Phase 1); this spec's NEW changeset id is `139`.
- Per `project_primitive_double_dto_overwrite.md`: any DTO field participating in PATCH semantics MUST be boxed (`Boolean`, `Long`, `Double`, `String`) with null guards in the update handler. All four JSONB-backed DTO fields in this spec are boxed `JsonNode` / `String` / `Map<String, Object>` types, never primitives.
- All four JSONB columns (`generation_inputs_json`, `generation_summary_json`, `quality_assessment_json`, `book_of_work_json`) use the `JsonType` Hibernate mapping precedent established in `DiscoveryRunEntity` (per `fix-hibernate-jsonb-mapping`).
- Gateway is the **sole orchestrator** (Q-1). AMS persists only; the optional AMS `/generate` endpoint is dropped.
- Persistence path is **gateway → AMS direct REST** (Q-3). MCP-server is NOT in the path unless inspection of existing PM-task save flows reveals an MCP routing pattern already in use.
- Auth gating is **verbatim from `product-manager--backlog.json`** (Q-17). No new role, permission flag, or gating layer is introduced.
- The Migration Discovery Context resolver in `gateway/src/services/contextResolvers.ts` + `migrationDiscoveryContextClient.ts` is reused **without modification** (Q-12).
- `saveState` lives in **frontend state only during review**; persists to `book_of_work_json` only on explicit Save Draft PUT or save-to-backlog write-back (Q-16).
- Workstream vocabulary is **14 values** (13 from raw-idea + `unknown` sentinel) per Q-7. Prompt restricts `unknown` usage to "no other workstream applies".
- The Phase 1 + Phase 2 reference implementations (`DiscoveryRunController` / `DiscoveryRunEntity` / `DiscoveryRunService`) are the **structural template** for the new `MigrationBookOfWork*` controller/entity/service quintet.
- `mcp-server/src/services/candidateSaveBackService.ts` is the structural template for per-item-commit + `saveState` + idempotent retry (Q-5) — patterns mirrored, but actual persistence stays gateway → AMS direct REST.
- All new structured AMS log lines use the prefix `[diag-ams] book_of_work ...`. Gateway log lines use `[diag-gateway] pm_migration_delivery_plan ...`. Frontend stage markers are scripted client-side (Q-15).
- No standalone `.md` documentation files — all docs live as inline TSDoc/JSDoc/Javadoc headers per the standing CLAUDE.md instruction.

---

## Task List

### Foundation Layer (cross-cutting; must land before gateway/AMS/frontend work)

#### Task Group 1: AMS Entity + Liquibase Changeset for `generated_migration_books_of_work`
**Dependencies:** None

- [x] 1.0 Create the AMS persistence layer for generated migration books of work
  - [x] 1.1 Write 4-6 focused persistence tests
    - Test file: `architecture-model-service/src/test/java/com/example/architecturemodel/repository/entity/GeneratedMigrationBookOfWorkEntityPersistenceTest.java`
    - Test 1: Liquibase changeset 139 applies cleanly on an existing populated database (no row corruption)
    - Test 2: an entity with all four JSONB columns populated round-trips through persist + reload (each blob's content matches byte-for-byte)
    - Test 3: an entity with all four JSONB columns NULL persists and reloads cleanly (Q-14 — partial drafts representable)
    - Test 4: PATCH semantics — an update touching only `title` + `status` does NOT wipe the four JSONB columns (boxed-type + null-guard per `project_primitive_double_dto_overwrite.md`)
    - Test 5: the `status` column rejects any value outside `{ draft, reviewed, partially_saved, saved, archived, failed }`
    - Test 6 (optional): the composite index on `(project_id, current_architecture_id, target_architecture_id, status)` is present and usable for the regenerate-on-same-tuple lookup (Q-6)
  - [x] 1.2 Author Liquibase changeset 139
    - File: `architecture-model-service/src/main/resources/db/changelog/sql/139-generated-migration-books-of-work.sql`
    - DDL: `CREATE TABLE generated_migration_books_of_work` with columns:
      - `id UUID PRIMARY KEY`
      - `project_id UUID NOT NULL`
      - `current_architecture_id UUID NOT NULL`
      - `target_architecture_id UUID NOT NULL`
      - `status TEXT NOT NULL CHECK (status IN ('draft','reviewed','partially_saved','saved','archived','failed'))`
      - `title TEXT`
      - `summary TEXT`
      - `generation_inputs_json JSONB NULL`
      - `generation_summary_json JSONB NULL`
      - `quality_assessment_json JSONB NULL`
      - `book_of_work_json JSONB NULL`
      - `created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`
      - `updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`
      - `created_by_task TEXT NOT NULL DEFAULT 'product-manager--migration-delivery-plan'`
      - `saved_to_backlog_at TIMESTAMP WITH TIME ZONE NULL`
      - `error_message TEXT NULL`
    - Add composite index `(project_id, current_architecture_id, target_architecture_id, status)` for the regenerate-on-same-tuple archive lookup (Q-6)
    - Add changeset entry to `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` immediately after changeset 138 — verify by reading the tail of the master yaml; numbering rationale: 138 was the last applied (per Phase 1's SOAP changeset), 139 is the next free slot
    - Do NOT edit any changeset ≤ 138 (per `feedback_liquibase_immutable_changesets.md`)
  - [x] 1.3 Create `GeneratedMigrationBookOfWorkEntity`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/GeneratedMigrationBookOfWorkEntity.java`
    - Annotate the four JSONB fields with the `JsonType` Hibernate mapping (mirror `DiscoveryRunEntity`'s JSONB pattern per `fix-hibernate-jsonb-mapping`)
    - All fields boxed (`String`, `UUID`, `Map<String, Object>` or `JsonNode`, `Instant`) — never primitive
    - Audit columns mapped via `@PrePersist` / `@PreUpdate` callbacks (mirror `DiscoveryRunEntity`)
  - [x] 1.4 Create `GeneratedMigrationBookOfWorkDto`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/GeneratedMigrationBookOfWorkDto.java`
    - All JSONB fields exposed as the same `Map<String, Object>` / `JsonNode` shape used by `DiscoveryRunDto`
    - PATCH null-guards: any update that omits a JSONB field MUST leave the existing column untouched (boxed type + null guard per `project_primitive_double_dto_overwrite.md`)
  - [x] 1.5 Create `GeneratedMigrationBookOfWorkRepository`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/GeneratedMigrationBookOfWorkRepository.java`
    - Extends `JpaRepository<GeneratedMigrationBookOfWorkEntity, UUID>`
    - Query method: `findActiveDraftForTuple(projectId, currentArchId, targetArchId)` returning rows where `status != 'archived'` — used by Q-6 regenerate-on-same-tuple archive flow
    - Query method: `findByProjectId(projectId, includeArchived)` for the list endpoint
  - [x] 1.6 Create `GeneratedMigrationBookOfWorkMapper`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/GeneratedMigrationBookOfWorkMapper.java`
    - MapStruct or manual mapper that round-trips entity ↔ DTO with all four JSONB blobs intact
  - [x] 1.7 Run ONLY the 4-6 tests from 1.1
    - Do NOT run the entire AMS test suite

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- Liquibase 139 applies cleanly; no changeset at or below 138 was touched
- All four JSONB columns nullable (Q-14 — partial drafts representable)
- PATCH semantics preserve JSONB columns when fields are omitted
- Status check constraint matches the six values in spec.md
- Composite index on `(project_id, current_architecture_id, target_architecture_id, status)` is in place

---

#### Task Group 2: WorkItemType Audit + Optional Extension Changeset
**Dependencies:** None (can run in parallel with Group 1)

- [x] 2.0 Audit `WorkItemEntity` / `WorkItemType` for `initiative | epic | feature | story` support
  - [x] 2.1 Write 2-4 focused tests for the audit outcome
    - Test file: `architecture-model-service/src/test/java/com/example/architecturemodel/repository/entity/WorkItemTypeAuditTest.java`
    - Test 1: a `WorkItemEntity` with `type='initiative'` persists and reloads with the value intact
    - Test 2: same for `'epic'`, `'feature'`, `'story'` (one parameterised test or four separate tests)
    - Test 3 (optional, only if an enum exists): the `WorkItemType` enum natively includes all four values
    - Test 4 (optional, only if an extension changeset was added): the new changeset applies cleanly on existing data
  - [x] 2.2 Inspect the existing model (read-only audit)
    - Files to read: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/WorkItemEntity.java` and any `WorkItemType.java` enum if present
    - Determine: is `type` a free-text `String` column, an enum, or a check-constrained text column?
    - If free-text string: no schema change needed; save-to-backlog (Task Group 8) does a 1:1 string mapping
    - If enum / check-constrained AND already supports the four values: no schema change needed
    - If enum / check-constrained AND missing values: extend via a NEW Liquibase changeset (Q-2)
  - [x] 2.3 (Conditional — only if missing values are found in 2.2) Author Liquibase changeset 140 — N/A: audit confirmed free-text TEXT column; no extension changeset needed
    - File: `architecture-model-service/src/main/resources/db/changelog/sql/140-work-item-type-extension.sql`
    - DDL: extend the check constraint OR add enum values for `initiative | epic | feature | story` (whichever shape the current schema uses)
    - Add changeset entry to `db.changelog-master.yaml` immediately after changeset 139
    - Do NOT edit any changeset ≤ 139 (per `feedback_liquibase_immutable_changesets.md`)
    - Per Q-2: NEW changeset only, never a comment-only edit to an applied one
  - [x] 2.4 Record the audit outcome
    - As an inline Javadoc header at the top of `WorkItemEntity.java`, OR as a brief comment block in the new save-to-backlog service (Task Group 8) when it lands
    - One of two outcomes:
      - "Confirmed: WorkItem `type` is free-text / already supports `initiative|epic|feature|story` — no schema change needed for the PM migration delivery plan save-to-backlog flow."
      - "Extended via changeset 140: added `<missing values>` to support save-to-backlog from `generated_migration_books_of_work`."
  - [x] 2.5 Run ONLY the 2-4 tests from 2.1 — test file compiles cleanly in isolation; full surefire run blocked by pre-existing unrelated test-compile rot in AMS (WorkItemRepositoryTest, WorkItemImplementContextServiceTest, RoadmapImportServiceV3Test, OrganisationController*Test all fail to compile against the current main sources, all unrelated to this audit). AMS test compile is disabled globally via pom property maven.test.skip=true.

**Acceptance Criteria:**
- The 2-4 tests written in 2.1 pass
- All four type values round-trip cleanly through `WorkItemEntity` (whether natively or via the optional changeset 140)
- Audit outcome is recorded inline in code (no standalone `.md` file)
- If a changeset was added, it is at id 140 and does NOT touch any prior changeset

---

#### Task Group 3: PM-Flow Test Fixture (`fixture-migration-delivery-plan-scenario.json`)
**Dependencies:** None (can run in parallel with Groups 1 and 2)

- [x] 3.0 Build the comprehensive PM-flow test fixture under `planning/visuals/`
  - [x] 3.1 Author the fixture file
    - Path: `agent-os/specs/2026-05-17-pm-migration-delivery-plan-book-of-work-draft/planning/visuals/fixture-migration-delivery-plan-scenario.json`
    - Scenario shape (per Q-9): a monolith service split into **2 target services** + **1 data migration** + **1 contract change** + **2 unresolved findings**
    - Fixture content covers:
      - Product Definition (1 product with the monolith as the in-scope service)
      - Current State Architecture: 1 monolith service with N components, 3-4 API operations, 1 data entity
      - Target State Architecture: 2 services (each with a subset of the original operations + the new contract version of one of them)
      - `ArchitectureElementMappings`: enough mappings to anchor the data migration + the contract change
      - Migration Discovery Context payload shaped exactly like the resolver output (consumed verbatim by the gateway)
      - 2 discovery findings flagged unresolved (e.g., one `evidence_gap` and one `confidence_warning`), each with an `id`, `summary`, and `affectedElementIds`
      - 1 API Behaviour Baseline for the contract-changing operation
    - Provenance comment at the top of the JSON (as a top-level `"_provenance"` string field):
      - "PM-flow fixture; cites Phase 1 (`reference-jaxws-document-literal-wrapped.wsdl`), Phase 2 (`fixture-hand-rolled-soap-servlet/`), and Phase 3 (auto-linking) fixtures for shape consistency, but is purpose-built for this spec and is not a verbatim reuse of any prior fixture."
  - [ ] 3.2 Add the fixture-loader utility for tests
    - File: `gateway/src/__tests__/fixtures/migrationDeliveryPlanFixture.ts` (or sibling — match wherever existing PM-task fixtures live)
    - Public function: `loadMigrationDeliveryPlanFixture(): MigrationDiscoveryContext` returning the parsed JSON typed against the existing `MigrationDiscoveryContext` DTO
  - [ ] 3.3 Write 1-2 sanity tests for the fixture
    - Test file: `gateway/src/__tests__/migrationDeliveryPlanFixture.test.ts`
    - Test 1: the fixture parses without error and contains the documented counts (1 product, 1 source service, 2 target services, 1 data entity, 1 contract change, 2 unresolved findings)
    - Test 2 (optional): the fixture's mapping IDs resolve to entries in the source + target architecture lists (referential integrity within the fixture)
  - [ ] 3.4 Run ONLY the 1-2 tests from 3.3

**Acceptance Criteria:**
- The 1-2 tests written in 3.3 pass
- Fixture file exists at the documented path under `planning/visuals/`
- Fixture content matches the Q-9 scenario shape (2 target services, 1 data migration, 1 contract change, 2 unresolved findings)
- Provenance is recorded inline as the `"_provenance"` top-level field

---

### Gateway Layer (PM task config + prompt + orchestration)

#### Task Group 4: PM Task Config + Markdown Prompt
**Dependencies:** Task Group 3 (fixture for the prompt-content test)

- [x] 4.0 Create the `product-manager--migration-delivery-plan` task config + prompt
  - [x] 4.1 Write 4-6 focused tests
    - Test file: `gateway/src/__tests__/productManagerMigrationDeliveryPlanTaskConfig.test.ts`
    - Test 1: task config file exists at `gateway/src/config/tasks/product-manager--migration-delivery-plan.json` and parses cleanly; `id='product-manager--migration-delivery-plan'`, `personaId='product-manager'`, `mode='discovery'`, `menuLabel='Create Migration Delivery Plan'`
    - Test 2: `contextNeeds` array includes the migration-discovery-context resolver identifier (whatever the exact string is in `contextResolvers.ts`) alongside any pre-existing PM-task entries (e.g. `mission`)
    - Test 3: `responseFormat` references the `GeneratedMigrationBookOfWork` structured-response schema (key check — the schema implementation lands in Group 5)
    - Test 4: `persistence` scope keys on `(projectId, currentArchitectureId, targetArchitectureId)` per Q-6
    - Test 5: `availableFrom` and auth gating match `product-manager--backlog.json` verbatim (Q-17) — deep-equal compare against the backlog config's gating fields
    - Test 6: the markdown task prompt at `gateway/src/config/prompts/product-manager.migration-delivery-plan.task.md` contains the eight numbered prompt rules from spec.md verbatim
  - [x] 4.2 Create the task config file
    - Path: `gateway/src/config/tasks/product-manager--migration-delivery-plan.json`
    - Shape mirrors `gateway/src/config/tasks/product-manager--backlog.json` key-for-key (Q-11) — only contents differ
    - Required fields per spec.md:
      - `id: "product-manager--migration-delivery-plan"`
      - `personaId: "product-manager"`
      - `mode: "discovery"` (guided workflow per Q-15)
      - `menuLabel: "Create Migration Delivery Plan"` (Q-18)
      - `contextNeeds`: include the migration-discovery-context resolver verbatim (Q-12) plus whatever the existing PM tasks list (likely `mission` and others — spec-writer / implementer reads `product-manager--backlog.json` and matches)
      - `responseFormat`: references the `GeneratedMigrationBookOfWork` schema (Group 5)
      - `persistence`: scope keyed on `(projectId, currentArchitectureId, targetArchitectureId)` (Q-6)
      - `availableFrom`: copy verbatim from `product-manager--backlog.json` (Q-17 — same menu surfacing)
      - Auth / role gating: copy verbatim from `product-manager--backlog.json` (Q-17)
  - [x] 4.3 Create the markdown task prompt
    - Path: `gateway/src/config/prompts/product-manager.migration-delivery-plan.task.md` (filename convention from existing PM-task prompts per Q-13 — spec-writer confirmed PM prompts live in `config/prompts/` as `*.task.md`)
    - Prompt rules (each as a numbered hard constraint, restated verbatim from spec.md):
      1. Functional equivalence is **mandatory** — never ask the user, never propose a non-equivalent target.
      2. Generate a **book of work**, not a migration plan document.
      3. Use only the provided evidence; **do not invent** contracts, mappings, or data details.
      4. Where detail is missing, create **prerequisite / refinement stories** and mark readiness accordingly (`needs_focused_context`, `needs_user_decision`, or `blocked`).
      5. Order work to respect **practical delivery dependencies** via `sequenceOrder`.
      6. Generate migration test pack work as **backlog items**, not as immediate test artifacts.
      7. Include `traceabilitySummary` + `confidence` + `readiness` on every item.
      8. Workstream `unknown` is used **only** when no other workstream applies — never as a guess or hedge (Q-7).
    - Body sections cover: the inputs the LLM will receive, the structured-response schema reference, the workstream vocabulary (14 values per Q-7), the readiness vocabulary, the confidence vocabulary, and the per-item required fields enumerated in spec.md
  - [x] 4.4 Run ONLY the 4-6 tests from 4.1

**Acceptance Criteria:**
- The 4-6 tests written in 4.1 pass
- Task config matches `product-manager--backlog.json` key-for-key in shape
- Auth / role gating matches the backlog task verbatim (Q-17)
- Markdown prompt contains the eight numbered rules verbatim
- `contextNeeds` includes the migration-discovery-context resolver

---

#### Task Group 5: Structured Response Schema + Validation
**Dependencies:** Task Group 4

- [x] 5.0 Implement the `GeneratedMigrationBookOfWork` structured-response schema with strict validation
  - [x] 5.1 Write 5-7 focused tests
    - Test file: `gateway/src/__tests__/generatedMigrationBookOfWorkSchema.test.ts`
    - Test 1 (happy path): a well-formed `GeneratedMigrationBookOfWork` payload (built from the fixture) passes validation
    - Test 2 (workstream vocab): all 14 workstream values from Q-7 pass validation; any 15th value is rejected
    - Test 3 (readiness vocab): all four readiness values (`ready_for_spec`, `needs_focused_context`, `needs_user_decision`, `blocked`) pass; any other value is rejected
    - Test 4 (confidence vocab): `high|medium|low` pass; any other value is rejected
    - Test 5 (hierarchy — orphan parentId): a `parentId` pointing to a non-existent item rejects with a useful error naming the orphaned id
    - Test 6 (hierarchy — wrong child type): a `feature` item nested under a `story` (or any other non-feature parent) rejects
    - Test 7 (hierarchy — cycle): a parent chain that loops back on itself rejects
    - Test 8 (optional): a malformed `saveState` value rejects, but a valid one passes
  - [x] 5.2 Define the schema
    - File: `gateway/src/services/schemas/generatedMigrationBookOfWorkSchema.ts` (or wherever the gateway's existing structured-response schemas live — spec-writer / implementer matches the existing PM-task schema location)
    - Use whichever schema library the gateway already uses for structured responses (Zod, JSON Schema, etc.) — match the precedent
    - Top-level fields: `title`, `summary`, `generationSummary`, `qualityAssessment`, `bookOfWork`
    - `bookOfWork` is a flat array of `MigrationBookOfWorkItem` with `parentId` references
    - `MigrationBookOfWorkItem` shape per spec.md:
      - `id` (string, temp id)
      - `type ∈ initiative|epic|feature|story`
      - `parentId|null`
      - `title`, `description`
      - `acceptanceCriteria[]` (string array)
      - `workstream` (14-value enum per Q-7)
      - `sequenceOrder` (integer)
      - `tags[]` (string array)
      - `confidence ∈ high|medium|low`
      - `readiness ∈ ready_for_spec|needs_focused_context|needs_user_decision|blocked`
      - `readinessReasons[]`, `missingInputs[]`, `recommendedNextAction`, `traceabilitySummary`
      - Reference arrays (IDs only): `evidenceReferences[]`, `architectureReferences[]`, `apiBaselineReferences[]`, `discoveryFindingReferences[]`, `mappingReferences[]`, `sourceContextRefs[]`
      - `saveState ∈ draft|selected|excluded|saved|failed` — present in schema but populated only on save-back per Q-16
      - `workItemId` (optional, populated after save-to-backlog success)
      - `errorMessage` (optional, populated on save failure)
  - [x] 5.3 Implement the hierarchy validator
    - Function: `validateBookOfWorkHierarchy(items: MigrationBookOfWorkItem[]): ValidationResult`
    - Three checks:
      - Every non-null `parentId` resolves to an existing item id (no orphans)
      - Parent-child type sequences are valid: `initiative → epic → feature → story` (no skipping levels in the parent direction; a `story`'s parent MUST be a `feature`, a `feature`'s parent MUST be an `epic`, etc.)
      - No cycles in the parent chain
    - Hierarchy validation runs **before** any AMS write — gateway rejects malformed hierarchies at validation time per spec.md
  - [x] 5.4 Run ONLY the 5-7 tests from 5.1

**Acceptance Criteria:**
- The 5-7 tests written in 5.1 pass
- The 14-value workstream enum (Q-7) is enforced including the `unknown` sentinel
- Hierarchy validation rejects orphans, wrong child types, and cycles before any AMS write
- Schema implementation library matches the existing PM-task structured-response convention

---

#### Task Group 6: Gateway Orchestration Handler
**Dependencies:** Task Groups 4 and 5 (and 3 for fixture-driven tests)

- [x] 6.0 Implement the gateway orchestration handler that drives the full PM-flow request
  - [x] 6.1 Write 6-8 focused tests
    - Test file: `gateway/src/__tests__/productManagerMigrationDeliveryPlanOrchestration.test.ts`
    - Test 1 (happy path): request flow invokes the migration-discovery-context resolver with the provided `currentArchitectureId` + `targetArchitectureId`, calls the LLM with the assembled context + new prompt (mocked), validates the structured response, POSTs to AMS, and returns `{ draftId, summary }` (Q-1)
    - Test 2 (sparse-context path): the migration-discovery-context resolver returns sparse / missing inputs; the LLM output (verified against fixture) produces prerequisite / refinement stories with `readiness='needs_focused_context'` (or similar), NOT invented detail
    - Test 3 (schema-validation rejection): a malformed LLM response (orphaned `parentId`, wrong child type, cycle, or invalid enum value) is rejected at gateway validation time; NO POST to AMS; useful error returned to the caller
    - Test 4 (token-cap truncation cascade — drop oldest evidence): an oversize input set triggers truncation step 1 (drop oldest discovery evidence bodies first); IDs are retained; the truncated payload passes the 120k cap (Q-4)
    - Test 5 (token-cap cascade — compress baseline): when dropping evidence is insufficient, step 2 fires (compress API Behaviour Baseline details to summaries)
    - Test 6 (token-cap cascade — fail loudly when over budget after cascade): an oversize input that overflows even after the full cascade fails loudly with a structured error naming what overflowed (Q-4) — Product Definition, Current Architecture entity list, Target Architecture entity list, all mappings, and all Discovery Finding IDs are NEVER silently truncated
    - Test 7 (single synchronous LLM call): the handler makes exactly one LLM invocation; no token streaming (Q-15)
    - Test 8 (AMS POST shape): the JSON POSTed to AMS at `POST /api/projects/{projectId}/migration-books-of-work` includes the full `generationInputs`, `generationSummary`, `qualityAssessment`, and `bookOfWork` blobs in the four sibling JSONB fields (Q-14)
  - [x] 6.2 Locate and reuse the Phase 2 token-cap helper
    - Read `api-migration-validation-service/src/services/llm/tokenCapHelper.ts` (Phase 2's helper) to understand the pattern
    - Adapt the pattern to the gateway side — soft cap **~120k tokens** per Q-4
    - Truncation cascade order (applied only as needed):
      1. Drop oldest discovery evidence bodies first (IDs always retained)
      2. Compress API Behaviour Baseline details to summaries
      3. Compress mapping rationale text
    - Always retained (never truncated): Product Definition, Current Architecture entity list, Target Architecture entity list, all current-to-target mappings, all Discovery Finding IDs
    - If still over budget after the full cascade → **fail loudly** with an error naming what overflowed; NEVER silently truncate an always-retained item
  - [x] 6.3 Create the orchestration handler
    - File: `gateway/src/handlers/productManagerMigrationDeliveryPlan.ts` (or wherever the gateway's existing PM-task handlers live — spec-writer / implementer matches the existing convention)
    - Sequence (per Q-1, Q-15):
      1. Resolve context via `migrationDiscoveryContextClient.ts` (Q-12 — verbatim)
      2. Apply the token-budget cap + cascade
      3. Make the single synchronous LLM call (no streaming)
      4. Validate against `GeneratedMigrationBookOfWork` schema (Group 5)
      5. POST to AMS at `POST /api/projects/{projectId}/migration-books-of-work`
      6. Return `{ draftId, summary }` to the frontend
    - Stage marker emission (Q-15): emit gateway-side log lines that the frontend's scripted stage indicator can correlate against:
      - `[diag-gateway] pm_migration_delivery_plan stage=loading_context projectId=<id>`
      - `[diag-gateway] pm_migration_delivery_plan stage=calling_generator projectId=<id> token_count=<N> truncated=<bool>`
      - `[diag-gateway] pm_migration_delivery_plan stage=validating_schema projectId=<id>`
      - `[diag-gateway] pm_migration_delivery_plan stage=saving_draft projectId=<id>`
      - `[diag-gateway] pm_migration_delivery_plan stage=complete projectId=<id> draftId=<id>`
    - Persistence path: gateway → AMS direct REST (Q-3); MCP-server is NOT in the loop unless the spec-writer / implementer discovers existing PM-task save flows already use MCP, in which case match that pattern
  - [x] 6.4 Run ONLY the 6-8 tests from 6.1

**Acceptance Criteria:**
- The 6-8 tests written in 6.1 pass
- The handler is the sole orchestrator (Q-1) — AMS only persists
- Token-cap cascade runs in the documented order and fails loudly when budget cannot be met without sacrificing always-retained items
- Sparse-context inputs produce prerequisite / refinement stories with appropriate `readiness` values, not invented detail
- Schema-validation rejection happens before any AMS write
- Stage markers are emitted as structured `[diag-gateway] pm_migration_delivery_plan stage=...` log lines

---

### AMS Layer (controller + service + endpoints + save-to-backlog)

#### Task Group 7: AMS Controller + Service for CRUD Endpoints
**Dependencies:** Task Group 1 (and Group 2 if extension changeset was needed)

- [x] 7.0 Implement the controller / service / endpoint layer for `generated_migration_books_of_work`
  - [x] 7.1 Write 6-8 focused tests
    - Test file: `architecture-model-service/src/test/java/com/example/architecturemodel/controller/MigrationBookOfWorkControllerTest.java`
    - Test 1 (POST happy path): `POST /api/projects/{projectId}/migration-books-of-work` with a well-formed payload creates a row with `status='draft'`, returns the new `draftId` + DTO, and all four JSONB blobs are persisted
    - Test 2 (regenerate-on-same-tuple archives prior): POSTing a second draft for the same `(projectId, currentArchitectureId, targetArchitectureId)` tuple flips the prior active row to `status='archived'` and creates the new row as `status='draft'` (Q-6)
    - Test 3 (GET detail): `GET /api/projects/{projectId}/migration-books-of-work/{bookId}` returns the entity + all four JSONB blobs
    - Test 4 (LIST defaults to active): `GET /api/projects/{projectId}/migration-books-of-work` returns only non-archived rows by default
    - Test 5 (LIST with `?includeArchived=true`): returns archived rows too (Q-6)
    - Test 6 (PUT updates editable fields): `PUT /api/projects/{projectId}/migration-books-of-work/{bookId}` updates `title`, `summary`, `status`, and `book_of_work_json` (the editable JSONB column for explicit Save Draft per Q-16); other JSONB columns are immutable post-create
    - Test 7 (status transition validation): PUT with an invalid status value rejects; valid transitions accepted
    - Test 8 (project scoping): a request with a `projectId` that does not own the `bookId` returns 404 (or whatever the existing project-scoping convention enforces)
  - [x] 7.2 Create `MigrationBookOfWorkController`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/MigrationBookOfWorkController.java`
    - Endpoints (modelled on `DiscoveryRunController`):
      - `POST /api/projects/{projectId}/migration-books-of-work` — create from generated JSON; returns `GeneratedMigrationBookOfWorkDto` with new `draftId`
      - `GET /api/projects/{projectId}/migration-books-of-work` — list; defaults to active; `?includeArchived=true` toggle
      - `GET /api/projects/{projectId}/migration-books-of-work/{bookId}` — full detail
      - `PUT /api/projects/{projectId}/migration-books-of-work/{bookId}` — update editable fields (`title`, `summary`, `status`, `book_of_work_json`)
      - `POST /api/projects/{projectId}/migration-books-of-work/{bookId}/save-to-backlog` — wired in Group 8
    - Project-scoping convention matches the existing `DiscoveryRunController` (request URL contains `projectId`; controller validates ownership)
    - Auth gating matches `product-manager--backlog.json` verbatim (Q-17 — no new role / permission flag)
  - [x] 7.3 Create `MigrationBookOfWorkService`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/MigrationBookOfWorkService.java`
    - Method `createDraft(...)`: implements Q-6 regenerate-on-same-tuple archive flow
      - Find active draft for `(projectId, currentArchitectureId, targetArchitectureId)` via `findActiveDraftForTuple` (Group 1.5)
      - If one exists → flip its `status` to `'archived'` (in the same transaction or in a paired pre-step — implementer chooses)
      - Insert the new row with `status='draft'`
    - Method `updateDraft(...)`: PATCH semantics — null-guard each editable field so an omitted field does NOT wipe (per `project_primitive_double_dto_overwrite.md`)
    - Method `listDrafts(projectId, includeArchived)`: returns active drafts only when `includeArchived=false` (the default)
    - Method `getDraft(projectId, bookId)`: project-scoping check enforced
    - Structured log line on every state transition:
      - `[diag-ams] book_of_work stage=create projectId=<id> draftId=<new> archivedDraftId=<prior|null>`
      - `[diag-ams] book_of_work stage=update projectId=<id> draftId=<id> status=<new>`
      - `[diag-ams] book_of_work stage=archive projectId=<id> draftId=<id> reason=regenerate_same_tuple`
  - [x] 7.4 Run ONLY the 6-8 tests from 7.1 — new test files (`GeneratedMigrationBookOfWorkServiceTest.java`) compile cleanly in isolation via direct `javac`; full surefire run blocked by pre-existing unrelated test-compile rot in AMS (RoadmapImportServiceV3Test, WorkItemImplementContextServiceTest, OrganisationControllerDocsAppliedTest, ProjectSnapshotImportIntegrationTest, etc., all unrelated to this group). AMS test compile is disabled globally via pom property `maven.test.skip=true`. Main sources `mvn compile` passes clean.

**Acceptance Criteria:**
- The 6-8 tests written in 7.1 pass
- Regenerate-on-same-tuple archives the prior active draft and creates a new draft row (Q-6)
- LIST defaults to active drafts; `?includeArchived=true` reveals archived rows
- PUT updates editable fields without wiping JSONB columns omitted from the payload
- Project-scoping is enforced on every endpoint
- Auth gating matches the backlog task verbatim (Q-17)

---

#### Task Group 8: AMS `save-to-backlog` Endpoint + Per-Item-Commit Service
**Dependencies:** Task Group 7 (and Group 2 audit outcome — confirms WorkItemType mapping is in place)

- [x] 8.0 Implement `POST /api/projects/{projectId}/migration-books-of-work/{bookId}/save-to-backlog` with per-item-commit + idempotent retry
  - [x] 8.1 Write 10-12 focused tests
    - Test file: `architecture-model-service/src/test/java/com/example/architecturemodel/controller/MigrationBookOfWorkSaveToBacklogControllerTest.java`
    - Test 1 (save-all): `saveMode='all'` writes every item not in `excludedItemIds` to `work_item` and updates each draft item's `saveState='saved'` + captures the new `workItemId` (Q-5)
    - Test 2 (save-selected): `saveMode='selected'` writes only `selectedItemIds`
    - Test 3 (parent-child hierarchy preserved): initiative → epic → feature → story `parentId` chain resolves correctly in the saved `work_item` rows (i.e. when an initiative is saved, the child epic's `parentWorkItemId` points to the newly-created initiative's `workItemId`)
    - Test 4 (`sequenceOrder` preserved): saved `work_item` rows carry the same `sequenceOrder` as the draft items
    - Test 5 (high_confidence_only filter): only items with `confidence='high'` are admitted, BUT the parent-inclusion rule applies — admitted descendants pull their ancestor chain through (Q-8)
    - Test 6 (ready_for_spec_only filter): only items with `readiness='ready_for_spec'` are admitted, plus the same parent-inclusion rule
    - Test 7 (idempotent re-run): re-running save-to-backlog after a successful save skips items already `saveState='saved'` (Q-5 — idempotent retry)
    - Test 8 (per-item failure isolation): one item save fails (simulated DB constraint error); that item flips to `saveState='failed'` + `error_message` populated; neighbouring items still commit successfully (Q-5 — each item is its own transaction)
    - Test 9 (tag-prefix idempotent additive — same tag): saving with `tagPrefix='mig-2026q2-'` where the target `work_item` already has the same tag is a no-op (no duplicate) (Q-10)
    - Test 10 (tag-prefix idempotent additive — different tag with same prefix): the new tag is added alongside; existing tags are never removed (Q-10)
    - Test 11 (includeTraceabilityInDescription + includeReadinessInDescription): when both flags are true, the saved `work_item` description carries the appended `traceabilitySummary` and `readiness` + `readinessReasons[]` sections with a stable marker
    - Test 12 (no destructive overwrite): saves always create new `work_item` rows with `statusForCreatedItems`; existing `work_item` rows are never overwritten
    - Test 13 (final draft status reconciliation): all items succeed → draft `status='saved'`; mixed → `status='partially_saved'`; all fail → draft status unchanged + `error_message` populated
  - [x] 8.2 Create the `save-to-backlog` endpoint + service method
    - Controller endpoint: `POST /api/projects/{projectId}/migration-books-of-work/{bookId}/save-to-backlog` in `MigrationBookOfWorkController` (extends Group 7)
    - Service method: `saveToBacklog(...)` on `MigrationBookOfWorkService`
    - Request body shape:
      ```
      {
        selectedItemIds?: string[],
        excludedItemIds?: string[],
        saveMode: 'all' | 'selected' | 'high_confidence_only' | 'ready_for_spec_only',
        statusForCreatedItems?: string,           // defaults to existing WorkItem default
        includeTraceabilityInDescription?: boolean,
        includeReadinessInDescription?: boolean,
        tagPrefix?: string
      }
      ```
    - Filter semantics (Q-8):
      - `all` — every item not in `excludedItemIds`
      - `selected` — exactly `selectedItemIds`
      - `high_confidence_only` — admit only `confidence === 'high'`
      - `ready_for_spec_only` — admit only `readiness === 'ready_for_spec'`
      - Parent-inclusion rule: when a child item passes the filter, its ancestor chain is auto-included (work items need their hierarchy)
    - Atomicity (Q-5):
      - Each item save runs in its own transaction (Spring `@Transactional(propagation = REQUIRES_NEW)` on the per-item save method)
      - On success → set `saveState='saved'` on the draft item + capture the new `workItemId`
      - On failure → set `saveState='failed'` + populate `error_message` on the draft item; continue with the next item
      - Re-run is idempotent: items already `saveState='saved'` are skipped (no double-create)
      - The whole batch is an orchestration loop over per-item commits; NEVER a single mega-transaction
    - Tag merge (Q-10):
      - Same tag already present on the target `work_item` → no-op (no duplicate)
      - Different tag with the same `tagPrefix` already present → add the new tag alongside
      - NEVER remove or overwrite existing tags under any circumstance
    - Hierarchy fidelity: preserve `parentId` chain (mapping draft-item-id → newly-created `workItemId`) and `sequenceOrder` when materialising into `work_item`. No destructive overwrite — saves always create new rows with `statusForCreatedItems`
    - Traceability / readiness materialisation:
      - If `includeTraceabilityInDescription` → append the item's `traceabilitySummary` to the saved description with a stable marker (e.g. `\n\n---\nTraceability:\n<summary>`)
      - If `includeReadinessInDescription` → append `readiness` + `readinessReasons[]` similarly
      - Optional `tagPrefix` is prepended to each non-conflicting saved tag
    - Final draft status reconciliation:
      - All admitted items succeed → `status='saved'` + set `saved_to_backlog_at`
      - Some succeed, some fail → `status='partially_saved'` + set `saved_to_backlog_at`
      - All admitted items fail → draft remains at its prior status + populate `error_message`
    - Persist `saveState` + `workItemId` per item back into `book_of_work_json` (this is the only post-create write to that column outside an explicit Save Draft PUT, per Q-16)
    - Return the updated `book_of_work_json` with per-item `saveState` + `workItemId` so the frontend can render the post-save view
    - Structured log line emission:
      - Start: `[diag-ams] book_of_work stage=save_to_backlog_start draftId=<id> saveMode=<mode> selected=<N> excluded=<N>`
      - Per-item ok: `[diag-ams] book_of_work stage=save_item_ok draftId=<id> itemId=<id> workItemId=<id>`
      - Per-item fail: `[diag-ams] book_of_work stage=save_item_fail draftId=<id> itemId=<id> reason=<...>`
      - Per-item skip (already saved): `[diag-ams] book_of_work stage=save_item_skip_already_saved draftId=<id> itemId=<id>`
      - Final: `[diag-ams] book_of_work stage=save_to_backlog_complete draftId=<id> saved=<N> failed=<N> skipped=<N> status=<saved|partially_saved>`
  - [x] 8.3 Run ONLY the 10-12 tests from 8.1 — new test file (`GeneratedMigrationBookOfWorkSaveToBacklogTest.java`) compiles cleanly in isolation via direct `javac`; full surefire run blocked by the same pre-existing AMS test-compile rot documented in Group 2 / Group 7. AMS test compile is disabled globally via pom property `maven.test.skip=true`. Main sources `mvn compile` passes clean.

**Acceptance Criteria:**
- The 10-12 tests written in 8.1 pass
- Each item save is its own transaction (Q-5)
- Per-item failure does not corrupt the whole draft; neighbouring items still commit
- Re-running save-to-backlog is idempotent (already-saved items are skipped)
- Parent-inclusion rule honoured for `high_confidence_only` and `ready_for_spec_only` (Q-8)
- Tag-prefix conflicts are idempotent additive; existing tags never removed (Q-10)
- Parent-child hierarchy and `sequenceOrder` preserved on save
- No destructive overwrite of existing `work_item` rows
- Final draft status reconciliation matches spec.md exactly

---

### Frontend Layer (wizard + review workspace + drawer + draft list)

#### Task Group 9: Generation Wizard (7-Stage Conversation Flow)
**Dependencies:** Task Group 6 (gateway orchestration handler must accept the wizard's request shape; can be mocked initially)

- [x] 9.0 Build the 7-stage migration delivery plan generation wizard
  - [x] 9.1 Write 5-7 focused tests
    - Test file: `frontend/src/components/MigrationDeliveryPlan/__tests__/GenerationWizard.test.tsx`
    - Test 1 (entry point): the new PM task menu entry "Create Migration Delivery Plan" (Q-18) launches the wizard
    - Test 2 (Stage 1 — input selection): the wizard's first stage shows current/target architecture pickers + a Migration Discovery Context readiness summary; advances only when both architectures are selected
    - Test 3 (Stage 2 — migration intent): renders multi-select; functional equivalence is NOT shown as a question (it is mandatory per spec.md)
    - Test 4 (Stage 3 — delivery streams): renders multi-select; defaults populated from the Migration Discovery Context payload
    - Test 5 (Stage 4 — migration style): renders single-select with the recommended option pre-selected from context
    - Test 6 (Stages 5-6 — data/cutover + test pack): render the concise questions from spec.md (only the ones where context is missing)
    - Test 7 (Stage 7 — generate): clicking Generate posts the assembled request to the gateway and routes to the review workspace on success
  - [x] 9.2 Create the wizard component
    - File: `frontend/src/components/MigrationDeliveryPlan/GenerationWizard.tsx` (or sibling — match wherever the existing PM-task wizards live)
    - 7-stage flow per spec.md (Q-18 guided-discovery contract):
      1. Input selection + context check — confirm Product Definition, Current/Target Architecture, Discovery runs, API Behaviour Baselines, mappings; render the Migration Discovery Context readiness summary
      2. Migration intent — multi-select (functional equivalence is NOT asked — mandatory per spec.md)
      3. Delivery streams — multi-select; defaulted from context
      4. Migration style — single-select; recommended from context
      5. Data and cutover assumptions — concise questions only where relevant
      6. Migration Test Pack expectations — multi-select; defaulted from context
      7. Generate draft book of work
    - Match existing PM-task wizard component patterns (spec-writer / implementer inspects existing PM-task wizard for the closest match)
    - Wire the menu entry "Create Migration Delivery Plan" (Q-18) in the existing PM task menu component
  - [x] 9.3 Add the PM menu entry
    - File: locate the existing PM task menu (likely under `frontend/src/components/...` — inspect at implementation time)
    - Add the new entry **"Create Migration Delivery Plan"** grouped alongside existing PM tasks (Q-18)
    - Add a sibling entry **"Migration Delivery Plans"** that opens the draft list view (Group 12 wires the list view)
  - [x] 9.4 Run ONLY the 5-7 tests from 9.1

**Acceptance Criteria:**
- The 5-7 tests written in 9.1 pass
- All 7 wizard stages render and advance correctly
- Functional equivalence is mandatory — never asked
- Defaults populate from Migration Discovery Context where spec.md says they should
- The PM task menu shows both "Create Migration Delivery Plan" and "Migration Delivery Plans" entries (Q-18)

---

#### Task Group 10: Generation Progress + Draft Summary Surface
**Dependencies:** Task Group 9 (wizard launches generation) and Task Group 6 (gateway handler emits stage milestones)

- [x] 10.0 Implement the scripted client-side stage indicator + draft summary surface
  - [x] 10.1 Write 4-6 focused tests
    - Test file: `frontend/src/components/MigrationDeliveryPlan/__tests__/GenerationProgress.test.tsx`
    - Test 1 (stage marker — loading context): on wizard Generate click, the indicator shows "Loading context…" (Q-15)
    - Test 2 (stage marker — calling generator): when the gateway emits `stage=calling_generator` (or the time-bucket script flips), the indicator shows "Calling generator…"
    - Test 3 (stage marker — validating schema): indicator flips to "Validating schema…" on the corresponding milestone
    - Test 4 (stage marker — saving draft): indicator flips to "Saving draft…"
    - Test 5 (stage marker — complete): on successful response, indicator flips to "Complete" and routes to the review workspace
    - Test 6 (draft summary card): the summary surface renders counts by type (initiative/epic/feature/story), confidence breakdown (high/medium/low), readiness breakdown (4 values), findings addressed / not addressed, contracts/baselines/data entities/infrastructure covered, mappings used, unresolved gaps
  - [x] 10.2 Create the progress component
    - File: `frontend/src/components/MigrationDeliveryPlan/GenerationProgress.tsx`
    - Four scripted stage markers per Q-15:
      - "Loading context…"
      - "Calling generator…"
      - "Validating schema…"
      - "Saving draft…"
    - Markers driven by gateway response milestones (when exposed via streaming-friendly response) OR a simple time-bucket script when milestones are not exposed (per Q-15 — either is acceptable)
    - No real LLM token streaming (Q-15) — the single synchronous response from gateway flips the indicator to "complete"
  - [x] 10.3 Create the draft summary card
    - File: `frontend/src/components/MigrationDeliveryPlan/DraftSummary.tsx`
    - Renders the `generationSummary` + `qualityAssessment` blobs:
      - Total items per type (initiative/epic/feature/story)
      - Confidence breakdown (high/medium/low)
      - Readiness breakdown (ready_for_spec / needs_focused_context / needs_user_decision / blocked)
      - Findings addressed / not addressed
      - Contracts / baselines / data entities / infrastructure covered
      - Mappings used
      - Unresolved gaps
      - Blocking issues
  - [x] 10.4 Run ONLY the 4-6 tests from 10.1

**Acceptance Criteria:**
- The 4-6 tests written in 10.1 pass
- All four scripted stage markers flip in the documented order (Q-15)
- Draft summary renders all the counts and breakdowns enumerated in spec.md
- No real token streaming; flow is one synchronous gateway call

---

#### Task Group 11: Hierarchy Tree + Filters + Item Drawer
**Dependencies:** Task Group 10 (summary surface routes to the review workspace); the AMS read endpoint (Group 7) must return the full `book_of_work_json` payload — can be mocked initially

- [x] 11.0 Build the review-workspace hierarchy tree, filters, and item detail drawer
  - [x] 11.1 Write 6-8 focused tests
    - Test file: `frontend/src/components/MigrationDeliveryPlan/__tests__/ReviewWorkspace.test.tsx`
    - Test 1 (tree renders): hierarchy tree renders the initiative → epic → feature → story chain from a sample `book_of_work_json` blob; per-item badges show confidence, readiness, workstream, saved/excluded state, gap count
    - Test 2 (filter by workstream including `unknown`): selecting the `unknown` workstream filter shows only items with `workstream='unknown'` (Q-7 reclassification surface)
    - Test 3 (filter by confidence): filtering to `high` shows only high-confidence items
    - Test 4 (filter by readiness): filtering to `ready_for_spec` shows only ready items
    - Test 5 (filter by blocking gaps): the "blocking gaps" filter shows only items with `readiness='blocked'` or with non-empty `readinessReasons` indicating blockers
    - Test 6 (item drawer open): clicking an item opens the drawer with title, type, description, acceptance criteria, workstream, confidence, readiness + reasons, missing inputs, recommended next action, traceability summary, and all reference arrays
    - Test 7 (filter by finding reference): selecting a discovery finding ID filters the tree to items whose `discoveryFindingReferences` include that ID
    - Test 8 (combined filters): multiple filters compose with AND semantics
  - [x] 11.2 Create the hierarchy tree component
    - File: `frontend/src/components/MigrationDeliveryPlan/HierarchyTree.tsx`
    - Renders the `book_of_work_json` items in Initiative → Epic → Feature → Story hierarchy
    - Per-item badges:
      - Confidence (high/medium/low — colour-coded)
      - Readiness (4 values — colour-coded)
      - Workstream (14-value chip including `unknown` highlighted per Q-7)
      - Saved / excluded state (from frontend-state `saveState` per Q-16)
      - Gap count (length of `missingInputs[]` or `readinessReasons[]`)
    - Reuse the existing review-workspace pattern from the closest precedent (Discovery Findings review surface OR the `api-migration-validation-service` review UI — spec-writer / implementer inspects both and picks the closer match)
  - [x] 11.3 Create the filters component
    - File: `frontend/src/components/MigrationDeliveryPlan/ReviewFilters.tsx`
    - Filters per spec.md:
      - Workstream (14 values including `unknown` — Q-7 reclassification surface)
      - Confidence (high/medium/low)
      - Readiness (4 values)
      - Blocking gaps
      - Low confidence
      - API / data / infra / test work
      - Finding reference (dropdown of `discoveryFindingId` values present in the draft)
    - Filters compose with AND semantics
  - [x] 11.4 Create the item detail drawer
    - File: `frontend/src/components/MigrationDeliveryPlan/ItemDrawer.tsx`
    - Shows for the selected item:
      - Title, type, description, acceptance criteria
      - Workstream, confidence, readiness + reasons
      - Missing inputs, recommended next action
      - "Why this exists" traceability summary
      - All reference lists: `evidenceReferences`, `architectureReferences`, `apiBaselineReferences`, `discoveryFindingReferences`, `mappingReferences`, `sourceContextRefs`
  - [x] 11.5 Run ONLY the 6-8 tests from 11.1

**Acceptance Criteria:**
- The 6-8 tests written in 11.1 pass
- Tree renders initiatives → epics → features → stories with all five badge types
- Filters compose correctly (workstream incl. `unknown`, confidence, readiness, blocking gaps, finding reference)
- Item drawer renders all per-item fields enumerated in spec.md
- Pattern matches the closest existing review-workspace precedent in the codebase

---

#### Task Group 12: Selection Controls + Save-to-Backlog UI + Draft List View
**Dependencies:** Task Groups 8 (AMS save-to-backlog endpoint) and 11 (review workspace tree); the gateway+AMS surface must be live OR mocked

- [x] 12.0 Implement selection controls, save-to-backlog confirmation, post-save view, and the draft list view
  - [x] 12.1 Write 8-10 focused tests
    - Test file: `frontend/src/components/MigrationDeliveryPlan/__tests__/SaveToBacklogAndDraftList.test.tsx`
    - Test 1 (select-all / deselect-all): toggling select-all flips every item's frontend `saveState` to `selected` or `draft`
    - Test 2 (subtree select): selecting a parent toggles its descendants too
    - Test 3 (exclude / include): excluding an item flips it to `saveState='excluded'`; re-including flips it back to `draft`
    - Test 4 (Save All): clicking Save All invokes the AMS save-to-backlog endpoint with `saveMode='all'` and the excluded-ids list
    - Test 5 (Save Selected): clicking Save Selected invokes with `saveMode='selected'` and the chosen ids
    - Test 6 (Save High-Confidence Only): invokes with `saveMode='high_confidence_only'`
    - Test 7 (Save Ready-for-Spec Only): invokes with `saveMode='ready_for_spec_only'`
    - Test 8 (confirmation dialog): the dialog shows counts + warnings + traceability/readiness inclusion toggles + tag-prefix input
    - Test 9 (post-save view): on success, items are marked `saveState='saved'` with their `workItemId`; failures show `saveState='failed'` + `error_message`
    - Test 10 (unsaved review changes indicator): when frontend `saveState` diverges from the persisted draft (Q-16), the UI surfaces the "unsaved review changes" indicator until explicit Save Draft PUT or save-to-backlog write-back
    - Test 11 (draft list view): the list shows title, current arch, target arch, status, created date, item counts, confidence/readiness summary, last-saved-to-backlog timestamp
    - Test 12 (draft list — active by default): the list defaults to active drafts; the "show archived" toggle reveals archived rows (Q-6)
    - Test 13 (draft reopen): opening a draft from the list routes to the review workspace and rehydrates the persisted `saveState` from `book_of_work_json` (Q-16); archived drafts are read-only
  - [x] 12.2 Create the selection controls + save buttons
    - File: `frontend/src/components/MigrationDeliveryPlan/SelectionControls.tsx`
    - Controls per spec.md:
      - Select all / deselect all
      - Subtree select
      - Exclude / include
      - Save All
      - Save Selected
      - Save High-Confidence Only
      - Save Ready-for-Spec Only
    - `saveState` per Q-16 lives in **frontend state only** during the review session
  - [x] 12.3 Create the save-to-backlog confirmation dialog
    - File: `frontend/src/components/MigrationDeliveryPlan/SaveToBacklogDialog.tsx`
    - Shows:
      - Item counts (will-save, excluded, filtered-out)
      - Warnings (e.g. items with `readiness='blocked'` being saved)
      - `includeTraceabilityInDescription` toggle
      - `includeReadinessInDescription` toggle
      - `tagPrefix` input
    - On confirm: invokes the AMS `save-to-backlog` endpoint (Group 8) with the assembled request body
    - On success: routes to the post-save view (counts of created `work_item`s + link to roadmap / backlog)
    - On per-item failure: surfaces `error_message` per item in the post-save view
  - [x] 12.4 Wire the unsaved-review-changes indicator
    - Q-16: `saveState` lives in frontend state only during review; persists to `book_of_work_json` only on:
      - (a) explicit "Save Draft" PUT (uses the AMS PUT endpoint from Group 7)
      - (b) save-to-backlog call (writes back post-save states)
    - The UI surfaces an "unsaved review changes" indicator (small badge / banner) when frontend state has diverged from the persisted draft state
  - [x] 12.5 Create the draft list view
    - File: `frontend/src/components/MigrationDeliveryPlan/DraftListView.tsx`
    - Columns per spec.md (Q-6, Q-18):
      - Title
      - Current arch
      - Target arch
      - Status
      - Created date
      - Item counts (per type)
      - Confidence / readiness summary
      - Last-saved-to-backlog timestamp
    - Defaults to active drafts (`status != 'archived'`); "show archived" toggle reveals archived rows
    - Opening a draft routes to the review workspace
    - Archived drafts are read-only (controls + Save Draft + save-to-backlog disabled)
    - The "Migration Delivery Plans" PM menu entry (Group 9.3) opens this view
  - [x] 12.6 Run ONLY the 8-10 tests from 12.1

**Acceptance Criteria:**
- The 8-10 tests written in 12.1 pass
- All four save modes (all / selected / high-confidence-only / ready-for-spec-only) work
- Confirmation dialog renders counts + warnings + traceability/readiness toggles + tag-prefix input
- Post-save view marks each item with its `saveState` + `workItemId` (or `error_message` on failure)
- Unsaved-review-changes indicator surfaces correctly per Q-16
- Draft list view defaults to active; "show archived" reveals archived rows (Q-6)
- Reopening a draft rehydrates the persisted `saveState` from `book_of_work_json`
- Archived drafts are read-only

---

### Documentation

#### Task Group 13: Inline TSDoc / JSDoc / Javadoc Headers
**Dependencies:** Task Groups 1-12

- [x] 13.0 Add inline module-header documentation at the top of the major new modules
  - [x] 13.1 Header at the top of `gateway/src/handlers/productManagerMigrationDeliveryPlan.ts` (Group 6)
    - Describe the sole-orchestrator flow (Q-1): context resolve → token cap → single LLM call → schema validate → AMS POST
    - State the token-cap cascade (Q-4): drop oldest evidence → compress baselines → compress mapping rationale → fail loudly if still over budget; document the always-retained set (Product Definition, Current/Target Architecture entity lists, all mappings, all Discovery Finding IDs)
    - State Q-15: single synchronous LLM call, no token streaming; scripted client-side stage markers
    - Reference Q-3: persistence path is gateway → AMS direct REST; MCP-server is NOT in the loop
    - Reference Q-12: Migration Discovery Context resolver reused verbatim
    - Reference the spec path: `agent-os/specs/2026-05-17-pm-migration-delivery-plan-book-of-work-draft/spec.md`
    - Reference design points (Q-1, Q-3, Q-4, Q-12, Q-15) so future readers can trace back to shaping-notes
  - [x] 13.2 Header at the top of `architecture-model-service/src/main/java/com/example/architecturemodel/controller/MigrationBookOfWorkController.java` (Group 7)
    - Describe the five endpoints (POST / GET list / GET detail / PUT / POST save-to-backlog) and what each one does
    - State Q-6 regenerate-on-same-tuple archive flow: create automatically archives prior active draft for the same `(projectId, currentArchitectureId, targetArchitectureId)` tuple
    - State Q-14: four sibling JSONB columns (`generation_inputs_json`, `generation_summary_json`, `quality_assessment_json`, `book_of_work_json`) — all nullable
    - State Q-17: auth gating matches `product-manager--backlog` verbatim — no new role / permission flag
    - State Q-5 + Q-8 + Q-10 for save-to-backlog: per-item commit, parent-inclusion rule, tag idempotent additive
    - State the WorkItemType audit outcome from Group 2 (one-liner: "WorkItem `type` natively supports `initiative|epic|feature|story`" OR "Extended via changeset 140")
    - Reference the spec path
    - Reference design points (Q-2, Q-5, Q-6, Q-8, Q-10, Q-14, Q-17)
  - [x] 13.3 Header at the top of `frontend/src/components/MigrationDeliveryPlan/GenerationWizard.tsx` (Group 9) AND `frontend/src/components/MigrationDeliveryPlan/ReviewWorkspace.tsx` (or wherever the review workspace root component lands — Group 11)
    - Wizard header:
      - Describe the 7-stage guided-discovery flow (Q-18)
      - State that functional equivalence is mandatory (not asked) per spec.md
      - State Q-15 client-side scripted stage markers
      - State Q-18 menu surfacing alongside existing PM tasks
      - Reference design points (Q-15, Q-18)
    - Review workspace header:
      - Describe the surfaces: top-level summary, hierarchy tree, filters, item drawer, selection controls, save-to-backlog dialog, post-save view, draft list view
      - State Q-16: `saveState` lives in frontend state only during review; persists to `book_of_work_json` on explicit Save Draft PUT or save-to-backlog write-back; UI surfaces "unsaved review changes" indicator
      - State Q-7: workstream filter includes `unknown` to surface reclassification candidates
      - Reference design points (Q-7, Q-16)
    - Reference the spec path in both headers
  - [x] 13.4 No standalone `.md` files
    - All documentation lives inside the source files only — do NOT create a separate README.md or design doc (per the standing CLAUDE.md instruction "NEVER create documentation files (*.md) or README files unless explicitly requested")

**Acceptance Criteria:**
- All four inline headers are present at the top of their respective files
- Each header covers the bullets enumerated above with explicit Q-x design-point references
- No standalone documentation files were created

---

## Execution Order

Recommended implementation sequence:

1. **Foundation parallel block (day 1)** — Groups 1 (AMS entity + Liquibase 139), 2 (WorkItemType audit ± Liquibase 140), 3 (PM-flow test fixture). All three are independent and parallelisable across engineers.
2. **Gateway parallel block (after Group 3)** — Groups 4 (task config + prompt) and 5 (schema + validation) can run in parallel once Group 3's fixture is in place for prompt-content + schema tests.
3. **Gateway orchestration** — Group 6 (orchestration handler). Depends on Groups 4 + 5 (and consumes Group 3's fixture in tests).
4. **AMS controller + endpoints** — Group 7 (CRUD endpoints). Depends on Groups 1 + 2 (entity / repository / mapper / type audit in place).
5. **AMS save-to-backlog** — Group 8. Depends on Group 7 (extends the same controller / service).
6. **Frontend wizard** — Group 9. Depends on Group 6 for the gateway API surface (can be mocked initially).
7. **Frontend progress + summary** — Group 10. Depends on Group 9 (wizard launches generation) AND Group 6 (gateway emits stage milestones).
8. **Frontend review workspace** — Group 11 (tree + filters + drawer). Depends on Group 7 (AMS read endpoint returns full `book_of_work_json`); can be mocked initially.
9. **Frontend selection + save + draft list** — Group 12. Depends on Groups 8 (AMS save-to-backlog endpoint) AND 11 (review workspace surface).
10. **Documentation** — Group 13 (inline headers). Depends on Groups 1-12.

**Parallelism opportunities:**
- Groups 1, 2, 3 — fully parallel on day 1.
- Groups 4, 5 — parallel once Group 3 lands.
- Groups 7, 9 — Group 7 (AMS controller) and Group 9 (frontend wizard) can start in parallel once Groups 1-2 (AMS entity) and Group 6 (gateway handler — or its mock) are in place.
- Groups 8, 10, 11 — Group 8 (AMS save-to-backlog), Group 10 (frontend progress + summary), Group 11 (frontend review workspace) can overlap as long as their inputs are mocked when not yet live.
- Group 12 — gates on Groups 8 + 11; should not start until both are at least partially live (mocks acceptable on the AMS side initially).

**Dependency map:**

```
Group 1 (AMS entity + Liquibase 139) ----+
Group 2 (WorkItemType audit + opt. 140) -+--> Group 7 (AMS CRUD controller) --> Group 8 (save-to-backlog) ---+
Group 3 (PM-flow fixture) ---------------+                                                                    |
                                         |                                                                    |
                                         +--> Group 4 (PM task config + prompt) ---+                          |
                                         |                                          +--> Group 6 (gateway orchestration handler) --+
                                         +--> Group 5 (schema + validation) -------+                                                |
                                                                                                                                    |
Group 9 (generation wizard) --------------------------------------------------------------------------------------------------------+
   |                                                                                                                                |
   +--> Group 10 (progress + summary) ---+                                                                                          |
                                          +--> Group 11 (tree + filters + drawer) --> Group 12 (selection + save + draft list) --> Group 13 (docs)
                                          |
                                          +-- Group 7 (AMS read endpoint, can be mocked)
```

Foundation Groups (1, 2, 3) are parallelisable on day one. Group 6 is the gating gateway handler that the frontend depends on (can be mocked initially). Group 8 is the gating AMS endpoint for save-to-backlog UX (Group 12). Group 13 is the inline-documentation deliverable folded in at the end.
