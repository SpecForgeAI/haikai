# Task Breakdown: Project Snapshot JSON Import

## Overview
Total Tasks: 19 sub-tasks across 4 task groups

This is a **backend-only** feature that adds an import endpoint to accept previously exported Project Snapshot JSON files and create new projects with all persisted state restored (model, work items, artifacts).

## Task List

### DTO Layer

#### Task Group 1: Data Transfer Objects
**Dependencies:** None

- [x] 1.0 Complete DTO layer for import feature
  - [x] 1.1 Write 3-4 focused tests for DTO validation and serialization
    - Test ProjectSnapshotImportRequestDto JSON deserialization with all fields
    - Test ProjectSnapshotImportResultDto JSON serialization
    - Test default value handling for set_active (true when null/omitted)
    - Test snake_case/camelCase alias handling for request fields
  - [x] 1.2 Create ProjectSnapshotImportRequestDto
    - Location: `model/dto/export/ProjectSnapshotImportRequestDto.java`
    - Fields:
      - `snapshot`: ProjectSnapshotDto (required) - the exported snapshot data
      - `importAsName`: String (optional) - overrides snapshot project name; uses @JsonAlias for snake_case
      - `projectParentFolder`: String (required) - local path for new project; uses @JsonAlias for snake_case
      - `setActive`: Boolean (optional, default true) - whether to activate imported project
    - Add convenience method `effectiveSetActive()` returning true if null (follow CreateProjectRequest pattern)
    - Add convenience method `effectiveProjectName()` returning importAsName if present, else snapshot.project().name()
  - [x] 1.3 Create ProjectSnapshotImportResultDto
    - Location: `model/dto/export/ProjectSnapshotImportResultDto.java`
    - Fields:
      - `project`: ProjectDto - the newly created project with id, name, projectParentFolder, isActive
      - `modelSaved`: boolean - indicates whether model was successfully persisted
      - `workItemsInserted`: int - count of work items imported
      - `artifactsInserted`: int - count of artifacts imported
      - `warnings`: List<String> - optional warnings (empty in v1)
    - Use Java record with @JsonProperty annotations for snake_case output
  - [x] 1.4 Ensure DTO tests pass
    - Run ONLY the 3-4 tests written in 1.1
    - Verify JSON serialization/deserialization works correctly

**Acceptance Criteria:**
- The 3-4 tests written in 1.1 pass
- DTOs follow existing patterns in model/dto/export package
- JSON field naming is consistent with snake_case API convention
- Default value handling works correctly for set_active

---

### Service Layer

#### Task Group 2: ProjectSnapshotImportService
**Dependencies:** Task Group 1 (DTOs)

