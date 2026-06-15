# Task Breakdown: Overwrite Existing Project Option for Snapshot Import

## Overview
Total Tasks: 24 (across 4 task groups)

This feature extends the "Import Project Snapshot" functionality to enforce project name uniqueness by default while allowing users to explicitly opt in to overwriting an existing project with the same name. The overwrite performs a full replacement (not merge) based on project name alone.

## Task List

### Backend Layer

#### Task Group 1: Backend DTO and Service Layer
**Dependencies:** None

- [x] 1.0 Complete backend DTO extension and deletion service
  - [x] 1.1 Write 4 focused tests for overwrite import functionality
    - Test 1: Import with existing project name and `overwriteExistingProject=false` returns 409 Conflict
    - Test 2: Import with existing project name and `overwriteExistingProject=true` succeeds and replaces data
    - Test 3: Verify replacement is not a merge (old data absent after overwrite)
    - Test 4: Verify transactionality (partial failure does not leave project in inconsistent state)
  - [x] 1.2 Extend ProjectSnapshotImportRequestDto with overwrite field
    - Add field: `Boolean overwriteExistingProject`
    - Add annotation: `@JsonProperty("overwrite_existing_project")`
    - Add annotation: `@JsonAlias({"overwriteExistingProject", "overwrite_existing_project"})`
    - Add method: `effectiveOverwriteExistingProject()` returning `false` if null
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/export/ProjectSnapshotImportRequestDto.java`
  - [x] 1.3 Create ProjectDeletionService for full project deletion
    - Create new service class: `ProjectDeletionService.java`
    - Implement method: `deleteProjectById(UUID projectId)`
    - Delete in dependency order:
      - Model file records (meta-model entities scoped to project's model files)
      - Work items (`work_item` table rows where `project_id` matches)
      - Project artifacts (`project_artifact` table rows where `project_id` matches)
      - Diagram-related records if scoped to project
      - Project record itself from `project` table
    - Use existing repository methods where available
    - Rely on database cascades where configured
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/ProjectDeletionService.java`
  - [x] 1.4 Modify ProjectSnapshotImportService conflict handling
    - After computing effective project name, query `projectRepository.findByName(effectiveProjectName)`
    - If project exists and `request.effectiveOverwriteExistingProject()` is false: throw `ConflictException("Project name already exists: " + effectiveProjectName)`
    - If project exists and overwrite is true: call `ProjectDeletionService.deleteProjectById(existingProject.getId())` then proceed with import
    - Ensure entire overwrite operation (delete + import) remains in single `@Transactional` for atomicity
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/ProjectSnapshotImportService.java`
  - [x] 1.5 Ensure idempotent overwrite behavior
    - After successful overwrite import, resulting project state must match snapshot content exactly
    - Repeated overwrite imports with same snapshot yield identical database state
    - Project ID will be new (generated during import), but project name matches effective name
    - No merge of old data with new data; old project is fully removed before new import
  - [x] 1.6 Ensure backend tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify DTO serialization/deserialization works correctly
    - Verify deletion service removes all related data
    - Verify import service handles overwrite flag correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- `ProjectSnapshotImportRequestDto` accepts `overwrite_existing_project` field
- `effectiveOverwriteExistingProject()` returns `false` when field is null
- `ProjectDeletionService` correctly deletes all project-scoped data
- Import with overwrite=true replaces existing project completely
- Import with overwrite=false (default) throws 409 on name conflict
- Transaction rollback works on partial failure

---

### API Layer

#### Task Group 2: API Integration Tests
**Dependencies:** Task Group 1

- [x] 2.0 Complete API integration tests for overwrite functionality
  - [x] 2.1 Write 4 focused integration tests for import endpoint
    - Test 1: POST `/api/projects/import` with existing name and no overwrite flag returns 409 with error message "Project name already exists: <name>"
    - Test 2: POST `/api/projects/import` with existing name and `overwrite_existing_project=true` returns 200 with new project
    - Test 3: After overwrite, verify old project data (work items, artifacts) is gone
    - Test 4: Verify response body matches `ProjectSnapshotImportResultDto` structure
  - [x] 2.2 Verify ConflictException mapping to HTTP 409
    - Confirm `GlobalExceptionHandler` maps `ConflictException` to 409 status
    - Confirm error response includes message field with "Project name already exists: <name>"
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/exception/GlobalExceptionHandler.java`
  - [x] 2.3 Test request payload deserialization
    - Verify Jackson correctly deserializes both `overwrite_existing_project` (snake_case) and `overwriteExistingProject` (camelCase) due to `@JsonAlias`
    - Verify default value (null treated as false) works correctly
  - [x] 2.4 Ensure API integration tests pass
    - Run ONLY the 4 tests written in 2.1
    - Verify HTTP status codes are correct
    - Verify error messages are user-friendly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 2.1 pass
