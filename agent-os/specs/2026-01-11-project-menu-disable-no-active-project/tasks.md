# Task Breakdown: Project Menu Disable When No Active Project

## Overview
Total Tasks: 2 Task Groups

This is a straightforward frontend fix that extends the existing disabled state pattern (used for Save and Import XLSX) to 4 additional menu items: Save As, Import as JSON, Export as JSON, and Export as XLSX.

## Task List

### Frontend Components

#### Task Group 1: Implement Disabled State Logic
**Dependencies:** None

- [x] 1.0 Complete disabled state implementation
  - [x] 1.1 Write 4-6 focused tests for disabled menu item behavior
    - Test: Save As menu item is disabled when `saveAsDisabled` prop is true
    - Test: Save As menu item is enabled when `saveAsDisabled` prop is false
    - Test: Import JSON menu item is disabled when `importJsonDisabled` prop is true
    - Test: Export JSON menu item is disabled when `exportJsonDisabled` prop is true
    - Test: Export XLSX menu item is disabled when `exportXlsxDisabled` prop is true
    - Test: Disabled menu items do not call their handlers when clicked
    - Follow patterns from: `frontend/src/__tests__/project-save-menu.test.tsx`
  - [x] 1.2 Update FileMenu.tsx interface with new disabled props
    - Add `saveAsDisabled?: boolean;` to FileMenuProps interface
    - Add `importJsonDisabled?: boolean;` to FileMenuProps interface
    - Add `exportJsonDisabled?: boolean;` to FileMenuProps interface
    - Add `exportXlsxDisabled?: boolean;` to FileMenuProps interface
    - Default all new props to `false`
  - [x] 1.3 Apply disabled CSS class conditionally to menu items
    - Save As: `className={\`${styles.menuItem} ${saveAsDisabled ? styles.menuItemDisabled : ''}\`}`
    - Import as JSON: `className={\`${styles.menuItem} ${importJsonDisabled ? styles.menuItemDisabled : ''}\`}`
    - Export as JSON: `className={\`${styles.menuItem} ${exportJsonDisabled ? styles.menuItemDisabled : ''}\`}`
    - Export as XLSX: `className={\`${styles.menuItem} ${exportXlsxDisabled ? styles.menuItemDisabled : ''}\`}`
    - Reuse existing `.menuItemDisabled` class from FileMenu.module.css
  - [x] 1.4 Add defensive guards to click handlers
    - `handleSaveAsBackendClick`: Add `if (!saveAsDisabled) { ... }` guard
    - `handleImportJsonClick`: Add `if (!importJsonDisabled) { ... }` guard
    - `handleExportJsonClick`: Add `if (!exportJsonDisabled) { ... }` guard
    - `handleExportXlsxClick`: Add `if (!exportXlsxDisabled) { ... }` guard
    - Follow pattern from existing `handleSaveClick` (lines 178-183)
  - [x] 1.5 Update TopBar.tsx to compute and pass disabled states
    - Add `const saveAsDisabled = !state.loadedFileName;`
    - Add `const importJsonDisabled = !state.loadedFileName;`
    - Add `const exportJsonDisabled = !state.loadedFileName;`
    - Add `const exportXlsxDisabled = !state.loadedFileName;`
    - Pass all 4 new disabled props to FileMenu component
    - Follow pattern from existing `saveDisabled` and `importXlsxDisabled` (lines 109, 112)
  - [x] 1.6 Ensure disabled state tests pass
    - Run ONLY the tests written in 1.1
    - Verify disabled styling applies correctly
    - Verify handlers are not called when disabled

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- Save As, Import JSON, Export JSON, Export XLSX show disabled styling when no active project
- Click handlers are blocked when respective items are disabled
- Menu items become enabled when a project is loaded

**Files to Modify:**
- `frontend/src/components/TopBar/TopBar.tsx` - Add disabled state computations
- `frontend/src/components/TopBar/FileMenu.tsx` - Add props, styling, and handler guards

**Files to Create:**
- `frontend/src/__tests__/project-menu-disable.test.tsx` - New test file

### Testing

#### Task Group 2: Test Review and Integration Verification
**Dependencies:** Task Group 1

- [x] 2.0 Review and verify complete disabled behavior
  - [x] 2.1 Review tests from Task Group 1
    - Review the 4-6 tests written for disabled state behavior
    - Verify test coverage for all 4 new disabled props
  - [x] 2.2 Analyze test coverage gaps for this feature only
    - Identify if any critical disabled state scenarios lack coverage
    - Focus ONLY on the 4 new disabled menu items
    - Check integration between TopBar and FileMenu
  - [x] 2.3 Write up to 4 additional tests if critical gaps exist
    - Test: All 4 items disabled simultaneously when no active project
    - Test: All 4 items enabled when active project exists
    - Test: Reactive update - items become enabled after project opens
    - Test: Reactive update - items become disabled after project closes
    - Maximum 4 new tests to fill gaps
  - [x] 2.4 Run feature-specific tests only
    - Run ONLY tests from `project-menu-disable.test.tsx`
    - Run related tests from `project-save-menu.test.tsx` to ensure no regressions
    - Do NOT run the entire application test suite
    - Verify all disabled behaviors work correctly

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 8-10 tests total)
- No regressions in existing Save and Import XLSX disabled behavior
- Disabled states correctly reflect `state.loadedFileName` value

## Execution Order

Recommended implementation sequence:
1. Frontend Components (Task Group 1) - Implement disabled state logic
2. Testing (Task Group 2) - Review and verify integration

## Reference Files

**Existing Patterns to Follow:**
- `frontend/src/components/TopBar/TopBar.tsx` (lines 109, 112) - `saveDisabled` and `importXlsxDisabled` computations
- `frontend/src/components/TopBar/FileMenu.tsx` (lines 178-183, 207-212) - Click handler guards
- `frontend/src/components/TopBar/FileMenu.module.css` (lines 43-55) - `.menuItemDisabled` CSS class
- `frontend/src/__tests__/project-save-menu.test.tsx` - Test patterns for disabled state verification

**Test Patterns:**
```typescript
// Check disabled styling
expect(menuItem.className).toMatch(/menuItemDisabled/);

// Check enabled (no disabled styling)
expect(menuItem.className).not.toMatch(/menuItemDisabled/);

// Check handler not called when disabled
fireEvent.click(menuItem);
expect(onHandler).not.toHaveBeenCalled();
```

## Notes

- This is a frontend-only change - no backend modifications required
- The existing `.menuItemDisabled` CSS class provides proper styling (opacity: 0.5, cursor: not-allowed, pointer-events: none)
- React reactivity automatically updates disabled states when `state.loadedFileName` changes
- No changes needed to CreateProjectModal, DeleteProjectModal, or OpenFileDialog
