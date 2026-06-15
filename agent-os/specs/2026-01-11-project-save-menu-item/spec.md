# Specification: Add Project Save Menu Item and Fix Project Menu Labels/Separator

## Goal
Add a new "Save" menu item to the Project menu that immediately persists the current project/model to the database without prompting, and fix the menu by removing trailing ellipses from all labels and ensuring exactly one separator between Delete and Import as JSON.

## User Stories
- As a user, I want to save my current project with a single click so that I can quickly persist my changes without re-entering a filename.
- As a user, I want a clean Project menu with consistent labeling and logical separation so that I can easily find and understand menu options.

## Specific Requirements

**Project menu item order**
- Menu must display exactly 9 items in this order: Create, Open, Save (NEW), Save As, Delete, separator, Import as JSON, Export as JSON, Import as XLSX, Export as XLSX
- Save is inserted between Open and Save As as the third item
- Only one separator exists, placed between Delete and Import as JSON
- Remove the second separator that currently exists between Export as JSON and Import as XLSX

**Remove trailing ellipses from all menu labels**
- All menu item labels must not contain trailing ellipsis characters
- Labels become: "Create", "Open", "Save", "Save As", "Delete", "Import as JSON", "Export as JSON", "Import as XLSX", "Export as XLSX"
- The ellipsis removal applies to all 8 existing items plus the new Save item

**Save menu item behavior**
- Clicking Save immediately saves the current project/model to the database
- No modal or dialog opens when Save is clicked
- Uses the same API call as Save As: `saveModelByFilename(filename, model)` via `saveModelToBackend` utility
- Uses `state.loadedFileName` from ArchitectureContext as the filename parameter
- Shows the same temporary notification as Save As on success (e.g., "Model saved as {filename}")

**Save button disabled state**
- Save menu item must be disabled when no project is currently open
- Check `state.loadedFileName` from ArchitectureContext; if null or undefined, disable Save
- Add a `menuItemDisabled` CSS class for visual styling of disabled state
- Disabled items should have reduced opacity and non-clickable cursor

**Reuse Save As persistence mechanism**
- Import and call `saveModelToBackend` from `src/utils/saveUtils.ts`
- Pass `state.model`, `state.loadedFileName`, and `dispatch` to the utility
- Handle the `SaveResult` response: show notification on success, show error modal on failure

**Error handling for Save**
- If `saveModelToBackend` returns `success: false` with `error`, show error in ErrorModal
- If `saveModelToBackend` returns `success: false` with `validationErrors`, show validation warning modal
- Prevent duplicate save requests by tracking a `saving` state and disabling the menu item while in progress

**FileMenu component props update**
- Add new prop: `onSave: () => void` for the Save handler
- Add new prop: `saveDisabled: boolean` to control disabled state
- Update FileMenuProps interface with these new properties

**TopBar component updates**
- Add `handleSave` async function that calls `saveModelToBackend`
- Determine disabled state: `!state.loadedFileName`
- Pass `onSave` and `saveDisabled` props to FileMenu component
- Reuse existing notification state and ErrorModal for save feedback

## Visual Design
No visual mockups provided. Follow existing FileMenu styling patterns.

## Existing Code to Leverage

**`frontend/src/components/TopBar/FileMenu.tsx`**
- Renders the Project dropdown menu with all menu items
- Uses portal rendering for z-index stacking
- Has existing separator implementation via `styles.separator` CSS class
- Add new Save menu item following the same pattern as other items

**`frontend/src/components/TopBar/TopBar.tsx`**
- Manages all menu state and handlers (handleOpenBackend, handleSaveAsBackend, etc.)
- Has existing `handleSaveToBackend` function that uses `saveModelToBackend` utility
- Uses `state.loadedFileName` from ArchitectureContext for current project name
- Has notification state and ErrorModal for user feedback

**`frontend/src/utils/saveUtils.ts`**
- Contains `saveModelToBackend(model, filename, dispatch)` utility function
- Returns `SaveResult` with success, error, or validationErrors fields
- Handles model preparation, validation, sanitization, and API call
- Already used by Save As flow; reuse for Save

**`frontend/src/components/TopBar/FileMenu.module.css`**
- Contains `.menuItem` and `.separator` styles
- Add `.menuItemDisabled` style with `opacity: 0.5`, `cursor: not-allowed`, `pointer-events: none`

**`frontend/src/__tests__/delete-project-modal.test.tsx`**
- Contains test patterns for FileMenu and TopBar
- Shows how to mock ArchitectureContext and ProjectContext
- Use similar patterns for new Save menu item tests

## Out of Scope
- Changes to Save As behavior (renaming, hierarchy changes remain in Save As only)
- Autosave functionality
- Backend API changes (existing save endpoint is sufficient)
- Changes to Create, Open, Delete, Import, or Export behaviors
- Keyboard shortcuts for Save
- Confirmation dialog before saving
- Dirty state tracking (save enabled regardless of unsaved changes)
- Undo/redo after save
