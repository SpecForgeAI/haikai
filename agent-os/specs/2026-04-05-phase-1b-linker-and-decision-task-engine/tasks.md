# Task Breakdown: Phase 1b Linker and DecisionTask Engine

## Overview
Total Tasks: 57
Increment: 8 of 16 (Legacy / Current-State Discovery)

This feature replaces the Phase 1b backbone stub with real evidence relationship linking: deterministic linker rules that pattern-match 1a atoms into candidate relationships, a confidence-based triage engine, and a DecisionTask engine that routes ambiguous candidates through the gateway's LLM for resolution.

Three services are involved:
- **architecture-model-service** (Java/Spring Boot): New Liquibase migration 071, full JPA entity stack for DecisionTask persistence
- **discovery-service** (Express/TypeScript): LinkerRule interface/registry, 4 deterministic rules, triage engine, DecisionTask types, archModelClient extensions, gatewayClient, Phase 1b orchestration
- **gateway** (Express/TypeScript): DecisionTask resolution endpoint using LLM, structured prompt templates

## Task List

### Discovery-Service Type Definitions

#### Task Group 1: LinkerRule, CandidateRelationship, and DecisionTask Types
**Dependencies:** None

- [x] 1.0 Complete discovery-service type definitions
  - [x] 1.1 Write 4 focused tests for type definitions and interfaces
    - Test that CandidateRelationship confidence field accepts values in the 0.0-1.0 range
    - Test that DecisionTask type discriminators (confirm_relationship, resolve_competing_relationships) are valid
    - Test that ConfirmRelationshipInput and ResolveCompetingInput are structurally correct with required fields
    - Test that DecisionTaskOutput union types resolve correctly for both task types
  - [x] 1.2 Create `LinkerRule` interface and `CandidateRelationship` interface in `discovery-service/src/types/linkerRule.ts`
    - `LinkerRule`: `id` (string), `name` (string), `description` (string), `targetRelationshipType` (RelationshipType), `match(atoms: EvidenceAtom[]): CandidateRelationship[]`
    - `CandidateRelationship`: `sourceAtomId` (string), `targetAtomId` (string), `relationshipType` (RelationshipType), `confidence` (number 0.0-1.0), `data` (RelationshipData), `ruleId` (string)
    - Import `RelationshipType`, `RelationshipData` from `./relationship` and `EvidenceAtom` from `./evidenceAtom`
  - [x] 1.3 Create DecisionTask types in `discovery-service/src/types/decisionTask.ts`
    - `DecisionTaskType`: `'confirm_relationship' | 'resolve_competing_relationships'`
    - `DecisionTaskStatus`: `'pending' | 'resolved' | 'failed'`
    - `ConfirmRelationshipInput`: sourceAtom (EvidenceAtom), targetAtom (EvidenceAtom), proposedRelationshipType (RelationshipType), confidence (number), ruleId (string)
    - `ResolveCompetingInput`: sourceAtom (EvidenceAtom), competitors (array of { targetAtom, relationshipType, confidence, ruleId })
    - `DecisionTaskInput`: `ConfirmRelationshipInput | ResolveCompetingInput`
    - `ConfirmRelationshipOutput`: decision ('confirm' | 'reject'), adjustedConfidence (number), reasoning (string)
    - `ResolveCompetingOutput`: selectedIndex (number | null), adjustedConfidence (number), reasoning (string)
    - `DecisionTaskOutput`: `ConfirmRelationshipOutput | ResolveCompetingOutput`
    - `DecisionTask`: id (string), runId (string), taskType (DecisionTaskType), status (DecisionTaskStatus), inputData (DecisionTaskInput), outputData (DecisionTaskOutput | null), createdAt (string), resolvedAt (string | null)
  - [x] 1.4 Update barrel export in `discovery-service/src/types/index.ts`
    - Export all types from `./linkerRule`: `LinkerRule`, `CandidateRelationship`
    - Export all types from `./decisionTask`: `DecisionTaskType`, `DecisionTaskStatus`, `ConfirmRelationshipInput`, `ResolveCompetingInput`, `DecisionTaskInput`, `ConfirmRelationshipOutput`, `ResolveCompetingOutput`, `DecisionTaskOutput`, `DecisionTask`
  - [x] 1.5 Ensure type definition tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify TypeScript compilation succeeds with no type errors

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- All new types are correctly exported from the barrel export
- `CandidateRelationship` is a standalone internal type (not persisted)
- `DecisionTask` interface mirrors the database table structure
- TypeScript compiler reports no errors

---

### Discovery-Service Linker Rules and Triage Engine

