# Task Breakdown: Target State Captured Decisions — Data Plane

## Overview

Total Tasks: 8 task groups, 60 sub-tasks.

This spec is **backend-only** and ships under a **single commit boundary**. Task groups are sequenced so each layer can be verified incrementally before the final commit. Tests per group are capped at 2-4 (per Q18 in `planning/requirements.md`).

## Task List

### Architecture Model Service — Schema & Persistence

#### Task Group 1: Liquibase changeset, entity, repository
**Dependencies:** None

- [x] 1.0 Complete Architecture Model Service schema + JPA layer for `target_state_captured_decisions`
  - [x] 1.1 Write 2-4 focused tests for the repository layer
    - File: `architecture-model-service/src/test/java/com/example/architecturemodel/repository/TargetStateCapturedDecisionRepositoryTest.java`
    - Test 1: save a row and read it back by id with all UUID / `Instant` / nullable fields round-tripping correctly
    - Test 2: composite index lookup — repository custom query returns the latest non-superseded row for a given `(project_id, target_architecture_id, decision_code, scope_kind, scope_ref_id)` tuple
    - Test 3: `findByDecisionCode` returns rows across multiple scopes for a single `decision_code`
    - Limit to 2-4 highly focused tests; skip exhaustive column-by-column coverage
  - [x] 1.2 Identify the next free Liquibase changeset number
    - Inspect `architecture-model-service/src/main/resources/db/changelog/` (or wherever the changelog directory lives in this project) and pick the next free number after the current tail
    - Do NOT edit any applied changeset (per `feedback_liquibase_immutable_changesets.md`)
  - [x] 1.3 Create the new Liquibase changeset file
    - File: `architecture-model-service/src/main/resources/db/changelog/<next-number>-create-target-state-captured-decisions.xml` (match existing filename casing convention)
    - Table `target_state_captured_decisions` with columns per spec.md "AMS — schema" section: `id` UUID PK, `project_id` UUID NOT NULL, `target_architecture_id` UUID NOT NULL, `decision_code` VARCHAR NOT NULL, `scope_kind` VARCHAR NOT NULL, `scope_ref_type` VARCHAR NULL, `scope_ref_id` VARCHAR NULL, `answer_value` TEXT NOT NULL, `answer_summary` VARCHAR NULL, `standards_lookup_ref` VARCHAR NULL, `conversation_thread_id` VARCHAR NULL, `conversation_turn_ref` VARCHAR NULL, `created_at` TIMESTAMPTZ NOT NULL DEFAULT NOW(), `created_by_task` VARCHAR NOT NULL (no DB default), `superseded_by_id` UUID NULL
    - Self-FK from `superseded_by_id` to `target_state_captured_decisions.id`
    - No FK to `architecture_element_mappings` (per Q2 — reverse-discovery via notes tag)
    - No CHECK on `decision_code` values (per Q7 — open-ended)
  - [x] 1.4 Add the CHECK constraint enforcing the scope invariant
    - Constraint name: `target_state_captured_decisions_scope_invariant_chk` (or equivalent)
    - Logic: `(scope_kind = 'element' AND scope_ref_type IS NOT NULL) OR (scope_kind IN ('architecture', 'service', 'interface') AND scope_ref_type IS NULL)`
    - Plus: `scope_kind = 'architecture' ↔ scope_ref_id IS NULL` (per the spec-writer brief — architecture-scope rows carry no ref id)
  - [x] 1.5 Add the three indexes
    - `idx_target_state_captured_decisions_project_target` on `(project_id, target_architecture_id)`
    - `idx_target_state_captured_decisions_latest_per_scope` on `(project_id, target_architecture_id, decision_code, scope_kind, scope_ref_id)` — supports the "latest decision per scope" read path
    - `idx_target_state_captured_decisions_decision_code` on `(decision_code)` — cross-architecture analytics
  - [x] 1.6 Create `TargetStateCapturedDecisionEntity`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/entity/TargetStateCapturedDecisionEntity.java` (mirror the package convention used by the nearest existing entity such as the selective-copy entities)
    - JPA `@Entity`, `@Table(name = "target_state_captured_decisions")`
    - UUID-typed fields where DDL is UUID; `Instant` for `created_at`; nullable wrapper types throughout
    - Self-FK mapping for `superseded_by_id`: this is the first self-FK in Architecture Model Service — use `@ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "superseded_by_id")` pointing back to `TargetStateCapturedDecisionEntity`, with a companion `@OneToMany(mappedBy = ...)` only if a reverse traversal is actually needed (it is not for this spec — omit to keep the entity lean)
    - Add `@PrePersist` to default `created_at` to `Instant.now()` when not set (covers tests that bypass DB default)
  - [x] 1.7 Create `TargetStateCapturedDecisionRepository`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/TargetStateCapturedDecisionRepository.java`
    - Extends `JpaRepository<TargetStateCapturedDecisionEntity, UUID>`
    - Custom queries:
      - `Optional<TargetStateCapturedDecisionEntity> findLatestNonSupersededByTuple(UUID projectId, UUID targetArchitectureId, String decisionCode, String scopeKind, String scopeRefId)` — returns the row where `superseded_by_id IS NULL` for the given tuple (max one such row at any time per the supersession invariant)
      - `List<TargetStateCapturedDecisionEntity> findLatestNonSupersededForTarget(UUID projectId, UUID targetArchitectureId)` — all rows where `superseded_by_id IS NULL`
      - `List<TargetStateCapturedDecisionEntity> findAllForTarget(UUID projectId, UUID targetArchitectureId)` — including superseded rows
      - `List<TargetStateCapturedDecisionEntity> findLatestNonSupersededByDecisionCode(UUID projectId, UUID targetArchitectureId, String decisionCode)` — latest rows across all scopes for one code
    - `scope_ref_id` is nullable — use IS NULL-safe predicates (`(scope_ref_id = :ref OR (:ref IS NULL AND scope_ref_id IS NULL))`) in the tuple query
  - [x] 1.8 Ensure database layer tests pass
    - Run ONLY the 2-4 tests from 1.1
    - Verify the Liquibase changeset applies cleanly on a fresh schema and the CHECK constraint rejects an invalid `scope_kind='element'` insert with null `scope_ref_type` (covered by repository test or a dedicated assertion)
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-4 repository tests pass
- Liquibase changeset applies on a fresh database
- CHECK constraint and all three indexes are present
- Self-FK on `superseded_by_id` resolves correctly via JPA
- No applied Liquibase changeset has been modified

