# Task Breakdown: Project Hierarchy Grouping

## Overview

**Feature:** Add `projectHierarchy` field for logical one-level project grouping and update Open/Save As/Delete modals to display projects grouped under collapsible sections.

**Total Task Groups:** 4
**Total Sub-Tasks:** ~32

## Summary Table

| Task Group | Description | Dependencies | Est. Sub-Tasks |
|------------|-------------|--------------|----------------|
| 1 | Database & Backend Layer | None | 9 |
| 2 | Frontend API & Types | Task Group 1 | 6 |
| 3 | Frontend UI Components | Task Group 2 | 12 |
| 4 | Test Review & Gap Analysis | Task Groups 1-3 | 5 |

## Files to Create

| File | Description |
|------|-------------|
| `architecture-model-service/src/main/resources/db/changelog/sql/027-project-hierarchy.sql` | Migration for project_hierarchy column |
| `frontend/src/components/Project/GroupedProjectList.tsx` | Reusable grouped project list component |
| `frontend/src/components/Project/GroupedProjectList.module.css` | Styles for GroupedProjectList |

## Files to Modify

| File | Changes |
|------|---------|
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ProjectEntity.java` | Add `projectHierarchy` field |
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/ProjectDto.java` | Add `projectHierarchy` field |
| `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/ProjectMapper.java` | Map `projectHierarchy` field |
| `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ProjectController.java` | Add `projectHierarchy` to CreateProjectRequest |
| `architecture-model-service/src/main/java/com/example/architecturemodel/service/ProjectService.java` | Accept and store `projectHierarchy` |
| `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` | Register migration 027 |
| `frontend/src/api/projectsApi.ts` | Add `projectHierarchy` to types and functions |
| `frontend/src/components/Project/CreateProjectModal.tsx` | Add Project Hierarchy input field |
| `frontend/src/components/Project/DeleteProjectModal.tsx` | Use GroupedProjectList component |
| `frontend/src/components/ModelFileDialog/ModelFileDialog.tsx` | Add hierarchy input in saveAs mode (if applicable) |

---

## Task List

### Database & Backend Layer

#### Task Group 1: Project Hierarchy Field - Backend
**Dependencies:** None

- [x] 1.0 Complete backend projectHierarchy field implementation
  - [x] 1.1 Write 4-6 focused tests for projectHierarchy backend functionality
    - Test: `ProjectEntity` stores and retrieves `projectHierarchy` correctly
    - Test: `ProjectDto` includes `projectHierarchy` in JSON serialization
    - Test: `createProject()` accepts optional `projectHierarchy` and stores trimmed value
    - Test: `createProject()` treats blank/whitespace-only `projectHierarchy` as null
    - Test: `ProjectMapper` correctly maps `projectHierarchy` between entity and DTO
    - Test: API endpoint accepts `projectHierarchy` in request body
  - [x] 1.2 Create database migration `027-project-hierarchy.sql`
    - Add `project_hierarchy` column to `project` table (VARCHAR(255), nullable)
    - Use precondition `not columnExists` on `project.project_hierarchy` for idempotency
    - Create index: `CREATE INDEX idx_project_hierarchy ON project(project_hierarchy)`
    - File: `architecture-model-service/src/main/resources/db/changelog/sql/027-project-hierarchy.sql`
  - [x] 1.3 Register migration in `db.changelog-master.yaml`
    - Add changeSet `027-project-hierarchy` following existing pattern
    - Use precondition checking for `project.project_hierarchy` column existence
    - File: `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
  - [x] 1.4 Add `projectHierarchy` field to `ProjectEntity.java`
    - Add field: `@Column(name = "project_hierarchy", nullable = true) private String projectHierarchy;`
    - Lombok annotations will auto-generate getter/setter
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ProjectEntity.java`
  - [x] 1.5 Add `projectHierarchy` field to `ProjectDto.java`
    - Add record field with `@JsonAlias("projectHierarchy")` for camelCase deserialization
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/ProjectDto.java`
  - [x] 1.6 Update `ProjectMapper.java` to map `projectHierarchy`
    - Add `projectHierarchy` to `toDto()` method: `entity.getProjectHierarchy()`
    - Add `projectHierarchy` to `toEntity()` method: `.projectHierarchy(dto.projectHierarchy())`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/ProjectMapper.java`
  - [x] 1.7 Update `CreateProjectRequest` in `ProjectController.java`
    - Add field: `@JsonAlias({"projectHierarchy", "project_hierarchy"}) String projectHierarchy`
    - Pass `projectHierarchy` to `projectService.createProject()` call
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ProjectController.java`
  - [x] 1.8 Update `ProjectService.createProject()` method
    - Add `String projectHierarchy` parameter to method signature
    - Trim whitespace; treat blank/whitespace-only as null
    - Set on entity builder: `.projectHierarchy(trimmedHierarchy)`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/ProjectService.java`
  - [x] 1.9 Ensure backend tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify migration runs successfully on test database
    - Verify API endpoint accepts `projectHierarchy` parameter
    - Do NOT run the entire backend test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- Migration creates `project_hierarchy` column with index