#### Task Group 2: Confidence Thresholds and Linker Rule Registry
**Dependencies:** Task Group 1

- [x] 2.0 Complete linker defaults and registry
  - [x] 2.1 Write 3 focused tests for thresholds and registry
    - Test that AUTO_ACCEPT_THRESHOLD and AMBIGUOUS_THRESHOLD are exported with correct defaults (0.8 and 0.4)
    - Test that initializeLinkerRuleRegistry() populates the registry with the expected number of rules (4)
    - Test that registerLinkerRule() adds a new rule to the registry and getLinkerRuleRegistry() returns it
  - [x] 2.2 Create `discovery-service/src/constants/linkerDefaults.ts`
    - Export `AUTO_ACCEPT_THRESHOLD = 0.8`
    - Export `AMBIGUOUS_THRESHOLD = 0.4`
    - Follow the `extractionDefaults.ts` pattern (documented constants with JSDoc)
  - [x] 2.3 Create linker rule registry in `discovery-service/src/services/linkerRuleRegistry.ts`
    - Follow the `analyzerRegistry.ts` pattern exactly: in-memory `Map<string, LinkerRule>`
    - Export `initializeLinkerRuleRegistry()`, `getLinkerRuleRegistry()`, `registerLinkerRule()`
    - `initializeLinkerRuleRegistry()` creates a fresh Map, calls `registerAllLinkerRules()`, logs registry size
  - [x] 2.4 Create `discovery-service/src/services/linkerRules/index.ts` barrel export
    - Export all 4 rule instances
    - Export `registerAllLinkerRules()` function that registers all 4 rules into the registry
  - [x] 2.5 Ensure thresholds and registry tests pass
    - Run ONLY the 3 tests written in 2.1

**Acceptance Criteria:**
- The 3 tests written in 2.1 pass
- Constants are centrally defined, not scattered as magic numbers
- Registry follows the established analyzerRegistry pattern
- `registerAllLinkerRules()` is callable from `initializeLinkerRuleRegistry()`

#### Task Group 3: Four Deterministic Linker Rules
**Dependencies:** Task Group 2

- [x] 3.0 Complete all four linker rules
  - [x] 3.1 Write 8 focused tests for the four linker rules (2 per rule)
    - ContainsByPathRule: test directory-prefix matching produces `contains` relationships at 1.0 confidence; test non-matching paths produce no candidates
    - ImportsByPatternRule: test `import_statement` / `require_statement` pattern atoms matched to symbol atoms produce `imports` relationships with correct confidence bands (0.9+ exact, 0.5-0.7 partial); test no match returns empty
    - ExtendsByPatternRule: test inheritance pattern atoms matched to symbol atoms with matching name/kind produce `extends` relationships; test mismatched kind (e.g., function vs class) produces no candidates
    - ReferencesBySymbolRule: test catch-all string_pattern-to-symbol matching produces `references` relationships at 0.3-0.6 confidence; test symbols already captured by more specific rules are excluded
  - [x] 3.2 Implement `ContainsByPathRule` in `discovery-service/src/services/linkerRules/containsByPathRule.ts`
    - Filter atoms by `type === 'file_structure'`
    - For each pair, check if one `relativePath` is a directory-prefix of another
    - Produce `contains` relationships with `ContainsRelationshipData` at confidence 1.0
    - Set `ruleId` to `'contains-by-path'`
  - [x] 3.3 Implement `ImportsByPatternRule` in `discovery-service/src/services/linkerRules/importsByPatternRule.ts`
    - Filter `string_pattern` atoms with `patternName` in (`'import_statement'`, `'require_statement'`)
    - Filter `symbol` atoms
    - Match when `matchedText` contains the symbol's `name`
    - Exact name match: confidence 0.9; partial/ambiguous match: confidence 0.5-0.7
    - Produce `imports` relationships with `ImportsRelationshipData`
    - Set `ruleId` to `'imports-by-pattern'`
  - [x] 3.4 Implement `ExtendsByPatternRule` in `discovery-service/src/services/linkerRules/extendsByPatternRule.ts`
    - Filter `string_pattern` atoms with inheritance-related `patternName` (patterns whose name includes 'extends' or 'implements')
    - Filter `symbol` atoms with appropriate `kind` (class, interface)
    - Match when `matchedText` contains the symbol's `name`
    - Confidence varies: exact match 0.9+, partial match 0.5-0.7
    - Produce `extends` relationships with `ExtendsRelationshipData`
    - Set `ruleId` to `'extends-by-pattern'`
  - [x] 3.5 Implement `ReferencesBySymbolRule` in `discovery-service/src/services/linkerRules/referencesBySymbolRule.ts`
    - Filter `string_pattern` atoms NOT already matched by imports/extends rules (different `patternName` values)
    - Filter `symbol` atoms
    - Match when `matchedText` contains a symbol's `name`
    - Produce `references` relationships at lower confidence (0.3-0.6)
    - Produce `ReferencesRelationshipData`
    - Set `ruleId` to `'references-by-symbol'`
  - [x] 3.6 Register all four rules in `linkerRules/index.ts` via `registerAllLinkerRules()`
  - [x] 3.7 Ensure linker rule tests pass
    - Run ONLY the 8 tests written in 3.1
    - Verify each rule operates as a self-contained, testable unit

