# Task Breakdown: Update Open Project Modal to Use Hierarchy-Collapsible Project List

## Overview

**Feature:** Replace the Open modal's flat file list with the reusable `GroupedProjectList` component used by the Delete Project modal.

**Total Tasks:** 12
**Estimated Complexity:** Low (Frontend-only, reusing existing component)

### Summary Table

| Task Group | Description | Tasks | Dependencies |
|------------|-------------|-------|--------------|
| 1 | Data Mapping Utility | 1.1 - 1.3 | None |
| 2 | UI Integration | 2.1 - 2.5 | Group 1 |
| 3 | Test Review & Gap Analysis | 3.1 - 3.4 | Groups 1-2 |

### Files to Modify

| File | Change Type |
|------|-------------|
| `frontend/src/components/file/ModelFileDialog.tsx` | Modify |
| `frontend/src/utils/modelFileMapping.ts` | Create (new) |

### Files to Reference (Read-Only)

| File | Purpose |
|------|---------|
| `frontend/src/components/Project/GroupedProjectList.tsx` | Reuse component |
| `frontend/src/components/Project/DeleteProjectModal.tsx` | Reference integration pattern |
| `frontend/src/api/modelApi.ts` | Source data type (ModelFileSummaryDto) |
| `frontend/src/api/projectsApi.ts` | Target data type (ProjectDto) |

---

## Task List

### Data Mapping Layer

#### Task Group 1: ModelFileSummaryDto to ProjectDto Mapping
**Dependencies:** None

- [x] 1.0 Complete data mapping utility
  - [x] 1.1 Write 4-6 focused tests for mapping function
    - Test mapping single ModelFileSummaryDto to ProjectDto
    - Test mapping array of files to array of ProjectDto
    - Test null/undefined date handling (created_at, updated_at)
    - Test projectHierarchy defaults to null
    - Test id and filename to name mapping
  - [x] 1.2 Create mapping utility file `frontend/src/utils/modelFileMapping.ts`
    - Create `mapModelFileToProjectDto(file: ModelFileSummaryDto): ProjectDto` function
    - Map `id` -> `id`
    - Map `filename` -> `name`
    - Set `projectParentFolder` to empty string (not used in display)
    - Set `projectHierarchy` to `null` (files have no hierarchy)
    - Set `isActive` to `false` (not relevant for file selection)
    - Map `created_at` -> `createdAt` (handle undefined)
    - Map `updated_at` -> `updatedAt` (handle undefined)
    - Create `mapModelFilesToProjectDtos(files: ModelFileSummaryDto[]): ProjectDto[]` array mapper
    - Export both functions
  - [x] 1.3 Ensure mapping utility tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify all edge cases handled correctly

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- Mapping function correctly converts ModelFileSummaryDto to ProjectDto format
- Date fields handle undefined gracefully
- Array mapping works for empty and populated arrays

---

### UI Integration Layer

#### Task Group 2: ModelFileDialog Component Update
**Dependencies:** Task Group 1

- [x] 2.0 Complete UI integration
  - [x] 2.1 Write 5-7 focused tests for UI integration
    - Test GroupedProjectList renders in "open" mode
    - Test flat file list still renders in "saveAs" mode (unchanged)
    - Test project selection updates selectedFilename state
    - Test OK button enabled after selection in "open" mode
    - Test OK button disabled when no selection in "open" mode
    - Test onConfirm called with correct filename on OK click
    - Test double-click or Enter confirms selection (if applicable)
  - [x] 2.2 Add imports to ModelFileDialog.tsx
    - Import `GroupedProjectList` from `../Project/GroupedProjectList`
    - Import `ProjectDto` from `../../api/projectsApi`
    - Import `mapModelFilesToProjectDtos` from `../../utils/modelFileMapping`
  - [x] 2.3 Add state for project ID selection
    - Add `selectedProjectId: string | null` state (parallel to selectedFilename)
    - Create lookup map or helper to convert projectId back to filename
  - [x] 2.4 Update handleFileClick for GroupedProjectList callback
    - Create `handleProjectClick(projectId: string)` callback
    - Find matching file by id to get filename
    - Update both `selectedProjectId` and `selectedFilename` states
  - [x] 2.5 Update render logic with conditional rendering
    - Replace lines 259-279 (flat .fileList block) for "open" mode only
    - Keep existing flat list rendering for "saveAs" mode
    - Add conditional: `{mode === 'open' ? <GroupedProjectList ... /> : <existing flat list>}`
    - Pass props to GroupedProjectList:
      - `projects={mapModelFilesToProjectDtos(files)}`
      - `selectedProjectId={selectedProjectId}`
      - `onProjectClick={handleProjectClick}`
      - `formatDate={formatDate}` (reuse existing formatDate function)
  - [x] 2.6 Ensure UI integration tests pass
    - Run ONLY the 5-7 tests written in 2.1
    - Verify selection and confirmation work correctly
    - Verify "saveAs" mode unchanged