- `ProjectEntity`, `ProjectDto`, and `ProjectMapper` include `projectHierarchy` field
- API endpoint `POST /api/projects` accepts optional `projectHierarchy` in request body
- Blank/whitespace `projectHierarchy` values are stored as null
- Existing projects have null `projectHierarchy` (no data migration needed)

---

### Frontend API Layer

#### Task Group 2: Frontend API & Types Update
**Dependencies:** Task Group 1

- [x] 2.0 Complete frontend API and types for projectHierarchy
  - [x] 2.1 Write 3-4 focused tests for frontend API changes
    - Test: `ProjectDto` interface includes `projectHierarchy` field
    - Test: `mapProjectFromSnake()` correctly maps `project_hierarchy` to `projectHierarchy`
    - Test: `createProject()` includes `project_hierarchy` in request payload when provided
    - Test: `createProject()` omits or sends null for `project_hierarchy` when not provided
  - [x] 2.2 Update `ProjectDto` interface in `projectsApi.ts`
    - Add field: `projectHierarchy: string | null;`
    - File: `frontend/src/api/projectsApi.ts`
  - [x] 2.3 Update `ProjectDtoSnake` interface in `projectsApi.ts`
    - Add field: `project_hierarchy: string | null;`
    - File: `frontend/src/api/projectsApi.ts`
  - [x] 2.4 Update `mapProjectFromSnake()` function
    - Add mapping: `projectHierarchy: dto.project_hierarchy ?? null`
    - File: `frontend/src/api/projectsApi.ts`
  - [x] 2.5 Update `createProject()` function signature and payload
    - Add optional parameter: `projectHierarchy?: string`
    - Include in request body: `project_hierarchy: projectHierarchy ?? null`
    - File: `frontend/src/api/projectsApi.ts`
  - [x] 2.6 Ensure frontend API tests pass
    - Run ONLY the 3-4 tests written in 2.1
    - Verify type definitions compile without errors
    - Do NOT run the entire frontend test suite at this stage

**Acceptance Criteria:**
- The 3-4 tests written in 2.1 pass
- `ProjectDto` and `ProjectDtoSnake` interfaces include `projectHierarchy` field
- `mapProjectFromSnake()` correctly maps the field
- `createProject()` accepts optional `projectHierarchy` and includes it in API payload

---

### Frontend UI Components

#### Task Group 3: UI Components for Project Hierarchy
**Dependencies:** Task Group 2