**Acceptance Criteria:**
- The 8 tests written in 3.1 pass
- Each rule is in its own file under `discovery-service/src/services/linkerRules/`
- Each rule implements the `LinkerRule` interface
- Confidence scores fall within the specified ranges per rule
- Rules are correctly registered in the registry

#### Task Group 4: Candidate Triage Engine
**Dependencies:** Task Groups 1, 2

- [x] 4.0 Complete triage engine
  - [x] 4.1 Write 5 focused tests for the triage engine
    - Test high-confidence candidates (>= 0.8) are placed in the `accepted` bucket
    - Test mid-confidence candidates (0.4-0.79) are placed in the `ambiguous` bucket
    - Test low-confidence candidates (< 0.4) are placed in the `discarded` bucket
    - Test competing relationships (same `sourceAtomId` and same `relationshipType`, both ambiguous) are grouped into a single `resolve_competing_relationships` DecisionTask
    - Test non-competing ambiguous candidates each produce individual `confirm_relationship` DecisionTasks
  - [x] 4.2 Implement triage function in `discovery-service/src/services/triageEngine.ts`
    - Export `triageCandidates(candidates: CandidateRelationship[]): TriageResult`
    - `TriageResult` interface: `accepted` (CandidateRelationship[]), `ambiguous` (CandidateRelationship[]), `discarded` (CandidateRelationship[]), `competingGroups` (Map of group key to CandidateRelationship[])
    - Partition by confidence thresholds (import from `linkerDefaults.ts`)
    - Detect competing relationships: group ambiguous candidates sharing the same `sourceAtomId` AND same `relationshipType`
    - Groups with 2+ candidates become `resolve_competing_relationships` tasks; single-candidate groups become `confirm_relationship` tasks
    - Function is standalone and testable with no external dependencies
  - [x] 4.3 Ensure triage engine tests pass
    - Run ONLY the 5 tests written in 4.1

**Acceptance Criteria:**
- The 5 tests written in 4.1 pass
- Triage function is a pure, standalone unit with no I/O dependencies
- Competing relationship detection uses the specified grouping strategy (same sourceAtomId + same relationshipType)
- Three buckets are correctly populated based on threshold constants

---

### Architecture-Model-Service: DecisionTask Persistence

#### Task Group 5: Liquibase Migration and JPA Entity
**Dependencies:** None (can be developed in parallel with Task Groups 1-4)

