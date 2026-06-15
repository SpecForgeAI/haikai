# Task Breakdown: Add Project Save Menu Item and Fix Project Menu Labels/Separator

## Overview

This feature adds a new "Save" menu item to the Project menu and cleans up the menu by removing trailing ellipses from all labels and consolidating separators.

**Total Tasks:** 16 sub-tasks across 3 task groups

## Summary Table

| Task Group | Description | Dependencies | Sub-tasks |
|------------|-------------|--------------|-----------|
| 1 | Menu Structure Updates | None | 1.1 - 1.5 |
| 2 | Save Handler Implementation | Task Group 1 | 2.1 - 2.6 |
| 3 | Test Review & Gap Analysis | Task Groups 1-2 | 3.1 - 3.5 |

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `frontend/src/components/TopBar/FileMenu.tsx` | Modify | Add Save item, update props, remove ellipses, fix separator |
| `frontend/src/components/TopBar/FileMenu.module.css` | Modify | Add `.menuItemDisabled` style |
| `frontend/src/components/TopBar/TopBar.tsx` | Modify | Add `handleSave` function, pass new props |
| `frontend/src/__tests__/project-save-menu.test.tsx` | Create | New test file for Save menu item functionality |

---

## Task List

### Frontend Components

#### Task Group 1: Menu Structure Updates
**Dependencies:** None

Update the FileMenu component to add the Save menu item, remove trailing ellipses from all labels, and consolidate separators.

- [x] 1.0 Complete menu structure updates
  - [x] 1.1 Write 4-6 focused tests for menu structure
    - Test: Menu renders all 9 items in correct order (Create, Open, Save, Save As, Delete, separator, Import as JSON, Export as JSON, Import as XLSX, Export as XLSX)
    - Test: Menu labels do not contain trailing ellipsis characters
    - Test: Menu has exactly one separator (between Delete and Import as JSON)
    - Test: Save menu item is disabled when `saveDisabled` prop is true
    - Test: Save menu item is enabled when `saveDisabled` prop is false
    - Test: Save menu item calls `onSave` handler when clicked
  - [x] 1.2 Update FileMenuProps interface
    - Add `onSave: () => void` prop for Save handler
    - Add `saveDisabled: boolean` prop for disabled state control
    - File: `frontend/src/components/TopBar/FileMenu.tsx`
  - [x] 1.3 Add `.menuItemDisabled` CSS class
    - Add to `frontend/src/components/TopBar/FileMenu.module.css`
    - Properties: `opacity: 0.5`, `cursor: not-allowed`, `pointer-events: none`
    - Ensure hover/active states are suppressed for disabled items
  - [x] 1.4 Remove trailing ellipses from all menu item labels
    - Change "Create..." to "Create"
    - Change "Open..." to "Open"
    - Change "Save As..." to "Save As"
    - Change "Delete..." to "Delete"
    - Change "Import as JSON..." to "Import as JSON"
    - Change "Export as JSON..." to "Export as JSON"
    - Change "Import as XLSX..." to "Import as XLSX"
    - Change "Export as XLSX..." to "Export as XLSX"
  - [x] 1.5 Add Save menu item and fix separators
    - Insert Save item between Open and Save As (position 3)
    - Add `handleSaveClick` handler following existing pattern
    - Apply conditional `menuItemDisabled` class when `saveDisabled` is true
    - Add `data-testid="project-menu-save"` for testing
    - Remove second separator (between Export as JSON and Import as XLSX)
    - Keep only one separator (between Delete and Import as JSON)
    - Update menu height estimate in `getClampedPosition` (9 items + 1 separator)
  - [x] 1.6 Ensure menu structure tests pass
    - Run ONLY the tests written in 1.1
    - Verify all menu items render correctly
    - Verify separator count is exactly 1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- All 4-6 tests from 1.1 pass
- FileMenu has 9 menu items in the specified order
- No menu labels contain trailing ellipsis
- Exactly one separator exists between Delete and Import as JSON
- Save menu item is visually disabled when `saveDisabled` prop is true
- Save menu item triggers `onSave` callback when clicked

---

### Save Handler Logic

#### Task Group 2: Save Handler Implementation
**Dependencies:** Task Group 1

Implement the Save handler in TopBar that calls `saveModelToBackend` and provides user feedback.

- [x] 2.0 Complete Save handler implementation
  - [x] 2.1 Write 4-6 focused tests for Save handler
    - Test: `handleSave` calls `saveModelToBackend` with correct parameters (`state.model`, `state.loadedFileName`, `dispatch`)
    - Test: Save is disabled when `state.loadedFileName` is null/undefined
    - Test: Success notification "Saved" is shown after successful save
    - Test: Error modal is shown when save fails with error
    - Test: Validation warning modal is shown when save fails with validation errors
    - Test: Menu closes after Save is clicked
  - [x] 2.2 Add saving state tracking
    - Add `const [isSaving, setIsSaving] = useState(false);` state variable
    - Use this to prevent duplicate save requests
    - File: `frontend/src/components/TopBar/TopBar.tsx`
  - [x] 2.3 Implement `handleSave` async function
    - Guard: Return early if `!state.loadedFileName` (should not happen if UI is correct)
    - Guard: Return early if `isSaving` is true (prevent double-click)
    - Set `setIsSaving(true)` at start
    - Call `await saveModelToBackend(state.model, state.loadedFileName, dispatch)`
    - Handle `SaveResult` response:
      - On `success: true`: Show notification "Saved" (simpler than "Model saved as {filename}")
      - On `success: false` with `error`: Show error in ErrorModal
      - On `success: false` with `validationErrors`: Show validation warning modal
    - Set `setIsSaving(false)` in finally block
    - File: `frontend/src/components/TopBar/TopBar.tsx`
  - [x] 2.4 Compute `saveDisabled` state
    - Create `const saveDisabled = !state.loadedFileName || isSaving;`
    - This disables Save when:
      - No project is open (`loadedFileName` is null/undefined)
      - Save is in progress (`isSaving` is true)
  - [x] 2.5 Pass new props to FileMenu
    - Add `onSave={handleSave}` prop
    - Add `saveDisabled={saveDisabled}` prop
    - File: `frontend/src/components/TopBar/TopBar.tsx`
  - [x] 2.6 Ensure Save handler tests pass
    - Run ONLY the tests written in 2.1
    - Verify save functionality works correctly
    - Verify error handling displays appropriate modals
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- All 4-6 tests from 2.1 pass
- Save correctly calls `saveModelToBackend` with current model and filename
- Save is disabled when no project is open
- Save is disabled while save is in progress (prevents double-click)
- Success notification "Saved" appears after successful save
- Error modal appears on API failure
- Validation warning modal appears on validation failure

