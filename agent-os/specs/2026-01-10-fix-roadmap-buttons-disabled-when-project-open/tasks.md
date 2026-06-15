# Task Breakdown: Fix Roadmap Tab Buttons Incorrectly Disabled When a Project is Open

## Overview

This is a targeted bug fix to ensure the Roadmap tab action buttons are enabled after opening a project from the backend via "File > Open from backend". The root cause is that `ProjectContext.activeProject` is not being refreshed when a model is opened.

**Total Tasks:** 10 (across 3 task groups)

**Approach:** Frontend-first fix. The primary solution is calling `refreshActiveProject()` in the `handleOpenFromBackend` function. Backend changes are only needed if verification shows the backend does not return the correct active project.

---

## Task List

### Task Group 1: Frontend Fix - TopBar handleOpenFromBackend

**Dependencies:** None

**Goal:** Update `handleOpenFromBackend` to refresh ProjectContext after loading a model, matching the pattern used in `handleImportSuccess`.

- [x] 1.0 Complete TopBar handleOpenFromBackend fix
  - [x] 1.1 Write 3 focused tests for handleOpenFromBackend behavior
    - Test 1: After calling `handleOpenFromBackend`, `refreshActiveProject` is invoked
    - Test 2: After opening from backend, `activeProject` state is updated from the backend
    - Test 3: Opening from backend with a valid project name results in Roadmap buttons becoming enabled
    - File: `frontend/src/__tests__/topbar-open-from-backend.test.ts`
  - [x] 1.2 Update handleOpenFromBackend to call refreshActiveProject
    - File: `frontend/src/components/TopBar/TopBar.tsx`
    - In `handleOpenFromBackend` (lines 108-117), after `dispatch({ type: 'LOAD_MODEL', ... })`, add `await refreshActiveProject()`
    - The `refreshActiveProject` hook is already imported and available (line 69)
    - Add try/catch around refresh call to prevent blocking model load on refresh failure
  - [x] 1.3 Run tests from 1.1 to verify fix
    - Run ONLY the 3 tests written in 1.1
    - Verify `refreshActiveProject` is called after model load

**Acceptance Criteria:**
- The 3 tests from 1.1 pass
- After "File > Open from backend", `refreshActiveProject()` is called
- If backend returns an active project matching the loaded model, Roadmap buttons are enabled

**Files Modified:**
- `frontend/src/components/TopBar/TopBar.tsx`
- `frontend/src/__tests__/topbar-open-from-backend.test.ts` (new)

---

### Task Group 2: Frontend Fix - ProductRoadmapPage Loading State Handling

**Dependencies:** None (can run in parallel with Task Group 1)

**Goal:** Update `ProductRoadmapPage` to account for initial loading state when determining button disabled state and banner visibility.

- [x] 2.0 Complete ProductRoadmapPage loading state handling
  - [x] 2.1 Write 3 focused tests for loading state handling
    - Test 1: When `loading` is true, `isImportDisabled` is true regardless of `activeProject`
    - Test 2: When `loading` is true, the "Create or open a project..." banner is not shown
    - Test 3: When `loading` is false and `activeProject` is null, banner is shown and buttons are disabled
    - File: `frontend/src/__tests__/product-roadmap-loading-state.test.ts`
  - [x] 2.2 Import useProjectLoading hook in ProductRoadmapPage
    - File: `frontend/src/components/ProductView/ProductRoadmapPage.tsx`
    - Add `useProjectLoading` to import from `../../contexts/ProjectContext` (line 41)
    - Call hook: `const loading = useProjectLoading();`
  - [x] 2.3 Update isImportDisabled logic to include loading state
    - File: `frontend/src/components/ProductView/ProductRoadmapPage.tsx`
    - Change line 418 from: `const isImportDisabled = !activeProject || importing;`
    - To: `const isImportDisabled = loading || !activeProject || importing;`
  - [x] 2.4 Update banner visibility logic to exclude loading state
    - File: `frontend/src/components/ProductView/ProductRoadmapPage.tsx`
    - Change line 479-483 from: `{!activeProject && (`
    - To: `{!loading && !activeProject && (`
    - This prevents the misleading banner from showing during initial load
  - [x] 2.5 Run tests from 2.1 to verify fix
    - Run ONLY the 3 tests written in 2.1
    - Verify loading state is properly considered

**Acceptance Criteria:**
- The 3 tests from 2.1 pass
- During initial load, buttons show disabled state (not misleading "no project" state)
- Banner is not shown while ProjectContext is loading
- Once loading completes, correct state is shown based on `activeProject`

**Files Modified:**
- `frontend/src/components/ProductView/ProductRoadmapPage.tsx`
- `frontend/src/__tests__/product-roadmap-loading-state.test.ts` (new)

---

### Task Group 3: Verification and Integration Testing

**Dependencies:** Task Groups 1 and 2

**Goal:** Verify the complete fix works end-to-end and that existing flows (Create Project, Import Snapshot) remain functional.