- [x] 5.0 Complete DecisionTask database migration and entity
  - [x] 5.1 Write 4 focused tests for the JPA stack (JUnit 5)
    - Test DiscoveryDecisionTaskService.bulkCreate persists tasks and returns DTOs with correct fields
    - Test DiscoveryDecisionTaskService.getByRunId returns tasks, and getByRunIdAndStatus filters correctly
    - Test DiscoveryDecisionTaskService.updateTask transitions status and sets outputData/resolvedAt
    - Test DiscoveryDecisionTaskController POST endpoint returns 200 with persisted task DTOs
  - [x] 5.2 Create Liquibase migration `architecture-model-service/src/main/resources/db/changelog/sql/071-discovery-decision-task.sql`
    - Table: `discovery_decision_task`
    - Columns: `id` (UUID PK), `run_id` (UUID NOT NULL FK to discovery_run ON DELETE CASCADE), `task_type` (TEXT NOT NULL), `status` (TEXT NOT NULL DEFAULT 'pending'), `input_data` (JSONB NOT NULL), `output_data` (JSONB nullable), `created_at` (TIMESTAMPTZ NOT NULL DEFAULT NOW()), `resolved_at` (TIMESTAMPTZ nullable)
    - Indexes: `idx_discovery_decision_task_run_id` on `run_id`, `idx_discovery_decision_task_run_id_status` on `(run_id, status)`, `idx_discovery_decision_task_run_id_task_type` on `(run_id, task_type)`
    - Table and column comments following the `067-discovery-relationship.sql` pattern
  - [x] 5.3 Register migration in `db.changelog-master.yaml`
    - Add changeSet `071-discovery-decision-task` after the existing `070-discovery-candidate` entry
    - Use `tableExists` precondition on `discovery_decision_task`
    - Follow the exact YAML structure of the preceding discovery changeSet entries
  - [x] 5.4 Create `DiscoveryDecisionTaskEntity.java` in `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/`
    - Follow `DiscoveryRelationshipEntity.java` pattern exactly
    - `@Entity`, `@Table` with 3 indexes matching the migration, Lombok `@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder`
    - Fields: `id` (UUID), `runId` (UUID), `taskType` (String), `status` (String), `inputData` (Map with `@Type(JsonType.class)`), `outputData` (Map with `@Type(JsonType.class)`, nullable), `createdAt` (Instant with `@PrePersist`), `resolvedAt` (Instant, nullable)
    - `@PrePersist` sets `createdAt` if null and defaults `status` to `'pending'`
  - [x] 5.5 Create `DiscoveryDecisionTaskDto.java` Java record in `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/`
    - Follow `DiscoveryRelationshipDto.java` record pattern
    - Fields: id (UUID), runId (UUID), taskType (String), status (String), inputData (Map), outputData (Map), createdAt (String), resolvedAt (String)
    - `@JsonProperty` annotations using snake_case names (run_id, task_type, input_data, output_data, created_at, resolved_at)
  - [x] 5.6 Create `DiscoveryDecisionTaskRepository.java` in `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/`
    - Extends `JpaRepository<DiscoveryDecisionTaskEntity, UUID>`
    - Methods: `findByRunId(UUID)`, `findByRunIdAndStatus(UUID, String)`, `findByRunIdAndTaskType(UUID, String)`, `countByRunId(UUID)`, `countByRunIdAndStatus(UUID, String)`
  - [x] 5.7 Create `DiscoveryDecisionTaskService.java` in `architecture-model-service/src/main/java/com/example/architecturemodel/service/`
    - `@Service`, `@ConditionalOnProperty`, `@RequiredArgsConstructor`, `@Slf4j`
    - `bulkCreate(UUID runId, List<DiscoveryDecisionTaskDto>)`: `@Transactional`, maps DTOs to entities, saves all, returns DTOs
    - `getByRunId(UUID runId, String status, String taskType)`: `@Transactional(readOnly = true)`, delegates to appropriate repository method based on non-null filters
    - `countByRunId(UUID runId, String status)`: `@Transactional(readOnly = true)`, delegates to countByRunId or countByRunIdAndStatus
    - `updateTask(UUID runId, UUID taskId, DiscoveryDecisionTaskDto update)`: `@Transactional`, fetches entity, updates status/outputData/resolvedAt, saves
    - Private `toDto()` method converting entity to DTO
  - [x] 5.8 Create `DiscoveryDecisionTaskController.java` in `architecture-model-service/src/main/java/com/example/architecturemodel/controller/`
    - `@RestController`, `@ConditionalOnProperty`, `@RequestMapping("/api/model/projects/{projectId}/discovery/runs/{runId}/decision-tasks")`
    - POST (bulk insert): accepts `List<DiscoveryDecisionTaskDto>`, returns persisted DTOs
    - GET (list): optional `@RequestParam status`, `@RequestParam taskType` query filters
    - GET `/count`: optional `@RequestParam status` filter, returns `Map.of("count", <long>)`
    - PUT `/{taskId}`: accepts `DiscoveryDecisionTaskDto` update body, returns updated DTO
  - [x] 5.9 Ensure JPA stack tests pass
    - Run ONLY the 4 tests written in 5.1
    - Verify migration applies successfully

**Acceptance Criteria:**
- The 4 tests written in 5.1 pass
- Migration creates the table with correct columns, constraints, and indexes
- JPA entity uses `@Type(JsonType.class)` for both JSONB columns
- All beans use `@ConditionalOnProperty(name = "app.features.include-database", havingValue = "true", matchIfMissing = true)`
- Controller endpoints match the URL pattern `/api/model/projects/{projectId}/discovery/runs/{runId}/decision-tasks`
- DTO uses snake_case `@JsonProperty` annotations

---

### Discovery-Service Client Methods

#### Task Group 6: archModelClient DecisionTask Methods and Gateway Client
**Dependencies:** Task Groups 1, 5