---

### Testing

#### Task Group 3: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-2

Review existing tests and fill critical gaps for the Save menu item feature.

- [x] 3.0 Review existing tests and fill critical gaps only
  - [x] 3.1 Review tests from Task Groups 1-2
    - Review the 4-6 tests written for menu structure (Task 1.1)
    - Review the 4-6 tests written for Save handler (Task 2.1)
    - Total existing tests: approximately 8-12 tests
  - [x] 3.2 Analyze test coverage gaps for THIS feature only
    - Identify any critical user workflows that lack test coverage
    - Focus ONLY on gaps related to the Save menu item feature
    - Do NOT assess entire application test coverage
    - Prioritize end-to-end save workflow over unit test gaps
  - [x] 3.3 Write up to 5 additional strategic tests if needed
    - Add maximum of 5 new tests to fill identified critical gaps
    - Potential gap tests:
      - Integration test: Full save flow from menu click to notification
      - Test: Menu item order is exactly as specified
      - Test: Disabled Save item does not fire click handler
      - Test: Save notification auto-dismisses after timeout
      - Test: Error state resets correctly after closing error modal
    - Skip edge cases, performance tests, and accessibility tests unless business-critical
  - [x] 3.4 Run feature-specific tests only
    - Run ONLY tests related to the Save menu item feature
    - Expected total: approximately 13-17 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass
  - [x] 3.5 Verify manual testing checklist
    - Open application with no project loaded - Save should be disabled
    - Open a project - Save should be enabled
    - Click Save - notification "Saved" should appear
    - Close notification - should auto-dismiss after 3 seconds
    - Verify all menu labels have no trailing ellipsis
    - Verify exactly one separator between Delete and Import as JSON

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 13-17 tests total)
- Critical Save workflow is covered end-to-end
- No more than 5 additional tests added when filling gaps
- Testing focused exclusively on the Save menu item feature requirements
- Manual testing checklist items all verified

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Menu Structure Updates** - Updates FileMenu component structure and styling
2. **Task Group 2: Save Handler Implementation** - Implements the save logic in TopBar
3. **Task Group 3: Test Review & Gap Analysis** - Reviews and fills test coverage gaps

---

## Technical Notes

### Existing Code Patterns to Follow

**FileMenu item handler pattern (from FileMenu.tsx):**
```typescript
const handleSaveClick = () => {
  if (!saveDisabled) {
    onSave();
    onClose();
  }
};
```

**Save utility usage (from TopBar.tsx handleSaveToBackend):**
```typescript
const result = await saveModelToBackend(state.model, filename, dispatch);

if (result.success) {
  setNotification(`Saved`);
  setTimeout(() => setNotification(null), 3000);
} else if (result.validationErrors && result.validationErrors.length > 0) {
  setValidationWarnings(result.validationErrors);
  setValidationWarningModalOpen(true);
} else if (result.error) {
  setErrorMessages([result.error]);
  setErrorModalOpen(true);
}
```

**Disabled menu item styling (new CSS class):**
```css
.menuItemDisabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}
```

### Expected Final Menu Structure

```
Create
Open
Save              <-- NEW (disabled when no project open)
Save As
Delete
---------------   <-- Only separator
Import as JSON
Export as JSON
Import as XLSX
Export as XLSX
```

### Key Dependencies

- `saveModelToBackend` from `frontend/src/utils/saveUtils.ts` - Already imported in TopBar.tsx
- `state.loadedFileName` from ArchitectureContext - Used to determine if project is open
- `state.model` from ArchitectureContext - The model data to save
- `dispatch` from useArchitectureDispatch - For updating state after save

---

## Implementation Summary

All 3 task groups have been completed successfully:

### Files Modified:
1. **`frontend/src/components/TopBar/FileMenu.tsx`** - Added Save menu item, updated props interface, removed trailing ellipses from all labels, fixed separators (now exactly one between Delete and Import as JSON)
2. **`frontend/src/components/TopBar/FileMenu.module.css`** - Added `.menuItemDisabled` CSS class with opacity, cursor, and pointer-events styles
3. **`frontend/src/components/TopBar/TopBar.tsx`** - Added `handleSave` async function, `isSaving` state, computed `saveDisabled`, passed new props to FileMenu

### Files Created:
1. **`frontend/src/__tests__/project-save-menu.test.tsx`** - 16 comprehensive tests covering menu structure, save handler behavior, and strategic gap coverage

### Test Results:
- All 16 tests pass
- Task Group 1: 7 tests for menu structure
- Task Group 2: 6 tests for save handler
- Task Group 3: 3 additional strategic tests
