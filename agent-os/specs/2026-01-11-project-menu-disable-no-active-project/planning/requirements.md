# Spec Requirements: Project Menu Disable When No Active Project

## Initial Description

Update the **Project** dropdown menu so that when the app has **no active project loaded**, only actions that make sense without an active project remain enabled.

**When NO active project is loaded:**
- Enabled (clickable): Create, Open, Delete
- Disabled (greyed out / not clickable): Save, Save As, Import as JSON, Export as JSON, Import as XLSX, Export as XLSX

**When an active project IS loaded:**
- All 9 items are enabled

## Requirements Discussion

### First Round Questions

**Q1:** I assume the canonical "active project" signal is `state.loadedFileName` from ArchitectureContext, since TopBar already uses `!state.loadedFileName` to compute `saveDisabled` and `importXlsxDisabled`. Is that correct?
**Answer:** Yes, confirmed by code analysis. `state.loadedFileName` is the single source of truth used in TopBar.tsx (lines 109, 112).

**Q2:** I assume we should follow the existing pattern of passing individual `disabled` props to FileMenu (like `saveDisabled`, `importXlsxDisabled`) rather than passing a single `hasActiveProject` boolean and letting FileMenu compute disabled states internally. Is that correct?
**Answer:** Code analysis shows a mixed approach could work. Current pattern passes `saveDisabled` and `importXlsxDisabled` as separate props. A cleaner approach would be to compute all disabled states in TopBar and pass them to FileMenu, following the same established pattern.

**Q3:** I assume the existing disabled styling class `menuItemDisabled` (opacity: 0.5, cursor: not-allowed, pointer-events: none) should be reused for all newly disabled items. Is that correct?
**Answer:** Yes, confirmed. The CSS class in `FileMenu.module.css` (lines 43-55) is designed for this purpose and is already used by Save and Import as XLSX.

**Q4:** I assume the disabled check in each click handler (e.g., `if (!saveDisabled) { onSave(); onClose(); }`) should be replicated for newly disabled items as a defensive guard, even though `pointer-events: none` already prevents clicks. Is that correct?
**Answer:** Yes, this is the existing pattern. `handleSaveClick` (line 178-183) and `handleImportXlsxClick` (line 207-212) both have explicit guards.

### Existing Code to Reference

**Similar Features Identified:**

- Feature: Save disabled state - Path: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\TopBar\TopBar.tsx` (line 109)
  - Pattern: `const saveDisabled = !state.loadedFileName || isSaving;`

- Feature: Import XLSX disabled state - Path: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\TopBar\TopBar.tsx` (line 112)
  - Pattern: `const importXlsxDisabled = !state.loadedFileName;`

- Feature: FileMenu disabled prop handling - Path: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\TopBar\FileMenu.tsx` (lines 259-265, 306-312)
  - Pattern: Conditional CSS class application + click handler guard

- Feature: Disabled CSS styling - Path: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\TopBar\FileMenu.module.css` (lines 43-55)
  - Pattern: `.menuItemDisabled` class with opacity, cursor, pointer-events

- Feature: Existing menu tests - Path: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\__tests__\project-save-menu.test.tsx`
  - Pattern: Testing disabled state via className match and click handler verification

### Follow-up Questions

No follow-up questions needed - the raw idea document and code analysis provide complete requirements.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A

## Requirements Summary

### Functional Requirements

1. **Menu Item Enable/Disable Rules:**
   - Create: Always enabled (makes sense without project)
   - Open: Always enabled (makes sense without project)
   - Delete: Always enabled (selects project via modal)
   - Save: Disabled when no active project (already implemented)
   - Save As: Disabled when no active project (NEW)
   - Import as JSON: Disabled when no active project (NEW)
   - Export as JSON: Disabled when no active project (NEW)
   - Import as XLSX: Disabled when no active project (already implemented)
   - Export as XLSX: Disabled when no active project (NEW)

2. **Reactive State Updates:**
   - Disabled states must update immediately when:
     - A project is opened (`state.loadedFileName` becomes truthy)
     - A project is created (should set `loadedFileName`)
     - The active project is cleared/deleted (`state.loadedFileName` becomes null/undefined)

3. **Click Prevention:**
   - Disabled items must not trigger their handlers
   - Both CSS `pointer-events: none` and explicit handler guards should be used

### Reusability Opportunities

1. **TopBar.tsx Patterns:**
   - Extend the pattern: `const [itemName]Disabled = !state.loadedFileName;`
   - For Save As, Export JSON, Export XLSX, Import JSON: use `!state.loadedFileName`
   - Save already combines with `isSaving` state
   - Import XLSX already implemented

2. **FileMenu.tsx Patterns:**
   - Add new disabled props to interface: `saveAsDisabled`, `importJsonDisabled`, `exportJsonDisabled`, `exportXlsxDisabled`
   - Apply `menuItemDisabled` class conditionally using existing pattern
   - Add guards to click handlers following existing pattern

3. **CSS Patterns:**
   - Reuse existing `.menuItemDisabled` class - no CSS changes needed

4. **Test Patterns:**
   - Follow `project-save-menu.test.tsx` patterns for testing disabled states
   - Test className includes `menuItemDisabled` when disabled
   - Test handler not called when disabled

### Scope Boundaries

**In Scope:**
- Add disabled props for Save As, Import JSON, Export JSON, Export XLSX to FileMenu
- Compute disabled states in TopBar based on `state.loadedFileName`
- Apply disabled styling and click prevention in FileMenu
- Update click handlers with defensive guards
- Add unit tests for new disabled states

**Out of Scope:**
- Changing the source of truth for "active project" (remains `state.loadedFileName`)
- Modifying CreateProjectModal, DeleteProjectModal, or OpenFileDialog behavior
- Backend changes
- Accessibility enhancements (aria-disabled, etc.) - could be future enhancement
- Keyboard navigation disabled state handling

### Technical Considerations

1. **Files to Modify:**
   - `frontend/src/components/TopBar/TopBar.tsx` - Add new disabled state computations and pass to FileMenu
   - `frontend/src/components/TopBar/FileMenu.tsx` - Add new disabled props, apply styling, add handler guards

2. **Files to Create/Extend:**
   - `frontend/src/__tests__/project-menu-disable.test.tsx` - New test file for disabled states

3. **No Changes Needed:**
   - `FileMenu.module.css` - Existing `.menuItemDisabled` class is sufficient
   - Backend code - Frontend-only change
   - Context providers - `state.loadedFileName` already provides needed signal

4. **Interface Changes:**
   - FileMenuProps interface will gain 4 new optional boolean props with defaults to `false`

5. **Existing Pattern to Follow:**
   ```typescript
   // TopBar.tsx - compute disabled state
   const saveAsDisabled = !state.loadedFileName;
   const importJsonDisabled = !state.loadedFileName;
   const exportJsonDisabled = !state.loadedFileName;
   const exportXlsxDisabled = !state.loadedFileName;

   // FileMenu.tsx - apply disabled class
   <div
     className={`${styles.menuItem} ${saveAsDisabled ? styles.menuItemDisabled : ''}`}
     onClick={handleSaveAsClick}
   >

   // FileMenu.tsx - handler guard
   const handleSaveAsClick = () => {
     if (!saveAsDisabled) {
       onSaveAsBackend();
       onClose();
     }
   };
   ```
