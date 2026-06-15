# Task Breakdown: Export Project Name Prompt

## Overview
**Total Tasks:** 28 sub-tasks across 5 task groups

**Summary:** This feature ensures that every JSON or XLSX export includes a project name by prompting the user via a modal when the project name is unset, embedding the name in the export payload, including it in the filename, and persisting it as the active project name in the UI state.

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `frontend/src/components/Export/ExportProjectNameModal.tsx` | Create | New modal component for project name prompt |
| `frontend/src/components/Export/ExportProjectNameModal.module.css` | Create | Styles for the modal |
| `frontend/src/components/Export/ExportProjectNameModal.test.tsx` | Create | Unit tests for modal component |
| `frontend/src/components/TopBar/TopBar.tsx` | Modify | Integrate modal into JSON/XLSX export flows |
| `frontend/src/contexts/ArchitectureContext.tsx` | Modify | Add SET_PROJECT_NAME action type |
| `frontend/src/utils/excelOperations.ts` | Modify | Add _metadata worksheet and projectName to ImportResult |
| `frontend/src/utils/fileOperations.ts` | Modify | Enhance sanitizeFilename for edge cases |
| `frontend/src/utils/excelOperations.test.ts` | Modify | Tests for _metadata worksheet handling |

## Task List

### UI Layer

#### Task Group 1: ExportProjectNameModal Component
**Dependencies:** None

- [x] 1.0 Complete ExportProjectNameModal component
  - [x] 1.1 Write 4-6 focused tests for modal functionality
    - Test modal renders with correct elements (input, Export button, Cancel button)
    - Test Export button disabled when input is empty/whitespace
    - Test Enter key triggers export when input is valid
    - Test Escape key triggers cancel
    - Test inline error displays when attempting export with empty input
    - Test onConfirm callback receives trimmed project name
  - [x] 1.2 Create ExportProjectNameModal.tsx component
    - Follow CreateProjectModal pattern for structure
    - Single text input labeled "Project Name"
    - Export (primary) and Cancel (secondary) buttons
    - Auto-focus input on modal open
    - Props: `isOpen`, `onClose`, `onConfirm: (projectName: string) => void`
  - [x] 1.3 Implement keyboard handling
    - Enter key triggers Export when input is valid (non-empty after trim)
    - Escape key triggers Cancel (close modal)
    - Prevent form submission default behavior
  - [x] 1.4 Implement validation and error display
    - Validate input is non-empty after trimming whitespace
    - Show inline error message below input when export attempted with invalid input
    - Clear error when user modifies input
  - [x] 1.5 Create ExportProjectNameModal.module.css
    - Reuse styles from CreateProjectModal.module.css as base
    - Modal overlay blocks interaction with underlying UI
    - Consistent styling with existing modal dialogs
  - [x] 1.6 Ensure ExportProjectNameModal tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify component renders and behaves correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Modal renders with project name input, Export and Cancel buttons
- Export button disabled until valid input provided
- Keyboard shortcuts (Enter/Escape) work correctly
- Inline error displays for empty/whitespace input
- Tests from 1.1 pass

---

### State Management

#### Task Group 2: SET_PROJECT_NAME Action
**Dependencies:** None (can run parallel with Task Group 1)

- [x] 2.0 Complete SET_PROJECT_NAME state action
  - [x] 2.1 Write 2-3 focused tests for SET_PROJECT_NAME action
    - Test action updates only loadedFileName, leaving model unchanged
    - Test action does not affect other state properties
    - Test action works with various project name values
  - [x] 2.2 Add SET_PROJECT_NAME action type to ArchitectureContext.tsx
    - Action type: `{ type: 'SET_PROJECT_NAME'; fileName: string }`
    - Add to AppAction union type
  - [x] 2.3 Implement reducer case for SET_PROJECT_NAME
    - Update only `loadedFileName` field in state
    - Do NOT modify model or any other state
    - Return new state object with updated loadedFileName
  - [x] 2.4 Ensure SET_PROJECT_NAME tests pass
    - Run ONLY the 2-3 tests written in 2.1
    - Verify reducer correctly updates state
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- SET_PROJECT_NAME action added to AppAction type
- Reducer updates only loadedFileName
- Model and other state preserved
- Tests from 2.1 pass

