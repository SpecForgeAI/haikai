# Task Breakdown: Phase 1 Evidence Schema Backbone (1a-1d)

## Overview
Total Tasks: 47 (across 7 task groups)

This increment defines the complete persistence schema and TypeScript type contracts for Phase 1 evidence layers 1b (Relationship Inference), 1c (Cluster Formation), and 1d (Candidate Synthesis). It delivers 4 Liquibase migrations, 4 new JPA entity stacks, 9+ archModelClient methods, run manager stub upgrades, and TypeScript type definitions -- establishing the end-to-end pipeline backbone that future analysis increments will build upon.

## Task List

### Database Layer (architecture-model-service)

#### Task Group 1: Liquibase Migrations (067-070)
**Dependencies:** None

- [x] 1.0 Complete all four Liquibase SQL migrations and changelog registration
  - [x] 1.1 Create `067-discovery-relationship.sql` migration
    - File: `architecture-model-service/src/main/resources/db/changelog/sql/067-discovery-relationship.sql`
    - Follow pattern from: `066-discovery-evidence.sql` (CREATE TABLE IF NOT EXISTS, FK ON DELETE CASCADE, TIMESTAMPTZ DEFAULT NOW(), CREATE INDEX IF NOT EXISTS, COMMENT ON TABLE/COLUMN)
    - Table: `discovery_relationship`
    - Columns: `id` (UUID PK), `run_id` (UUID FK to discovery_run ON DELETE CASCADE NOT NULL), `source_atom_id` (UUID FK to discovery_evidence ON DELETE CASCADE NOT NULL), `target_atom_id` (UUID FK to discovery_evidence ON DELETE CASCADE NOT NULL), `relationship_type` (TEXT NOT NULL), `confidence` (DOUBLE PRECISION NOT NULL), `data` (JSONB NOT NULL), `inferred_at` (TIMESTAMPTZ NOT NULL DEFAULT NOW())
    - Indexes: `run_id`, `(run_id, relationship_type)`, `source_atom_id`, `target_atom_id`
    - Comments on table and columns documenting purpose and FK semantics
  - [x] 1.2 Create `068-discovery-cluster.sql` migration
    - File: `architecture-model-service/src/main/resources/db/changelog/sql/068-discovery-cluster.sql`
    - Table: `discovery_cluster`
    - Columns: `id` (UUID PK), `run_id` (UUID FK to discovery_run ON DELETE CASCADE NOT NULL), `cluster_type` (TEXT NOT NULL), `name` (TEXT nullable), `confidence` (DOUBLE PRECISION NOT NULL), `data` (JSONB NOT NULL), `formed_at` (TIMESTAMPTZ NOT NULL DEFAULT NOW())
    - Indexes: `run_id`, `(run_id, cluster_type)`
    - Comments on table and columns
  - [x] 1.3 Create `069-discovery-cluster-member.sql` migration
    - File: `architecture-model-service/src/main/resources/db/changelog/sql/069-discovery-cluster-member.sql`
    - Table: `discovery_cluster_member`
    - Columns: `id` (UUID PK), `cluster_id` (UUID FK to discovery_cluster ON DELETE CASCADE NOT NULL), `member_type` (TEXT NOT NULL), `member_id` (UUID NOT NULL)
    - Unique constraint on `(cluster_id, member_type, member_id)`
    - Indexes: `cluster_id`, `(cluster_id, member_type)`, `member_id`
    - No FK on `member_id` (polymorphic reference -- target table varies by member_type)
    - Comments noting that referential integrity for member_id is enforced at the application layer
  - [x] 1.4 Create `070-discovery-candidate.sql` migration
    - File: `architecture-model-service/src/main/resources/db/changelog/sql/070-discovery-candidate.sql`
    - Table: `discovery_candidate`
    - Columns: `id` (UUID PK), `run_id` (UUID FK to discovery_run ON DELETE CASCADE NOT NULL), `candidate_type` (TEXT NOT NULL), `name` (TEXT NOT NULL), `confidence` (DOUBLE PRECISION NOT NULL), `status` (TEXT NOT NULL DEFAULT 'proposed'), `source_cluster_ids` (JSONB NOT NULL), `data` (JSONB NOT NULL), `synthesized_at` (TIMESTAMPTZ NOT NULL DEFAULT NOW())
    - Indexes: `run_id`, `(run_id, candidate_type)`, `(run_id, status)`
    - Comments on table and columns, documenting valid status values and source_cluster_ids format
  - [x] 1.5 Register all four migrations in `db.changelog-master.yaml`
    - File: `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
    - Append four new changeSets following the existing pattern (preConditions with `onFail: MARK_RAN`, `not: tableExists` guard, sqlFile reference, `splitStatements: true`, `stripComments: true`)
    - Order: 067, 068, 069, 070
    - Each changeSet includes a descriptive comment block above it (matching the pattern of entries 064-066)
  - [x] 1.6 Review 1a alignment: verify `066-discovery-evidence.sql` type column COMMENT
    - Check if the COMMENT ON COLUMN for `discovery_evidence.type` restricts values to only the current three types
    - If it does (it currently says "Valid values: file_structure, symbol, string_pattern"), no migration needed unless spec explicitly requires updating the comment -- document the finding for future reference
    - Any changes must be backward-compatible (nullable new columns only)
    - **Finding:** Confirmed that `066-discovery-evidence.sql` line 43 contains `COMMENT ON COLUMN discovery_evidence.type IS 'Evidence atom type. Valid values: file_structure, symbol, string_pattern.';` which restricts values to only three types. No migration is needed in this increment since the backbone introduces new tables for new layers (1b/1c/1d) rather than new atom types within the 1a layer. A future increment that adds new atom types should update this comment to indicate extensibility.

**Acceptance Criteria:**
- All four SQL files are syntactically valid and follow the 066-discovery-evidence.sql pattern
- Changelog YAML has four new entries in correct order with proper preconditions
- All FK relationships use ON DELETE CASCADE
- Unique constraint on cluster_member `(cluster_id, member_type, member_id)` is present
- No FK constraint on `discovery_cluster_member.member_id` (polymorphic)

---

#### Task Group 2: Relationship JPA Stack (1b)
**Dependencies:** Task Group 1 (migration 067)

- [x] 2.0 Complete Discovery Relationship entity, DTO, repository, service, and controller
  - [x] 2.1 Write 4 focused controller tests for Relationship endpoints
    - File: `architecture-model-service/src/test/java/com/example/architecturemodel/controller/DiscoveryRelationshipControllerTest.java`
    - Follow pattern from: `DiscoveryEvidenceControllerTest.java` (@WebMvcTest, @MockBean service, MockMvc)
    - Test 1: POST bulk insert accepts array of relationship DTOs and returns persisted results
    - Test 2: GET by run ID returns all relationships for that run
    - Test 3: GET by run ID with `?type=imports` filter returns only matching relationships
    - Test 4: GET `/count` returns the correct relationship count for a run
  - [x] 2.2 Create `DiscoveryRelationshipEntity` JPA entity
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DiscoveryRelationshipEntity.java`
    - Follow pattern from: `DiscoveryEvidenceEntity.java` (Lombok `@Getter/@Setter/@Builder/@NoArgsConstructor/@AllArgsConstructor`, `@Type(JsonType.class)` on data, `@Builder.Default`, `@PrePersist`)
    - Fields: `id` (UUID), `runId` (UUID), `sourceAtomId` (UUID), `targetAtomId` (UUID), `relationshipType` (String), `confidence` (double), `data` (Map<String, Object>), `inferredAt` (Instant)
    - Table annotation with indexes matching migration 067
  - [x] 2.3 Create `DiscoveryRelationshipDto` record
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/DiscoveryRelationshipDto.java`
    - Follow pattern from: `DiscoveryEvidenceDto.java` (Java record with @JsonProperty annotations using snake_case names)
    - Fields: `id`, `runId` (as `run_id`), `sourceAtomId` (as `source_atom_id`), `targetAtomId` (as `target_atom_id`), `relationshipType` (as `relationship_type`), `confidence`, `data`, `inferredAt` (as `inferred_at`)
  - [x] 2.4 Create `DiscoveryRelationshipRepository`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/DiscoveryRelationshipRepository.java`
    - Follow pattern from: `DiscoveryEvidenceRepository.java`
    - Methods: `findByRunId(UUID)`, `findByRunIdAndRelationshipType(UUID, String)`, `countByRunId(UUID)`
  - [x] 2.5 Create `DiscoveryRelationshipService`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/DiscoveryRelationshipService.java`
    - Follow pattern from: `DiscoveryEvidenceService.java` (@ConditionalOnProperty, @RequiredArgsConstructor, @Slf4j)
    - Methods: `bulkCreate(UUID runId, List<DiscoveryRelationshipDto>)` with `@Transactional`, `getByRunId(UUID runId, String type)` with `@Transactional(readOnly = true)`, `countByRunId(UUID)` with `@Transactional(readOnly = true)`
    - DTO-to-entity mapping in bulkCreate, entity-to-DTO in toDto helper
  - [x] 2.6 Create `DiscoveryRelationshipController`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/DiscoveryRelationshipController.java`
    - Follow pattern from: `DiscoveryEvidenceController.java` (@ConditionalOnProperty, @RequestMapping, @RequiredArgsConstructor, @Slf4j)
    - Base path: `/api/model/projects/{projectId}/discovery/runs/{runId}/relationships`
    - Endpoints: POST (bulk insert), GET (list with optional `?type=` filter), GET `/count`
  - [x] 2.7 Ensure Relationship controller tests pass
    - Run ONLY the 4 tests in `DiscoveryRelationshipControllerTest.java`
    - Verify all endpoints delegate correctly to the service

