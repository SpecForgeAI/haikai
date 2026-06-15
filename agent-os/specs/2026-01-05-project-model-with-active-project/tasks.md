# Task Breakdown: Project Model with Active Project

## Overview
Total Tasks: 42

This feature introduces a first-class Project entity enabling the tool to manage multiple projects while operating on exactly one "active" project at a time. The roadmap import will resolve files from the active project's configured parent folder path.

## Files to Create/Modify

### Backend Files (Create)
- `architecture-model-service/src/main/resources/db/changelog/sql/013-project-table.sql`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ProjectEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/ProjectDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/ProjectMapper.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/ProjectRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ProjectService.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ProjectController.java`

### Backend Files (Modify)
- `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/RoadmapImportService.java`

### Frontend Files (Create)
- `frontend/src/api/projectsApi.ts`
- `frontend/src/contexts/ProjectContext.tsx`
- `frontend/src/components/Project/CreateProjectModal.tsx`
- `frontend/src/components/Project/CreateProjectModal.module.css`

### Frontend Files (Modify)
- `frontend/src/components/TopBar/FileMenu.tsx`
- `frontend/src/components/TopBar/TopBar.tsx`
- `frontend/src/components/ProductView/ProductRoadmapPage.tsx`
- `frontend/src/App.tsx`

## Task List

### Backend Database Layer

#### Task Group 1: Database Schema and Migration
**Dependencies:** None

- [x] 1.0 Complete database schema for project table
  - [x] 1.1 Write 4 focused tests for database schema
    - Test project table creation with all required columns
    - Test partial unique index enforcement (only one active project)
    - Test index on is_active column exists
    - Test default values for is_active, created_at, updated_at
  - [x] 1.2 Create Liquibase migration file `013-project-table.sql`
    - Create `project` table with columns: id (UUID PK), name (TEXT NOT NULL), project_parent_folder (TEXT NOT NULL), is_active (BOOLEAN NOT NULL DEFAULT FALSE), created_at (TIMESTAMPTZ), updated_at (TIMESTAMPTZ)
    - Add index on is_active column: `CREATE INDEX idx_project_is_active ON project(is_active)`
    - Add partial unique index for single active project: `CREATE UNIQUE INDEX project_single_active_idx ON project((is_active)) WHERE is_active = true`
    - Follow pattern from `012-work-items-project-artifacts.sql`
  - [x] 1.3 Update `db.changelog-master.yaml` to include new migration
    - Add changeSet entry for 013-project-table.sql
  - [x] 1.4 Ensure database layer tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify migration runs successfully on PostgreSQL

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- Project table is created with all specified columns
- Partial unique index enforces single active project at DB level
- Migration follows existing project patterns

---

### Backend Entity and Repository Layer

#### Task Group 2: Entity, DTO, Mapper, and Repository
**Dependencies:** Task Group 1

- [x] 2.0 Complete entity, DTO, mapper, and repository
  - [x] 2.1 Write 5 focused tests for entity and repository
    - Test ProjectEntity persistence and retrieval
    - Test `findByIsActiveTrue()` returns Optional with active project
    - Test `findByIsActiveTrue()` returns empty Optional when no active project
    - Test `deactivateAll()` sets all is_active=false
    - Test entity @PrePersist and @PreUpdate timestamp handling
  - [x] 2.2 Create `ProjectEntity.java`
    - Follow pattern from `WorkItemEntity.java`
    - Use @Entity, @Table(name = "project"), @Getter, @Setter, @NoArgsConstructor, @AllArgsConstructor, @Builder
    - Fields: id (UUID), name (String), projectParentFolder (String), isActive (Boolean), createdAt (Instant), updatedAt (Instant)
    - Add @PrePersist and @PreUpdate lifecycle callbacks for timestamps
  - [x] 2.3 Create `ProjectDto.java` record
    - Use Java record with camelCase field names
    - Fields: id, name, projectParentFolder, isActive, createdAt, updatedAt
  - [x] 2.4 Create `ProjectMapper.java`
    - Method: `toDto(ProjectEntity entity)` returning ProjectDto
    - Method: `toEntity(ProjectDto dto)` returning ProjectEntity
    - Follow existing mapper patterns in the codebase
  - [x] 2.5 Create `ProjectRepository.java` interface
    - Extend JpaRepository<ProjectEntity, UUID>
    - Add `Optional<ProjectEntity> findByIsActiveTrue()`
    - Add `@Modifying @Query("UPDATE ProjectEntity p SET p.isActive = false") void deactivateAll()`
  - [x] 2.6 Ensure entity and repository tests pass
    - Run ONLY the 5 tests written in 2.1

**Acceptance Criteria:**
- The 5 tests written in 2.1 pass
- ProjectEntity correctly maps to project table
- Repository methods work as specified
- Mapper converts between entity and DTO correctly

---

### Backend Service Layer

#### Task Group 3: Project Service Implementation
**Dependencies:** Task Group 2

- [x] 3.0 Complete ProjectService implementation
  - [x] 3.1 Write 6 focused tests for ProjectService
    - Test `createProject()` with setActive=true deactivates existing active project first
    - Test `createProject()` with setActive=false does not affect other projects
    - Test `listProjects()` returns all projects
    - Test `getActiveProject()` returns active project when exists
    - Test `getActiveProject()` throws ResourceNotFoundException when no active project
    - Test `activateProject(id)` deactivates all then activates specified project
  - [x] 3.2 Create `ProjectService.java`
    - Inject ProjectRepository
    - Use @Service and @Transactional annotations
  - [x] 3.3 Implement `createProject(String name, String parentFolder, boolean setActive)`
    - When setActive=true: call deactivateAll() first, then create and save with isActive=true
    - When setActive=false: create and save with isActive=false
    - Return saved ProjectDto
  - [x] 3.4 Implement `listProjects()`
    - Return List<ProjectDto> of all projects
    - Use mapper to convert entities
  - [x] 3.5 Implement `getActiveProject()`
    - Call findByIsActiveTrue()
    - If empty: throw ResourceNotFoundException with message "No active project. Create or open a project first."
    - Return ProjectDto
  - [x] 3.6 Implement `activateProject(UUID id)`
    - Verify project exists (throw ResourceNotFoundException if not)
    - Call deactivateAll() within transaction
    - Set specified project isActive=true and save
    - Return updated ProjectDto
  - [x] 3.7 Ensure service tests pass
    - Run ONLY the 6 tests written in 3.1

**Acceptance Criteria:**
- The 6 tests written in 3.1 pass
- All service methods are @Transactional
- Only one project is active at any time
- Clear error messages when no active project

---

### Backend API Layer

#### Task Group 4: Project REST Controller
**Dependencies:** Task Group 3

- [x] 4.0 Complete Project REST API
  - [x] 4.1 Write 5 focused tests for ProjectController
    - Test POST /api/projects creates project and returns 201
    - Test GET /api/projects returns list of all projects
    - Test GET /api/projects/active returns active project when exists
    - Test GET /api/projects/active returns 404 with message when no active project
    - Test POST /api/projects/{id}/activate activates project and returns 200
  - [x] 4.2 Create `ProjectController.java`
    - Use @RestController and @RequestMapping("/api/projects")
    - Inject ProjectService
  - [x] 4.3 Implement POST /api/projects endpoint
    - Accept request body with: name, projectParentFolder, optional setActive (default true)
    - Call projectService.createProject()
    - Return ResponseEntity with 201 Created and ProjectDto
  - [x] 4.4 Implement GET /api/projects endpoint
    - Call projectService.listProjects()
    - Return List<ProjectDto>
  - [x] 4.5 Implement GET /api/projects/active endpoint
    - Call projectService.getActiveProject()
    - Return ProjectDto or let exception handler return 404
  - [x] 4.6 Implement POST /api/projects/{id}/activate endpoint
    - Accept path variable id (UUID)
    - Call projectService.activateProject(id)
    - Return updated ProjectDto
  - [x] 4.7 Ensure API tests pass
    - Run ONLY the 5 tests written in 4.1

**Acceptance Criteria:**
- The 5 tests written in 4.1 pass
- All endpoints return correct HTTP status codes
- 404 response includes clear error message
- Request/response bodies match spec

---

### Backend Roadmap Import Update

#### Task Group 5: Roadmap Import Service Integration
**Dependencies:** Task Group 3

- [x] 5.0 Update RoadmapImportService for active project path resolution
  - [x] 5.1 Write 4 focused tests for updated RoadmapImportService
    - Test import resolves path from active project's projectParentFolder
    - Test import throws exception with clear message when no active project
    - Test import throws exception when active project has null/blank parentFolder
    - Test error messages include resolved absolute path
  - [x] 5.2 Modify RoadmapImportService to inject ProjectService
    - Add ProjectService dependency via constructor injection
  - [x] 5.3 Update `importFromAgentOsFile()` method
    - Call projectService.getActiveProject() at start
    - If no active project: let exception propagate (message: "No active project. Create or open a project first.")
    - If parentFolder is null or blank: throw exception with message "Active project has no parent folder configured."
    - Compute roadmap path: `Paths.get(activeProject.getProjectParentFolder(), "agent-os", "product", "roadmap.md")`
  - [x] 5.4 Update error messages to include resolved absolute path
    - In readRoadmapFile(), include full resolved path in exception message
  - [x] 5.5 Ensure roadmap import tests pass
    - Run ONLY the 4 tests written in 5.1

**Acceptance Criteria:**
- The 4 tests written in 5.1 pass
- Roadmap import reads from active project's folder
- Clear error messages for missing active project
- Absolute paths included in error messages for troubleshooting

---

### Frontend API Layer

#### Task Group 6: Frontend Projects API Client
**Dependencies:** Task Group 4 (backend API must be available)

- [x] 6.0 Complete frontend Projects API client
  - [x] 6.1 Write 4 focused tests for projectsApi
    - Test createProject() sends POST with correct body and returns ProjectDto
    - Test listProjects() sends GET and returns array of ProjectDto
    - Test getActiveProject() returns null on 404, ProjectDto on success
    - Test activateProject() sends POST and returns updated ProjectDto
  - [x] 6.2 Create `src/api/projectsApi.ts`
    - Follow patterns from `roadmapApi.ts` and `modelApi.ts`
    - Define ProjectDto interface with camelCase fields
  - [x] 6.3 Implement `createProject(name: string, projectParentFolder: string)`
    - POST to /api/projects with body { name, projectParentFolder, setActive: true }
    - Return ProjectDto
  - [x] 6.4 Implement `listProjects()`
    - GET from /api/projects
    - Return ProjectDto[]
  - [x] 6.5 Implement `getActiveProject()`
    - GET from /api/projects/active
    - Return null on 404, ProjectDto on success
  - [x] 6.6 Implement `activateProject(id: string)`
    - POST to /api/projects/{id}/activate
    - Return ProjectDto
  - [x] 6.7 Ensure API client tests pass
    - Run ONLY the 4 tests written in 6.1

**Acceptance Criteria:**
- The 4 tests written in 6.1 pass
- API client follows existing patterns
- Proper error handling for 404 responses
- TypeScript types are correctly defined

---

### Frontend State Management

#### Task Group 7: Project Context and State
**Dependencies:** Task Group 6

- [x] 7.0 Complete Project Context implementation
  - [x] 7.1 Write 4 focused tests for ProjectContext
    - Test context provides activeProject state (initially null)
    - Test refreshActiveProject() calls API and updates state
    - Test app initialization calls getActiveProject()
    - Test context re-renders consumers when activeProject changes
  - [x] 7.2 Create `src/contexts/ProjectContext.tsx`
    - Define ProjectContextType with activeProject: ProjectDto | null and refreshActiveProject: () => Promise<void>
    - Create ProjectContext using createContext
    - Create ProjectProvider component
  - [x] 7.3 Implement ProjectProvider
    - Use useState for activeProject (initial: null)
    - Implement refreshActiveProject() that calls getActiveProject() API and updates state
    - Use useEffect to call refreshActiveProject() on mount
  - [x] 7.4 Create useProject() and useRefreshActiveProject() hooks
    - useProject() returns activeProject from context
    - useRefreshActiveProject() returns refreshActiveProject function
  - [x] 7.5 Integrate ProjectProvider into App.tsx
    - Wrap application with ProjectProvider (alongside ArchitectureProvider)
  - [x] 7.6 Ensure context tests pass
    - Run ONLY the 4 tests written in 7.1

**Acceptance Criteria:**
- The 4 tests written in 7.1 pass
- Active project state is available throughout the app
- State refreshes on app initialization
- Context follows React best practices

---

### Frontend UI Components

#### Task Group 8: Create Project Modal Component
**Dependencies:** Task Group 7

- [x] 8.0 Complete Create Project Modal
  - [x] 8.1 Write 5 focused tests for CreateProjectModal
    - Test modal renders with Project Name and Parent Folder inputs
    - Test Create button is disabled when fields are empty/whitespace
    - Test Create button is enabled when both fields have values
    - Test Cancel button closes modal without calling API
    - Test Create success calls refreshActiveProject and closes modal
  - [x] 8.2 Create `src/components/Project/CreateProjectModal.tsx`
    - Follow pattern from `ModelFileDialog.tsx`
    - Props: isOpen, onClose
  - [x] 8.3 Implement modal structure
    - Overlay with click-to-close
    - Modal container with header (title: "Create Project", close button)
    - Content area with two input fields
    - Footer with Cancel and Create buttons
  - [x] 8.4 Implement form state and validation
    - useState for projectName and parentFolder
    - Create button disabled until both fields have non-empty trimmed values
    - useState for error message, loading state
  - [x] 8.5 Implement Create action
    - Call createProject() API
    - On success: call refreshActiveProject(), then onClose()
    - On error: display inline error message below inputs
  - [x] 8.6 Create `CreateProjectModal.module.css`
    - Style overlay, modal, header, inputs, buttons
    - Follow existing modal styling patterns
  - [x] 8.7 Ensure modal tests pass
    - Run ONLY the 5 tests written in 8.1

**Acceptance Criteria:**
- The 5 tests written in 8.1 pass
- Modal matches visual design pattern from ModelFileDialog
- Form validation prevents invalid submissions
- Error messages display clearly

---

#### Task Group 9: File Menu and TopBar Integration
**Dependencies:** Task Group 8

- [x] 9.0 Complete File Menu integration
  - [x] 9.1 Write 3 focused tests for File Menu changes
    - Test "Create Project" menu item appears as FIRST item (above "Open...")
    - Test clicking "Create Project" calls onCreateProject handler
    - Test existing Open/Save menu items still work correctly
  - [x] 9.2 Update FileMenu.tsx
    - Add new prop: onCreateProject: () => void to FileMenuProps interface
    - Add "Create Project" menu item as FIRST item (before "Open...")
    - Wire click handler to call onCreateProject then onClose
  - [x] 9.3 Update TopBar.tsx
    - Add state for createProjectModalOpen
    - Add handler handleCreateProject that sets modal open
    - Pass onCreateProject prop to FileMenu
    - Render CreateProjectModal with isOpen and onClose handlers
  - [x] 9.4 Ensure menu integration tests pass
    - Run ONLY the 3 tests written in 9.1

**Acceptance Criteria:**
- The 3 tests written in 9.1 pass
- "Create Project" appears above existing menu items
- Existing menu functionality unchanged
- Modal opens when menu item clicked

---

#### Task Group 10: Roadmap Import UI Gating
**Dependencies:** Task Group 7

- [x] 10.0 Complete Roadmap Import UI gating
  - [x] 10.1 Write 3 focused tests for import gating
    - Test import button is disabled when no activeProject
    - Test "Create or open a project to import roadmap." message displays when no activeProject
    - Test import button is enabled when activeProject exists
  - [x] 10.2 Modify ProductRoadmapPage.tsx
    - Import useProject hook from ProjectContext
    - Get activeProject from context
  - [x] 10.3 Add conditional rendering for import button
    - When no activeProject: show message "Create or open a project to import roadmap." instead of import button
    - When activeProject exists: show normal import button
  - [x] 10.4 Preserve existing behavior
    - Import summary, error display, tree rendering unchanged
    - Refresh button behavior unchanged
  - [x] 10.5 Ensure UI gating tests pass
    - Run ONLY the 3 tests written in 10.1

**Acceptance Criteria:**
- The 3 tests written in 10.1 pass
- Import blocked when no active project
- Clear guidance message for users
- All existing functionality preserved

---

### Testing and Integration

#### Task Group 11: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-10

- [x] 11.0 Review existing tests and fill critical gaps only
  - [x] 11.1 Review tests from Task Groups 1-10
    - Review the 4 tests written by database-engineer (Task 1.1)
    - Review the 5 tests written by entity/repository engineer (Task 2.1)
    - Review the 6 tests written by service engineer (Task 3.1)
    - Review the 5 tests written by API engineer (Task 4.1)
    - Review the 4 tests written for roadmap import (Task 5.1)
    - Review the 4 tests written for frontend API (Task 6.1)
    - Review the 4 tests written for context (Task 7.1)
    - Review the 5 tests written for modal (Task 8.1)
    - Review the 3 tests written for menu (Task 9.1)
    - Review the 3 tests written for UI gating (Task 10.1)
    - Total existing tests: approximately 43 tests
  - [x] 11.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows lacking coverage
    - Focus ONLY on gaps related to Project Model feature
    - Do NOT assess entire application test coverage
  - [x] 11.3 Write up to 7 additional strategic tests maximum
    - Add maximum of 7 new tests for critical integration gaps
    - Focus on: create project -> activate -> import roadmap flow
    - Focus on: multiple projects, switching active project
    - Do NOT write comprehensive coverage for all scenarios
  - [x] 11.4 Run feature-specific tests only
    - Run ONLY tests related to Project Model feature
    - Expected total: approximately 50 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 50 tests total)
- Critical user workflows for Project Model are covered
- No more than 7 additional tests added
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Database Schema** (no dependencies)
2. **Task Group 2: Entity/DTO/Repository** (depends on 1)
3. **Task Group 3: Project Service** (depends on 2)
4. **Task Group 4: Project REST Controller** (depends on 3)
5. **Task Group 5: Roadmap Import Update** (depends on 3)
6. **Task Group 6: Frontend API Client** (depends on 4)
7. **Task Group 7: Project Context** (depends on 6)
8. **Task Group 8: Create Project Modal** (depends on 7)
9. **Task Group 9: File Menu Integration** (depends on 8)
10. **Task Group 10: Roadmap Import UI Gating** (depends on 7)
11. **Task Group 11: Test Review** (depends on 1-10)

Note: Task Groups 9 and 10 can be executed in parallel after Task Group 8 is complete.

---

## Key Implementation Patterns

### Backend Patterns to Follow
- **Entity**: Follow `WorkItemEntity.java` for @Entity, @Table, Lombok annotations, @PrePersist/@PreUpdate
- **Migration**: Follow `012-work-items-project-artifacts.sql` for table/index creation syntax
- **Service**: Use @Transactional, throw ResourceNotFoundException for missing resources
- **Controller**: Use @RestController, proper HTTP status codes, inject service

### Frontend Patterns to Follow
- **API Client**: Follow `roadmapApi.ts` for fetch patterns, error handling, DTO interfaces
- **Context**: Follow React context patterns with Provider, hooks, useEffect for initialization
- **Modal**: Follow `ModelFileDialog.tsx` for overlay, modal structure, input handling
- **Menu**: Follow existing `FileMenu.tsx` patterns for menu items, click handlers

### Error Message Standards
- No active project: "No active project. Create or open a project first."
- No parent folder: "Active project has no parent folder configured."
- File not found: Include absolute path in message