---

#### Task Group 2: Service layer with atomic supersession + cross-project guard
**Dependencies:** Task Group 1

- [x] 2.0 Complete `TargetStateCapturedDecisionService`
  - [x] 2.1 Write 2-4 focused tests for the service layer
    - File: `architecture-model-service/src/test/java/com/example/architecturemodel/service/TargetStateCapturedDecisionServiceTest.java`
    - Test 1: `createDecision` then a second `createDecision` with the same `(project, target_architecture, decision_code, scope_kind, scope_ref_id)` tuple — prior row's `superseded_by_id` equals the new row's id, both rows persisted, all in one transaction (use `@Transactional` test isolation with manual rollback assertion if needed)
    - Test 2: `listLatestDecisions` excludes superseded rows; `listAllDecisions` includes them
    - Test 3: `findByDecisionCode` returns latest rows across multiple scopes for one code
    - Test 4 (optional): `findById` returns the row when `project_id` + `target_architecture_id` match; returns empty (translated to 404 at controller) when they do not match
    - Limit to 2-4 tests; skip exhaustive scope-combination coverage
  - [x] 2.2 Create `TargetStateCapturedDecisionService`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/TargetStateCapturedDecisionService.java`
    - Spring `@Service` with constructor injection of `TargetStateCapturedDecisionRepository`
    - Method signatures:
      - `TargetStateCapturedDecisionEntity createDecision(UUID projectId, UUID targetArchitectureId, CreateTargetStateCapturedDecisionRequest request)`
      - `List<TargetStateCapturedDecisionEntity> listLatestDecisions(UUID projectId, UUID targetArchitectureId)`
      - `List<TargetStateCapturedDecisionEntity> listAllDecisions(UUID projectId, UUID targetArchitectureId)`
      - `Optional<TargetStateCapturedDecisionEntity> findById(UUID projectId, UUID targetArchitectureId, UUID decisionId)`
      - `List<TargetStateCapturedDecisionEntity> findByDecisionCode(UUID projectId, UUID targetArchitectureId, String decisionCode)`
  - [x] 2.3 Implement atomic supersession in `createDecision`
    - Annotate the method `@Transactional` (Spring default propagation — do NOT use `REQUIRES_NEW`, per spec Implementation Notes)
    - Insert the new row first; capture its id
    - Look up any prior non-superseded row for the same `(project_id, target_architecture_id, decision_code, scope_kind, scope_ref_id)` tuple via the repository
    - If found, set the prior row's `superseded_by_id` to the new row's id and save — both writes share the single transaction boundary
    - Invariant: at any consistent read, at most one row per tuple has `superseded_by_id IS NULL`
  - [x] 2.4 Implement cross-project leak protection on lookups
    - `findById` loads by id then verifies the loaded row's `project_id` matches the `projectId` argument AND `target_architecture_id` matches `targetArchitectureId`; on mismatch return `Optional.empty()` (controller translates to 404)
    - Same guard applied to any other single-row lookup path
    - Return 404, never 403 — avoid leaking existence (per Q15 and Implementation Notes)
    - Use plain English in any log line / error message ("Architecture Model Service captured-decision row …") per `feedback_no_invented_acronyms.md`
  - [x] 2.5 Implement list methods
    - `listLatestDecisions` delegates to `repository.findLatestNonSupersededForTarget`
    - `listAllDecisions` delegates to `repository.findAllForTarget`
    - `findByDecisionCode` delegates to `repository.findLatestNonSupersededByDecisionCode`
  - [x] 2.6 Ensure service layer tests pass
    - Run ONLY the 2-4 tests from 2.1
    - Verify the supersession test asserts both rows persisted and the prior row's `superseded_by_id` is set
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-4 service tests pass
- `createDecision` never leaves two non-superseded rows for the same tuple
- Supersession write shares the single `@Transactional` boundary with the insert
- Cross-project lookups return empty (translated to 404 at the controller)

---

#### Task Group 3: Controller, DTOs, active-target-lookup endpoint
**Dependencies:** Task Group 2

- [x] 3.0 Complete the REST surface and DTOs
  - [x] 3.1 Write 2-4 focused tests for the controller
    - File: `architecture-model-service/src/test/java/com/example/architecturemodel/controller/TargetStateCapturedDecisionsControllerTest.java`
    - Test 1: `POST /captured-decisions` happy path returns 201 with the new row as a `TargetStateCapturedDecisionDto`, and the JSON response uses lowerCamelCase keys (verifies `@JsonNaming(LowerCamelCaseStrategy.class)`)
    - Test 2: `GET /captured-decisions` default returns latest only; `?includeSuperseded=true` returns the full audit list
    - Test 3: `GET /captured-decisions/{decisionId}` returns 404 when the decision row's `project_id` or `target_architecture_id` does not match the path (cross-project guard)
    - Test 4: `GET /captured-decisions/by-code/{decisionCode}` returns the latest rows for that code across multiple scopes
    - Limit to 2-4 tests
  - [x] 3.2 Create the DTOs
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/targetstate/TargetStateCapturedDecisionDto.java` (mirror the package layout used by `MigrationDiscoveryContextDto` / selective-copy DTOs)
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/targetstate/CreateTargetStateCapturedDecisionRequest.java`
    - Both annotated with `@JsonNaming(LowerCamelCaseStrategy.class)`
    - Response DTO fields: `decisionId` (UUID), `projectId` (UUID), `targetArchitectureId` (UUID), `decisionCode` (String), `scopeKind` (String), `scopeRefType` (String, nullable), `scopeRefId` (String, nullable), `answerValue` (String), `answerSummary` (String, nullable), `standardsLookupRef` (String, nullable), `conversationThreadId` (String, nullable), `conversationTurnRef` (String, nullable), `createdAt` (Instant), `createdByTask` (String), `supersededById` (UUID, nullable)
    - Request DTO fields: `decisionCode`, `scopeKind`, `scopeRefType`, `scopeRefId`, `answerValue`, `answerSummary`, `standardsLookupRef`, `conversationThreadId`, `conversationTurnRef`, `createdByTask`
    - All numeric / boolean fields (none in this spec, but if any are added) use boxed types per `project_primitive_double_dto_overwrite.md`
  - [x] 3.3 Create `TargetStateCapturedDecisionsController`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/TargetStateCapturedDecisionsController.java`
    - Base path: `/api/projects/{projectId}/target-architectures/{targetArchitectureId}/captured-decisions`
    - Endpoints:
      - `POST /` — accepts `CreateTargetStateCapturedDecisionRequest`, returns 201 + `TargetStateCapturedDecisionDto`
      - `GET /?includeSuperseded={bool}` — default false; returns `List<TargetStateCapturedDecisionDto>`
      - `GET /{decisionId}` — returns `TargetStateCapturedDecisionDto` or 404 (via cross-project guard from Group 2)
      - `GET /by-code/{decisionCode}` — returns `List<TargetStateCapturedDecisionDto>`
    - NO PUT / PATCH / DELETE — insert-only at the data plane (per Q3)
    - Use a small mapper (inline or `TargetStateCapturedDecisionMapper`) to translate entity ↔ DTO
  - [x] 3.4 Confirm / add the active-target-architecture-id lookup endpoint
    - Per Q11 and Implementation Notes: grep `architecture-model-service/src/main/java/.../controller/` for any existing endpoint that returns the active target architecture id for a project (search for "active-target", "activeTarget", "active_target", etc.)
    - If absent: add `GET /api/projects/{projectId}/active-target-architecture-id` returning `{ "activeTargetArchitectureId": "<uuid-or-null>" }` (or matching the existing project-scoped JSON convention). Locate the existing service that knows which target architecture is "active" for a project (probably the project service or target-architecture service) and delegate to it.
    - If present under a different name: document the existing path in a doc-comment on the new resolver (Task Group 5) and skip adding a new endpoint
  - [x] 3.5 Ensure controller layer tests pass
    - Run ONLY the 2-4 tests from 3.1
    - Verify the JSON-naming test asserts lowerCamelCase keys explicitly (not just deserialization round-trip)
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-4 controller tests pass
- All four captured-decisions endpoints respond correctly
- 404 returned (not 403) on cross-project access
- DTO JSON uses lowerCamelCase keys
- Active-target-architecture-id lookup endpoint exists (either pre-existing or added in this spec)

