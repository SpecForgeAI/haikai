# Task Breakdown: Roadmap/Backlog Persistence

## Overview
Total Tasks: 6 Task Groups, ~35 Sub-tasks

This feature implements DB-first storage for hierarchical work items (Initiative/Epic/Feature/Story) and versioned project artifacts (mission.md, roadmap.md) using the existing Spring Boot + JPA + Liquibase architecture patterns.

## Task List

### Database Layer

#### Task Group 1: Database Migration
**Dependencies:** None

- [x] 1.0 Complete database migration for work_item and project_artifact tables
  - [x] 1.1 Write 2-4 focused migration verification tests
    - Test that work_item table exists with correct columns
    - Test that project_artifact table exists with correct columns
    - Test that indexes are created properly
    - Test ON DELETE CASCADE behavior for parent_id
  - [x] 1.2 Create Liquibase migration file `012-work-items-project-artifacts.sql`
    - Create `work_item` table with columns:
      - id UUID PK
      - project_id TEXT NOT NULL
      - type TEXT NOT NULL (INITIATIVE, EPIC, FEATURE, STORY)
      - parent_id UUID NULL (FK to work_item with ON DELETE CASCADE)
      - title TEXT NOT NULL
      - description TEXT NULL
      - status TEXT NOT NULL DEFAULT 'PLANNED'
      - sort_order INTEGER NOT NULL DEFAULT 0
      - priority INTEGER NULL
      - target_window TEXT NULL
      - tags_json JSONB NULL
      - external_system TEXT NULL
      - external_key TEXT NULL
      - created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      - updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    - Add CHECK constraint: `parent_id IS NULL OR parent_id <> id`
    - Create indexes: idx_work_item_project_id, idx_work_item_project_type, idx_work_item_project_parent_sort, idx_work_item_parent_id
    - Create `project_artifact` table with columns:
      - id UUID PK
      - project_id TEXT NOT NULL
      - artifact_type TEXT NOT NULL (MISSION_MD, ROADMAP_MD)
      - content TEXT NOT NULL
      - source TEXT NOT NULL DEFAULT 'AGENT_OS'
      - revision INTEGER NOT NULL DEFAULT 1
      - created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    - Add UNIQUE constraint on (project_id, artifact_type, revision)
    - Create indexes: idx_artifact_project_type, idx_artifact_project_type_revision
    - Follow pattern from: `005-sequence-diagrams.sql`
  - [x] 1.3 Register migration in `db.changelog-master.yaml`
  - [x] 1.4 Ensure migration tests pass
    - Run ONLY the 2-4 tests written in 1.1
    - Verify migrations run successfully on H2 test database
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Migration file follows existing SQL patterns with section comments
- Both tables created with all specified columns and constraints
- Indexes created for optimal query performance
- CASCADE delete configured on work_item.parent_id
- Migration registered and runs cleanly

---

### Entity Layer

#### Task Group 2: JPA Entities
**Dependencies:** Task Group 1

- [x] 2.0 Complete JPA entity classes
  - [x] 2.1 Write 3-5 focused entity tests
    - Test WorkItemEntity field mappings and basic validation
    - Test WorkItemEntity tags_json JSONB handling (Map<String, Object>)
    - Test ProjectArtifactEntity field mappings
    - Test entity builder patterns work correctly
  - [x] 2.2 Create `WorkItemEntity.java`
    - Location: `model/entity/WorkItemEntity.java`
    - Annotations: @Entity, @Table(name = "work_item"), @Getter, @Setter, @NoArgsConstructor, @AllArgsConstructor, @Builder
    - UUID id field with @Id annotation
    - Use @Type(JsonType.class) for tags_json column (follow DiagramEntity pattern)
    - Map all columns with appropriate @Column annotations
    - Use UUID type for parentId field (not entity reference to avoid complexity)
  - [x] 2.3 Create `ProjectArtifactEntity.java`
    - Location: `model/entity/ProjectArtifactEntity.java`
    - Annotations: @Entity, @Table(name = "project_artifact"), @Getter, @Setter, @NoArgsConstructor, @AllArgsConstructor, @Builder
    - UUID id field with @Id annotation
    - Map all columns with appropriate @Column annotations
  - [x] 2.4 Ensure entity tests pass
    - Run ONLY the 3-5 tests written in 2.1
    - Verify JSONB mapping works correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Entities follow existing codebase patterns (DiagramEntity)
- JSONB mapping uses @Type(JsonType.class) annotation
- All Lombok annotations applied correctly
- Field types match database column types

---

### DTO Layer

#### Task Group 3: Data Transfer Objects
**Dependencies:** Task Group 2