- [x] 6.0 Complete discovery-service HTTP client extensions
  - [x] 6.1 Write 5 focused tests for client methods
    - Test `bulkSaveDecisionTasks` sends POST to correct URL with tasks array
    - Test `getDecisionTasksByRun` sends GET with optional status and taskType query params
    - Test `getDecisionTaskCount` sends GET to /count with optional status param
    - Test `updateDecisionTask` sends PUT to correct URL with update payload
    - Test `gatewayClient.resolveDecisionTasks` sends POST to gateway resolution endpoint with correct body shape
  - [x] 6.2 Add DecisionTask methods to `discovery-service/src/services/archModelClient.ts`
    - `bulkSaveDecisionTasks(projectId, runId, tasks: DecisionTask[])`: POST to `/api/model/projects/{projectId}/discovery/runs/{runId}/decision-tasks`
    - `getDecisionTasksByRun(projectId, runId, status?, taskType?)`: GET with optional query params, returns `DecisionTask[]`
    - `getDecisionTaskCount(projectId, runId, status?)`: GET `/count` with optional status, returns number
    - `updateDecisionTask(projectId, runId, taskId, update: Partial<DecisionTask>)`: PUT to `/{taskId}`, returns `DecisionTask`
    - Follow exact same axios patterns as `bulkSaveRelationships`, `getRelationshipsByRun`, etc.
  - [x] 6.3 Add `GATEWAY_BASE_URL` to `discovery-service/src/config.ts`
    - `export const GATEWAY_BASE_URL: string = process.env.GATEWAY_BASE_URL || 'http://localhost:3001';`
    - Follow the `ARCHITECTURE_MODEL_SERVICE_BASE_URL` pattern
  - [x] 6.4 Create `discovery-service/src/services/gatewayClient.ts`
    - Separate axios-based client for HTTP calls to the gateway
    - Import `GATEWAY_BASE_URL` from `../config`
    - `resolveDecisionTasks(projectId, runId, tasks: DecisionTask[])`: POST to `/api/v1/discovery/resolve-decision-tasks` with body `{ projectId, runId, tasks }`
    - Returns `{ results: Array<{ taskId, status, outputData, error }> }`
    - Follow same axios instance pattern as `archModelClient` (create instance, timeout, headers)
  - [x] 6.5 Ensure client method tests pass
    - Run ONLY the 5 tests written in 6.1

**Acceptance Criteria:**
- The 5 tests written in 6.1 pass
- archModelClient DecisionTask methods follow the identical pattern of existing relationship/cluster/candidate methods
- gatewayClient is a separate file keeping concerns distinct from archModelClient
- GATEWAY_BASE_URL config follows the same pattern as ARCHITECTURE_MODEL_SERVICE_BASE_URL
- URL construction uses `encodeURIComponent` for path parameters

---

### Gateway: DecisionTask Resolution Endpoint

#### Task Group 7: LLM Prompt Templates
**Dependencies:** None (can be developed in parallel with all other groups)

- [x] 7.0 Complete LLM prompt templates
  - [x] 7.1 Create `gateway/src/config/prompts/discovery.confirm-relationship.prompt.md`
    - System context: "You are analyzing code evidence to confirm or reject an inferred relationship between two code elements."
    - Input sections for: source atom type/data, target atom type/data, proposed relationship type, confidence score, file paths, producing rule
    - Expected JSON output format: `{ "decision": "confirm"|"reject", "adjustedConfidence": <0.0-1.0>, "reasoning": "<brief explanation>" }`
    - Explicit instruction to return ONLY valid JSON (no markdown fencing, no preamble)
  - [x] 7.2 Create `gateway/src/config/prompts/discovery.resolve-competing-relationships.prompt.md`
    - System context: "You are analyzing code evidence to determine which of several competing relationship targets is most accurate for a given source element."
    - Input sections for: source atom type/data, array of competing targets each with atom data/type/confidence
    - Expected JSON output format: `{ "selectedIndex": <number|null>, "adjustedConfidence": <0.0-1.0>, "reasoning": "<brief explanation>" }`
    - Explicit instruction to return ONLY valid JSON

**Acceptance Criteria:**
- Prompts are stored as `.prompt.md` files following the existing prompt template convention
- Prompts specify the exact JSON response schema the LLM must produce
- Prompts include clear instructions about returning valid JSON only

#### Task Group 8: Gateway Resolution Route and Registration
**Dependencies:** Task Group 7