- 409 Conflict returned when name exists and overwrite is false/omitted
- 200 OK returned when overwrite is true and import succeeds
- Error response contains clear message for conflict case
- Both snake_case and camelCase field names accepted

---

### Frontend Layer

#### Task Group 3: Frontend UI and API Client
**Dependencies:** Task Group 2

- [x] 3.0 Complete frontend UI and API integration
  - [x] 3.1 Write 6 focused tests for import modal overwrite functionality
    - Test 1: Overwrite checkbox renders with label "Overwrite existing project?" and default unchecked
    - Test 2: When snapshot name conflicts and overwrite is unchecked, error banner shows and Import button is disabled
    - Test 3: When overwrite is checked, error banner disappears and Import button is enabled
    - Test 4: When override name changes to non-conflicting name, error disappears without needing overwrite
    - Test 5: When override name changes to conflicting name, error shows (overwrite gating applies)
    - Test 6: Import request includes `overwrite_existing_project` field when checkbox is checked
  - [x] 3.2 Extend ProjectSnapshotImportRequestDto interface
    - Add optional field: `overwriteExistingProject?: boolean`
    - File: `frontend/src/api/projectSnapshotApi.ts`
  - [x] 3.3 Update importProjectSnapshot function to include overwrite field
    - Add `overwrite_existing_project: boolean` to request body (snake_case for backend)
    - Send alongside existing fields: `snapshot`, `set_active`, `import_as_name`, `project_parent_folder`
    - Only include field when explicitly set (do not send if undefined)
    - File: `frontend/src/api/projectSnapshotApi.ts`
  - [x] 3.4 Add overwrite checkbox state to ImportProjectSnapshotModal
    - Add state variable: `overwriteExistingProject` (boolean, default: false)
    - Reset state in `useEffect` when `isOpen` changes
    - File: `frontend/src/components/Project/ImportProjectSnapshotModal.tsx`
  - [x] 3.5 Add overwrite checkbox UI to modal
    - Position: below "Override Project Name/Folder?" checkbox
    - Label: "Overwrite existing project?"
    - Use existing CSS classes: `styles.checkboxGroup`, `styles.checkbox`, `styles.checkboxLabel`
    - Add `data-testid="overwrite-existing-checkbox"` for testing
    - File: `frontend/src/components/Project/ImportProjectSnapshotModal.tsx`
  - [x] 3.6 Implement name conflict validation logic
    - Compute effective project name: if override is checked use `importAsName`, else use `rawSnapshotJson.project.name`
    - Add logic to check if effective name conflicts with existing project (may need to fetch project list or handle on submit)
    - When conflict detected and `overwriteExistingProject` is unchecked:
      - Show error banner: "Project name already exists: <name>"
      - Disable Import button
    - When conflict detected and `overwriteExistingProject` is checked:
      - Suppress error banner
      - Enable Import button
    - Re-evaluate conflict state when: override toggle changes, `importAsName` value changes, or `overwriteExistingProject` checkbox is toggled
    - Use existing `styles.errorMessage` CSS class and `data-testid="error-message"`
    - File: `frontend/src/components/Project/ImportProjectSnapshotModal.tsx`
  - [x] 3.7 Update handleImport to send overwrite field
    - Include `overwriteExistingProject` in the request payload to `importProjectSnapshot()`
    - File: `frontend/src/components/Project/ImportProjectSnapshotModal.tsx`
  - [x] 3.8 Handle 409 Conflict error response from backend
    - Current error handling already extracts `err.message` and displays in error banner
    - Verify that "Project name already exists: <name>" message displays correctly
    - No changes needed if existing error handling works
    - File: `frontend/src/components/Project/ImportProjectSnapshotModal.tsx`
  - [x] 3.9 Ensure frontend tests pass
    - Run ONLY the 6 tests written in 3.1
    - Verify checkbox renders and toggles correctly
    - Verify error display logic works
    - Verify API request includes overwrite field
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6 tests written in 3.1 pass
- Overwrite checkbox renders with correct label and default state
- Name conflict validation prevents import when overwrite is off
- Name conflict validation allows import when overwrite is on
- API request correctly includes `overwrite_existing_project` field
- Backend 409 error message displays in error banner