- [x] 3.0 Complete DTO record classes
  - [x] 3.1 Write 2-4 focused DTO serialization tests
    - Test WorkItemDto JSON serialization with snake_case property names
    - Test ProjectArtifactDto JSON serialization with snake_case property names
    - Test null handling for optional fields
  - [x] 3.2 Create `WorkItemDto.java` record
    - Location: `model/dto/WorkItemDto.java`
    - Use Java record with @JsonProperty annotations for snake_case
    - Fields: id (UUID), project_id (String), type (String), parent_id (UUID), title (String), description (String), status (String), sort_order (Integer), priority (Integer), target_window (String), tags (Map<String, Object>), external_system (String), external_key (String), created_at (Instant), updated_at (Instant)
    - Follow pattern from: `SequenceDiagramDto.java`
  - [x] 3.3 Create `ProjectArtifactDto.java` record
    - Location: `model/dto/ProjectArtifactDto.java`
    - Use Java record with @JsonProperty annotations for snake_case
    - Fields: id (UUID), project_id (String), artifact_type (String), content (String), source (String), revision (Integer), created_at (Instant)
  - [x] 3.4 Create mapper methods or utility class for Entity-DTO conversion
    - toDto() and toEntity() methods for both types
  - [x] 3.5 Ensure DTO tests pass
    - Run ONLY the 2-4 tests written in 3.1
    - Verify JSON serialization produces expected snake_case output
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- DTOs use Java record syntax
- JSON property names use snake_case via @JsonProperty
- Entity-DTO mapping is clean and testable

---

### Repository Layer

#### Task Group 4: Spring Data Repositories
**Dependencies:** Task Groups 2, 3

- [x] 4.0 Complete repository interfaces
  - [x] 4.1 Write 3-5 focused repository tests
    - Test WorkItemRepository.findByProjectIdOrderBySortOrderAscCreatedAtAscIdAsc returns deterministic order
    - Test WorkItemRepository.findByProjectIdAndTypeOrderBySortOrderAscCreatedAtAscIdAsc filters correctly
    - Test ProjectArtifactRepository.findTopByProjectIdAndArtifactTypeOrderByRevisionDesc returns latest
    - Test cascade delete works via repository operations
  - [x] 4.2 Create `WorkItemRepository.java`
    - Location: `repository/entity/WorkItemRepository.java`
    - Extend JpaRepository<WorkItemEntity, UUID>
    - Methods:
      - `List<WorkItemEntity> findByProjectIdOrderBySortOrderAscCreatedAtAscIdAsc(String projectId)`
      - `List<WorkItemEntity> findByProjectIdAndTypeOrderBySortOrderAscCreatedAtAscIdAsc(String projectId, String type)`
      - `List<WorkItemEntity> findByProjectIdAndParentIdOrderBySortOrderAscCreatedAtAscIdAsc(String projectId, UUID parentId)`
      - `void deleteByProjectId(String projectId)`
  - [x] 4.3 Create `ProjectArtifactRepository.java`
    - Location: `repository/entity/ProjectArtifactRepository.java`
    - Extend JpaRepository<ProjectArtifactEntity, UUID>
    - Methods:
      - `Optional<ProjectArtifactEntity> findTopByProjectIdAndArtifactTypeOrderByRevisionDesc(String projectId, String artifactType)`
      - `List<ProjectArtifactEntity> findByProjectIdAndArtifactTypeOrderByRevisionDesc(String projectId, String artifactType)`
      - `List<ProjectArtifactEntity> findByProjectIdOrderByCreatedAtDesc(String projectId)`
  - [x] 4.4 Ensure repository tests pass
    - Run ONLY the 3-5 tests written in 4.1
    - Verify custom query methods return expected results
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Repositories extend JpaRepository with correct generic types
- Query methods follow Spring Data naming conventions for deterministic ordering
- Cascade delete verified at repository level

---

### Service Layer

#### Task Group 5: Business Logic Services with Validation
**Dependencies:** Task Group 4

