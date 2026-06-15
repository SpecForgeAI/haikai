# Task Breakdown: Candidate Save-Back to Canonical Model

## Overview
Total Tasks: 53
Increment: 11 of 16 (Legacy / Current-State Discovery)

This feature promotes high-confidence discovery candidates from Phase 1d into the canonical architecture meta-model. It implements a new MCP tool that fetches eligible candidates, converts them to entity shapes, merges them into the existing model via GET-merge-PUT, and updates candidate status with provenance tracking.

Three services are involved:
- **architecture-model-service** (Java/Spring Boot): New Liquibase migration for `discovery_candidate_entity_mapping` provenance table, full JPA stack (Entity, DTO, Repository, Service, Controller)
- **mcp-server** (Express/TypeScript): New `candidateSaveBackService.ts` with topological sort, entity conversion, and GET-merge-PUT orchestration; new MCP tool route; archModelClient extensions for candidate fetching, candidate updating, and provenance mapping persistence
- **discovery-service** (Express/TypeScript): `CandidateStatus` union extension with `committed`

No gateway changes are required -- the MCP tool endpoint is already accessible through the existing MCP tool routing infrastructure.

## Task List

### Architecture-Model-Service: Provenance Mapping Table and JPA Stack

#### Task Group 1: Liquibase Migration for `discovery_candidate_entity_mapping`
**Dependencies:** None

- [x] 1.0 Complete Liquibase migration for the provenance mapping table
  - [x] 1.1 Create migration SQL file `architecture-model-service/src/main/resources/db/changelog/sql/073-discovery-candidate-entity-mapping.sql`
    - Create `discovery_candidate_entity_mapping` table with columns:
      - `id` UUID PRIMARY KEY DEFAULT gen_random_uuid()
      - `candidate_id` UUID NOT NULL, FK to `discovery_candidate(id)` ON DELETE CASCADE
      - `run_id` UUID NOT NULL
      - `entity_type` TEXT NOT NULL (the model array key, e.g., `applications`, `services`)
      - `entity_id` TEXT NOT NULL (the generated/matched entity ID string, e.g., `svc-mk8r1ccg-bd7tv`)
      - `action` TEXT NOT NULL (either `created` or `reused`)
      - `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()
    - Add index on `run_id` for efficient queries: `idx_candidate_entity_mapping_run_id`
    - Add index on `candidate_id`: `idx_candidate_entity_mapping_candidate_id`
    - Add column comments following the pattern from `072-candidate-parent-candidate-id.sql`
  - [x] 1.2 Register migration in `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
    - Add changeSet `073-discovery-candidate-entity-mapping` following the established pattern
    - Precondition: `not: tableExists: tableName: discovery_candidate_entity_mapping`
    - Reference SQL file path: `db/changelog/sql/073-discovery-candidate-entity-mapping.sql`

**Acceptance Criteria:**
- Migration SQL creates the table with all specified columns, FKs, and indexes
- Changelog entry follows the established YAML pattern with proper preconditions
- Migration is idempotent (uses `IF NOT EXISTS` patterns where applicable)

---

#### Task Group 2: JPA Entity, DTO, Repository, Service, and Controller
**Dependencies:** Task Group 1