**Acceptance Criteria:**
- The 5-7 tests written in 2.1 pass
- "open" mode displays GroupedProjectList with collapsible sections
- "saveAs" mode displays original flat file list (unchanged)
- Project selection correctly updates state and enables OK button
- OK button triggers onConfirm with selected filename
- Visual appearance matches DeleteProjectModal hierarchy display

---

### Testing

#### Task Group 3: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-2

- [x] 3.0 Review existing tests and fill critical gaps only
  - [x] 3.1 Review tests from Task Groups 1-2
    - Review the 4-6 tests written for mapping utility (Task 1.1)
    - Review the 5-7 tests written for UI integration (Task 2.1)
    - Total existing tests: approximately 9-13 tests
  - [x] 3.2 Analyze test coverage gaps for THIS feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to this spec's feature requirements
    - Prioritize end-to-end selection workflow tests
  - [x] 3.3 Write up to 5 additional strategic tests maximum
    - Add maximum of 5 new tests to fill identified critical gaps
    - Consider edge cases:
      - Empty file list renders correctly in "open" mode
      - Loading state displays correctly before GroupedProjectList appears
      - Error state with retry displays correctly in "open" mode
      - Keyboard navigation (Enter to confirm, Escape to cancel)
      - Selection persists correctly through expand/collapse of sections
  - [x] 3.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature
    - Expected total: approximately 14-18 tests maximum
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 14-18 tests total)
- Critical user workflows for this feature are covered
- No more than 5 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Data Mapping Utility** (No dependencies)
   - Create the mapping function first as it's a standalone utility
   - Tests validate the data transformation logic in isolation

2. **Task Group 2: UI Integration** (Depends on Group 1)
   - Integrate GroupedProjectList into ModelFileDialog
   - Uses the mapping utility from Group 1

3. **Task Group 3: Test Review & Gap Analysis** (Depends on Groups 1-2)
   - Review all tests and fill any critical gaps
   - Final verification of complete feature

---

## Implementation Notes

### Key Code Patterns to Follow

**GroupedProjectList Integration (from DeleteProjectModal.tsx lines 222-228):**
```tsx
<GroupedProjectList
  projects={projects}
  selectedProjectId={selectedProjectId}
  onProjectClick={handleProjectClick}
  formatDate={formatDate}
/>
```

**Mapping Function Pattern:**
```tsx
export function mapModelFileToProjectDto(file: ModelFileSummaryDto): ProjectDto {
  return {
    id: file.id,
    name: file.filename,
    projectParentFolder: '',
    projectHierarchy: null,  // Files don't have hierarchy
    isActive: false,
    createdAt: file.created_at ?? '',
    updatedAt: file.updated_at ?? file.created_at ?? '',
  };
}
```

**Conditional Rendering Pattern:**
```tsx
{!isLoading && !error && (
  mode === 'open' ? (
    <GroupedProjectList
      projects={mapModelFilesToProjectDtos(files)}
      selectedProjectId={selectedProjectId}
      onProjectClick={handleProjectClick}
      formatDate={formatDate}
    />
  ) : (
    // Existing flat file list for saveAs mode
    <div className={styles.fileList}>
      {/* ... existing code ... */}
    </div>
  )
)}
```

### Selection State Management

The component needs to maintain two parallel selection states:
- `selectedFilename: string` - Used by onConfirm callback (unchanged API)
- `selectedProjectId: string | null` - Used by GroupedProjectList component

The `handleProjectClick` callback must:
1. Receive `projectId` from GroupedProjectList
2. Find the matching file in the `files` array by `id`
3. Update both `selectedProjectId` and `selectedFilename` states

### Out of Scope (Do Not Implement)

- Backend API changes
- Changes to "saveAs" mode behavior
- Changes to DeleteProjectModal
- Real projectHierarchy values (all null for now)
- Modal title changes
- Loading/error state changes
- Multi-select functionality
- Data fetching logic changes