- [x] 5.0 Complete service classes with validation logic
  - [x] 5.1 Write 5-8 focused service validation tests
    - Test WorkItemService rejects self-parent (parent_id = id) with 400
    - Test WorkItemService rejects cross-project parent (parent in different project_id) with 400
    - Test WorkItemService enforces type hierarchy: INITIATIVE must have null parent
    - Test WorkItemService enforces type hierarchy: EPIC requires INITIATIVE parent
    - Test WorkItemService enforces type hierarchy: FEATURE requires EPIC parent
    - Test WorkItemService enforces type hierarchy: STORY requires FEATURE parent
    - Test ProjectArtifactService auto-increments revision correctly
    - Test ProjectArtifactService getLatestArtifact returns highest revision
  - [x] 5.2 Create `WorkItemService.java`
    - Location: `service/WorkItemService.java`
    - Annotations: @Service, @RequiredArgsConstructor, @Slf4j
    - Inject WorkItemRepository
    - CRUD methods with @Transactional on write operations:
      - `List<WorkItemDto> getWorkItems(String projectId, String type, UUID parentId)` - with optional filters
      - `WorkItemDto getWorkItem(UUID id)` - throws ResourceNotFoundException if not found
      - `WorkItemDto createWorkItem(String projectId, WorkItemDto dto)` - validates and returns created DTO
      - `WorkItemDto updateWorkItem(UUID id, WorkItemDto dto)` - validates and returns updated DTO
      - `void deleteWorkItem(UUID id)` - cascade handled by DB
    - Validation logic:
      - Validate parent_id belongs to same project_id (query DB to verify)
      - Validate parent_id cannot equal id
      - Enforce type parenting rules:
        - INITIATIVE: parent must be NULL
        - EPIC: parent must be INITIATIVE
        - FEATURE: parent must be EPIC
        - STORY: parent must be FEATURE
      - Throw IllegalArgumentException with clear messages for validation failures
    - Follow pattern from: `SequenceDiagramService.java`
  - [x] 5.3 Create `ProjectArtifactService.java`
    - Location: `service/ProjectArtifactService.java`
    - Annotations: @Service, @RequiredArgsConstructor, @Slf4j
    - Inject ProjectArtifactRepository
    - CRUD methods with @Transactional on write operations:
      - `ProjectArtifactDto getLatestArtifact(String projectId, String artifactType)` - returns most recent revision
      - `List<ProjectArtifactDto> getArtifactRevisions(String projectId, String artifactType)` - all revisions DESC
      - `ProjectArtifactDto getArtifactById(UUID id)` - throws ResourceNotFoundException if not found
      - `ProjectArtifactDto createArtifact(String projectId, String artifactType, ProjectArtifactDto dto)` - auto-increment revision
      - `void deleteArtifact(UUID id)`
    - Auto-revision logic:
      - Query max revision for (project_id, artifact_type)
      - Set new artifact revision = max + 1 (or 1 if no prior revisions)
    - Validation:
      - Validate artifact_type is one of: MISSION_MD, ROADMAP_MD
      - Validate source is one of: AGENT_OS, TOOL, USER_EDIT
  - [x] 5.4 Ensure service tests pass
    - Run ONLY the 5-8 tests written in 5.1
    - Verify all validation rules return 400 with clear messages
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Services follow existing patterns (SequenceDiagramService)
- All validation rules implemented with clear error messages
- @Transactional used appropriately for write operations
- Auto-revision logic correctly increments revision numbers

---

### Controller Layer

#### Task Group 6: REST Controllers
**Dependencies:** Task Group 5

- [x] 6.0 Complete REST controller classes
  - [x] 6.1 Write 4-6 focused controller tests
    - Test WorkItemController GET /work-items returns list with 200
    - Test WorkItemController POST /work-items creates with 201
    - Test WorkItemController validation failure returns 400 with clear message
    - Test ProjectArtifactController GET /artifacts/{type}/latest returns latest revision
    - Test ProjectArtifactController POST creates new revision
    - Test cross-project parent validation returns 400
  - [x] 6.2 Create `WorkItemController.java`
    - Location: `controller/WorkItemController.java`
    - Annotations: @RestController, @RequestMapping("/api/model/projects/{projectId}/work-items"), @RequiredArgsConstructor, @Slf4j
    - Inject WorkItemService
    - Endpoints:
      - `GET /` - list all work items for project (with optional `type`, `parent_id` query params)
        - Returns List<WorkItemDto> with 200
        - Deterministic ordering by (sort_order, created_at, id)
      - `GET /{id}` - get single work item
        - Returns WorkItemDto with 200
        - Returns 404 if not found
      - `POST /` - create new work item
        - Request body: WorkItemDto
        - Returns created WorkItemDto with 201
        - Returns 400 on validation failure
      - `PUT /{id}` - update work item
        - Request body: WorkItemDto
        - Returns updated WorkItemDto with 200
        - Returns 400 on validation failure
        - Returns 404 if not found
      - `DELETE /{id}` - delete work item (cascades to children via DB)
        - Returns 204 No Content
    - Follow pattern from: `SequenceDiagramController.java`
  - [x] 6.3 Create `ProjectArtifactController.java`
    - Location: `controller/ProjectArtifactController.java`
    - Annotations: @RestController, @RequestMapping("/api/model/projects/{projectId}/artifacts"), @RequiredArgsConstructor, @Slf4j
    - Inject ProjectArtifactService
    - Endpoints:
      - `GET /{artifactType}/latest` - get latest revision for artifact type
        - Returns ProjectArtifactDto with 200
        - Returns 404 if no revisions exist
      - `GET /{artifactType}` - list all revisions for artifact type (ordered by revision DESC)
        - Returns List<ProjectArtifactDto> with 200
      - `POST /{artifactType}` - create new artifact revision
        - Request body: ProjectArtifactDto (content, source)
        - Returns created ProjectArtifactDto with 201 (auto-incremented revision)
      - `GET /by-id/{id}` - get artifact by ID
        - Returns ProjectArtifactDto with 200
        - Returns 404 if not found
      - `DELETE /by-id/{id}` - delete artifact
        - Returns 204 No Content
  - [x] 6.4 Ensure controller tests pass
    - Run ONLY the 4-6 tests written in 6.1
    - Verify HTTP status codes and response bodies
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Controllers follow existing patterns (SequenceDiagramController)
- Proper HTTP status codes (200, 201, 204, 400, 404)
- Request/response bodies use snake_case JSON
- Path variables and query params named consistently

