# Specification: Project Menu Disable When No Active Project

## Goal
Disable Project menu actions that require an active project context when no project is loaded, ensuring only Create, Open, and Delete remain enabled.

## User Stories
- As a user, I want menu items that cannot function without an active project to be visually disabled so that I understand which actions are available to me.
- As a user, I want the menu to immediately reflect state changes when I open or close a project so that I always see accurate enabled/disabled states.

## Specific Requirements

**Determine active project state using loadedFileName**
- Use `state.loadedFileName` from ArchitectureContext as the single source of truth
- Compute `hasActiveProject` as `!!state.loadedFileName` (truthy check)
- This follows the existing pattern already used for `saveDisabled` and `importXlsxDisabled`

**Menu items always enabled (no changes needed)**
- Create: Always enabled - creates a new project without requiring an existing one
- Open: Always enabled - opens a project from the backend
- Delete: Always enabled - selects a project via modal, does not require active project

**Menu items disabled when no active project**
- Save: Already implemented with `saveDisabled = !state.loadedFileName || isSaving`
- Save As: NEW - disabled when `!state.loadedFileName`
- Import as JSON: NEW - disabled when `!state.loadedFileName`
- Export as JSON: NEW - disabled when `!state.loadedFileName`
- Import as XLSX: Already implemented with `importXlsxDisabled = !state.loadedFileName`
- Export as XLSX: NEW - disabled when `!state.loadedFileName`

**TopBar.tsx: Add new disabled state computations**
- Add `const saveAsDisabled = !state.loadedFileName;`
- Add `const importJsonDisabled = !state.loadedFileName;`
- Add `const exportJsonDisabled = !state.loadedFileName;`
- Add `const exportXlsxDisabled = !state.loadedFileName;`
- Pass these as new props to FileMenu component

**FileMenu.tsx: Add new disabled props to interface**
- Add `saveAsDisabled?: boolean;` with default `false`
- Add `importJsonDisabled?: boolean;` with default `false`
- Add `exportJsonDisabled?: boolean;` with default `false`
- Add `exportXlsxDisabled?: boolean;` with default `false`

**FileMenu.tsx: Apply disabled CSS class conditionally**
- Save As: `className={\`${styles.menuItem} ${saveAsDisabled ? styles.menuItemDisabled : ''}\`}`
- Import as JSON: `className={\`${styles.menuItem} ${importJsonDisabled ? styles.menuItemDisabled : ''}\`}`
- Export as JSON: `className={\`${styles.menuItem} ${exportJsonDisabled ? styles.menuItemDisabled : ''}\`}`
- Export as XLSX: `className={\`${styles.menuItem} ${exportXlsxDisabled ? styles.menuItemDisabled : ''}\`}`

**FileMenu.tsx: Add defensive guards to click handlers**
- `handleSaveAsBackendClick`: Add `if (!saveAsDisabled) { ... }` guard
- `handleImportJsonClick`: Add `if (!importJsonDisabled) { ... }` guard
- `handleExportJsonClick`: Add `if (!exportJsonDisabled) { ... }` guard
- `handleExportXlsxClick`: Add `if (!exportXlsxDisabled) { ... }` guard

**Reactive state updates**
- Disabled states automatically update when `state.loadedFileName` changes
- This happens when: project opened, project created, active project deleted/cleared
- No additional subscription or effect logic needed - React reactivity handles this

## Existing Code to Leverage

**saveDisabled pattern in TopBar.tsx (line 109)**
- Pattern: `const saveDisabled = !state.loadedFileName || isSaving;`
- Reuse the `!state.loadedFileName` check for all new disabled states
- Located at `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\TopBar\TopBar.tsx`

**importXlsxDisabled pattern in TopBar.tsx (line 112)**
- Pattern: `const importXlsxDisabled = !state.loadedFileName;`
- Exact pattern to replicate for saveAsDisabled, importJsonDisabled, exportJsonDisabled, exportXlsxDisabled
- Located at `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\TopBar\TopBar.tsx`

**Disabled CSS class in FileMenu.module.css (lines 43-55)**
- Class: `.menuItemDisabled` with `opacity: 0.5`, `cursor: not-allowed`, `pointer-events: none`
- Already exists and is properly styled - no CSS changes needed
- Located at `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\TopBar\FileMenu.module.css`

**Click handler guard pattern in FileMenu.tsx (lines 178-183, 207-212)**
- Pattern: `if (!saveDisabled) { onSave(); onClose(); }` and `if (!importXlsxDisabled) { onImportXlsx(); onClose(); }`
- Replicate this defensive check for all newly disabled handlers
- Located at `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\TopBar\FileMenu.tsx`

**Test patterns in project-save-menu.test.tsx**
- Pattern: Test disabled state via `expect(element.className).toMatch(/menuItemDisabled/)`
- Pattern: Test handler not called when disabled via `expect(onHandler).not.toHaveBeenCalled()`
- Located at `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\__tests__\project-save-menu.test.tsx`

## Out of Scope
- Changing the source of truth for "active project" (remains `state.loadedFileName`)
- Modifying CreateProjectModal, DeleteProjectModal, or OpenFileDialog behavior
- Backend changes - this is a frontend-only change
- Accessibility enhancements (aria-disabled attribute) - future enhancement
- Keyboard navigation disabled state handling
- Tooltip or explanatory text for why items are disabled
- Changes to the menu item order or labels
- Adding any new menu items
- Modifying existing Save or Import XLSX disabled logic