- [x] 2.0 Complete the full JPA stack for provenance mapping
  - [x] 2.1 Write 4 focused tests for the provenance mapping JPA stack (JUnit 5)
    - Test `DiscoveryCandidateEntityMappingService.bulkCreate` persists mappings with correct fields and returns DTOs
    - Test `DiscoveryCandidateEntityMappingService.getByRunId` returns all mappings for a given run
    - Test `DiscoveryCandidateEntityMappingController` POST endpoint returns 200 with persisted mappings
    - Test `DiscoveryCandidateEntityMappingController` GET endpoint returns mappings filtered by runId
  - [x] 2.2 Create JPA Entity `DiscoveryCandidateEntityMappingEntity.java`
    - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DiscoveryCandidateEntityMappingEntity.java`
    - Follow `DiscoveryCandidateEntity.java` pattern: `@Entity`, `@Table`, Lombok `@Getter/@Setter/@NoArgsConstructor/@AllArgsConstructor/@Builder`
    - Fields: `id` (UUID PK), `candidateId` (UUID, not null), `runId` (UUID, not null), `entityType` (String, not null), `entityId` (String, not null), `action` (String, not null), `createdAt` (Instant, default now)
    - `@Table(name = "discovery_candidate_entity_mapping")` with `@Index` on `run_id` and `candidate_id`
    - `@PrePersist` to initialize `createdAt` if null
  - [x] 2.3 Create DTO record `DiscoveryCandidateEntityMappingDto.java`
    - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/DiscoveryCandidateEntityMappingDto.java`
    - Follow `DiscoveryCandidateDto.java` pattern: Java `record` with `@JsonProperty` annotations
    - Fields: `id` (UUID), `candidateId` (UUID, `candidate_id`), `runId` (UUID, `run_id`), `entityType` (String, `entity_type`), `entityId` (String, `entity_id`), `action` (String), `createdAt` (String, `created_at`)
  - [x] 2.4 Create Repository `DiscoveryCandidateEntityMappingRepository.java`
    - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/DiscoveryCandidateEntityMappingRepository.java`
    - Follow `DiscoveryCandidateRepository.java` pattern: extends `JpaRepository<DiscoveryCandidateEntityMappingEntity, UUID>`
    - Methods: `findByRunId(UUID runId)`, `countByRunId(UUID runId)`
  - [x] 2.5 Create Service `DiscoveryCandidateEntityMappingService.java`
    - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/service/DiscoveryCandidateEntityMappingService.java`
    - Follow `DiscoveryCandidateService.java` pattern: `@Service`, `@ConditionalOnProperty`, `@Transactional`
    - Methods:
      - `bulkCreate(UUID runId, List<DiscoveryCandidateEntityMappingDto> mappings)`: maps DTOs to entities, overrides runId from path param, saves all via `saveAll()`, returns DTOs
      - `getByRunId(UUID runId)`: returns all mappings for the run as DTOs
    - Include private `toDto` method following the candidate service pattern
  - [x] 2.6 Create Controller `DiscoveryCandidateEntityMappingController.java`
    - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/DiscoveryCandidateEntityMappingController.java`
    - Follow `DiscoveryCandidateController.java` pattern: `@RestController`, `@ConditionalOnProperty`, `@RequestMapping`, `@RequiredArgsConstructor`, `@Slf4j`
    - Base path: `/api/model/projects/{projectId}/discovery/runs/{runId}/candidate-entity-mappings`
    - Endpoints:
      - `POST /` -- bulk insert mappings for a run
      - `GET /` -- list all mappings for a run
  - [x] 2.7 Ensure JPA stack tests pass
    - Run ONLY the 4 tests written in 2.1
    - Verify all CRUD operations work against the in-memory test database

**Acceptance Criteria:**
- The 4 tests written in 2.1 pass
- Entity, DTO, Repository, Service, and Controller follow the established `DiscoveryCandidate*` pattern exactly
- POST endpoint accepts bulk insert and returns persisted DTOs
- GET endpoint returns mappings for a given runId
- `@ConditionalOnProperty` annotation present on Service and Controller

---

### Discovery-Service: CandidateStatus Extension

#### Task Group 3: Add `committed` to CandidateStatus Union
**Dependencies:** None (can be developed in parallel with Task Groups 1-2)

- [x] 3.0 Extend CandidateStatus with `committed`
  - [x] 3.1 Write 2 focused tests for the status extension
    - Test that `committed` is a valid `CandidateStatus` value (type-level test using a typed variable assignment)
    - Test that the existing values (`proposed`, `accepted`, `rejected`, `merged`) still compile correctly alongside `committed`
  - [x] 3.2 Add `committed` to `CandidateStatus` union in `discovery-service/src/types/candidate.ts`
    - Add `| 'committed'` to the existing union type
    - Update the JSDoc comment to document `committed`: "Candidate has been promoted to the canonical model via save-back"
  - [x] 3.3 Ensure status extension tests pass
    - Run ONLY the 2 tests written in 3.1
    - Verify TypeScript compilation succeeds with no type errors

**Acceptance Criteria:**
- The 2 tests written in 3.1 pass
- `committed` is a valid `CandidateStatus` value
- Existing status values remain unchanged
- No breaking changes to existing discovery-service code

---

### MCP-Server: archModelClient Extensions

#### Task Group 4: Candidate Fetching and Provenance Mapping Methods
**Dependencies:** Task Groups 1, 2 (for the provenance mapping endpoint to exist)

- [x] 4.0 Complete archModelClient extensions for candidate and provenance operations
  - [x] 4.1 Write 5 focused tests for the new archModelClient methods
    - Test `getCandidatesByRun(projectId, runId)` sends GET to the correct URL `/api/model/projects/{projectId}/discovery/runs/{runId}/candidates` and returns `DiscoveryCandidateDto[]`
    - Test `getCandidatesByRun(projectId, runId, type, status)` appends query params `?type=application&status=proposed`
    - Test `updateCandidate(projectId, runId, candidateId, update)` sends PUT to the correct URL with update body and returns the updated candidate
    - Test `bulkCreateCandidateEntityMappings(projectId, runId, mappings)` sends POST to `/api/model/projects/{projectId}/discovery/runs/{runId}/candidate-entity-mappings` with the mappings array
    - Test `getCandidatesByRun` handles error responses (non-200) by throwing with preserved status code
  - [x] 4.2 Define `DiscoveryCandidateDto` interface in `mcp-server/src/services/archModelClient.ts`
    - Fields: `id` (string), `run_id` (string), `candidate_type` (string), `name` (string), `confidence` (number), `status` (string), `source_cluster_ids` (string[]), `data` (Record<string, any>), `synthesized_at` (string), `parent_candidate_id` (string | null)
    - Follow the convention of defining response DTOs near the client class (as done for `ProjectDto`, `DiscoveryRunResponseDto`, etc.)
  - [x] 4.3 Define `CandidateEntityMappingDto` interface in `mcp-server/src/services/archModelClient.ts`
    - Fields: `id` (string), `candidate_id` (string), `run_id` (string), `entity_type` (string), `entity_id` (string), `action` (string), `created_at` (string)
  - [x] 4.4 Add `getCandidatesByRun` method to `ArchModelClient` class
    - Signature: `async getCandidatesByRun(projectId: string, runId: string, type?: string, status?: string): Promise<DiscoveryCandidateDto[]>`
    - URL: `/api/model/projects/${encodeURIComponent(projectId)}/discovery/runs/${encodeURIComponent(runId)}/candidates`
    - Optional query params: `type`, `status`
    - Follow the pattern from existing methods (e.g., `getDiscoveryRun`)
  - [x] 4.5 Add `updateCandidate` method to `ArchModelClient` class
    - Signature: `async updateCandidate(projectId: string, runId: string, candidateId: string, update: Partial<DiscoveryCandidateDto>): Promise<DiscoveryCandidateDto>`
    - URL: `/api/model/projects/${encodeURIComponent(projectId)}/discovery/runs/${encodeURIComponent(runId)}/candidates/${encodeURIComponent(candidateId)}`
    - Method: PUT with update body
    - Follow the pattern from `updateWorkItem`
  - [x] 4.6 Add `bulkCreateCandidateEntityMappings` method to `ArchModelClient` class
    - Signature: `async bulkCreateCandidateEntityMappings(projectId: string, runId: string, mappings: CandidateEntityMappingDto[]): Promise<CandidateEntityMappingDto[]>`
    - URL: `/api/model/projects/${encodeURIComponent(projectId)}/discovery/runs/${encodeURIComponent(runId)}/candidate-entity-mappings`
    - Method: POST with mappings array body
  - [x] 4.7 Ensure archModelClient extension tests pass
    - Run ONLY the 5 tests written in 4.1

**Acceptance Criteria:**
- The 5 tests written in 4.1 pass
- All three new methods follow the established ArchModelClient patterns (URL encoding, error handling, return types)
- `DiscoveryCandidateDto` and `CandidateEntityMappingDto` interfaces match the architecture-model-service REST API shapes
- Methods use `encodeURIComponent` for all path parameters

---

### MCP-Server: Save-Back Service

#### Task Group 5: Entity Conversion and Topological Sort Utilities
**Dependencies:** Task Group 4

- [x] 5.0 Complete entity conversion and topological sort logic
  - [x] 5.1 Write 8 focused tests for conversion and topological sort
    - Test `buildDepthMap` with a flat list (no parents) returns all candidates at depth 0
    - Test `buildDepthMap` with a two-level hierarchy (application -> service) returns correct depths 0 and 1
    - Test `buildDepthMap` with a three-level hierarchy (application -> service -> interface) returns depths 0, 1, 2
    - Test `convertCandidateToEntity` for `application` type produces correct entity shape with `id`, `name`, `description`, `model_file_id`, default null fields (`app_type`, `status`, `tags`, `valid_from`, `valid_to`, `is_internal`)
    - Test `convertCandidateToEntity` for `service` type populates `service_type` and `core_tech` from candidate data, and resolves `application_id` from the `candidateIdToEntityId` map via `parentCandidateId`
    - Test `convertCandidateToEntity` for `physical_entity` type populates `physical_type` and `database_name` from candidate data
    - Test `convertCandidateToEntity` for `interface` type populates `interface_type` and resolves `service_id` via parent chain
    - Test `getTargetArrayKey` returns correct model array keys for all 8 candidate types: `application` -> `applications`, `app_component` -> `app_components`, `service` -> `services`, `interface` -> `interfaces`, `logical_entity` -> `logical_data_entities`, `physical_entity` -> `physical_data_entities`, `data_entity` -> `physical_data_entities`, `business_process` -> `business_processes`
  - [x] 5.2 Create `mcp-server/src/services/candidateSaveBackService.ts` with conversion utilities
    - Export `CANDIDATE_TYPE_CONFIG`: a mapping from `candidateType` to `{ targetArrayKey, idPrefix, parentFkField }`:
      - `application` -> `{ targetArrayKey: 'applications', idPrefix: 'app-', parentFkField: null }`
      - `app_component` -> `{ targetArrayKey: 'app_components', idPrefix: 'comp-', parentFkField: 'application_id' }`
      - `service` -> `{ targetArrayKey: 'services', idPrefix: 'svc-', parentFkField: 'application_id' }`
      - `interface` -> `{ targetArrayKey: 'interfaces', idPrefix: 'ifc-', parentFkField: 'service_id' }`
      - `logical_entity` -> `{ targetArrayKey: 'logical_data_entities', idPrefix: 'lde-', parentFkField: null }`
      - `physical_entity` -> `{ targetArrayKey: 'physical_data_entities', idPrefix: 'pde-', parentFkField: null }`
      - `data_entity` -> `{ targetArrayKey: 'physical_data_entities', idPrefix: 'pde-', parentFkField: null }`
      - `business_process` -> `{ targetArrayKey: 'business_processes', idPrefix: 'bp-', parentFkField: null }`
    - Export `getTargetArrayKey(candidateType: string): string` helper
    - Export `CANDIDATE_AUTO_ACCEPT_THRESHOLD = 0.75` (mirroring the discovery-service constant)
    - Export `EXCLUDED_STATUSES = ['rejected', 'merged', 'committed']` for eligibility filtering
  - [x] 5.3 Implement `buildDepthMap` function
    - Signature: `buildDepthMap(candidates: DiscoveryCandidateDto[]): Map<string, number>`
    - Build a depth map from the candidate forest: candidates with no `parent_candidate_id` are depth 0, children of depth-0 are depth 1, etc.
    - Uses a simple iterative approach: start with all root candidates, then for each depth level find candidates whose `parent_candidate_id` is in the current depth's set
    - Returns a Map of candidateId -> depth
  - [x] 5.4 Implement `convertCandidateToEntity` function
    - Signature: `convertCandidateToEntity(candidate: DiscoveryCandidateDto, modelFileId: string, candidateIdToEntityId: Record<string, string>): any`
    - Generate entity ID via `generateId(config.idPrefix)`
    - Populate common fields: `id`, `name`, `description` (from `candidate.data.description` or empty string), `model_file_id`
    - Populate type-specific fields from candidate `data`:
      - Services: `service_type` from `data.service_type`, `core_tech` from `data.core_tech`
      - Physical data entities: `physical_type` from `data.physical_type`, `database_name` from `data.database_name`
      - App components: `tech_type` from `data.tech_type`
      - Interfaces: `interface_type` from `data.interface_type`
    - Populate parent FK field by looking up `candidate.parent_candidate_id` in `candidateIdToEntityId` map
    - All nullable fields not provided default to `null` or empty string following the `anchorEntitiesService` patterns
    - If parent is required but not found in map, throw a descriptive error (fail-fast)
  - [x] 5.5 Ensure conversion and sort tests pass
    - Run ONLY the 8 tests written in 5.1

**Acceptance Criteria:**
- The 8 tests written in 5.1 pass
- `CANDIDATE_TYPE_CONFIG` covers all 8 candidate types from the spec
- `buildDepthMap` correctly handles flat lists, two-level, and three-level hierarchies
- `convertCandidateToEntity` produces entity shapes matching the canonical model format
- Parent FK resolution via `candidateIdToEntityId` map works correctly
- Type-specific fields are populated from candidate `data` payload

---

#### Task Group 6: Save-Back Orchestration Service
**Dependencies:** Task Groups 4, 5

- [x] 6.0 Complete the save-back orchestration function
  - [x] 6.1 Write 7 focused tests for the orchestration function
    - Test happy path: mock `getProjectById`, `getCandidatesByRun` (returns 3 eligible candidates -- 1 application, 1 service, 1 interface in hierarchy), `getModel` (returns empty model shell), verify `putModel` called with correct merged entities, `updateCandidate` called 3 times with `committed` status, `bulkCreateCandidateEntityMappings` called with 3 mappings
    - Test eligibility filtering: candidates with confidence < 0.75 are excluded; candidates with status `rejected`, `merged`, `committed` are excluded; only `proposed` or `accepted` with confidence >= 0.75 pass
    - Test idempotent matching: if an application named "OrderApp" already exists in the model, it is skipped (not duplicated), the existing entity's ID is recorded in `candidateIdToEntityId` for downstream parent resolution, and `entitiesSkipped` count increments
    - Test topological ordering: service candidate with `parent_candidate_id` pointing to application candidate is processed after the application; interface candidate pointing to service is processed after service
    - Test early return: if no eligible candidates are found after filtering, return `{ entitiesCreated: 0, entitiesSkipped: 0, candidatesCommitted: 0 }` without calling `getModel` or `putModel`
    - Test fail-fast: if `getModel` throws, the error propagates immediately and `putModel` is never called
    - Test status update resilience: after successful `putModel`, if one `updateCandidate` call fails, the failure is logged as a warning but does not throw; the overall operation still returns success
  - [x] 6.2 Implement `saveDiscoveryCandidatesToModel` function
    - Signature: `async saveDiscoveryCandidatesToModel(projectId: string, runId: string): Promise<SaveBackResult>`
    - Define `SaveBackResult` interface: `{ projectId: string, runId: string, entitiesCreated: number, entitiesSkipped: number, candidatesCommitted: number }`
    - Orchestration steps:
      1. Validate project via `archModelClient.getProjectById(projectId)` -- derive `filename` from `project.name`
      2. Fetch all candidates for the run via `archModelClient.getCandidatesByRun(projectId, runId)`
      3. Filter to eligible candidates: `confidence >= CANDIDATE_AUTO_ACCEPT_THRESHOLD` AND `status` not in `EXCLUDED_STATUSES`
      4. If no eligible candidates, return early with zero counts
      5. GET existing model via `archModelClient.getModel(filename)` -- create empty shell if null (reuse `createEmptyModelShell` from `anchorEntitiesService` pattern)
      6. Build depth map via `buildDepthMap(eligibleCandidates)`
      7. Sort candidates by ascending depth
      8. Initialize `candidateIdToEntityId: Record<string, string> = {}`
      9. For each candidate in depth order:
         a. Determine `targetArrayKey` from `CANDIDATE_TYPE_CONFIG`
         b. Ensure target array exists on `model.metaModel.entities[targetArrayKey]`
         c. Check for existing entity with same name (case-sensitive) in target array
         d. If exists: skip creation, record existing entity ID in `candidateIdToEntityId`, increment `entitiesSkipped`
         e. If not exists: call `convertCandidateToEntity`, push to target array, record new entity ID in `candidateIdToEntityId`, increment `entitiesCreated`
      10. PUT updated model via `archModelClient.putModel(filename, model)`
      11. Update each promoted candidate's status to `committed` with `committedEntityId` and `committedEntityType` in data:
          - Call `archModelClient.updateCandidate(projectId, runId, candidateId, { status: 'committed', data: { ...existingData, committedEntityId, committedEntityType } })`
          - Catch and log warnings for individual failures (do not fail overall)
      12. Persist provenance mappings via `archModelClient.bulkCreateCandidateEntityMappings(projectId, runId, mappings)`
          - Each mapping: `{ candidate_id, run_id, entity_type, entity_id, action: 'created' | 'reused' }`
      13. Return `{ projectId, runId, entitiesCreated, entitiesSkipped, candidatesCommitted }`
  - [x] 6.3 Implement `createEmptyModelShell` (or import from a shared utility)
    - Replicate the exact shape from `anchorEntitiesService.ts`: all entity arrays and relationship arrays initialized to empty
    - Consider extracting to a shared utility if not already shared; otherwise replicate inline
  - [x] 6.4 Ensure orchestration tests pass
    - Run ONLY the 7 tests written in 6.1

**Acceptance Criteria:**
- The 7 tests written in 6.1 pass
- Full orchestration flow works end-to-end: fetch -> filter -> GET model -> sort -> convert/merge -> PUT model -> status update -> provenance
- Eligibility filtering correctly applies confidence threshold and status exclusions
- Idempotent matching skips existing entities by name and records their IDs for parent resolution
- Topological sort ensures parents are always processed before children
- Fail-fast behavior prevents partial model writes
- Status update failures after `putModel` are logged as warnings, not thrown
- Provenance mappings are persisted with correct `action` values (`created` vs `reused`)

---

### MCP-Server: MCP Tool Route

#### Task Group 7: Save Discovery Candidates Route
**Dependencies:** Task Group 6

- [x] 7.0 Complete the MCP tool route for save-back
  - [x] 7.1 Write 5 focused tests for the route handler
    - Test valid request: POST with `sessionId`, `projectId` (UUID), `runId` (UUID) returns 200 with structured result `{ projectId, runId, entitiesCreated, entitiesSkipped, candidatesCommitted }`
    - Test missing `sessionId` returns 400 with descriptive error
    - Test invalid `projectId` (non-UUID string) returns 400 with descriptive error
    - Test invalid `runId` (non-UUID string) returns 400 with descriptive error
    - Test upstream service failure (502 from archModelClient) returns 502 with error message
  - [x] 7.2 Create route file `mcp-server/src/routes/saveDiscoveryCandidatesRoute.ts`
    - Follow `saveProjectAnchorEntitiesRoute.ts` pattern exactly:
      - Import `Router`, `Request`, `Response`, `NextFunction` from express
      - Import `getOrCreateSession` from sessionManager
      - Import `createHttpError` from errorHandler
      - Import `saveDiscoveryCandidatesToModel` from candidateSaveBackService
    - Export `saveDiscoveryCandidatesRouter`
    - UUID v4 regex validation for both `projectId` and `runId`
    - POST handler:
      1. Extract `sessionId`, `projectId`, `runId` from `req.body`
      2. Validate `sessionId` (non-empty string)
      3. Validate `projectId` (UUID v4 regex)
      4. Validate `runId` (UUID v4 regex)
      5. Call `getOrCreateSession(sessionId)`
      6. Delegate to `saveDiscoveryCandidatesToModel(projectId, runId)`
      7. Log success and return `res.json(response)`
    - Error handling:
      - 400 for validation errors (statusCode === 400)
      - 502 for upstream failures (statusCode === 502)
      - Pass others to `next(error)`
  - [x] 7.3 Mount route in `mcp-server/src/routes/tools.ts`
    - Import `saveDiscoveryCandidatesRouter` from `./saveDiscoveryCandidatesRoute`
    - Add: `toolsRouter.use('/save_discovery_candidates_to_model', saveDiscoveryCandidatesRouter)`
    - Place after the existing `save_project_anchor_entities` mount
  - [x] 7.4 Ensure route tests pass
    - Run ONLY the 5 tests written in 7.1

**Acceptance Criteria:**
- The 5 tests written in 7.1 pass
- Route follows the `saveProjectAnchorEntitiesRoute.ts` pattern exactly
- Both `projectId` and `runId` are validated as UUID v4
- Error handling matches the established 400/502 pattern
- Route is mounted at `/mcp/tools/save_discovery_candidates_to_model` in `tools.ts`

---

### Testing: Review and Gap Analysis

#### Task Group 8: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-7

- [x] 8.0 Review existing tests and fill critical gaps only
  - [x] 8.1 Review tests from Task Groups 1-7
    - Review the 4 JPA stack tests (Task 2.1)
    - Review the 2 status extension tests (Task 3.1)
    - Review the 5 archModelClient extension tests (Task 4.1)
    - Review the 8 conversion/sort tests (Task 5.1)
    - Review the 7 orchestration tests (Task 6.1)
    - Review the 5 route handler tests (Task 7.1)
    - Total existing tests: approximately 31 tests
  - [x] 8.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows that lack test coverage
    - Focus on integration points: candidate fetch -> eligibility filter -> topological sort -> entity conversion -> model merge -> status update -> provenance mapping
    - Assess whether parent resolution edge cases are adequately covered
    - Assess whether the multi-entity-type conversion path is covered (not just single types)
    - Do NOT assess entire application test coverage
  - [x] 8.3 Write up to 10 additional strategic tests maximum
    - Possible gap areas (implement only if gaps exist after review):
      - End-to-end orchestration with all 8 candidate types producing entities in the correct model arrays
      - Topological sort with orphaned child (parent candidate not in eligible set and not in map) triggers fail-fast error
      - Idempotent matching: re-running save-back on the same candidates produces zero `entitiesCreated` and all `entitiesSkipped`
      - Mixed scenario: some candidates match existing entities (skipped), others are new (created), parent resolution uses both existing and new IDs
      - `convertCandidateToEntity` with missing optional `data` fields defaults gracefully (no undefined errors)
      - `data_entity` candidate type maps to `physical_data_entities` (conservative physical-side-only mapping)
      - `buildDepthMap` with circular parent references (should not infinite loop -- detect and error)
      - Route validation: `runId` as empty string returns 400
      - Provenance mapping: `action` field is correctly `created` for new entities and `reused` for skipped entities
      - Status update: `committedEntityId` and `committedEntityType` are correctly populated in candidate data after save
  - [x] 8.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, and 8.3)
    - Expected total: approximately 31-41 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 31-41 tests total)
- Critical end-to-end orchestration flow is covered
- No more than 10 additional tests added to fill gaps
- Testing focused exclusively on this spec's feature requirements

## Execution Order

Recommended implementation sequence:

```
Phase A: Foundation (parallel tracks)
  Track 1: Task Group 1 (Liquibase Migration) -> Task Group 2 (JPA Stack)
  Track 2: Task Group 3 (CandidateStatus Extension -- independent TypeScript work)