---

### Integration Testing

#### Task Group 7: Integration Test Suite
**Dependencies:** Task Groups 1-6

- [x] 7.0 Complete integration test suite for critical workflows
  - [x] 7.1 Review tests from Task Groups 1-6
    - Review migration tests (Task 1.1)
    - Review entity tests (Task 2.1)
    - Review DTO tests (Task 3.1)
    - Review repository tests (Task 4.1)
    - Review service tests (Task 5.1)
    - Review controller tests (Task 6.1)
    - Estimate total existing tests: approximately 19-32 tests
  - [x] 7.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows lacking coverage
    - Focus ONLY on roadmap/backlog persistence feature
    - Prioritize integration tests over additional unit tests
  - [x] 7.3 Write up to 8 additional integration tests maximum
    - **Cascade delete test:** Create INITIATIVE -> EPIC -> FEATURE -> STORY hierarchy, delete EPIC, verify FEATURE + STORY are deleted
    - **Type parenting validation test:** Attempt to create FEATURE with INITIATIVE parent -> expect 400
    - **Cross-project parent test:** Create INITIATIVE in project A, create EPIC in project B with that parent -> expect 400
    - **Self-parent test:** Attempt to set work item's parent_id to its own id -> expect 400
    - **Artifact revisioning test:** POST artifact twice to same (project_id, artifact_type), verify second has revision 2
    - **Get latest artifact test:** Create 3 revisions, call /latest, verify returns revision 3
    - **Deterministic ordering test:** Create multiple work items with same sort_order, verify consistent ordering by created_at, id
    - **Full CRUD workflow test:** Create, read, update, delete work item, verify all operations
  - [x] 7.4 Run feature-specific tests only
    - Run ALL tests related to this spec's feature
    - Expected total: approximately 27-40 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass
- Cascade delete verified by integration test
- Type parenting validation verified by integration test
- Cross-project parent rejection verified by integration test
- Artifact auto-revisioning verified by integration test
- Deterministic ordering verified by integration test

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Database Migration** - Foundation for all other work
2. **Task Group 2: JPA Entities** - Required for repository layer
3. **Task Group 3: DTOs** - Required for service and controller layers
4. **Task Group 4: Repositories** - Required for service layer
5. **Task Group 5: Services** - Business logic with validation
6. **Task Group 6: Controllers** - REST API endpoints
7. **Task Group 7: Integration Tests** - Final verification and gap filling

## Reference Files

### Patterns to Follow
- **Entity with JSONB:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DiagramEntity.java`
- **DTO Record:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/SequenceDiagramDto.java`
- **Service with Validation:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/SequenceDiagramService.java`
- **Controller:** `architecture-model-service/src/main/java/com/example/architecturemodel/controller/SequenceDiagramController.java`
- **SQL Migration:** `architecture-model-service/src/main/resources/db/changelog/sql/005-sequence-diagrams.sql`
- **Controller Test:** `architecture-model-service/src/test/java/com/example/architecturemodel/controller/SequenceDiagramControllerTest.java`

### New Files to Create
- `architecture-model-service/src/main/resources/db/changelog/sql/012-work-items-project-artifacts.sql`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/WorkItemEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ProjectArtifactEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/WorkItemDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/ProjectArtifactDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/WorkItemRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/ProjectArtifactRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/WorkItemService.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ProjectArtifactService.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/WorkItemController.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ProjectArtifactController.java`

### Test Files to Create
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/WorkItemServiceTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/ProjectArtifactServiceTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/controller/WorkItemControllerTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/controller/ProjectArtifactControllerTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/integration/WorkItemIntegrationTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/integration/ProjectArtifactIntegrationTest.java`