- [x] 2.0 Complete service layer for import feature
  - [x] 2.1 Write 6-8 focused tests for import service functionality
    - Test successful import creates new project with correct name and parent folder
    - Test successful import persists model via ModelService.saveModel()
    - Test successful import persists work items with preserved IDs
    - Test successful import persists artifacts with preserved IDs
    - Test validation rejects unsupported snapshot_version (not 1)
    - Test validation rejects missing/blank project_parent_folder
    - Test 409 Conflict on duplicate project name
    - Test 409 Conflict on work item ID collision
  - [x] 2.2 Create ProjectSnapshotImportService class
    - Location: `service/ProjectSnapshotImportService.java`
    - Inject dependencies:
      - ProjectService (for createProject and name uniqueness check)
      - ModelService (for saveModel)
      - WorkItemRepository (for existsById checks and saveAll)
      - ProjectArtifactRepository (for existsById checks and saveAll)
      - ProjectRepository (for name uniqueness query)
    - Use @Service and @RequiredArgsConstructor annotations
    - Follow existing service patterns in ProjectSnapshotService.java
  - [x] 2.3 Implement importSnapshot() transactional method
    - Method signature: `importSnapshot(ProjectSnapshotImportRequestDto req): ProjectSnapshotImportResultDto`
    - Annotate with @Transactional for all-or-nothing semantics
    - Implementation steps:
      1. Validate snapshot.meta.snapshot_version == 1 (throw 400 if not)
      2. Validate project_parent_folder is not blank (throw 400 if blank)
      3. Determine newProjectName from request
      4. Check project name uniqueness via ProjectRepository (throw 409 if exists)
      5. Create new project via ProjectService.createProject()
      6. Persist model via ModelService.saveModel(newProjectName, snapshot.model)
      7. Persist work items with ID collision detection
      8. Persist artifacts with ID collision detection
      9. Build and return ProjectSnapshotImportResultDto with counts
  - [x] 2.4 Implement work item import with ID preservation
    - Before insert, iterate snapshot.workItems and check WorkItemRepository.existsById() for each
    - If any ID exists, throw ConflictException with message: "Work item ID already exists: <id>"
    - Map WorkItemDto to WorkItemEntity, setting project_id to new project ID
    - Preserve all fields: id, parentId, type, status, title, description, sortOrder, priority, targetWindow, tags, externalSystem, externalKey
    - Use WorkItemRepository.saveAll() for batch insert
  - [x] 2.5 Implement artifact import with ID preservation
    - Before insert, iterate snapshot.artifacts and check ProjectArtifactRepository.existsById() for each
    - If any ID exists, throw ConflictException with message: "Artifact ID already exists: <id>"
    - Map ProjectArtifactDto to ProjectArtifactEntity, setting project_id to new project ID
    - Preserve all fields: id, revision, content, source, createdAt
    - Use ProjectArtifactRepository.saveAll() for batch insert
  - [x] 2.6 Add custom exception handling
    - Create or reuse ConflictException for 409 responses (check if exists in exception package)
    - Create or reuse ValidationException for 400 responses
    - Ensure exceptions are mapped correctly by global exception handler
  - [x] 2.7 Ensure service layer tests pass
    - Run ONLY the 6-8 tests written in 2.1
    - Verify all validation and persistence logic works correctly

**Acceptance Criteria:**
- The 6-8 tests written in 2.1 pass
- Import is transactional - no partial data on failure
- Snapshot version validation rejects non-v1 snapshots
- Parent folder validation rejects blank/missing values
- Name uniqueness check returns 409 on collision
- ID collision detection works for work items and artifacts
- Model persistence uses existing ModelService.saveModel()
- Work items and artifacts preserve original IDs from snapshot

---

### API Layer

#### Task Group 3: Import Endpoint
**Dependencies:** Task Group 2 (Service)

- [x] 3.0 Complete API layer for import endpoint
  - [x] 3.1 Write 4-6 focused tests for API endpoint
    - Test POST /api/projects/import returns 201 Created with valid snapshot
    - Test endpoint returns 400 Bad Request for unsupported snapshot_version
    - Test endpoint returns 400 Bad Request for missing project_parent_folder
    - Test endpoint returns 409 Conflict for duplicate project name
    - Test endpoint returns 409 Conflict for ID collision
    - Test response body matches ProjectSnapshotImportResultDto structure
  - [x] 3.2 Add import endpoint to ProjectController
    - Location: `controller/ProjectController.java`
    - Endpoint: POST /api/projects/import
    - Request body: ProjectSnapshotImportRequestDto
    - Response: ResponseEntity<ProjectSnapshotImportResultDto> with HttpStatus.CREATED
    - Add logging: log.info("POST /api/projects/import - Importing project snapshot")
    - Follow existing endpoint patterns in ProjectController (see createProject, exportActiveProject)
  - [x] 3.3 Ensure exception mapping produces correct HTTP status codes
    - Verify ConflictException maps to 409 Conflict
    - Verify ValidationException or IllegalArgumentException maps to 400 Bad Request
    - Check GlobalExceptionHandler or add mappings if needed
  - [x] 3.4 Update ProjectController constructor
    - Inject ProjectSnapshotImportService alongside existing dependencies
    - Update constructor signature and field assignments
  - [x] 3.5 Ensure API layer tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify all HTTP status codes and response structures are correct

**Acceptance Criteria:**
- The 4-6 tests written in 3.1 pass
- POST /api/projects/import endpoint is accessible
- Returns 201 Created with ProjectSnapshotImportResultDto on success
- Returns 400 Bad Request for validation errors
- Returns 409 Conflict for name/ID collisions
- Endpoint follows existing patterns in ProjectController

---