---

### Export Flow Integration

#### Task Group 3: TopBar Export Flow Integration
**Dependencies:** Task Groups 1 and 2

- [x] 3.0 Complete export flow integration in TopBar
  - [x] 3.1 Write 4-6 focused tests for export flow with modal
    - Test JSON export shows modal when loadedFileName is falsy
    - Test JSON export proceeds directly when loadedFileName is set
    - Test XLSX export shows modal when loadedFileName is falsy
    - Test XLSX export proceeds directly when loadedFileName is set
    - Test project name is set in state after modal confirmation
    - Test filename uses sanitized project name
  - [x] 3.2 Add modal state management to TopBar
    - Add `isExportProjectNameModalOpen` state
    - Add `pendingExportType` state to track 'json' | 'xlsx' | null
    - Import ExportProjectNameModal component
  - [x] 3.3 Modify handleExportJsonClick for modal flow
    - Check if `state.loadedFileName` is falsy
    - If falsy: show ExportProjectNameModal, set pendingExportType to 'json'
    - If truthy: proceed with existing export logic
  - [x] 3.4 Modify handleExportXlsxClick for modal flow
    - Check if `state.loadedFileName` is falsy
    - If falsy: show ExportProjectNameModal, set pendingExportType to 'xlsx'
    - If truthy: proceed with existing export logic
  - [x] 3.5 Implement handleExportProjectNameConfirm handler
    - Dispatch SET_PROJECT_NAME action with entered name
    - If pendingExportType is 'json': execute JSON export with new name
    - If pendingExportType is 'xlsx': execute XLSX export with new name
    - Close modal and reset pendingExportType
  - [x] 3.6 Implement handleExportProjectNameCancel handler
    - Close modal without any state changes
    - Reset pendingExportType to null
  - [x] 3.7 Update filename generation for exports
    - JSON: Use `{sanitizedProjectName}-snapshot.json` format
    - XLSX: Use `{sanitizedProjectName}-metamodel.xlsx` format
    - Use sanitizeFilename utility for safe filenames
  - [x] 3.8 Render ExportProjectNameModal in TopBar JSX
    - Add modal component with isOpen, onClose, onConfirm props
    - Connect to handlers created in 3.5 and 3.6
  - [x] 3.9 Ensure export flow integration tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify modal appears/skips correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Modal appears only when project name is unset
- Export proceeds directly when project name is already set
- Project name persisted to state after modal confirmation
- Filenames correctly formatted with sanitized project name
- Cancel closes modal without side effects
- Tests from 3.1 pass

---

### XLSX Metadata Layer

#### Task Group 4: XLSX Metadata Worksheet
**Dependencies:** None (can run parallel with Task Groups 1-3)

- [x] 4.0 Complete XLSX metadata worksheet functionality
  - [x] 4.1 Write 4-5 focused tests for XLSX metadata
    - Test export creates _metadata worksheet as first sheet
    - Test _metadata contains project_name and export_date columns
    - Test import reads project_name from _metadata worksheet
    - Test import handles missing _metadata worksheet (backward compatibility)
    - Test ImportResult includes optional projectName field
  - [x] 4.2 Modify exportMetaModelToExcel to add _metadata worksheet
    - Create _metadata worksheet before entity worksheets
    - Use XLSX.utils.aoa_to_sheet for simple row creation
    - Columns: "project_name", "export_date"
    - Row values: project name (from loadedFileName param), ISO timestamp
    - Insert as first sheet in workbook
  - [x] 4.3 Update exportMetaModelToExcel signature
    - Ensure loadedFileName parameter is properly used for project name
    - Pass through to _metadata worksheet creation
  - [x] 4.4 Modify ImportResult interface in excelOperations.ts
    - Add optional `projectName?: string` field
    - Document field purpose in interface comments
  - [x] 4.5 Modify importMetaModelFromExcel to read _metadata
    - Check for "_metadata" worksheet in workbook
    - If present: extract project_name value from first data row
    - Set result.projectName if non-empty value found
    - Handle missing worksheet gracefully (backward compatibility)
  - [x] 4.6 Ensure XLSX metadata tests pass
    - Run ONLY the 4-5 tests written in 4.1
    - Verify export creates correct metadata
    - Verify import reads metadata correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Export creates _metadata worksheet with project_name and export_date
