# Task Breakdown: Auto-Save After Create Project

## Overview
Total Tasks: 12

This is a small, focused frontend feature that adds auto-save behavior after project creation. The implementation requires extracting the existing save logic from TopBar into a reusable utility, then invoking it from CreateProjectModal after successful project creation.

## Task List

### Utility Extraction

#### Task Group 1: Extract Save Logic to Reusable Utility
**Dependencies:** None

- [x] 1.0 Complete save utility extraction
  - [x] 1.1 Write 3-4 focused tests for the extracted save utility
    - Test that `saveModelToBackend()` calls prepare, validate, sanitize in correct order
    - Test that successful save returns success result with filename
    - Test that validation errors return failure result with error details
    - Test that API errors return failure result with error message
  - [x] 1.2 Create `saveUtils.ts` utility file
    - File path: `frontend/src/utils/saveUtils.ts`
    - Export `saveModelToBackend(model, filename, dispatch)` function
    - Return a result object: `{ success: boolean; error?: string; validationErrors?: ValidationError[] }`
  - [x] 1.3 Extract save logic from TopBar.handleSaveToBackend (lines 92-124)
    - Move `prepareModelForSave()` call
    - Move `validateModel()` call
    - Move `sanitizeModelForBackendSave()` call
    - Move `saveModelByFilename()` API call
    - Move `dispatch({ type: 'LOAD_MODEL', ... })` call
    - Return structured result instead of managing UI state
  - [x] 1.4 Refactor TopBar to use new utility
    - Import `saveModelToBackend` from `saveUtils.ts`
    - Call utility in `handleSaveToBackend()`
    - Handle result to show notifications/modals (preserve existing UI behavior)
  - [x] 1.5 Ensure utility tests pass
    - Run ONLY the 3-4 tests written in 1.1
    - Verify extraction does not break existing save flow

**Acceptance Criteria:**
- The 3-4 tests written in 1.1 pass
- `saveModelToBackend()` function is exported from `saveUtils.ts`
- TopBar save functionality works identically to before refactoring
- Utility returns structured result suitable for different callers

**Files Modified:**
- `frontend/src/utils/saveUtils.ts` (new file)
- `frontend/src/components/TopBar/TopBar.tsx`

---

### Feature Implementation

#### Task Group 2: Integrate Auto-Save into CreateProjectModal
**Dependencies:** Task Group 1

- [x] 2.0 Complete auto-save integration
  - [x] 2.1 Write 4-5 focused tests for auto-save behavior
    - Test that save is called after successful project creation with project name as filename
    - Test that save occurs after `refreshActiveProject()` completes
    - Test that modal closes regardless of save success/failure
    - Test that save failure shows non-blocking notification
    - Test that project creation failure does NOT trigger save
  - [x] 2.2 Add ArchitectureContext access to CreateProjectModal
    - Import `useArchitectureContext` hook
    - Destructure `state` and `dispatch` from context
    - Ensure component has access to current model state
  - [x] 2.3 Implement auto-save call in handleCreate
    - After `refreshActiveProject()` completes, call `saveModelToBackend(state.model, projectName.trim(), dispatch)`
    - Use the created project's `name` property as the filename
    - Do NOT await save completion before closing modal (non-blocking)
  - [x] 2.4 Implement error handling for save failure
    - Add notification state (or use existing global notification pattern)
    - On save failure, display: "Project created, but initial save failed. You can retry via File > Save."
    - Close modal regardless of save outcome (project creation succeeded)
    - Do not show validation error modal; treat as soft failure
  - [x] 2.5 Ensure auto-save integration tests pass
    - Run ONLY the 4-5 tests written in 2.1
    - Verify project creation + auto-save flow works end-to-end

**Acceptance Criteria:**
- The 4-5 tests written in 2.1 pass
- After creating project "sdd-test", top-right filename displays "sdd-test" immediately
- Modal closes promptly after project creation (save runs in background)
- Save failure shows non-blocking notification without reverting project

**Files Modified:**
- `frontend/src/components/Project/CreateProjectModal.tsx`

---

### Testing and Verification

#### Task Group 3: Integration Testing and Regression Check
**Dependencies:** Task Groups 1-2

- [x] 3.0 Complete integration testing
  - [x] 3.1 Review tests from Task Groups 1-2
    - Review the 3-4 tests from save utility (Task 1.1)
    - Review the 4-5 tests from auto-save integration (Task 2.1)
    - Total existing tests: approximately 7-9 tests
  - [x] 3.2 Analyze test coverage for critical gaps
    - Verify end-to-end flow: Create Project -> Auto-Save -> Filename Display Update
    - Check existing File -> Save behavior is not regressed
    - Check existing File -> Open behavior is not regressed
  - [x] 3.3 Write up to 3 additional integration tests if needed
    - Test File -> Save after auto-save is idempotent (same file, no error)
    - Test filename appears in "Save Model As" available files list after auto-save
    - Test manual save workflow still functions correctly after refactoring
  - [x] 3.4 Run all feature-specific tests
    - Run tests from 1.1, 2.1, and 3.3 (approximately 10-12 tests total)
    - Verify all acceptance criteria are met
    - Do NOT run entire application test suite

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 10-12 tests total)
- No regression to File -> Save functionality
- No regression to File -> Open functionality
- Filename display updates correctly after project creation

**Files Modified:**
- `frontend/src/__tests__/autoSaveOnProjectCreate.test.ts` (new file, if needed)

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Extract Save Logic** - Create reusable utility from TopBar
2. **Task Group 2: Integrate Auto-Save** - Wire CreateProjectModal to use the utility
3. **Task Group 3: Integration Testing** - Verify end-to-end behavior and check for regressions

## Summary of Files to Modify

| File | Change Type | Description |
|------|-------------|-------------|
| `frontend/src/utils/saveUtils.ts` | New | Extracted save utility function |
| `frontend/src/components/TopBar/TopBar.tsx` | Modify | Refactor to use saveUtils |
| `frontend/src/components/Project/CreateProjectModal.tsx` | Modify | Add auto-save after project creation |
| `frontend/src/__tests__/autoSaveOnProjectCreate.test.ts` | New | Integration tests (if needed) |

## Key Implementation Notes

1. **Non-blocking save**: The auto-save should not block the modal from closing. Consider using `.then()/.catch()` pattern or fire-and-forget with error handling.

2. **State access**: CreateProjectModal will need access to ArchitectureContext for `state.model` and `dispatch`.

3. **Notification pattern**: Reuse the existing notification toast pattern from TopBar (lines 117-119) for save success, and a similar pattern for save failure.

4. **Validation soft failure**: If `validateModel()` returns errors during auto-save, treat as a soft failure - show notification but don't block project creation.