**Acceptance Criteria:**
- All 4 controller tests pass
- Entity maps to `discovery_relationship` table with correct column mappings
- DTO uses snake_case @JsonProperty annotations
- Repository has the three finder methods
- Service has proper @Transactional annotations on all methods
- Controller gated by @ConditionalOnProperty

---

#### Task Group 3: Cluster + ClusterMember JPA Stack (1c)
**Dependencies:** Task Group 1 (migrations 068, 069)

- [x] 3.0 Complete Discovery Cluster entity (with nested ClusterMember), DTO, repository, service, and controller
  - [x] 3.1 Write 5 focused controller tests for Cluster endpoints
    - File: `architecture-model-service/src/test/java/com/example/architecturemodel/controller/DiscoveryClusterControllerTest.java`
    - Follow pattern from: `DiscoveryEvidenceControllerTest.java`
    - Test 1: POST bulk insert accepts array of cluster DTOs (each including members list) and returns persisted results
    - Test 2: GET by run ID returns all clusters for that run, each with their member lists
    - Test 3: GET by run ID with `?type=service_boundary` filter returns only matching clusters
    - Test 4: GET `/count` returns the correct cluster count
    - Test 5: POST with a cluster containing duplicate members (same cluster_id, member_type, member_id) returns the cluster with deduplicated members
  - [x] 3.2 Create `DiscoveryClusterMemberEntity` JPA entity
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DiscoveryClusterMemberEntity.java`
    - Fields: `id` (UUID), `clusterId` (UUID), `memberType` (String), `memberId` (UUID)
    - No separate controller -- managed through cluster operations
    - Table annotation referencing `discovery_cluster_member` with indexes matching migration 069
  - [x] 3.3 Create `DiscoveryClusterEntity` JPA entity
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DiscoveryClusterEntity.java`
    - Follow pattern from: `DiscoveryEvidenceEntity.java`
    - Fields: `id` (UUID), `runId` (UUID), `clusterType` (String), `name` (String nullable), `confidence` (double), `data` (Map<String, Object>), `formedAt` (Instant)
    - `@OneToMany` relationship to `DiscoveryClusterMemberEntity` with CascadeType.ALL and orphanRemoval
  - [x] 3.4 Create `DiscoveryClusterMemberDto` record
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/DiscoveryClusterMemberDto.java`
    - Fields: `id`, `clusterId` (as `cluster_id`), `memberType` (as `member_type`), `memberId` (as `member_id`)
  - [x] 3.5 Create `DiscoveryClusterDto` record
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/DiscoveryClusterDto.java`
    - Fields: `id`, `runId` (as `run_id`), `clusterType` (as `cluster_type`), `name`, `confidence`, `members` (List<DiscoveryClusterMemberDto>), `data`, `formedAt` (as `formed_at`)
  - [x] 3.6 Create `DiscoveryClusterRepository`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/DiscoveryClusterRepository.java`
    - Methods: `findByRunId(UUID)`, `findByRunIdAndClusterType(UUID, String)`, `countByRunId(UUID)`
  - [x] 3.7 Create `DiscoveryClusterMemberRepository`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/DiscoveryClusterMemberRepository.java`
    - Methods: `findByClusterId(UUID)` (needed if members are not eagerly loaded)
  - [x] 3.8 Create `DiscoveryClusterService`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/DiscoveryClusterService.java`
    - `bulkCreate` persists cluster entities AND their member entities together in a single transaction
    - `getByRunId(UUID, String type?)` returns clusters with their members populated
    - `countByRunId(UUID)` returns cluster count
    - All write methods `@Transactional`, read methods `@Transactional(readOnly = true)`
  - [x] 3.9 Create `DiscoveryClusterController`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/DiscoveryClusterController.java`
    - Base path: `/api/model/projects/{projectId}/discovery/runs/{runId}/clusters`
    - Endpoints: POST (bulk insert -- clusters with nested members), GET (list with optional `?type=` filter), GET `/count`
  - [x] 3.10 Ensure Cluster controller tests pass
    - Run ONLY the 5 tests in `DiscoveryClusterControllerTest.java`

