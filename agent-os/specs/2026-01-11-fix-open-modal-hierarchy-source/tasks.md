# Task Breakdown: Fix Open Modal Hierarchy Grouping by Sourcing Projects

## Overview

| Metric | Value |
|--------|-------|
| Total Task Groups | 3 |
| Total Tasks | 10 |
| Estimated Complexity | Low (Bugfix) |
| Primary Files Modified | 2 |
| Test Files Modified | 1 |

## Summary

This bugfix changes the Open modal's data source from `fetchModelFilenames()` (which lacks `projectHierarchy`) to `listProjects()` (which includes real `projectHierarchy` values). This aligns the Open modal behavior with the Delete modal, enabling proper hierarchy grouping.

## Files to Modify

| File | Change Type | Description |
|------|-------------|-------------|
| `frontend/src/components/file/ModelFileDialog.tsx` | Modify | Switch data source from `fetchModelFilenames()` to `listProjects()` for "open" mode |
| `frontend/src/__tests__/ModelFileDialogOpenMode.test.ts` | Modify | Update tests to verify hierarchy grouping with real `projectHierarchy` values |
| `frontend/src/utils/modelFileMapping.ts` | Potentially Remove | Remove if no longer needed by any other code |

## Task List

### Task Group 1: Test Updates (Test-First Approach)

**Dependencies:** None

- [x] 1.0 Complete test updates for Open modal hierarchy fix
  - [x] 1.1 Write 4 focused tests for Open modal with `listProjects()` data source
    - Test: Open modal displays project with `projectHierarchy: "Rivvy"` under "Rivvy" section header
    - Test: Open modal displays project with `projectHierarchy: null` under "(No hierarchy)" section
    - Test: Open modal correctly groups multiple projects by their hierarchy values
    - Test: Selection and OK button work correctly with `ProjectDto[]` data (project `name` passed to `onConfirm`)
  - [x] 1.2 Update mock data in tests to use `ProjectDto[]` with real `projectHierarchy` values
    - Replace `ModelFileSummaryDto[]` mock with `ProjectDto[]` mock
    - Include projects with various hierarchy values (null, "Rivvy", "Enterprise", etc.)
    - Ensure mock data matches what `listProjects()` returns
  - [x] 1.3 Remove or update tests that reference `mapModelFilesToProjectDtos`
    - Identify tests using the mapping utility
    - Remove tests for mapping function (no longer needed for Open modal)
    - Keep any tests that might still be relevant for "saveAs" mode if applicable
  - [x] 1.4 Verify updated tests compile (may initially fail until implementation is done)
    - Run TypeScript check on test file
    - Confirm test structure is correct

**Acceptance Criteria:**
- Test file compiles without TypeScript errors
- Tests are structured to verify hierarchy grouping behavior
- Mock data uses `ProjectDto[]` with real `projectHierarchy` values
- Tests will pass after Task Group 2 implementation

**File:** `frontend/src/__tests__/ModelFileDialogOpenMode.test.ts`

---

### Task Group 2: Implementation - Switch Data Source

**Dependencies:** Task Group 1 (tests written)

- [x] 2.0 Complete Open modal data source switch
  - [x] 2.1 Update imports in `ModelFileDialog.tsx`
    - Add import: `listProjects, ProjectDto` from `../../api/projectsApi`
    - Keep import: `fetchModelFilenames, ModelFileSummaryDto` from `../../api/modelApi` (needed for "saveAs" mode)
    - Remove import: `mapModelFilesToProjectDtos` from `../../utils/modelFileMapping`
  - [x] 2.2 Add state for projects data in "open" mode
    - Add state: `const [projects, setProjects] = useState<ProjectDto[]>([]);`
    - Keep existing `files` state for "saveAs" mode
  - [x] 2.3 Update `loadFiles` function to be mode-aware
    - If `mode === 'open'`: call `listProjects()` and set `projects` state
    - If `mode === 'saveAs'`: call `fetchModelFilenames()` and set `files` state (existing behavior)
    - Handle loading and error states for both paths
  - [x] 2.4 Update `handleProjectClick` to work with `ProjectDto[]`
    - For "open" mode: find project by `id` in `projects` array
    - Update `selectedProjectId` and derive `selectedFilename` from project `name`
    - Ensure `onConfirm` receives project `name` (which serves as the file identifier)
  - [x] 2.5 Update GroupedProjectList props in render
    - Pass `projects` directly instead of `mapModelFilesToProjectDtos(files)`
    - No mapping needed since `ProjectDto[]` already has `projectHierarchy`
  - [x] 2.6 Run tests written in Task Group 1 to verify implementation
    - Execute: `npm test -- ModelFileDialogOpenMode`
    - All 4 hierarchy tests should pass
    - Existing tests should still pass

**Acceptance Criteria:**
- "Open" mode uses `listProjects()` and displays proper hierarchy grouping
- "SaveAs" mode continues using `fetchModelFilenames()` with flat list (no regression)
- Selection works correctly and passes project `name` to `onConfirm`
- All tests from Task Group 1 pass

**File:** `frontend/src/components/file/ModelFileDialog.tsx`

---

### Task Group 3: Cleanup and Verification

**Dependencies:** Task Group 2