- [x] 8.0 Complete gateway DecisionTask resolution endpoint
  - [x] 8.1 Write 5 focused tests for the resolution endpoint (Jest)
    - Test POST `/api/v1/discovery/resolve-decision-tasks` with a valid `confirm_relationship` task returns resolved result with outputData
    - Test POST with a valid `resolve_competing_relationships` task returns resolved result with selectedIndex
    - Test that an individual LLM failure returns `status: 'failed'` with error message while other tasks continue processing
    - Test request body validation rejects missing projectId or runId
    - Test that LLM response parsing handles both raw JSON and markdown-fenced JSON
  - [x] 8.2 Create `gateway/src/routes/discoveryDecisionTasks.ts`
    - Export `discoveryDecisionTasksRouter` as a Router
    - POST `/resolve-decision-tasks` endpoint
    - Request body: `{ projectId: string, runId: string, tasks: DecisionTask[] }`
    - Response body: `{ results: Array<{ taskId, status, outputData, error }> }`
    - Validate request body (projectId, runId, tasks array required)
    - Sequential loop over tasks (no parallelism)
    - For each task: construct prompt based on `taskType`, read prompt template file, interpolate input data, call `getLlmClient().sendChatRequest()`
    - Parse JSON response from LLM -- handle both raw JSON and markdown-fenced JSON (strip ```json fences if present)
    - On individual task LLM failure: set that task's result to `status: 'failed'` with error string, continue to next task
    - Log each task resolution attempt
  - [x] 8.3 Add prompt template loader utility
    - Read prompt files from `gateway/src/config/prompts/`
    - Interpolate variables (source atom data, target atom data, relationship type, confidence, etc.) into the prompt template
    - Build the full message array for `sendChatRequest()` (system message from template, user message with specific task data)
  - [x] 8.4 Export from `gateway/src/routes/index.ts`
    - Add `export { discoveryDecisionTasksRouter } from './discoveryDecisionTasks';`
  - [x] 8.5 Register route in `gateway/src/server.ts`
    - Add import of `discoveryDecisionTasksRouter` from `./routes`
    - Mount at: `app.use('/api/v1/discovery', discoveryDecisionTasksRouter);` (will serve `/api/v1/discovery/resolve-decision-tasks`)
    - Note: This shares the `/api/v1/discovery` prefix with the existing `discoveryRouter`. The new router must be mounted BEFORE the existing discovery router OR the route must be mounted on a sub-path to avoid conflicts. Verify no route collisions.
    - Add console.log for the new endpoint in the startup block
  - [x] 8.6 Ensure gateway resolution endpoint tests pass
    - Run ONLY the 5 tests written in 8.1

**Acceptance Criteria:**
- The 5 tests written in 8.1 pass
- Endpoint processes tasks sequentially (no parallelism)
- Individual task failures do not abort processing of remaining tasks
- LLM response parsing handles both raw JSON and markdown-fenced JSON
- Route is correctly registered in server.ts without collisions

---

### Discovery-Service: Phase 1b Orchestration

#### Task Group 9: Replace executeStep1b Stub with Real Orchestration
**Dependencies:** Task Groups 1, 2, 3, 4, 6

- [x] 9.0 Complete Phase 1b orchestration logic
  - [x] 9.1 Write 6 focused tests for the executeStep1b orchestration
    - Test full happy path: mock atoms returned, mock rules producing candidates across all confidence bands, verify auto-accepted relationships are persisted, DecisionTasks are created and resolved, summary metadata is correct
    - Test that high-confidence candidates bypass DecisionTask creation and are persisted directly as relationships via bulkSaveRelationships
    - Test that low-confidence candidates (below AMBIGUOUS_THRESHOLD) are discarded -- not persisted and not turned into DecisionTasks
    - Test that competing ambiguous candidates produce a single `resolve_competing_relationships` DecisionTask instead of individual confirm tasks
    - Test that a failed DecisionTask resolution (gateway returns `status: 'failed'`) increments `decisionTaskFailedCount` and does not persist a relationship
    - Test that relationships from confirmed DecisionTasks use the `adjustedConfidence` from the LLM output, not the original rule confidence
  - [x] 9.2 Replace `executeStep1b` stub in `discovery-service/src/services/runManager.ts`
    - Keep the same function signature: `(projectId: string, runId: string) => Promise<Record<string, unknown>>`
    - Step 1: Fetch 1a atoms via `archModelClient.getEvidenceByRun(projectId, runId)`
    - Step 2: Get all registered linker rules from `getLinkerRuleRegistry()`, iterate and call `rule.match(atoms)` on each, collect all `CandidateRelationship[]`
    - Step 3: Call `triageCandidates(allCandidates)` to partition into accepted/ambiguous/discarded
    - Step 4: Convert accepted candidates to `EvidenceRelationship` objects (generate UUIDs, set runId, set inferredAt), persist via `archModelClient.bulkSaveRelationships()` in `BULK_SAVE_BATCH_SIZE` batches
    - Step 5: Convert ambiguous candidates and competing groups into `DecisionTask` objects with `status: 'pending'` and structured `inputData` (include full atom data, not just IDs). Persist via `archModelClient.bulkSaveDecisionTasks()`
    - Step 6: Call `gatewayClient.resolveDecisionTasks(projectId, runId, pendingTasks)` to get LLM resolutions
    - Step 7: Process resolution results -- for confirmed: create EvidenceRelationship with adjustedConfidence and persist; for rejected/failed: skip
    - Step 8: Update each DecisionTask record via `archModelClient.updateDecisionTask()` with resolved status, outputData, resolvedAt
    - Step 9: Return summary metadata object
  - [x] 9.3 Implement summary metadata return
    - `relationshipCount`: total relationships persisted (auto-accepted + LLM-confirmed)
    - `autoAcceptedCount`: relationships persisted without LLM review
    - `decisionTaskCount`: total DecisionTasks created
    - `decisionTaskResolvedCount`: tasks successfully resolved by LLM
    - `decisionTaskFailedCount`: tasks that failed LLM resolution
    - `discardedCount`: candidates auto-discarded below AMBIGUOUS_THRESHOLD
    - `upstreamAtomCount`: total 1a atoms fetched
  - [x] 9.4 Add imports for new dependencies in runManager.ts
    - Import `getLinkerRuleRegistry` from `./linkerRuleRegistry`
    - Import `triageCandidates` from `./triageEngine`
    - Import `gatewayClient` from `./gatewayClient`
    - Import `EvidenceRelationship` from types
    - Import `CandidateRelationship`, `DecisionTask` from types
    - Import `AUTO_ACCEPT_THRESHOLD`, `AMBIGUOUS_THRESHOLD` from constants (only if needed by orchestration beyond triage)
    - Import `v4 as uuidv4` from `uuid` (for generating relationship/task IDs)
  - [x] 9.5 Initialize linker rule registry at discovery-service startup
    - Call `initializeLinkerRuleRegistry()` in the service's startup/initialization path (e.g., alongside `initializeAnalyzerRegistry()`)
    - Verify this is called before any run can be executed
  - [x] 9.6 Ensure orchestration tests pass
    - Run ONLY the 6 tests written in 9.1

**Acceptance Criteria:**
- The 6 tests written in 9.1 pass
- executeStep1b function signature remains compatible with the existing step sequencing in startRun
- Summary metadata includes all 7 required fields
- Relationships are persisted in batches using BULK_SAVE_BATCH_SIZE
- DecisionTask inputData includes full atom data (not just IDs)
- Linker rule registry is initialized before runs can execute

---

### Infrastructure: Docker Compose Configuration

#### Task Group 10: Docker Compose Environment Variable
**Dependencies:** Task Group 6 (depends on GATEWAY_BASE_URL config being defined)

- [x] 10.0 Complete Docker Compose configuration
  - [x] 10.1 Add `GATEWAY_BASE_URL` environment variable to the discovery-service container in Docker Compose
    - Value should point to the gateway container (e.g., `http://gateway:3001`)
    - Follow the pattern of existing service-to-service URL environment variables (e.g., `ARCHITECTURE_MODEL_SERVICE_BASE_URL`)
  - [x] 10.2 Verify no new service containers are needed
    - The gateway container already has LLM provider configuration
    - No new containers required -- only the env var addition

**Acceptance Criteria:**
- discovery-service container has `GATEWAY_BASE_URL` environment variable
- Gateway container needs no configuration changes
- No new service containers are introduced

---

### Testing: Review and Gap Analysis

#### Task Group 11: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-9

- [x] 11.0 Review existing tests and fill critical gaps only
  - [x] 11.1 Review tests from Task Groups 1-9
    - Review the 4 type definition tests (Task 1.1)
    - Review the 3 threshold/registry tests (Task 2.1)
    - Review the 8 linker rule tests (Task 3.1)
    - Review the 5 triage engine tests (Task 4.1)
    - Review the 4 JPA stack tests (Task 5.1)
    - Review the 5 client method tests (Task 6.1)
    - Review the 5 gateway resolution tests (Task 8.1)
    - Review the 6 orchestration tests (Task 9.1)
    - Total existing tests: approximately 40 tests
  - [x] 11.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows that lack test coverage
    - Focus on integration points: discovery-service -> archModelClient -> architecture-model-service, discovery-service -> gatewayClient -> gateway
    - Assess whether the full pipeline flow (fetch atoms -> run rules -> triage -> persist -> resolve -> update) has adequate integration-level coverage
    - Do NOT assess entire application test coverage
  - [x] 11.3 Write up to 10 additional strategic tests maximum
    - Possible gap areas (implement only if gaps exist after review):
      - End-to-end orchestration test with all 4 rules producing candidates across all 3 confidence tiers
      - Triage engine edge case: empty candidate list returns empty buckets
      - Gateway prompt template interpolation correctness (variables are properly substituted)
      - archModelClient DecisionTask methods: verify encodeURIComponent on path params with special characters
      - ContainsByPathRule edge case: root-level files with no parent directory
      - Gateway JSON parsing resilience: malformed LLM response gracefully fails
      - Linker registry: getLinkerRuleRegistry returns empty map before initialization
      - executeStep1b with zero atoms returns zero-count summary without errors
      - Multiple competing relationship groups in a single triage
      - DecisionTask update with resolvedAt timestamp format validation
  - [x] 11.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 8.1, 9.1, and 11.3)
    - Expected total: approximately 40-50 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 40-50 tests total)