**Acceptance Criteria:**
- All 5 controller tests pass
- Cluster entity has @OneToMany to ClusterMemberEntity with CascadeType.ALL
- ClusterMember entity has no separate REST controller
- bulkCreate persists clusters and members atomically in one transaction
- Cluster DTO includes nested `members` list of ClusterMemberDto entries
- Member deduplication handled (unique constraint on cluster_id, member_type, member_id)

---

#### Task Group 4: Candidate JPA Stack (1d)
**Dependencies:** Task Group 1 (migration 070)

- [x] 4.0 Complete Discovery Candidate entity, DTO, repository, service, and controller
  - [x] 4.1 Write 5 focused controller tests for Candidate endpoints
    - File: `architecture-model-service/src/test/java/com/example/architecturemodel/controller/DiscoveryCandidateControllerTest.java`
    - Follow pattern from: `DiscoveryEvidenceControllerTest.java`
    - Test 1: POST bulk insert accepts array of candidate DTOs and returns persisted results
    - Test 2: GET by run ID returns all candidates for that run
    - Test 3: GET by run ID with `?type=application&status=proposed` returns only matching candidates (dual filter)
    - Test 4: GET `/count` returns the correct candidate count
    - Test 5: PUT `/{candidateId}` updates candidate status and returns updated DTO
  - [x] 4.2 Create `DiscoveryCandidateEntity` JPA entity
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DiscoveryCandidateEntity.java`
    - Follow pattern from: `DiscoveryEvidenceEntity.java`
    - Fields: `id` (UUID), `runId` (UUID), `candidateType` (String), `name` (String), `confidence` (double), `status` (String, default "proposed"), `sourceClusterIds` (List<String> mapped as JSONB), `data` (Map<String, Object>), `synthesizedAt` (Instant)
    - `@Type(JsonType.class)` on both `sourceClusterIds` and `data` JSONB columns
  - [x] 4.3 Create `DiscoveryCandidateDto` record
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/DiscoveryCandidateDto.java`
    - Fields: `id`, `runId` (as `run_id`), `candidateType` (as `candidate_type`), `name`, `confidence`, `status`, `sourceClusterIds` (as `source_cluster_ids`), `data`, `synthesizedAt` (as `synthesized_at`)
  - [x] 4.4 Create `DiscoveryCandidateRepository`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/DiscoveryCandidateRepository.java`
    - Methods: `findByRunId(UUID)`, `findByRunIdAndCandidateType(UUID, String)`, `findByRunIdAndStatus(UUID, String)`, `findByRunIdAndCandidateTypeAndStatus(UUID, String, String)`, `countByRunId(UUID)`
  - [x] 4.5 Create `DiscoveryCandidateService`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/DiscoveryCandidateService.java`
    - `bulkCreate(UUID runId, List<DiscoveryCandidateDto>)` with `@Transactional`
    - `getByRunId(UUID runId, String type, String status)` with `@Transactional(readOnly = true)` -- delegates to appropriate repository method based on which filters are present
    - `countByRunId(UUID)` with `@Transactional(readOnly = true)`
    - `updateCandidate(UUID runId, UUID candidateId, DiscoveryCandidateDto update)` with `@Transactional` -- for status changes
  - [x] 4.6 Create `DiscoveryCandidateController`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/DiscoveryCandidateController.java`
    - Base path: `/api/model/projects/{projectId}/discovery/runs/{runId}/candidates`
    - Endpoints: POST (bulk insert), GET (list with optional `?type=` and/or `?status=` filters), GET `/count`, PUT `/{candidateId}` (update)
  - [x] 4.7 Ensure Candidate controller tests pass
    - Run ONLY the 5 tests in `DiscoveryCandidateControllerTest.java`

**Acceptance Criteria:**
- All 5 controller tests pass
- Entity has `@Type(JsonType.class)` on both sourceClusterIds and data JSONB columns
- DTO uses snake_case @JsonProperty annotations for all fields
- GET endpoint supports dual filtering by type and status (independently and together)
- PUT /{candidateId} endpoint exists for status update workflow
- Service updateCandidate method validates candidate exists before updating
- Status defaults to 'proposed' in entity

---

### TypeScript Types Layer (discovery-service)

#### Task Group 5: TypeScript Type Definitions and archModelClient Methods
**Dependencies:** Task Groups 2, 3, 4 (needs knowledge of exact API contracts)

- [x] 5.0 Complete TypeScript types, archModelClient methods, and AnalyzerResult extension
  - [x] 5.1 Write 6 focused tests for new archModelClient methods
    - File: `discovery-service/src/__tests__/archModelClientNewLayers.test.ts`
    - Follow pattern from: `discovery-service/src/__tests__/archModelClient.test.ts` (jest.mock axios, jest.resetModules per test, require after mock setup)
    - Test 1: `bulkSaveRelationships` calls POST to correct URL with relationship array body
    - Test 2: `getRelationshipsByRun` calls GET with optional `?type=` param
    - Test 3: `getRelationshipCount` calls GET to `/count` and returns numeric count
    - Test 4: `bulkSaveClusters` calls POST to correct URL with cluster array body
    - Test 5: `getCandidatesByRun` calls GET with optional `?type=` and `?status=` params
    - Test 6: `updateCandidate` calls PUT to correct URL with update body
  - [x] 5.2 Create `relationship.ts` type definitions
    - File: `discovery-service/src/types/relationship.ts`
    - Follow pattern from: `discovery-service/src/types/evidenceAtom.ts` (union type, per-type data interfaces, core interface, JSDoc)
    - `RelationshipType` union: `'imports' | 'calls' | 'extends' | 'contains' | 'uses_data' | 'defines' | 'references'`
    - Type-specific data interfaces: `ImportsRelationshipData`, `CallsRelationshipData`, `ExtendsRelationshipData`, `ContainsRelationshipData`, `UsesDataRelationshipData`, `DefinesRelationshipData`, `ReferencesRelationshipData`
    - `RelationshipData` union of all type-specific data interfaces
    - `EvidenceRelationship` interface: `id`, `runId`, `sourceAtomId`, `targetAtomId`, `relationshipType`, `confidence`, `data`, `inferredAt`
    - JSDoc explaining layer position: 1a atoms -> **1b relationships** -> 1c clusters -> 1d candidates
  - [x] 5.3 Create `cluster.ts` type definitions
    - File: `discovery-service/src/types/cluster.ts`
    - `ClusterType` union: `'service_boundary' | 'data_domain' | 'shared_library' | 'api_layer' | 'ui_module'`
    - `ClusterMemberType` union: `'atom' | 'relationship'`
    - `ClusterMember` interface: `memberType`, `memberId`
    - `EvidenceCluster` interface: `id`, `runId`, `clusterType`, `name` (optional), `confidence`, `members` (ClusterMember[]), `data`, `formedAt`
    - JSDoc explaining layer position: 1a atoms -> 1b relationships -> **1c clusters** -> 1d candidates
  - [x] 5.4 Create `candidate.ts` type definitions
    - File: `discovery-service/src/types/candidate.ts`
    - `CandidateType` union: `'application' | 'app_component' | 'service' | 'logical_entity' | 'physical_entity' | 'interface' | 'business_process' | 'data_entity'`
    - `CandidateStatus` union: `'proposed' | 'accepted' | 'rejected' | 'merged'`
    - `DiscoveryCandidate` interface: `id`, `runId`, `candidateType`, `name`, `confidence`, `status`, `sourceClusterIds`, `data`, `synthesizedAt`
    - JSDoc explaining layer position: 1a atoms -> 1b relationships -> 1c clusters -> **1d candidates**
  - [x] 5.5 Update `index.ts` barrel export
    - File: `discovery-service/src/types/index.ts`
    - Add exports for all new types from `relationship.ts`, `cluster.ts`, `candidate.ts`
    - Maintain alphabetical grouping by file
  - [x] 5.6 Extend `AnalyzerResult` in `analyzerPack.ts`
    - File: `discovery-service/src/types/analyzerPack.ts`
    - Add import for `EvidenceRelationship`, `EvidenceCluster`, `DiscoveryCandidate`
    - Add optional fields: `relationships?: EvidenceRelationship[]`, `clusters?: EvidenceCluster[]`, `candidates?: DiscoveryCandidate[]`
    - Backward-compatible -- existing packs that only produce `evidenceAtoms` are unaffected
  - [x] 5.7 Add 1a alignment JSDoc to `evidenceAtom.ts`
    - File: `discovery-service/src/types/evidenceAtom.ts`
    - Add JSDoc note on `EvidenceAtomType` indicating the union is extensible and future atom types may be added in later increments
    - No breaking changes to existing types
  - [x] 5.8 Add 1b archModelClient methods
    - File: `discovery-service/src/services/archModelClient.ts`
    - `bulkSaveRelationships(projectId, runId, relationships: EvidenceRelationship[])`: POST to `/api/model/projects/{projectId}/discovery/runs/{runId}/relationships`
    - `getRelationshipsByRun(projectId, runId, type?)`: GET with optional `?type=` param, returns `EvidenceRelationship[]`
    - `getRelationshipCount(projectId, runId)`: GET `/count`, returns `number`
    - Follow exact pattern from existing `bulkSaveEvidence`, `getEvidenceByRun`, `getEvidenceCount`
  - [x] 5.9 Add 1c archModelClient methods
    - `bulkSaveClusters(projectId, runId, clusters: EvidenceCluster[])`: POST to clusters endpoint
    - `getClustersByRun(projectId, runId, type?)`: GET with optional `?type=` param, returns `EvidenceCluster[]`
    - `getClusterCount(projectId, runId)`: GET `/count`, returns `number`
  - [x] 5.10 Add 1d archModelClient methods
    - `bulkSaveCandidates(projectId, runId, candidates: DiscoveryCandidate[])`: POST to candidates endpoint
    - `getCandidatesByRun(projectId, runId, type?, status?)`: GET with optional `?type=` and `?status=` params, returns `DiscoveryCandidate[]`
    - `getCandidateCount(projectId, runId)`: GET `/count`, returns `number`
    - `updateCandidate(projectId, runId, candidateId, update)`: PUT to `/{candidateId}`, returns `DiscoveryCandidate`
  - [x] 5.11 Ensure archModelClient tests pass
    - Run ONLY the 6 tests in `archModelClientNewLayers.test.ts`

**Acceptance Criteria:**
- All 6 archModelClient tests pass
- Three new type files exist with complete union types, data interfaces, and core interfaces
- All new types exported via barrel export in index.ts
- AnalyzerResult has three new optional fields (backward-compatible)
- archModelClient has 10 new methods (3 for relationships, 3 for clusters, 4 for candidates)
- All methods follow the existing URL construction and params pattern with `encodeURIComponent`
- JSDoc on all new files and interfaces explains the layer's purpose and data flow position

---

### Pipeline Orchestration Layer (discovery-service)

#### Task Group 6: Run Manager Stub Upgrades (1b/1c/1d)
**Dependencies:** Task Group 5 (needs archModelClient methods)

- [x] 6.0 Complete run manager stub updates for 1b, 1c, 1d backbone readiness
  - [x] 6.1 Write 4 focused tests for run manager step execution
    - File: `discovery-service/src/__tests__/runManagerBackbone.test.ts`
    - Follow pattern from: `discovery-service/src/__tests__/runManagerAndRoutes.test.ts`
    - Test 1: `executeStep1b` queries upstream atom count via `getEvidenceCount`, returns `{ relationshipCount: 0, upstreamAtomCount: <count> }`
    - Test 2: `executeStep1c` queries upstream relationship count via `getRelationshipCount`, returns `{ clusterCount: 0, upstreamRelationshipCount: <count> }`
    - Test 3: `executeStep1d` queries upstream cluster count via `getClusterCount`, returns `{ candidateCount: 0, upstreamClusterCount: <count> }`
    - Test 4: `startRun` completes all four steps sequentially with correct stepsPayload metadata for each step (atomCounts for 1a, relationshipCount/upstreamAtomCount for 1b, clusterCount/upstreamRelationshipCount for 1c, candidateCount/upstreamClusterCount for 1d)
  - [x] 6.2 Create `executeStep1b` function
    - File: `discovery-service/src/services/runManager.ts`
    - Follow pattern from: `executeStep1a` (try/catch implicit via caller in startRun)
    - Query upstream 1a atom count via `archModelClient.getEvidenceCount(projectId, runId)`
    - Create no relationships (empty backbone -- no real logic)
    - Return `{ relationshipCount: 0, upstreamAtomCount: <count> }`
  - [x] 6.3 Create `executeStep1c` function
    - Query upstream 1b relationship count via `archModelClient.getRelationshipCount(projectId, runId)`
    - Create no clusters
    - Return `{ clusterCount: 0, upstreamRelationshipCount: <count> }`
  - [x] 6.4 Create `executeStep1d` function
    - Query upstream 1c cluster count via `archModelClient.getClusterCount(projectId, runId)`
    - Create no candidates
    - Return `{ candidateCount: 0, upstreamClusterCount: <count> }`
  - [x] 6.5 Update `executeStep` dispatch to call new functions
    - Replace the inert stub return (`{ phase: 'phase1', step, status: 'stub', projectId }`) with dispatch to `executeStep1b`, `executeStep1c`, `executeStep1d`
    - Maintain the existing `executeStep1a` call for step '1a'
  - [x] 6.6 Update `startRun` stepsPayload metadata handling
    - Currently only checks for `stepResult.atomCounts` -- update to also carry the new metadata fields from 1b/1c/1d step results
    - 1b stepsPayload entry: `{ status: 'completed', relationshipCount: 0, upstreamAtomCount: <n> }`
    - 1c stepsPayload entry: `{ status: 'completed', clusterCount: 0, upstreamRelationshipCount: <n> }`
    - 1d stepsPayload entry: `{ status: 'completed', candidateCount: 0, upstreamClusterCount: <n> }`
    - Generalize the metadata merge so all step result fields are included (not just atomCounts)
  - [x] 6.7 Ensure run manager tests pass
    - Run ONLY the 4 tests in `runManagerBackbone.test.ts`

**Acceptance Criteria:**
- All 4 run manager tests pass
- Each stub function queries the upstream layer's count before returning
- No actual relationships, clusters, or candidates are persisted (empty backbone)
- stepsPayload for each step carries the correct summary metadata
- The inert stub return is completely removed -- all steps dispatch to dedicated functions
- startRun correctly handles metadata from all four step types

---

### Test Review

#### Task Group 7: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-6

- [x] 7.0 Review existing tests and fill critical gaps only
  - [x] 7.1 Review tests from Task Groups 2-6
    - Review the 4 controller tests for Relationship (Task 2.1)
    - Review the 5 controller tests for Cluster (Task 3.1)
    - Review the 5 controller tests for Candidate (Task 4.1)
    - Review the 6 archModelClient tests (Task 5.1)
    - Review the 4 run manager tests (Task 6.1)
    - Total existing tests: 24 tests
  - [x] 7.2 Analyze test coverage gaps for this feature only
    - Identify any critical user workflows that lack test coverage
    - Focus on integration points: cluster bulkCreate persisting members atomically, candidate dual-filter query, run manager full pipeline flow
    - Do NOT assess entire application test coverage
  - [x] 7.3 Write up to 8 additional strategic tests to fill gaps
    - Candidate areas for additional tests (add only if critical gap identified):
      - Service-level test for DiscoveryClusterService.bulkCreate verifying members are persisted with the cluster in one transaction
      - Service-level test for DiscoveryCandidateService.getByRunId with dual type+status filter delegation
      - Service-level test for DiscoveryCandidateService.updateCandidate verifying status change
      - TypeScript type compile-time validation (ensure interfaces are structurally sound)
      - archModelClient `getClusterCount` and `getCandidateCount` returning numeric values
      - Run manager error handling: step 1b failure sets stepsPayload to failed and stops pipeline
    - Maximum of 8 additional tests across all services
    - Do NOT write comprehensive coverage for all scenarios
  - [x] 7.4 Run all feature-specific tests
    - Run ONLY tests related to this spec's feature
    - Architecture-model-service: `DiscoveryRelationshipControllerTest`, `DiscoveryClusterControllerTest`, `DiscoveryCandidateControllerTest`, plus any new service tests from 7.3
    - Discovery-service: `archModelClientNewLayers.test.ts`, `runManagerBackbone.test.ts`
    - Expected total: approximately 24-32 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 24-32 tests total)
- Critical integration points are covered (cluster+member atomicity, candidate dual-filter, pipeline flow)
- No more than 8 additional tests added when filling gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Liquibase Migrations (067-070)** -- No dependencies. Creates the database foundation that all JPA stacks build on. Pure SQL files and YAML registration.

2. **Task Group 2: Relationship JPA Stack (1b)** -- Depends on migration 067. The simplest of the three new JPA stacks (no nested entities). Establishes the pattern for Groups 3 and 4.

3. **Task Group 3: Cluster + ClusterMember JPA Stack (1c)** -- Depends on migrations 068, 069. More complex due to the @OneToMany relationship between cluster and cluster_member entities with CascadeType.ALL. Benefits from the pattern established in Group 2.

4. **Task Group 4: Candidate JPA Stack (1d)** -- Depends on migration 070. Adds the PUT update endpoint pattern (unique among the four layers). Can be implemented in parallel with Group 3 if resources allow.

5. **Task Group 5: TypeScript Types and archModelClient** -- Depends on Groups 2-4 for finalized API contracts. Creates the TypeScript type definitions, barrel exports, AnalyzerResult extension, and all 10 new archModelClient methods.

6. **Task Group 6: Run Manager Stub Upgrades** -- Depends on Group 5 for archModelClient methods. Replaces inert stubs with backbone functions that query upstream counts and produce structured metadata.

7. **Task Group 7: Test Review and Gap Analysis** -- Depends on all previous groups. Reviews all 24 feature tests, identifies critical gaps, and adds up to 8 additional tests.

## File Summary

### New Files (architecture-model-service)

| File | Task |
|------|------|
| `src/main/resources/db/changelog/sql/067-discovery-relationship.sql` | 1.1 |
| `src/main/resources/db/changelog/sql/068-discovery-cluster.sql` | 1.2 |
| `src/main/resources/db/changelog/sql/069-discovery-cluster-member.sql` | 1.3 |
| `src/main/resources/db/changelog/sql/070-discovery-candidate.sql` | 1.4 |
| `src/main/java/.../model/entity/DiscoveryRelationshipEntity.java` | 2.2 |
| `src/main/java/.../model/dto/DiscoveryRelationshipDto.java` | 2.3 |
| `src/main/java/.../repository/entity/DiscoveryRelationshipRepository.java` | 2.4 |
| `src/main/java/.../service/DiscoveryRelationshipService.java` | 2.5 |
| `src/main/java/.../controller/DiscoveryRelationshipController.java` | 2.6 |
| `src/main/java/.../model/entity/DiscoveryClusterMemberEntity.java` | 3.2 |
| `src/main/java/.../model/entity/DiscoveryClusterEntity.java` | 3.3 |
| `src/main/java/.../model/dto/DiscoveryClusterMemberDto.java` | 3.4 |
| `src/main/java/.../model/dto/DiscoveryClusterDto.java` | 3.5 |
| `src/main/java/.../repository/entity/DiscoveryClusterRepository.java` | 3.6 |
| `src/main/java/.../repository/entity/DiscoveryClusterMemberRepository.java` | 3.7 |
| `src/main/java/.../service/DiscoveryClusterService.java` | 3.8 |
| `src/main/java/.../controller/DiscoveryClusterController.java` | 3.9 |
| `src/main/java/.../model/entity/DiscoveryCandidateEntity.java` | 4.2 |
| `src/main/java/.../model/dto/DiscoveryCandidateDto.java` | 4.3 |
| `src/main/java/.../repository/entity/DiscoveryCandidateRepository.java` | 4.4 |
| `src/main/java/.../service/DiscoveryCandidateService.java` | 4.5 |
| `src/main/java/.../controller/DiscoveryCandidateController.java` | 4.6 |
| `src/test/.../controller/DiscoveryRelationshipControllerTest.java` | 2.1 |
| `src/test/.../controller/DiscoveryClusterControllerTest.java` | 3.1 |
| `src/test/.../controller/DiscoveryCandidateControllerTest.java` | 4.1 |

### New Files (discovery-service)

| File | Task |
|------|------|
| `src/types/relationship.ts` | 5.2 |
| `src/types/cluster.ts` | 5.3 |
| `src/types/candidate.ts` | 5.4 |
| `src/__tests__/archModelClientNewLayers.test.ts` | 5.1 |
| `src/__tests__/runManagerBackbone.test.ts` | 6.1 |

### Modified Files (architecture-model-service)

| File | Task |
|------|------|
| `src/main/resources/db/changelog/db.changelog-master.yaml` | 1.5 |

### Modified Files (discovery-service)

| File | Task |
|------|------|
| `src/types/index.ts` | 5.5 |
| `src/types/analyzerPack.ts` | 5.6 |
| `src/types/evidenceAtom.ts` | 5.7 |
| `src/services/archModelClient.ts` | 5.8, 5.9, 5.10 |
| `src/services/runManager.ts` | 6.2, 6.3, 6.4, 6.5, 6.6 |