- [x] 3.0 Complete cleanup and final verification
  - [x] 3.1 Analyze usage of `modelFileMapping.ts`
    - Search codebase for imports of `mapModelFilesToProjectDtos`
    - Search codebase for imports of `mapModelFileToProjectDto`
    - Determine if utility is still used anywhere
  - [x] 3.2 Remove or keep `modelFileMapping.ts` based on analysis
    - If no other usages: delete `frontend/src/utils/modelFileMapping.ts`
    - If still used elsewhere: keep file, only remove unused functions
  - [x] 3.3 Run full test suite for affected components
    - Execute: `npm test -- ModelFileDialog`
    - Execute: `npm test -- GroupedProjectList`
    - Verify no regressions in related functionality
  - [x] 3.4 Manual verification of fix
    - Open the application
    - Create projects with different `projectHierarchy` values (via UI or database)
    - Open the "Open Model" dialog
    - Verify projects appear under correct hierarchy section headers
    - Verify "(No hierarchy)" section contains projects with null/blank hierarchy
    - Compare with Delete modal to ensure consistent behavior

**Acceptance Criteria:**
- No unused code remains in codebase
- All related tests pass
- Manual testing confirms hierarchy grouping works correctly
- Open modal visually matches Delete modal organization

**File:** `frontend/src/utils/modelFileMapping.ts` (deleted - no longer needed)

---

## Execution Order

```
Task Group 1: Test Updates          [Test-First]     COMPLETED
       |
       v
Task Group 2: Implementation        [Core Fix]       COMPLETED
       |
       v
Task Group 3: Cleanup               [Verification]   COMPLETED
```

**Recommended Sequence:**
1. **Task Group 1** - Write/update tests first (TDD approach)
2. **Task Group 2** - Implement the fix to make tests pass
3. **Task Group 3** - Clean up unused code and verify manually

## Reference Implementation

The Delete modal (`DeleteProjectModal.tsx`) serves as the reference implementation:

```typescript
// Pattern to follow from DeleteProjectModal.tsx (lines 16, 44, 62)
import { listProjects, ProjectDto } from '../../api/projectsApi';

const [projects, setProjects] = useState<ProjectDto[]>([]);

const loadProjects = useCallback(async () => {
  setIsLoading(true);
  setLoadError(null);
  try {
    const projectList = await listProjects();
    setProjects(projectList);
  } catch (err) {
    setLoadError(err instanceof Error ? err.message : 'Failed to load projects');
  } finally {
    setIsLoading(false);
  }
}, []);

// Pass projects directly to GroupedProjectList
<GroupedProjectList
  projects={projects}
  selectedProjectId={selectedProjectId}
  onProjectClick={handleProjectClick}
  formatDate={formatDate}
/>
```

## Key Code Changes Summary

### ModelFileDialog.tsx - Before:
```typescript
import { fetchModelFilenames, ModelFileSummaryDto } from '../../api/modelApi';
import { mapModelFilesToProjectDtos } from '../../utils/modelFileMapping';

const [files, setFiles] = useState<ModelFileSummaryDto[]>([]);

// In loadFiles:
const filenames = await fetchModelFilenames();
setFiles(filenames);

// In render (open mode):
<GroupedProjectList
  projects={mapModelFilesToProjectDtos(files)}  // Always returns projectHierarchy: null
  ...
/>
```

### ModelFileDialog.tsx - After:
```typescript
import { listProjects, ProjectDto } from '../../api/projectsApi';
import { fetchModelFilenames, ModelFileSummaryDto } from '../../api/modelApi';

const [projects, setProjects] = useState<ProjectDto[]>([]);  // For "open" mode
const [files, setFiles] = useState<ModelFileSummaryDto[]>([]);  // For "saveAs" mode

// In loadFiles (mode-aware):
if (mode === 'open') {
  const projectList = await listProjects();
  setProjects(projectList);
} else {
  const filenames = await fetchModelFilenames();
  setFiles(filenames);
}

// In render (open mode):
<GroupedProjectList
  projects={projects}  // Real projectHierarchy values from API
  ...
/>
```

## Implementation Summary

All 3 task groups have been completed:

1. **Task Group 1 (Test Updates):** Updated `ModelFileDialogOpenMode.test.ts` with 23 tests covering:
   - Hierarchy grouping with real `projectHierarchy` values from `listProjects()`
   - Mode-based rendering (Open vs SaveAs)
   - Selection state management with `ProjectDto[]`
   - OK button enabled state
   - Confirmation behavior
   - Mode-aware data loading

2. **Task Group 2 (Implementation):** Modified `ModelFileDialog.tsx`:
   - Added imports for `listProjects` and `ProjectDto` from `projectsApi`
   - Added separate `projects` state for "open" mode
   - Updated `loadData` function to be mode-aware (calls `listProjects()` for "open" mode)
   - Updated `handleProjectClick` to work with `ProjectDto[]`
   - Pass `projects` directly to `GroupedProjectList` (no mapping needed)

3. **Task Group 3 (Cleanup):**
   - Analyzed codebase - `modelFileMapping.ts` only used by its own test file
   - Deleted `frontend/src/utils/modelFileMapping.ts`
   - Deleted `frontend/src/__tests__/modelFileMapping.test.ts`
   - Verified all tests pass (23 tests in ModelFileDialogOpenMode, 11 tests in GroupedProjectList)