- Critical end-to-end orchestration flow is covered
- No more than 10 additional tests added to fill gaps
- Testing focused exclusively on this spec's feature requirements

## Execution Order

Recommended implementation sequence:

```
Phase A: Foundation (parallel tracks)
  Track 1: Task Group 1 (Types) -> Task Group 2 (Registry) -> Task Group 3 (Rules)
  Track 2: Task Group 5 (JPA Stack -- independent Java work)
  Track 3: Task Group 7 (Prompt Templates -- independent file creation)

Phase B: Integration Layer (after Phase A)
  Task Group 4 (Triage Engine -- needs types from TG1)
  Task Group 6 (Client Methods -- needs types from TG1 and JPA from TG5)
  Task Group 8 (Gateway Route -- needs prompts from TG7)

Phase C: Orchestration (after Phase B)
  Task Group 9 (Phase 1b Orchestration -- depends on all Phase A and B groups)

Phase D: Configuration and Testing (after Phase C)
  Task Group 10 (Docker Compose)
  Task Group 11 (Test Review & Gap Analysis)
```

**Critical path**: Task Group 1 -> Task Group 2 -> Task Group 3 -> Task Group 9 (all discovery-service TypeScript work is sequential)

**Parallelizable**: Task Group 5 (Java/Spring Boot) can proceed independently of all TypeScript work. Task Group 7 (prompt files) can proceed independently of all code work.

