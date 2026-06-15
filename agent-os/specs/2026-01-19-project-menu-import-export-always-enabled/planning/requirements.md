# Spec Requirements: Project Menu Import/Export Always Enabled

## Initial Description
The Import/Export menu items in the Project menu (FileMenu component) should always be enabled, regardless of whether a project is currently loaded or any other state. Currently the Import actions are disabled when no project is loaded, but the user wants all 4 file-based Import/Export actions to always be available.

## Requirements Discussion

### First Round Questions

No clarifying questions were needed. The user provided explicit instructions with the spec request:

1. **Scope is clear**: The 4 file-based menu items (Import as JSON, Export as JSON, Import as XLSX, Export as XLSX) should always be enabled
2. **Database items not affected**: The database-dependent items (Create, Open, Save, Save As, Delete) should continue to behave as they do now
3. **Feature toggle not affected**: The `includeDatabase` toggle should continue to hide/show database items, but Import/Export should never be affected by it

### Existing Code to Reference

**Files requiring changes:**

1. `frontend/src/components/TopBar/TopBar.tsx`
   - Lines 147-157: Where disabled states are computed
   - Currently: `importXlsxDisabled = !state.loadedFileName` and `importJsonDisabled = !state.loadedFileName`
   - Change to: `importXlsxDisabled = false` and `importJsonDisabled = false`

2. `frontend/src/components/TopBar/FileMenu.tsx`
   - Lines 229-259: Click handlers with disabled guards
   - Remove/bypass the `if (!importJsonDisabled)` and `if (!importXlsxDisabled)` guards
   - The `exportJsonDisabled` and `exportXlsxDisabled` guards can also be removed for consistency

3. Test files that may need updating:
   - `frontend/src/__tests__/project-menu-disable.test.tsx` - Tests that expect Import JSON to be disabled
   - Any other tests checking disabled state for these menu items

### Follow-up Questions

No follow-up questions needed. The requirements are explicit and the codebase analysis confirms the exact changes needed.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A - This is a behavioral change, not a visual change.

## Requirements Summary

### Functional Requirements
- Import as JSON menu item must always be enabled (currently disabled when no project loaded)
- Import as XLSX menu item must always be enabled (currently disabled when no project loaded)
- Export as JSON menu item must remain always enabled (already correct)
- Export as XLSX menu item must remain always enabled (already correct)
- Click handlers must execute the action regardless of any disabled state

### Reusability Opportunities
- Follow the existing pattern already used for Export items (lines 156-157 in TopBar.tsx):
  ```typescript
  const exportJsonDisabled = false;
  const exportXlsxDisabled = false;
  ```
- Apply same pattern to Import items

### Scope Boundaries

**In Scope:**
- Change `importJsonDisabled` to always be `false` in TopBar.tsx
- Change `importXlsxDisabled` to always be `false` in TopBar.tsx
- Remove/simplify disabled guards in FileMenu.tsx click handlers for Import items
- Update or remove tests that expect Import items to be disabled when no project loaded

**Out of Scope:**
- Database-dependent menu items (Create, Open, Save, Save As, Delete) - these should continue to work as they do now
- The `includeDatabase` feature toggle behavior - this should continue to hide/show database items
- The actual Import/Export functionality - only the enabled/disabled state is changing

### Technical Considerations
- The disabled props (`importJsonDisabled`, `importXlsxDisabled`) can be kept in the interface for backward compatibility, but should always be passed as `false`
- Alternatively, the props could be removed entirely from FileMenu interface if no other code depends on them
- The click handler guards in FileMenu can be removed since the disabled state will always be false
- The CSS class application (`styles.menuItemDisabled`) will still work correctly but will never be applied since the disabled state is always false