---

#### Task Group 4: `MigrationDiscoveryContextDto` extension
**Dependencies:** Task Group 2

- [x] 4.0 Extend `MigrationDiscoveryContextDto` additively
  - [x] 4.1 Write 2-4 focused tests for the DTO extension
    - File: `architecture-model-service/src/test/java/com/example/architecturemodel/service/MigrationDiscoveryContextAggregationTest.java` (or extend the existing aggregation test file if one exists — grep for `MigrationDiscoveryContextDto` test references first)
    - Test 1: aggregation response on a project with no decisions returns `targetStateDecisionsSummary` with empty lists, `totalDecisionCount = 0`, `lastDecisionAt = null` (correct empty default shape)
    - Test 2: aggregation response on a project with seeded decisions returns the populated shape — architecture-wide block + scoped overrides + non-null `lastDecisionAt`
    - Test 3: existing top-level fields on `MigrationDiscoveryContextDto` are byte-identical to pre-spec responses for a project with no decisions (regression guard)
    - Test 4 (optional): `includeTargetStateDecisions=false` on the request body suppresses or zeroes the block per the implementation choice
    - Limit to 2-4 tests
  - [x] 4.2 Create `CapturedDecisionRefDto`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/targetstate/CapturedDecisionRefDto.java`
    - Fields: `decisionId` (UUID), `decisionCode` (String), `scopeKind` (String), `scopeRefId` (String, nullable), `answerSummary` (String, nullable), `standardsLookupRef` (String, nullable)
    - `@JsonNaming(LowerCamelCaseStrategy.class)`
  - [x] 4.3 Create `TargetStateDecisionsSummaryDto`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/targetstate/TargetStateDecisionsSummaryDto.java`
    - Fields: `architectureWideDecisions: List<CapturedDecisionRefDto>`, `scopedOverrides: List<CapturedDecisionRefDto>`, `totalDecisionCount: Integer` (boxed), `lastDecisionAt: Instant` (nullable)
    - `@JsonNaming(LowerCamelCaseStrategy.class)`
    - Provide a static `empty()` factory returning `new TargetStateDecisionsSummaryDto(List.of(), List.of(), 0, null)` for the empty default
  - [x] 4.4 Add `targetStateDecisionsSummary` to `MigrationDiscoveryContextDto`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/migration/MigrationDiscoveryContextDto.java`
    - Add new top-level field `targetStateDecisionsSummary: TargetStateDecisionsSummaryDto` (boxed types only inside the nested DTO)
    - Do not modify any existing field
  - [x] 4.5 Add `includeTargetStateDecisions` flag to the aggregation request body
    - Locate the existing aggregation request body DTO (grep for `MigrationDiscoveryContextDto` usage in controllers and request shapes — likely `MigrationDiscoveryContextRequest` or similar)
    - Add `Boolean includeTargetStateDecisions` field, defaulting to `true` when null (use a getter that returns `flag == null ? true : flag` to preserve the "default true" semantic without requiring callers to set it)
    - Body field only — not a query param (per Q13)
  - [x] 4.6 Wire the aggregation service to populate the new block
    - Locate the existing aggregation service that builds `MigrationDiscoveryContextDto`
    - When `includeTargetStateDecisions` is true (or null): resolve the project's active target architecture id (via the active-target-lookup added in Group 3); if absent OR if no decisions returned, set `targetStateDecisionsSummary` to `TargetStateDecisionsSummaryDto.empty()`; otherwise call `TargetStateCapturedDecisionService.listLatestDecisions`, partition into architecture-wide vs scoped overrides, populate the summary with the count and `max(createdAt)` as `lastDecisionAt`
    - When `includeTargetStateDecisions` is false: set the field to `TargetStateDecisionsSummaryDto.empty()` (zeroed block — preserves the consistent shape contract from spec.md)
  - [x] 4.7 Ensure DTO extension tests pass
    - Run ONLY the 2-4 tests from 4.1
    - Verify both empty-default and populated shapes
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-4 aggregation DTO tests pass
- New nested DTOs serialize as lowerCamelCase
- Empty default shape returned when no decisions exist
- Existing fields on `MigrationDiscoveryContextDto` byte-identical to pre-spec responses
- `includeTargetStateDecisions=false` zeroes the block

---

### Gateway

#### Task Group 5: Gateway proxy routes
**Dependencies:** Task Group 3

- [x] 5.0 Add gateway proxy routes for the new endpoints
  - [x] 5.1 Locate the existing target-architectures proxy and mirror its shape
    - Grep `gateway/src/` for existing `target-architectures` proxy routes (likely `gateway/src/routes/` or similar)
    - Identify the shared proxy helper (axios / fetch wrapper, path translation, error pass-through)
  - [x] 5.2 Add proxy route for `POST /api/projects/:projectId/target-architectures/:targetArchitectureId/captured-decisions`
    - File: place alongside the existing target-architectures proxy (e.g. `gateway/src/routes/targetArchitectures.ts` or wherever the existing pattern lives — match the convention)
    - Forward body to the Architecture Model Service; return 201 + response on success; pass through error status codes
  - [x] 5.3 Add proxy routes for the three GET endpoints
    - `GET /api/projects/:projectId/target-architectures/:targetArchitectureId/captured-decisions?includeSuperseded=<bool>`
    - `GET /api/projects/:projectId/target-architectures/:targetArchitectureId/captured-decisions/:decisionId` — must pass through 404 from Architecture Model Service (cross-project guard)
    - `GET /api/projects/:projectId/target-architectures/:targetArchitectureId/captured-decisions/by-code/:decisionCode`
  - [x] 5.4 Add proxy route for `GET /api/projects/:projectId/active-target-architecture-id`
    - Only if Group 3 added the endpoint (skip if already present and the existing proxy covers it — grep the gateway routes first)
  - [x] 5.5 No new tests for this group
    - Per spec test scope: 6 test groups, none of which is "gateway proxy". The resolver tests in Group 6 cover the integration path through the proxy. Proxy routes are pass-through with no business logic and are covered transitively.

**Acceptance Criteria:**
- All four captured-decisions endpoints reachable through the gateway
- Active-target-architecture-id lookup reachable through the gateway
- Error status codes (especially 404 on cross-project) pass through correctly
- No business logic in the proxy layer

---

#### Task Group 6: `TargetStateDecisionsContextResolver` + `KNOWN_CONTEXT_KEYS` registration
**Dependencies:** Task Group 5, Task Group 3 (active-target endpoint)

- [x] 6.0 Build the gateway resolver
  - [x] 6.1 Write 2-4 focused tests for the resolver
    - File: `gateway/src/__tests__/targetStateDecisionsContextResolver.test.ts`
    - Test 1: no active target architecture returns the distinct copy `"no target architecture defined yet"`
    - Test 2: active target architecture exists but `GET .../captured-decisions` returns zero rows — resolver returns the distinct copy `"no decisions captured yet"` (verifies the two-state distinction from Q12)
    - Test 3: populated decisions render the bounded grouped-by-scope summary — architecture-wide block first, then per-service / per-interface / per-element overrides, each line carrying `decision_code`, `answer_summary`, and `standards_lookup_ref` when present
    - Test 4: `KNOWN_CONTEXT_KEYS` lookup of `'target-state-decisions-context'` resolves to the new resolver (registry round-trip test)
    - Mock the Architecture Model Service client per the project pattern (`jest.requireActual` spread)
    - Limit to 2-4 tests
  - [x] 6.2 Create `TargetStateDecisionsContextResolver`
    - File: `gateway/src/services/contextResolvers/targetStateDecisionsContextResolver.ts` (or place alongside the existing `migration-discovery-context` resolver — match the existing layout)
    - Resolution flow:
      1. Resolve active project id via the existing helper
      2. Call `GET /api/projects/{projectId}/active-target-architecture-id`
      3. If null / missing: return `"no target architecture defined yet"` (exact wording — downstream prompts switch on this)
      4. Call `GET /api/projects/{projectId}/target-architectures/{targetArchitectureId}/captured-decisions` (latest only — default)
      5. If empty array: return `"no decisions captured yet"`
      6. Otherwise partition into architecture-wide (where `scopeKind === 'architecture'`) and scoped overrides; render the grouped-by-scope summary per spec.md "Gateway — `target-state-decisions-context` resolver"
    - Output format: markdown-like text mirroring the sketch in `planning/raw-idea.md` — `## Target State Decisions`, `### Architecture-wide`, `### Per-service overrides` (and per-interface / per-element subsections as data warrants); each line `\`<decision_code>\` = <answer_summary> (standards: <standards_lookup_ref>)` with the standards parenthetical omitted when null
    - No transcript content (per Q5); no size cap (per Q14)
    - Plain English in any error / fallback strings — no acronyms like "AMS" in user-facing or prompt-facing text
  - [x] 6.3 Register the resolver in `KNOWN_CONTEXT_KEYS`
    - File: `gateway/src/services/contextResolvers.ts` (the registry file — match the existing pattern used by `migration-discovery-context`)
    - Add string `'target-state-decisions-context'` to the `KNOWN_CONTEXT_KEYS` array
    - Bind it to `TargetStateDecisionsContextResolver` in the same registration block alongside the existing resolvers
    - Code edit only — no Liquibase changeset (per Q10)
  - [x] 6.4 Ensure resolver tests pass
    - Run ONLY the 2-4 tests from 6.1
    - Verify both fallback copies are distinct and the registry lookup returns the new resolver
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-4 resolver tests pass
- Two distinct fallback copies returned for the two empty states (Q12)
- `KNOWN_CONTEXT_KEYS` lookup resolves the new key
- Resolver renders bounded grouped-by-scope text matching the sketch shape

