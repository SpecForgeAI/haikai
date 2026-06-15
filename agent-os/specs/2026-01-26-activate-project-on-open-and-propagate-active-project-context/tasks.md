# Task Breakdown: Activate Project on Open and Propagate Active Project Context

## Overview
Total Tasks: 26 (across 4 task groups)

This feature fixes the "No active project" error that occurs when a user opens a project from the ModelFileDialog. The solution implements an "activate-first" flow that calls the activation endpoint before loading the model, ensuring the active project state is available to all downstream features.

## Task List

### Frontend - Types and Interfaces

#### Task Group 1: ModelFileDialog OpenProjectResult Interface
**Dependencies:** None

- [x] 1.0 Complete ModelFileDialog interface changes
  - [x] 1.1 Write 4 focused tests for OpenProjectResult functionality
    - Test that open mode calls onConfirm with `{ filename, projectId }` object
    - Test that projectId matches the selected project from the list
    - Test that saveAs mode still receives SaveAsResult (backward compatibility)
    - Test type guard correctly identifies OpenProjectResult vs SaveAsResult
  - [x] 1.2 Create OpenProjectResult interface in ModelFileDialog.tsx
    - Add JSDoc comment referencing Spec 2026-01-26
    - Fields: `filename: string`, `projectId: string`
    - Export the interface for use in TopBar.tsx
  - [x] 1.3 Update ModelFileDialogProps onConfirm signature
    - Change from `(result: string | SaveAsResult) => void`
    - To `(result: OpenProjectResult | SaveAsResult) => void`
    - Add JSDoc explaining the union type behavior per mode
  - [x] 1.4 Update handleSaveClick to pass OpenProjectResult in open mode
    - Create OpenProjectResult object with filename and selectedProjectId
    - Verify selectedProjectId is already tracked in component state
    - Maintain existing SaveAsResult behavior for saveAs mode
  - [x] 1.5 Ensure ModelFileDialog tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify both open mode and saveAs mode work correctly

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- OpenProjectResult interface is exported and typed correctly
- Open mode passes `{ filename, projectId }` to onConfirm
- SaveAs mode continues to pass SaveAsResult (no regression)

---

### Frontend - Context Layer

#### Task Group 2: ProjectContext setActiveProject Method
**Dependencies:** None (can run in parallel with Task Group 1)

- [x] 2.0 Complete ProjectContext state update method
  - [x] 2.1 Write 5 focused tests for setActiveProject functionality
    - Test that setActiveProject updates the activeProject state
    - Test that setActiveProject sets source to 'db' when includeDatabase=true
    - Test that setActiveProject sets source to 'session' when includeDatabase=false
    - Test that useSetActiveProject hook returns the function
    - Test that useSetActiveProject throws when used outside ProjectProvider
  - [x] 2.2 Add setActiveProject to ProjectContextType interface
    - Add JSDoc comment referencing Spec 2026-01-26
    - Signature: `setActiveProject: (project: ProjectDto) => void`
    - Document that this is used after POST /activate to avoid extra GET
  - [x] 2.3 Implement setActiveProject in ProjectProvider
    - Use useCallback for stable reference
    - Update activeProject state with provided project
    - Set activeProjectSource based on includeDatabase flag
  - [x] 2.4 Create useSetActiveProject hook
    - Follow pattern of existing hooks (useRefreshActiveProject, etc.)
    - Include error handling for usage outside provider
    - Add JSDoc documentation
  - [x] 2.5 Update refreshActiveProject for File Mode resilience
    - Wrap File Mode session fetch in try-catch
    - Log debug message on 404 (expected when no project imported)
    - Preserve current state on error instead of clearing
  - [x] 2.6 Ensure ProjectContext tests pass
    - Run ONLY the 5 tests written in 2.1
    - Verify state updates work correctly in both DB and File modes

**Acceptance Criteria:**
- The 5 tests written in 2.1 pass
- setActiveProject updates state correctly
- useSetActiveProject hook is exported and functional
- File Mode gracefully handles missing session project

---

### Frontend - Integration Layer

#### Task Group 3: TopBar Activate-First Flow
**Dependencies:** Task Group 1, Task Group 2

- [x] 3.0 Complete TopBar handleOpenFromBackend rewrite
  - [x] 3.1 Write 6 focused tests for activate-first flow
    - Test that activateProject is called BEFORE loadModelByFilename (DB mode)
    - Test that ProjectContext is updated from activation response
    - Test that activation failure shows error and prevents model load
    - Test that File Mode sets project without backend call
    - Test that File Mode constructs minimal ProjectDto correctly
    - Test that dialog closes on successful open
  - [x] 3.2 Add new imports to TopBar.tsx
    - Import useSetActiveProject from ProjectContext
    - Import OpenProjectResult from ModelFileDialog
    - Import ProjectDto from projectsApi (for File Mode construction)
    - Verify activateProject import from projectsApi exists
  - [x] 3.3 Get new hooks in component body
    - Call useSetActiveProject() to get setter function
    - Verify useIncludeDatabase() is available for File Mode check
  - [x] 3.4 Rewrite handleOpenFromBackend with activation-first flow
    - Add type guard to verify OpenProjectResult (has projectId)
    - DB Mode: Call activateProject(projectId) first
    - DB Mode: Update ProjectContext from POST response
    - File Mode: Construct minimal ProjectDto with available data
    - File Mode: Call setActiveProject directly (no backend)
    - Then load model via loadModelByFilename
    - Dispatch LOAD_MODEL action
    - Close dialog on success
  - [x] 3.5 Implement error handling
    - Catch activation errors and show error modal
    - Do NOT proceed to model load on activation failure
    - Allow model load failure after successful activation (acceptable state)
    - Add descriptive error messages
  - [x] 3.6 Update ModelFileDialog component usage
    - Verify onConfirm handler accepts new result type
    - No functional change needed if types align
  - [x] 3.7 Ensure TopBar tests pass
    - Run ONLY the 6 tests written in 3.1
    - Verify activation-first sequence is correct

