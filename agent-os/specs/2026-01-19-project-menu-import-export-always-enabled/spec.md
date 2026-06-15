# Specification: Project Menu Import/Export Always Enabled

## Goal
Enable Import as JSON and Import as XLSX menu items to be always clickable regardless of whether a project is loaded, allowing users to import files immediately on fresh app startup without first loading or creating a project.

## User Stories
- As a user, I want to import a JSON project snapshot on fresh app startup so that I can start working immediately without first creating a blank project
- As a user, I want to import an XLSX file on fresh app startup so that I can populate architecture data without needing an existing project open

## Specific Requirements

**Change importJsonDisabled to always be false**
- In TopBar.tsx line 152, change `const importJsonDisabled = !state.loadedFileName;` to `const importJsonDisabled = false;`
- This matches the existing pattern used for Export items (lines 156-157)
- The Import JSON functionality already handles the no-project scenario through ImportProjectSnapshotModal

**Change importXlsxDisabled to always be false**
- In TopBar.tsx line 147, change `const importXlsxDisabled = !state.loadedFileName;` to `const importXlsxDisabled = false;`
- XLSX import will append/overwrite data to the current in-memory model regardless of saved state
- When model is empty, the ImportModeModal is skipped and implicit Overwrite mode is used

**Remove disabled guards in FileMenu click handlers**
- In FileMenu.tsx handleImportJsonClick (lines 230-235), remove the `if (!importJsonDisabled)` guard
- In FileMenu.tsx handleImportXlsxClick (lines 246-251), remove the `if (!importXlsxDisabled)` guard
- Simplify to directly call the handler and close menu, matching the always-enabled Export pattern

**Keep FileMenu props interface unchanged**
- The `importJsonDisabled` and `importXlsxDisabled` props remain in FileMenuProps interface
- Props will always receive `false` from TopBar but interface remains for backward compatibility
- CSS class application logic can remain unchanged (will never apply disabled class)

**Update project-menu-disable.test.tsx**
- Update Test 1.1b to reflect that Import JSON is now always enabled by design
- Update Test 1.1e test for Import JSON disabled click behavior - either remove or update to test always-enabled
- Update Test 2.3a to not include Import JSON/XLSX in "disabled when no active project" assertions
- Verify Test 2.3b passes with Import items always enabled

**Maintain Export item behavior**
- Export as JSON and Export as XLSX must remain always enabled (already correct)
- No changes needed to export disabled state computation

## Existing Code to Leverage

**TopBar.tsx disabled state pattern (lines 154-157)**
- Export items already use the always-enabled pattern: `const exportJsonDisabled = false;`
- Apply identical pattern to Import items for consistency
- Located at `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\TopBar\TopBar.tsx`

**FileMenu.tsx export click handlers (lines 238-259)**
- Export handlers already check disabled state but always execute since disabled is always false
- Import handlers should follow same structure
- Located at `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\TopBar\FileMenu.tsx`

**ImportProjectSnapshotModal handling**
- JSON import already opens modal for project name/folder selection on import
- Works correctly regardless of current project state - no changes needed to modal

**ImportModeModal handling (lines 574-581)**
- XLSX import checks `hasExistingMetaModelData()` to decide whether to show modal
- Empty model uses implicit Overwrite mode - works on fresh startup

**project-menu-disable.test.tsx test patterns**
- Test file at `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\__tests__\project-menu-disable.test.tsx`
- Contains existing tests for disabled/enabled menu item behavior to update

## Out of Scope
- Database-dependent menu items (Create, Open, Save, Save As, Delete) remain unchanged
- The includeDatabase feature toggle behavior for hiding/showing database items
- The actual Import/Export file handling functionality
- ExportProjectNameModal behavior for prompting project name on export
- Any backend API changes
- Changes to import file validation or parsing logic
- Changes to the ImportModeModal append/overwrite selection logic
- Adding new menu items or reorganizing menu structure
- Removing the disabled props from FileMenu interface entirely
- Changes to the menuItemDisabled CSS class styling
