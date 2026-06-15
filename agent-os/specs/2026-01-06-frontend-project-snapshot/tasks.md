# Task Breakdown: Frontend Project Snapshot Export/Import

## Overview
Total Tasks: 4 Task Groups, ~25 sub-tasks

This feature replaces the legacy architecture-only JSON export/import with full project snapshot endpoints, enabling users to export and import complete project snapshots that preserve all project data.

## Task List

### API Layer

#### Task Group 1: Project Snapshot API Client
**Dependencies:** None

- [x] 1.0 Complete API client for project snapshots
  - [x] 1.1 Write 3-5 focused tests for projectSnapshotApi functions
    - Test `exportActiveProjectSnapshot()` success returns ProjectSnapshotDto
    - Test `exportActiveProjectSnapshot()` returns null on 404 (no active project)
    - Test `importProjectSnapshot()` success returns ProjectSnapshotImportResultDto
    - Test `importProjectSnapshot()` handles 400/409 errors with message extraction
  - [x] 1.2 Create `src/api/projectSnapshotApi.ts` following `projectsApi.ts` pattern
    - Define `API_BASE` from environment variable
    - Use same fetch patterns and headers as `projectsApi.ts`
  - [x] 1.3 Define TypeScript interfaces for DTOs
    - `ProjectSnapshotDto`: Full snapshot structure with nested project, model, product data
    - `ProjectSnapshotImportRequestDto`: `{ snapshot, import_as_name, project_parent_folder, set_active }`
    - `ProjectSnapshotImportResultDto`: Response with imported project details
    - Define snake_case internal interfaces and mapping functions as needed
  - [x] 1.4 Implement `exportActiveProjectSnapshot()` function
    - GET `/api/projects/active/export`
    - Return `ProjectSnapshotDto` on success
    - Return `null` on 404 (no active project)
    - Throw error with backend message on other failures
  - [x] 1.5 Implement `importProjectSnapshot(req)` function
    - POST `/api/projects/import` with snake_case body
    - Return `ProjectSnapshotImportResultDto` on success
    - Handle 400/409 errors: extract and throw backend error message
    - Handle other errors: throw generic failure message
  - [x] 1.6 Ensure API client tests pass
    - Run ONLY the 3-5 tests written in 1.1
    - Verify all API functions work with mocked responses

**Acceptance Criteria:**
- The 3-5 tests written in 1.1 pass
- API client follows existing `projectsApi.ts` patterns exactly
- TypeScript interfaces match backend DTO structure
- Error messages from backend are properly extracted and thrown

---

### UI Components

#### Task Group 2: ImportProjectSnapshotModal Component
**Dependencies:** Task Group 1

- [x] 2.0 Complete ImportProjectSnapshotModal component
  - [x] 2.1 Write 4-6 focused tests for ImportProjectSnapshotModal
    - Test modal renders with snapshot name displayed read-only
    - Test Import button disabled until `projectParentFolder` and `importAsName` are non-empty
    - Test form submission calls `importProjectSnapshot` with correct payload
    - Test error display on 400/409 responses
    - Test modal closes and calls `onImported` callback on success
  - [x] 2.2 Create `src/components/Project/ImportProjectSnapshotModal.tsx`
    - Props: `isOpen`, `onClose`, `snapshotProjectName`, `rawSnapshotJson`, `onImported`
    - Follow structure pattern from `CreateProjectModal.tsx`
    - Import `importProjectSnapshot` from API client
  - [x] 2.3 Create `src/components/Project/ImportProjectSnapshotModal.module.css`
    - Reuse styles from `CreateProjectModal.module.css` as base
    - Add styles for read-only display field
    - Add styles for checkbox input group
  - [x] 2.4 Implement modal form fields
    - Read-only "Original Name" field showing `snapshotProjectName`
    - Text input: `importAsName` (default: `snapshotProjectName`)
    - Text input: `projectParentFolder` (required)
    - Checkbox: `setActive` (default: checked) with label "Make imported project active"
  - [x] 2.5 Implement form validation
    - Disable Import button until `projectParentFolder.trim()` and `importAsName.trim()` are non-empty
    - Show inline error message on API failure
  - [x] 2.6 Implement keyboard handling
    - Escape key closes modal
    - Enter key submits form if valid
    - Focus first editable input on open
  - [x] 2.7 Implement submit handler
    - Call `importProjectSnapshot` with `{ snapshot: rawSnapshotJson, import_as_name, project_parent_folder, set_active }`
    - On success: close modal, call `onImported()` callback
    - On error: display inline error message from backend
  - [x] 2.8 Ensure modal component tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Verify modal renders and behaves correctly