### Integration Testing

#### Task Group 4: Integration Tests and Test Gap Analysis
**Dependencies:** Task Groups 1-3

- [x] 4.0 Complete integration testing for import feature
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 3-4 DTO tests from Task Group 1
    - Review the 6-8 service tests from Task Group 2
    - Review the 4-6 API tests from Task Group 3
    - Total existing tests: approximately 13-18 tests
  - [x] 4.2 Analyze test coverage gaps for import feature only
    - Identify end-to-end workflow coverage gaps
    - Focus on round-trip (export then import) scenarios
    - Check transaction rollback behavior on failure
    - Verify set_active=true deactivates other projects
  - [x] 4.3 Write up to 6 additional integration tests if needed
    - Location: `src/test/java/com/example/architecturemodel/integration/ProjectSnapshotImportIntegrationTest.java`
    - Test full round-trip: export active project, import as new project, verify all data matches
    - Test import with set_active=true deactivates previously active project
    - Test import with set_active=false leaves existing active project active
    - Test transaction rollback: simulate failure mid-import, verify no partial data
    - Test import_as_name override correctly renames project
    - Test import with empty work_items and artifacts lists succeeds
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to this import feature (approximately 19-24 tests total)
    - Command: Run tests in ProjectSnapshotImportService*, ProjectSnapshotImport*Test, and DTO tests
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 19-24 tests total)
- Round-trip export/import workflow verified
- Transaction rollback behavior confirmed
- set_active flag behavior verified
- No more than 6 additional integration tests added

---

## Execution Order

Recommended implementation sequence:

1. **DTO Layer (Task Group 1)** - Create request/response DTOs first as they define the API contract
2. **Service Layer (Task Group 2)** - Implement core business logic with validation and persistence
3. **API Layer (Task Group 3)** - Wire up the endpoint to expose the service
4. **Integration Testing (Task Group 4)** - Verify end-to-end behavior and fill test gaps

## File Locations Summary

**New Files:**
- `src/main/java/com/example/architecturemodel/model/dto/export/ProjectSnapshotImportRequestDto.java`
- `src/main/java/com/example/architecturemodel/model/dto/export/ProjectSnapshotImportResultDto.java`
- `src/main/java/com/example/architecturemodel/service/ProjectSnapshotImportService.java`
- `src/main/java/com/example/architecturemodel/exception/ConflictException.java`
- `src/test/java/com/example/architecturemodel/dto/ProjectSnapshotImportDtoTest.java`
- `src/test/java/com/example/architecturemodel/service/ProjectSnapshotImportServiceTest.java`
- `src/test/java/com/example/architecturemodel/controller/ProjectSnapshotImportControllerTest.java`
- `src/test/java/com/example/architecturemodel/integration/ProjectSnapshotImportIntegrationTest.java`

**Modified Files:**
- `src/main/java/com/example/architecturemodel/controller/ProjectController.java` (add import endpoint)
- `src/main/java/com/example/architecturemodel/repository/ProjectRepository.java` (add existsByName, findByName)
- `src/main/java/com/example/architecturemodel/exception/GlobalExceptionHandler.java` (add ConflictException handler)

**Reference Files (existing patterns to follow):**
- `src/main/java/com/example/architecturemodel/model/dto/export/ProjectSnapshotDto.java`
- `src/main/java/com/example/architecturemodel/model/dto/export/SnapshotMeta.java`
- `src/main/java/com/example/architecturemodel/service/ProjectSnapshotService.java`
- `src/main/java/com/example/architecturemodel/service/ProjectService.java`
- `src/main/java/com/example/architecturemodel/service/ModelService.java`

## Key Design Decisions

1. **Always creates NEW project** - No merge functionality; import always creates a fresh project
2. **Requires project_parent_folder** - Exported path is not valid on another machine
3. **409 Conflict on duplicates** - No auto-suffix; deterministic, explicit behavior
4. **set_active=true by default** - Imported project becomes active unless explicitly disabled
5. **Transactional all-or-nothing** - Rollback on any failure leaves no partial data
6. **ID preservation** - Work items and artifacts keep their original UUIDs from snapshot
7. **Snapshot version validation** - Only version 1 supported; future versions may need migration