## File Inventory

### New Files (26 files)

**discovery-service (13 new files):**
- `discovery-service/src/types/linkerRule.ts`
- `discovery-service/src/types/decisionTask.ts`
- `discovery-service/src/constants/linkerDefaults.ts`
- `discovery-service/src/services/linkerRuleRegistry.ts`
- `discovery-service/src/services/linkerRules/index.ts`
- `discovery-service/src/services/linkerRules/containsByPathRule.ts`
- `discovery-service/src/services/linkerRules/importsByPatternRule.ts`
- `discovery-service/src/services/linkerRules/extendsByPatternRule.ts`
- `discovery-service/src/services/linkerRules/referencesBySymbolRule.ts`
- `discovery-service/src/services/triageEngine.ts`
- `discovery-service/src/services/gatewayClient.ts`
- `discovery-service/src/__tests__/linkerRulesAndTriage.test.ts` (or split per group)
- `discovery-service/src/__tests__/phase1bOrchestration.test.ts`

**architecture-model-service (5 new files):**
- `architecture-model-service/src/main/resources/db/changelog/sql/071-discovery-decision-task.sql`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DiscoveryDecisionTaskEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/DiscoveryDecisionTaskDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/DiscoveryDecisionTaskRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/DiscoveryDecisionTaskService.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/DiscoveryDecisionTaskController.java`

**gateway (4 new files):**
- `gateway/src/config/prompts/discovery.confirm-relationship.prompt.md`
- `gateway/src/config/prompts/discovery.resolve-competing-relationships.prompt.md`
- `gateway/src/routes/discoveryDecisionTasks.ts`
- `gateway/src/__tests__/discoveryDecisionTasks.test.ts`

### Modified Files (6 files)

- `discovery-service/src/types/index.ts` -- add exports for linkerRule and decisionTask types
- `discovery-service/src/config.ts` -- add GATEWAY_BASE_URL
- `discovery-service/src/services/archModelClient.ts` -- add 4 DecisionTask methods
- `discovery-service/src/services/runManager.ts` -- replace executeStep1b stub with real orchestration
- `gateway/src/routes/index.ts` -- add discoveryDecisionTasksRouter export
- `gateway/src/server.ts` -- mount discoveryDecisionTasksRouter route
- `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` -- add 071 changeSet entry
- Docker Compose file -- add GATEWAY_BASE_URL env var for discovery-service container