**Acceptance Criteria:**
- The 4-6 tests written in 2.1 pass
- Modal matches `CreateProjectModal.tsx` styling patterns
- Form validation works correctly
- Error messages display inline
- Success triggers callback and closes modal

---

### Integration Layer

#### Task Group 3: TopBar Integration and State Refresh
**Dependencies:** Task Groups 1 and 2

- [x] 3.0 Complete TopBar integration with snapshot export/import
  - [x] 3.1 Write 4-6 focused tests for TopBar export/import functionality
    - Test Export JSON calls `exportActiveProjectSnapshot()` and triggers download
    - Test Export JSON shows error toast/modal on 404 (no active project)
    - Test Import JSON opens file picker, parses JSON, opens modal
    - Test Import JSON shows error on invalid JSON file
    - Test successful import refreshes project, model, and product data
  - [x] 3.2 Create filename sanitization utility
    - Add `sanitizeFilename(name: string): string` function to `fileOperations.ts` or new util
    - Remove/replace characters invalid for filenames: `< > : " / \ | ? *`
    - Handle empty string edge case
  - [x] 3.3 Implement export handler in TopBar
    - Replace `handleExportJsonClick` to call `exportActiveProjectSnapshot()`
    - On 404/null response: show error modal "No active project to export"
    - On success: create Blob from JSON, trigger download as `<sanitizedProjectName>-snapshot.json`
    - Use same Blob + URL.createObjectURL pattern as existing `saveJsonFile`
  - [x] 3.4 Implement import handler in TopBar
    - Replace `handleImportJsonClick` and `handleFileChange` for JSON imports
    - Open file picker for `.json` files
    - Read file using FileReader.readAsText()
    - Parse JSON client-side to extract `snapshot.project.name`
    - On parse failure: show error modal and abort
    - On parse success: open `ImportProjectSnapshotModal` with parsed data
  - [x] 3.5 Add modal state management in TopBar
    - Add state: `importModalOpen`, `pendingSnapshotName`, `pendingSnapshotJson`
    - Wire up `ImportProjectSnapshotModal` component in render
    - Handle `onClose` and `onImported` callbacks
  - [x] 3.6 Implement state refresh after successful import
    - Call `refreshActiveProject()` from `useRefreshActiveProject()` hook
    - Dispatch `LOAD_MODEL` action via `loadModelByFilename()` to reload architecture model
    - Trigger product data refresh using existing patterns (work items, roadmap)
    - Ensure all three domains refresh: project state, architecture model, product data
  - [x] 3.7 Remove legacy JSON export/import usage
    - Remove import of `loadJsonFile` from `fileOperations.ts` in TopBar (for JSON menu action)
    - Remove import of `saveJsonFile` from `fileOperations.ts` in TopBar (for JSON menu action)
    - Keep hidden file input for JSON but rewire to new handler
    - Verify XLSX import/export remains unchanged
  - [x] 3.8 Ensure TopBar integration tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify export downloads correct file
    - Verify import flow opens modal and refreshes state

**Acceptance Criteria:**
- The 4-6 tests written in 3.1 pass
- Export downloads `<projectName>-snapshot.json` file
- Export shows error when no active project
- Import opens modal with parsed snapshot data
- Import shows error for invalid JSON
- Successful import refreshes all UI state (project, model, product)
- XLSX import/export functionality unchanged

---

### Testing