Phase B: MCP-Server Client Layer (after Phase A)
  Task Group 4 (archModelClient Extensions -- needs TG1-2 for provenance endpoints)

Phase C: MCP-Server Service Layer (after Phase B)
  Task Group 5 (Entity Conversion & Topological Sort -- needs TG4 for DTO types)
  Task Group 6 (Save-Back Orchestration -- needs TG4 + TG5)

Phase D: MCP-Server Route Layer (after Phase C)
  Task Group 7 (MCP Tool Route -- needs TG6 for service function)

Phase E: Testing (after Phase D)
  Task Group 8 (Test Review & Gap Analysis)
```

**Critical path**: Task Group 1 -> Task Group 2 -> Task Group 4 -> Task Group 5 -> Task Group 6 -> Task Group 7

**Parallelizable**:
- Task Group 3 (discovery-service TypeScript CandidateStatus change) can proceed independently of all Java and MCP-server work
- Task Group 1 (Liquibase migration) and Task Group 3 can start simultaneously at the beginning
- Task Group 5 (conversion utilities) has no strict dependency on Task Group 2 being deployed, only on TG4 DTO types being defined -- in practice these can be developed together

## File Inventory

### New Files (9 files)

**architecture-model-service (6 new files):**
- `architecture-model-service/src/main/resources/db/changelog/sql/073-discovery-candidate-entity-mapping.sql`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DiscoveryCandidateEntityMappingEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/DiscoveryCandidateEntityMappingDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/DiscoveryCandidateEntityMappingRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/DiscoveryCandidateEntityMappingService.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/DiscoveryCandidateEntityMappingController.java`

**mcp-server (3 new files):**
- `mcp-server/src/services/candidateSaveBackService.ts`
- `mcp-server/src/routes/saveDiscoveryCandidatesRoute.ts`
- `mcp-server/src/__tests__/candidateSaveBack.test.ts` (or split across multiple test files per task group)

### Modified Files (4 files)

**architecture-model-service (1 modified file):**
- `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` -- add changeSet `073-discovery-candidate-entity-mapping`

**mcp-server (2 modified files):**
- `mcp-server/src/services/archModelClient.ts` -- add `DiscoveryCandidateDto` and `CandidateEntityMappingDto` interfaces, add `getCandidatesByRun`, `updateCandidate`, and `bulkCreateCandidateEntityMappings` methods
- `mcp-server/src/routes/tools.ts` -- import and mount `saveDiscoveryCandidatesRouter`

**discovery-service (1 modified file):**
- `discovery-service/src/types/candidate.ts` -- add `'committed'` to `CandidateStatus` union