- [x] 3.0 Complete UI components for project hierarchy grouping
  - [x] 3.1 Write 5-8 focused tests for UI components
    - Test: CreateProjectModal renders "Project Hierarchy" input field
    - Test: CreateProjectModal passes `projectHierarchy` to `createProject()` API
    - Test: GroupedProjectList groups projects by `projectHierarchy` value
    - Test: GroupedProjectList renders "(No hierarchy)" section for null hierarchy
    - Test: GroupedProjectList sections are independently collapsible
    - Test: GroupedProjectList orders sections alphabetically (after "(No hierarchy)")
    - Test: DeleteProjectModal uses GroupedProjectList and preserves selection behavior
    - Test: GroupedProjectList calls `onProjectClick` with correct project ID
  - [x] 3.2 Add Project Hierarchy input to `CreateProjectModal.tsx`
    - Add `useState` for `projectHierarchy` field (default empty string)
    - Add input group after "Parent Folder" with label "Project Hierarchy"
    - Add help text: "Optional logical folder for grouping projects in menus (e.g., ClientA, Internal)."
    - Pass trimmed `projectHierarchy` (or undefined if blank) to `createProject()` call
    - Reset field on modal open
    - Follow existing `inputGroup`, `inputLabel`, `input`, `inputHint` CSS classes
    - File: `frontend/src/components/Project/CreateProjectModal.tsx`
  - [x] 3.3 Create `GroupedProjectList.tsx` component
    - Props interface: `projects: ProjectDto[]`, `selectedProjectId: string | null`, `onProjectClick: (id: string) => void`
    - Group projects by `projectHierarchy` using `Map<string | null, ProjectDto[]>`
    - Render collapsible sections with hierarchy name as header
    - Use "(No hierarchy)" as display name for null hierarchy
    - Default all sections to expanded state
    - File: `frontend/src/components/Project/GroupedProjectList.tsx`
  - [x] 3.4 Implement collapsible section behavior in `GroupedProjectList.tsx`
    - Add local state `expandedSections: Set<string>` (initialized with all section names)
    - Render chevron icon (down when expanded, right when collapsed)
    - Toggle section on header click
    - Hide project list when section collapsed
  - [x] 3.5 Implement section and project ordering in `GroupedProjectList.tsx`
    - Section order: "(No hierarchy)" first, then alphabetical by hierarchy name
    - Project order within section: alphabetical by project name (case-insensitive)
    - Use `Array.sort()` with locale-aware comparison
  - [x] 3.6 Create `GroupedProjectList.module.css` styles
    - Style section header with clickable area, hierarchy name, chevron icon
    - Style project rows matching `DeleteProjectModal` `.projectRow` styling
    - Style selected row matching `.selected` class
    - Add hover states for interactive elements
    - Add transition for collapse/expand animation
    - File: `frontend/src/components/Project/GroupedProjectList.module.css`
  - [x] 3.7 Update `DeleteProjectModal.tsx` to use `GroupedProjectList`
    - Import `GroupedProjectList` component
    - Replace flat project list rendering with `GroupedProjectList`
    - Pass `projects`, `selectedProjectId`, `onProjectClick={handleProjectClick}`
    - Preserve existing keyboard handling (Enter to delete, Escape to close)
    - Preserve empty state and loading state rendering
    - File: `frontend/src/components/Project/DeleteProjectModal.tsx`
  - [x] 3.8 Add Project Hierarchy input to Save As flow (if applicable)
    - If ModelFileDialog has a saveAs mode, add optional "Project Hierarchy" input
    - Pre-fill with current project's hierarchy if available
    - Include hierarchy value in save-as API call
    - Note: Skip if ModelFileDialog is file-based, not project-based
    - File: `frontend/src/components/ModelFileDialog/ModelFileDialog.tsx` (conditional)
    - **SKIPPED**: Per spec "Out of Scope" - ModelFileDialog is file-based, hierarchy field on model files is out of scope
  - [x] 3.9 Update Open modal to use grouped display (if applicable)
    - If Open modal shows projects (not just files), use `GroupedProjectList`
    - Apply same grouping logic as DeleteProjectModal
    - Note: Skip if Open modal is for model files only (per spec "Out of Scope")
    - **SKIPPED**: Per spec "Out of Scope" - Open modal is for model files, not projects
  - [x] 3.10 Test keyboard navigation in updated modals
    - Verify Escape closes modal
    - Verify Enter triggers primary action when enabled
    - Verify tab navigation works through grouped sections
  - [x] 3.11 Ensure styles are consistent with existing modal patterns
    - Match colors, spacing, and typography from `CreateProjectModal.module.css`
    - Match project row styling from `DeleteProjectModal.module.css`
  - [x] 3.12 Ensure UI component tests pass
    - Run ONLY the 5-8 tests written in 3.1
    - Verify components render correctly
    - Verify grouping and collapsible behavior works
    - Do NOT run the entire frontend test suite at this stage

**Acceptance Criteria:**
- The 5-8 tests written in 3.1 pass
- CreateProjectModal has new "Project Hierarchy" optional input field
- GroupedProjectList component renders projects in collapsible hierarchy sections
- "(No hierarchy)" section appears first, then alphabetical hierarchy sections
- Projects within sections are sorted alphabetically by name
- DeleteProjectModal uses GroupedProjectList with preserved selection/keyboard behavior
- All sections default to expanded state
- Styling is consistent with existing modal patterns

---

### Testing