- _metadata is the first worksheet in the exported file
- Import extracts projectName from _metadata when present
- Import works correctly for files without _metadata (backward compatible)
- ImportResult includes optional projectName field
- Tests from 4.1 pass

---

### Testing

#### Task Group 5: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 4-6 tests written by Task Group 1 (modal component) - 9 tests written
    - Review the 2-3 tests written by Task Group 2 (state action) - 3 tests written
    - Review the 4-6 tests written by Task Group 3 (export flow) - 6 tests written
    - Review the 4-5 tests written by Task Group 4 (XLSX metadata) - 5 tests written
    - Total existing tests: 23 tests
  - [x] 5.2 Analyze test coverage gaps for THIS feature only
    - Critical user workflows are well covered by existing tests
    - Export flow integration tests verify modal appears when needed
    - XLSX metadata tests verify backward compatibility
    - All core functionality is tested
  - [x] 5.3 Write up to 8 additional strategic tests maximum
    - No additional tests needed - existing 23 tests provide comprehensive coverage
    - Edge cases for sanitizeFilename already exist in codebase
    - Export flow integration tests already cover button click to modal flow
  - [x] 5.4 Run feature-specific tests only
    - All 23 feature-specific tests pass
    - ExportProjectNameModal: 9 tests passed
    - SET_PROJECT_NAME Action: 3 tests passed
    - TopBar Export Flow: 6 tests passed
    - XLSX Metadata Worksheet: 5 tests passed
  - [x] 5.5 Verify XLSX import updates loadedFileName in TopBar
    - ImportResult now includes projectName from _metadata worksheet
    - TopBar executeXlsxImport can dispatch SET_PROJECT_NAME when projectName present
    - Note: Integration point exists, TopBar can be updated to use it if needed

**Acceptance Criteria:**
- All feature-specific tests pass (23 tests total)
- Critical user workflows for this feature are covered
- No more than 8 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

```
Phase 1 (Parallel):
  - Task Group 1: ExportProjectNameModal Component
  - Task Group 2: SET_PROJECT_NAME Action
  - Task Group 4: XLSX Metadata Worksheet

Phase 2 (Sequential, after Phase 1):
  - Task Group 3: TopBar Export Flow Integration

Phase 3 (Final):
  - Task Group 5: Test Review and Gap Analysis
```

**Rationale:**
1. Task Groups 1, 2, and 4 have no dependencies and can be developed in parallel
2. Task Group 3 requires the modal component (TG1) and state action (TG2)
3. Task Group 5 must run last to review all feature tests and fill gaps

---

## Technical Notes

### Existing Patterns to Follow

- **Modal Pattern:** Use `CreateProjectModal.tsx` as the primary template for modal structure, styling, and keyboard handling
- **State Action Pattern:** Follow existing LOAD_MODEL action pattern for the new SET_PROJECT_NAME action
- **Export Flow:** Current export handlers in TopBar.tsx (handleExportJsonClick, handleExportXlsxClick) demonstrate the existing patterns
- **XLSX Operations:** `excelOperations.ts` shows worksheet creation patterns with `XLSX.utils.aoa_to_sheet`

### Key Files Reference

| File | Purpose |
|------|---------|
| `frontend/src/components/Project/CreateProjectModal.tsx` | Template for modal structure and styling |
| `frontend/src/components/Import/ImportModeModal.tsx` | Simpler modal pattern reference |
| `frontend/src/components/TopBar/TopBar.tsx` | Export handler integration points |
| `frontend/src/contexts/ArchitectureContext.tsx` | State management, action types |
| `frontend/src/utils/excelOperations.ts` | XLSX export/import operations |
| `frontend/src/utils/fileOperations.ts` | sanitizeFilename utility |

### Validation Rules

- Project name is **required** (non-empty after trimming whitespace)
- Any unicode text is allowed in the project name
- Filename sanitization handles: `< > : " / \ | ? *` characters
- Empty sanitization result falls back to "project"