---

#### Task Group 7: Thread persistence helper + mapping-notes decoration helper
**Dependencies:** None (these can be built in parallel with Groups 1-6 if convenient, but kept here to land in the single commit)

- [x] 7.0 Build both small helpers
  - [x] 7.1 Write 2-4 focused tests for the thread persistence helper
    - File: `gateway/src/__tests__/targetStateConversationStore.test.ts`
    - Test 1: `loadTargetStateConversation` on a project with no existing thread file returns the default envelope `{ schemaVersion: 1, threadId, turns: [] }`
    - Test 2: `appendTurn` followed by `loadTargetStateConversation` round-trips the appended turn in `turns[]`
    - Test 3: `appendTurn` against a path whose parent directory does not exist auto-creates the directory (no thrown ENOENT)
    - Use the project test cleanup pattern: `beforeEach` removes the test `threads/` directory under `testTmpDir` (per the MEMORY.md test pattern note)
    - Limit to 2-4 tests
  - [x] 7.2 Create `targetStateConversationStore.ts`
    - File: `gateway/src/services/targetStateConversationStore.ts` (sibling to `gateway/src/services/threadStore.ts` — NOT an extension)
    - Use `fetchProjectFolder(projectId)` from `architectureModelClient.ts` to resolve `{projectParentFolder}` (per MEMORY.md thread path resolution note)
    - File path: `{projectParentFolder}/threads/target-state-conversation/{targetArchitectureId}/thread.json`
    - Exported helpers:
      - `loadTargetStateConversation(projectId: string, targetArchitectureId: string): Promise<{ schemaVersion: number; threadId: string; turns: unknown[] }>` — reads the file; on ENOENT returns `{ schemaVersion: 1, threadId: <generated or derived from targetArchitectureId>, turns: [] }`
      - `appendTurn(projectId: string, targetArchitectureId: string, turn: unknown): Promise<void>` — loads (or initialises), pushes the turn, writes atomically via `.tmp` rename, creates parent directories via `fs.mkdir(..., { recursive: true })`
    - Mirror `threadStore.ts`'s atomic-write pattern and ENOENT graceful degradation — do not extend `threadStore.ts` itself
    - Helper does not inspect turn contents (per Q16) — Spec 3 defines turn shape
  - [x] 7.3 Write 2-4 focused tests for the mapping-notes decoration helper
    - File: `architecture-model-service/src/test/java/com/example/architecturemodel/service/ArchitectureElementMappingNotesDecoratorTest.java`
    - Test 1: empty input + `"db.engine"` produces `"[decision:db.engine]"` (or equivalent — confirm the exact tag format in 7.4)
    - Test 2: input already containing `"[decision:db.engine]"` + `"db.engine"` returns the input unchanged (idempotent)
    - Test 3: input containing `"[decision:db.engine]"` + `"api.protocol"` appends `"[decision:api.protocol]"` (different code, second tag appended)
    - Test 4 (optional): input with surrounding human-written notes plus an existing tag for the same code returns unchanged (idempotency holds in noisy strings)
    - Limit to 2-4 tests
  - [x] 7.4 Create `ArchitectureElementMappingNotesDecorator`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureElementMappingNotesDecorator.java` (co-located with the existing `ArchitectureElementMappingService`)
    - Stateless utility — `public final class` with a private constructor, OR a Spring `@Component` if the existing project pattern injects helpers (match the local convention)
    - Single public method `String decorateWithDecision(String currentNotes, String decisionCode)`:
      - Tag format: `[decision:<code>]` (per Q6 — simple string tag, greppable, human-readable)
      - If `currentNotes` is null treat as empty string; if `currentNotes` already contains the exact substring `[decision:<decisionCode>]` return `currentNotes` unchanged
      - Otherwise append the tag to `currentNotes` separated by a single space when `currentNotes` is non-empty, or return just the tag when empty
    - No DB access; callers are responsible for persisting the returned string
    - Not called from any existing write path in this spec (per spec.md Implementation Notes — Spec 3 and possibly Spec 4 will wire it in)
  - [x] 7.5 Ensure thread helper + decoration helper tests pass
    - Run ONLY the 4-8 tests from 7.1 + 7.3
    - Verify both helpers' contracts independently
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-8 helper tests pass (2-4 per helper)
- `targetStateConversationStore.ts` round-trips a JSON thread file under the documented path
- Parent directories auto-create when missing
- `ArchitectureElementMappingNotesDecorator` produces tagged strings idempotently
- Helpers are stateless and free of cross-cutting side-effects

---

### Final Verification

#### Task Group 8: Definition-of-Done check + grep sweeps + full backend test runs
**Dependencies:** Task Groups 1-7

- [x] 8.0 Final verification before committing
  - [x] 8.1 Review existing tests written in Groups 1-7 and confirm gap coverage
    - Group 1: 2-4 repository tests
    - Group 2: 2-4 service tests
    - Group 3: 2-4 controller tests
    - Group 4: 2-4 aggregation DTO tests
    - Group 6: 2-4 resolver tests
    - Group 7: 4-8 helper tests (2-4 each for thread + decoration)
    - Total: approximately 16-32 new tests
    - Per spec test scope (Q18) and the task-writer brief: no additional tests added in this group — spec is fully covered by the per-group tests above. If a critical gap surfaces during review, add up to 10 additional strategic tests; otherwise add none.
  - [x] 8.2 Run feature-specific Architecture Model Service tests
    - Run ONLY the new Architecture Model Service tests written in Groups 1, 2, 3, 4, and 7.3 (repository + service + controller + aggregation + decoration)
    - Do NOT run the entire Architecture Model Service test suite
    - Verify all pass
  - [x] 8.3 Run feature-specific gateway tests
    - Run ONLY the new gateway tests written in Groups 6 and 7.1 (resolver + thread store)
    - Use the project test cleanup pattern (`beforeEach` clears `threads/` under `testTmpDir`)
    - Do NOT run the entire gateway test suite
    - Verify all pass
  - [x] 8.4 Grep sweep: confirm no edits to applied Liquibase changesets
    - `git diff --name-only architecture-model-service/src/main/resources/db/changelog/` should show only the new changeset file from Task 1.3 — no other changelog files touched
    - Per `feedback_liquibase_immutable_changesets.md`: applied changesets are immutable
  - [x] 8.5 Grep sweep: confirm no frontend changes
    - `git diff --name-only frontend/` should be empty
    - Per spec.md Commit Boundary: no frontend changes
  - [x] 8.6 Grep sweep: confirm no discovery-service source edits
    - `git diff --name-only discovery-service/src/` should be empty
    - Per `feedback_no_src_edits_during_run.md`: avoid incidental discovery-service edits
  - [x] 8.7 Grep sweep: confirm `@JsonNaming(LowerCamelCaseStrategy.class)` present on every new DTO
    - Files to check: `TargetStateCapturedDecisionDto`, `CreateTargetStateCapturedDecisionRequest`, `TargetStateDecisionsSummaryDto`, `CapturedDecisionRefDto`
    - Grep for `@JsonNaming` in each of the four new DTO files — every file should have one occurrence
  - [x] 8.8 Definition of Done check against spec.md
    - Liquibase changeset applies cleanly (manual smoke test on a fresh schema)
    - All four captured-decisions endpoints respond correctly
    - 404 returned on cross-project access (not 403)
    - Active-target-architecture-id endpoint exists
    - Resolver returns the two distinct fallback copies AND a bounded grouped-by-scope summary when populated
    - `targetStateDecisionsSummary` block present with correct empty default on aggregation responses
    - Existing aggregation fields byte-identical to pre-spec responses
    - Thread helper round-trips and creates parent directories
    - Decoration helper is idempotent
    - `target_state_captured_decisions` table is empty on every environment post-deploy (nothing in this spec writes to it)
  - [x] 8.9 Confirm single commit boundary is ready
    - Stage all changes: new Liquibase changeset + entity + repository + service + controller + DTOs + active-target endpoint (if added) + `MigrationDiscoveryContextDto` extension + aggregation service wiring + gateway proxy routes + resolver + `KNOWN_CONTEXT_KEYS` entry + thread persistence helper + decoration helper + all new tests
    - Do NOT commit until explicitly instructed by the user (per the MEMORY.md "never commit unless asked" rule)

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 16-32 tests total across both services)
- Pre-existing test failures listed in MEMORY.md are untouched (no regressions, no fixes — they were already broken before this spec)
- No applied Liquibase changeset modified
- No frontend changes
- No discovery-service source edits
- `@JsonNaming` annotation present on all four new DTOs
- All Definition of Done bullets from spec.md verified
- Single commit ready to land per the spec's Commit Boundary

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1** — Liquibase changeset, entity, repository (the self-FK pattern is the trickiest piece; settle it first)
2. **Task Group 2** — Service with atomic supersession + cross-project guard
3. **Task Group 3** — Controller, DTOs, active-target-lookup endpoint
4. **Task Group 4** — `MigrationDiscoveryContextDto` extension (depends on the service from Group 2; doable in parallel with Group 3 if the active-target endpoint already exists)
5. **Task Group 5** — Gateway proxy routes (depends on Group 3 endpoint paths being final)
6. **Task Group 6** — Gateway resolver + `KNOWN_CONTEXT_KEYS` registration (depends on proxy routes from Group 5)
7. **Task Group 7** — Thread persistence helper + mapping-notes decoration helper (no dependency on other groups — can be done any time; co-located here to keep the single-commit boundary clean)
8. **Task Group 8** — Final verification, grep sweeps, Definition of Done check

The whole thing lands in **one commit** per spec.md "Commit Boundary".