**Acceptance Criteria:**
- The 6 tests written in 3.1 pass
- activateProject is called before loadModelByFilename in DB mode
- File Mode works without backend activation call
- Error handling prevents model load on activation failure
- Active project is available immediately after open

---

### Testing

#### Task Group 4: Test Review and Integration Coverage
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 4 tests from ModelFileDialog (Task 1.1)
    - Review the 5 tests from ProjectContext (Task 2.1)
    - Review the 6 tests from TopBar (Task 3.1)
    - Total existing tests: 15 tests
  - [x] 4.2 Analyze test coverage gaps for this feature only
    - Identify integration points between ModelFileDialog -> TopBar -> ProjectContext
    - Check for end-to-end flow coverage
    - Verify backward compatibility with SaveAs mode is tested
    - Check ImplementationAssistantPanel receives projectParentFolder after open
  - [x] 4.3 Write up to 6 additional integration tests if needed
    - Integration: Open project flow updates activeProject before model loads
    - Integration: ImplementationAssistantPanel has projectParentFolder after open
    - Integration: Error during activation shows error and blocks model load
    - Integration: File Mode open flow works without backend calls
    - Backward compat: CreateProjectModal still works (no changes needed)
    - Backward compat: SaveAs mode unchanged by OpenProjectResult changes
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to this spec (from 1.1, 2.1, 3.1, and 4.3)
    - Expected total: approximately 15-21 tests
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 15-21 tests total)
- Integration flow from dialog selection to active project propagation is covered
- Backward compatibility with existing flows is verified
- No more than 6 additional tests added in gap analysis

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1 and Task Group 2** (in parallel)
   - ModelFileDialog interface changes (no dependencies)
   - ProjectContext setActiveProject method (no dependencies)

2. **Task Group 3** (after Groups 1 and 2)
   - TopBar activate-first flow (depends on new interface and context method)

3. **Task Group 4** (after Group 3)
   - Test review and integration coverage (validates complete feature)

---

## Files Changed

| File | Change Type | Task Group |
|------|-------------|------------|
| `frontend/src/components/file/ModelFileDialog.tsx` | Modified | 1 |
| `frontend/src/contexts/ProjectContext.tsx` | Modified | 2 |
| `frontend/src/components/TopBar/TopBar.tsx` | Modified | 3 |

## New Test Files

| File | Task Group |
|------|------------|
| `frontend/src/__tests__/ModelFileDialog.openProjectResult.test.tsx` | 1 |
| `frontend/src/__tests__/ProjectContext.setActiveProject.test.tsx` | 2 |
| `frontend/src/__tests__/ProjectContext.fileMode.test.tsx` | 2 |
| `frontend/src/__tests__/TopBar.activateOnOpen.test.tsx` | 3 |
| `frontend/src/__tests__/activateOnOpen.integration.test.tsx` | 4 |

---

## Key Implementation Notes

1. **Existing APIs:** The `activateProject` function in `projectsApi.ts` and `POST /api/projects/{id}/activate` endpoint already exist - no backend changes required.

2. **File Mode:** When `includeDatabase=false`, create a minimal ProjectDto in the frontend without any backend calls.

3. **Error Flow:** Activation failure must block model loading to prevent the "No active project" error from propagating.

4. **Type Safety:** Use type guards to distinguish OpenProjectResult from SaveAsResult in handlers.

5. **Backward Compatibility:** SaveAs mode, CreateProjectModal, and ImportProjectSnapshotModal are explicitly excluded from changes.

---

## Implementation Summary

All 4 task groups have been completed:

**Task Group 1 (ModelFileDialog):**
- Created `OpenProjectResult` interface with `filename` and `projectId` fields
- Created `isOpenProjectResult` type guard function
- Updated `onConfirm` prop to accept `OpenProjectResult | SaveAsResult` union type
- Updated `handleSaveClick` to build and pass `OpenProjectResult` in open mode
- 10 tests written and passing

**Task Group 2 (ProjectContext):**
- Added `setActiveProject` method to `ProjectContextType` interface
- Implemented `setActiveProject` in `ProjectProvider` using `useCallback`
- Created `useSetActiveProject()` hook following existing patterns
- Updated `refreshActiveProject` for File Mode graceful 404 handling
- 8 tests written and passing (5 + 3 file mode tests)

**Task Group 3 (TopBar):**
- Added imports for `useSetActiveProject`, `OpenProjectResult`, `isOpenProjectResult`, `activateProject`, `ProjectDto`
- Rewrote `handleOpenFromBackend` with activation-first flow
- DB mode: Calls `activateProject(projectId)` BEFORE `loadModelByFilename`
- File mode: Constructs minimal `ProjectDto` and sets state directly (no backend call)
- Error handling prevents model load on activation failure
- 6 tests written and passing

**Task Group 4 (Integration):**
- Reviewed all tests from Groups 1-3
- Added integration test file with 6 end-to-end flow tests
- Total: 30 tests passing

**Test Execution:**
```
npm test -- "openProjectResult" "setActiveProject" "fileMode" "activateOnOpen" --run
Test Files  5 passed (5)
Tests       30 passed (30)
```