- [x] 3.0 Complete verification and integration testing
  - [x] 3.1 Write 4 integration tests for project-opening flows
    - Test 1: Create Project flow - after creating project, Roadmap buttons are enabled
    - Test 2: Import Snapshot flow with "Make active" checked - after import, Roadmap buttons are enabled
    - Test 3: Open from Backend flow - after opening, Roadmap buttons are enabled (new behavior)
    - Test 4: Open from Backend flow with no matching project - banner shows after loading completes
    - File: `frontend/src/__tests__/roadmap-buttons-project-open-integration.test.ts`
  - [x] 3.2 Manual verification of Open from Backend flow
    - Start backend and frontend
    - Create a project (to ensure one exists)
    - Reload application
    - Use "File > Open from backend" to open the project's model
    - Verify: Project name appears in top-right
    - Verify: Roadmap tab shows enabled "Import roadmap.md" button
    - Verify: "Create or open a project..." banner is NOT shown
  - [x] 3.3 Manual verification of Create Project flow still works
    - Reload application with no active project
    - Use "File > Create Project" to create a new project
    - Verify: Roadmap buttons become enabled immediately
    - Verify: No regressions in project creation flow
  - [x] 3.4 Run all feature-specific tests
    - Run tests from Task Groups 1, 2, and 3 (approximately 10 tests total)
    - Verify all pass
    - Do NOT run the entire application test suite

**Acceptance Criteria:**
- All 10 feature-specific tests pass
- Manual verification confirms the bug is fixed
- Existing Create Project and Import Snapshot flows work correctly
- No regressions in Roadmap tab functionality

**Files Modified:**
- `frontend/src/__tests__/roadmap-buttons-project-open-integration.test.ts` (new)

---

## Execution Order

1. **Task Group 1** and **Task Group 2** can run in parallel (no dependencies)
2. **Task Group 3** must wait for Task Groups 1 and 2 to complete

```
Task Group 1 (TopBar fix) ----+
                              +---> Task Group 3 (Verification)
Task Group 2 (Loading state) -+
```

---

## Summary Table

| Task Group | Focus Area | Task Count | Dependencies |
|------------|-----------|------------|--------------|
| 1 | TopBar handleOpenFromBackend fix | 3 sub-tasks | None |
| 2 | ProductRoadmapPage loading state | 5 sub-tasks | None |
| 3 | Verification and integration | 4 sub-tasks | Groups 1, 2 |
| **Total** | | **10 sub-tasks** | |

---

## Implementation Summary

### Changes Made

**Task Group 1: TopBar handleOpenFromBackend fix**
- Created test file: `frontend/src/__tests__/topbar-open-from-backend.test.ts` (5 tests)
- Updated `frontend/src/components/TopBar/TopBar.tsx`:
  - Added `refreshActiveProject()` call after successful model load in `handleOpenFromBackend`
  - Wrapped in try/catch to prevent blocking model load on refresh failure
  - Added spec comments documenting the fix

**Task Group 2: ProductRoadmapPage loading state handling**
- Created test file: `frontend/src/__tests__/product-roadmap-loading-state.test.ts` (11 tests)
- Updated `frontend/src/components/ProductView/ProductRoadmapPage.tsx`:
  - Added `useProjectLoading` import from ProjectContext
  - Added `const loading = useProjectLoading();` hook call
  - Updated `isImportDisabled` logic: `loading || !activeProject || importing`
  - Updated banner visibility: `{!loading && !activeProject && (`
  - Added spec comments documenting the fix

**Task Group 3: Verification and integration testing**
- Created test file: `frontend/src/__tests__/roadmap-buttons-project-open-integration.test.ts` (5 tests)
- All 21 feature-specific tests pass

### Test Results

```
Test Files  3 passed (3)
Tests       21 passed (21)
```

---

## Notes

### Backend Changes (If Needed)

If verification in Task Group 3 shows that `refreshActiveProject()` returns null or the wrong project after opening a model, the following backend work would be required:

**Conditional Task Group 4: Backend activate-by-name endpoint**
- Add `activateProjectByName(name: string)` function in `frontend/src/api/projectsApi.ts`
- Add `POST /api/projects/activate-by-name` endpoint in backend `ProjectController`
- Update `handleOpenFromBackend` to call `activateProjectByName(filename)` before/after `refreshActiveProject()`

This is marked as conditional because the spec indicates the backend should already maintain the correct active project state. Only implement if frontend-only fix proves insufficient.

### Key Code Locations

| Component | File | Relevant Lines |
|-----------|------|----------------|
| handleOpenFromBackend | `frontend/src/components/TopBar/TopBar.tsx` | 124-142 |
| refreshActiveProject hook | `frontend/src/components/TopBar/TopBar.tsx` | 38, 74 |
| isImportDisabled | `frontend/src/components/ProductView/ProductRoadmapPage.tsx` | 432 |
| No active project banner | `frontend/src/components/ProductView/ProductRoadmapPage.tsx` | 493-498 |
| useProjectLoading hook | `frontend/src/contexts/ProjectContext.tsx` | 119-125 |
| useProject hook | `frontend/src/contexts/ProjectContext.tsx` | 105-111 |