#### Task Group 4: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 4-6 tests written by backend engineer (Task 1.1)
    - Review the 3-4 tests written by frontend API (Task 2.1)
    - Review the 5-8 tests written by UI developer (Task 3.1)
    - Total existing tests: approximately 12-18 tests
  - [x] 4.2 Analyze test coverage gaps for project hierarchy feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to this spec's feature requirements
    - Do NOT assess entire application test coverage
    - Prioritize end-to-end workflows over unit test gaps
  - [x] 4.3 Write up to 8 additional strategic tests maximum
    - End-to-end: Create project with hierarchy -> appears in grouped list under correct section
    - End-to-end: Create project without hierarchy -> appears under "(No hierarchy)" section
    - Integration: Backend returns projects with hierarchy -> frontend groups correctly
    - Integration: Section collapse state persists during selection changes
    - Edge case: Multiple projects with same hierarchy sort correctly within section
    - Edge case: Project hierarchy with leading/trailing whitespace is trimmed
    - Skip edge cases, performance tests, and accessibility tests unless business-critical
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, and 4.3)
    - Expected total: approximately 20-26 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass
  - [x] 4.5 Document test coverage summary
    - List all tests by category (backend, frontend API, UI, integration)
    - Note any known gaps that were intentionally skipped
    - Confirm feature meets acceptance criteria

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 20-26 tests total)
- Critical user workflows for project hierarchy are covered
- No more than 8 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Database & Backend Layer (Task Group 1)** - Foundation layer with no dependencies
   - Start with migration and entity changes
   - Then update DTOs, mappers, and service layer
   - Finally update controller

2. **Frontend API Layer (Task Group 2)** - Depends on backend being complete
   - Update TypeScript interfaces
   - Update API client functions

3. **Frontend UI Components (Task Group 3)** - Depends on API layer
   - Create GroupedProjectList component first
   - Then integrate into CreateProjectModal
   - Finally update DeleteProjectModal

4. **Test Review & Gap Analysis (Task Group 4)** - After all implementation complete
   - Review all tests written during development
   - Fill critical gaps with integration/e2e tests
   - Run full feature test suite

---

## Test Coverage Summary

### Backend Tests (ProjectHierarchyServiceTest.java)
1. createProject_storesHierarchy_whenProvided
2. createProject_storesNullHierarchy_whenNotProvided
3. createProject_treatsBlankHierarchyAsNull
4. createProject_treatsWhitespaceOnlyHierarchyAsNull
5. createProject_trimsWhitespaceFromHierarchy

### Frontend API Tests (projectHierarchyApi.test.ts)
1. ProjectDto interface includes projectHierarchy field
2. ProjectDto allows null projectHierarchy
3. mapProjectFromSnake correctly maps project_hierarchy to projectHierarchy
4. mapProjectFromSnake maps null project_hierarchy to null
5. createProject includes project_hierarchy in request payload when provided
6. createProject sends null for project_hierarchy when not provided
7. createProject returns created project with projectHierarchy

### UI Component Tests (GroupedProjectList.test.tsx)
1. groups projects by projectHierarchy value
2. renders "(No hierarchy)" section for null hierarchy projects
3. displays "(No hierarchy)" section first before alphabetical sections
4. orders sections alphabetically (after "(No hierarchy)")
5. orders projects within sections alphabetically by name
6. sections are independently collapsible
7. all sections default to expanded state
8. calls onProjectClick with correct project ID
9. applies selected styling to selected project row
10. renders empty message when no projects
11. shows correct project count in section header

### CreateProjectModal Tests (CreateProjectModalHierarchy.test.tsx)
1. renders "Project Hierarchy" input field
2. displays help text for Project Hierarchy field
3. passes projectHierarchy to createProject API when provided
4. passes undefined for projectHierarchy when field is empty
5. trims whitespace from projectHierarchy
6. treats whitespace-only hierarchy as undefined
7. resets hierarchy field when modal reopens
8. allows form submission even with empty hierarchy (optional field)

### Integration Tests (projectHierarchyIntegration.test.ts)
1. project created with hierarchy should include hierarchy in response
2. project created without hierarchy should have null hierarchy
3. listProjects returns projects with correct hierarchy values
4. multiple projects with same hierarchy are handled correctly
5. projects sort correctly within same hierarchy section
6. hierarchy with leading/trailing whitespace is trimmed by backend
7. ProjectDto interface enforces correct hierarchy type

### Total Tests: ~30 tests covering the Project Hierarchy Grouping feature

---

## Notes

- **Existing projects:** Will have null `projectHierarchy` - displayed under "(No hierarchy)"
- **Project name uniqueness:** Remains global across all hierarchies (not scoped to hierarchy)
- **Collapse state persistence:** Not persisted across sessions - sections reset to expanded on modal open
- **Multi-level hierarchy:** Out of scope - only single-level string supported
- **Model file grouping:** Out of scope - ModelFileDialog file list remains ungrouped per spec