---

### Testing

#### Task Group 4: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 4 tests written by backend engineer (Task 1.1)
    - Review the 4 tests written by API integration (Task 2.1)
    - Review the 6 tests written by frontend engineer (Task 3.1)
    - Total existing tests: approximately 14 tests
  - [x] 4.2 Analyze test coverage gaps for THIS feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to overwrite import functionality
    - Do NOT assess entire application test coverage
    - Prioritize end-to-end workflows over unit test gaps
  - [x] 4.3 Write up to 6 additional strategic tests if necessary
    - Gap Test 1: End-to-end test: Import snapshot -> name conflict -> check overwrite -> successful import
    - Gap Test 2: Verify project list API returns projects for conflict checking (if frontend needs to fetch list)
    - Gap Test 3: Test overwrite with project that has many work items and artifacts (verify complete deletion)
    - Gap Test 4: Test interaction between override name and overwrite checkbox (effective name changes)
    - Gap Test 5: Test keyboard interaction (Enter key submits with overwrite checked)
    - Gap Test 6: Test modal reset when reopened (overwrite checkbox should reset to unchecked)
    - Add maximum of 6 new tests to fill identified critical gaps
    - Focus on integration points and end-to-end workflows
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, and 4.3)
    - Expected total: approximately 20 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 20 tests total)
- Critical user workflows for overwrite import are covered
- No more than 6 additional tests added when filling in testing gaps
- Testing focused exclusively on overwrite import functionality

---

## Execution Order

Recommended implementation sequence:

1. **Backend Layer (Task Group 1)** - Foundation work
   - Extend DTO with overwrite field
   - Create ProjectDeletionService
   - Modify import service conflict handling
   - Ensure transactional behavior

2. **API Layer (Task Group 2)** - Verify backend integration
   - Integration tests for HTTP endpoints
   - Verify error responses
   - Confirm request deserialization

3. **Frontend Layer (Task Group 3)** - User interface
   - Extend API client types
   - Add checkbox UI to modal
   - Implement conflict validation logic
   - Connect UI to API

4. **Test Review (Task Group 4)** - Final validation
   - Review all tests from previous groups
   - Identify and fill critical gaps
   - Run full feature test suite

## Key Files to Modify

### Backend (architecture-model-service)
- `src/main/java/com/example/architecturemodel/model/dto/export/ProjectSnapshotImportRequestDto.java` - Add overwrite field
- `src/main/java/com/example/architecturemodel/service/ProjectSnapshotImportService.java` - Modify conflict handling
- `src/main/java/com/example/architecturemodel/service/ProjectDeletionService.java` - New file for deletion logic

### Frontend
- `frontend/src/api/projectSnapshotApi.ts` - Extend DTO and API function
- `frontend/src/components/Project/ImportProjectSnapshotModal.tsx` - Add checkbox and validation

## Notes

- **Safe-by-default**: The overwrite checkbox defaults to OFF, ensuring users do not accidentally overwrite projects
- **Full replacement**: Overwrite deletes all existing project data before importing; no merge behavior
- **Project identity by name**: Matching is based on project name only, not UUID
- **Transactional**: The delete + import operation must be atomic to prevent data loss on failure
- **Existing patterns**: Follow existing checkbox and error display patterns in ImportProjectSnapshotModal.tsx