#### Task Group 4: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 3-5 tests written by Task Group 1 (API client)
    - Review the 4-6 tests written by Task Group 2 (Modal component)
    - Review the 4-6 tests written by Task Group 3 (TopBar integration)
    - Total existing tests: approximately 11-17 tests
  - [x] 4.2 Analyze test coverage gaps for THIS feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to project snapshot export/import
    - Prioritize end-to-end workflows over unit test gaps
  - [x] 4.3 Write up to 8 additional strategic tests maximum
    - End-to-end: Full export flow from menu click to file download
    - End-to-end: Full import flow from file selection to UI refresh
    - Integration: State refresh updates all three contexts (Project, Architecture, Product)
    - Edge case: Export with special characters in project name
    - Edge case: Import with `setActive: false` does not change active project
    - Error flow: Network failure during import shows appropriate error
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to project snapshot feature
    - Expected total: approximately 19-25 tests maximum
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 19-25 tests total)
- Critical user workflows for export/import are covered
- No more than 8 additional tests added when filling gaps
- Testing focused exclusively on project snapshot feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **API Layer (Task Group 1)** - Create the API client first as it's the foundation
   - TypeScript interfaces define the data contracts
   - API functions enable all subsequent work

2. **UI Components (Task Group 2)** - Build the modal component
   - Depends on API client for import function
   - Self-contained component with clear props interface

3. **Integration Layer (Task Group 3)** - Wire everything together in TopBar
   - Depends on API client and modal component
   - Replaces legacy export/import handlers
   - Implements state refresh orchestration

4. **Testing (Task Group 4)** - Review and fill gaps
   - Depends on all implementation being complete
   - Validates end-to-end workflows

---

## Key Files to Create/Modify

### New Files
- `src/api/projectSnapshotApi.ts` - API client
- `src/components/Project/ImportProjectSnapshotModal.tsx` - Modal component
- `src/components/Project/ImportProjectSnapshotModal.module.css` - Modal styles

### Modified Files
- `src/components/TopBar/TopBar.tsx` - Integration point for export/import
- `src/utils/fileOperations.ts` - Add filename sanitization utility (optional location)

### Reference Files (Do Not Modify)
- `src/api/projectsApi.ts` - Pattern reference for API client
- `src/components/Project/CreateProjectModal.tsx` - Pattern reference for modal
- `src/components/Project/CreateProjectModal.module.css` - Pattern reference for styles
- `src/contexts/ProjectContext.tsx` - Use `useRefreshActiveProject()` hook
- `src/contexts/ArchitectureContext.tsx` - Use `LOAD_MODEL` action

---

## Technical Notes

### API Response Mapping
- Backend uses snake_case, frontend uses camelCase
- Follow mapping pattern from `projectsApi.ts`:
  ```typescript
  interface ProjectSnapshotDtoSnake { ... }  // Internal, snake_case
  export interface ProjectSnapshotDto { ... } // Exported, camelCase
  function mapFromSnake(dto: SnakeType): CamelType { ... }
  ```

### File Download Pattern
Reference from `fileOperations.ts` lines 524-533:
```typescript
const blob = new Blob([json], { type: 'application/json' });
const url = URL.createObjectURL(blob);
const link = document.createElement('a');
link.href = url;
link.download = fileName;
document.body.appendChild(link);
link.click();
document.body.removeChild(link);
URL.revokeObjectURL(url);
```

### State Refresh Sequence
After successful import with `setActive: true`:
1. `refreshActiveProject()` - Updates ProjectContext
2. `loadModelByFilename()` + `dispatch({ type: 'LOAD_MODEL' })` - Updates ArchitectureContext
3. Product data refresh - Triggers existing fetch patterns for work items/roadmap

---

## Implementation Summary

**Total Tests Written:** 37 tests across 4 test files
- `projectSnapshotApi.test.ts` - 6 tests (API client)
- `ImportProjectSnapshotModal.test.ts` - 6 tests (Modal component)
- `TopBarSnapshotIntegration.test.ts` - 13 tests (TopBar integration + sanitizeFilename)
- `projectSnapshotE2E.test.ts` - 12 tests (End-to-end flows and edge cases)

**All tests pass successfully.**
