# Spec Requirements: Diagrams Toolbar UX Refresh

## Initial Description
Replace the existing Diagram selector + inline New/Copy inputs with a single-line "Search + Actions" toolbar using an advanced grouped autocomplete selector and modal-driven New/Copy/Rename/Delete flows.

**Motivation:**
- Current toolbar does not scale when many diagrams exist (flat select list).
- Inline "New Diagram name + type + button" clutters the header row.
- Copy/Rename/Delete need explicit, safe workflows (modals / confirmation).
- Align selector UX with the existing grouped typeahead pattern used in ApplicationPointPickerCell.

## Requirements Discussion

### First Round Questions

**Q1:** Grouped autocomplete grouping strategy -- how should diagrams be grouped?
**Answer:** Group by DiagramType exactly (General, ER, Sequence, Activity, State, UI_Workflow, UI_SCREEN) and render group headers using DIAGRAM_TYPE_LABELS, matching the ApplicationPointPickerCell visual pattern.

**Q2:** Autocomplete activation/trigger -- how does the dropdown open?
**Answer:** Clicking anywhere on the selector should open the dropdown immediately (showing all diagrams grouped by type); typing filters live -- no separate dropdown arrow required.

**Q3:** New Diagram modal defaults -- what should the default type and name be?
**Answer:** Keep default type = General; name field should start empty (no auto "New Diagram 1").

**Q4:** Copy Diagram name pre-population -- how should the copy name be seeded?
**Answer:** Pre-populate with "[OriginalName] (Copy)"; user can edit.

**Q5:** Rename Diagram modal behavior -- how should the rename modal work?
**Answer:** Pre-populate with the current diagram name for editing, and use the existing UPDATE_DIAGRAM action for the rename operation.

**Q6:** Delete Diagram behavior -- what happens after deletion?
**Answer:** Add a DELETE_DIAGRAM reducer action; after deletion auto-select a sensible remaining diagram (next by index if possible, otherwise first), and if none remain show the "No diagrams defined" empty state with no selection.

**Q7:** Toolbar layout details -- label visibility and button enable/disable rules?
**Answer:** "Search:" should be visible text label (not just placeholder). [Copy]/[Rename]/[Delete] must be disabled when no diagram is selected. [New] is always enabled.

**Q8:** Rename validation edge case -- what if the user renames to the current name?
**Answer:** Block renaming to the current name (treat as invalid/no-op) and show a simple validation message rather than allowing it.

**Q9:** Explicit scope boundaries -- anything else to exclude?
**Answer:** Keep strictly to toolbar + selector + New/Copy/Rename/Delete modals/confirm and reducer wiring; no keyboard shortcuts beyond basic combobox behavior, no drag-to-reorder, no batch ops, and no changes to period/zoom/export controls.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: DiagramSelector (current implementation) - Path: `frontend/src/components/DiagramSelector/DiagramSelector.tsx`
- Feature: ApplicationPointPickerCell (grouped typeahead pattern) - Path: `frontend/src/components/ApplicationPointPickerCell/ApplicationPointPickerCell.tsx`
- Feature: Modal component - Path: `frontend/src/components/Modal/Modal.tsx`
- Feature: DeleteDiagramElementModal (existing delete confirmation pattern) - Path: `frontend/src/components/DeleteDiagramElementModal/DeleteDiagramElementModal.tsx`
- Feature: Button component (primary/secondary/danger variants) - Path: `frontend/src/components/Button/Button.tsx`
- Components to potentially reuse: ApplicationPointPickerCell grouped dropdown pattern (isEditing/searchText/showDropdown state, GroupedOption[], group headers, keyboard support), Modal overlay pattern (Escape and overlay click handling), Button variants with disabled state
- Backend logic to reference: ArchitectureContext reducer actions (ADD_DIAGRAM, UPDATE_DIAGRAM, SELECT_DIAGRAM -- plus new DELETE_DIAGRAM)

### Types and Utilities to Reference
- **DiagramType** (diagramType.ts): 7 types with ALL_DIAGRAM_TYPES array and DIAGRAM_TYPE_LABELS map
- **validateDiagramName** (validation.ts): Validates empty name + case-sensitive duplicate checking
- **generatePrefixedId** (idGenerator.ts): Generates `prefix-timestamp-random` format IDs

### Follow-up Questions
No follow-up questions were needed. All requirements were sufficiently clarified in the first round.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
Not applicable -- no visual assets were submitted.

## Requirements Summary

### Functional Requirements
- Replace the flat `<select>` dropdown in DiagramSelector with a grouped autocomplete selector
- Group diagrams by DiagramType (7 types) with group headers rendered using DIAGRAM_TYPE_LABELS
- Clicking the selector opens the full grouped dropdown; typing filters results live
- "Search:" visible text label (not placeholder-only) precedes the autocomplete input
- [New] button opens a modal with empty name field and default type = General
- [Copy] button opens a modal with name pre-populated as "[OriginalName] (Copy)" and same type
- [Rename] button opens a modal with current diagram name pre-populated; uses UPDATE_DIAGRAM action
- Rename validation blocks renaming to the current name with a validation message
- [Delete] button opens a confirmation dialog; on confirm dispatches new DELETE_DIAGRAM reducer action
- After deletion, auto-select next diagram by index (or first if last was deleted); show empty state if none remain
- All name inputs reuse validateDiagramName for duplicate/empty validation
- [Copy]/[Rename]/[Delete] disabled when no diagram is selected; [New] always enabled

### Reusability Opportunities
- ApplicationPointPickerCell grouped typeahead pattern (state management, GroupedOption type, group header rendering, keyboard navigation)
- Modal.tsx overlay/escape/click-outside handling
- Button.tsx primary/secondary/danger variants with disabled state
- DeleteDiagramElementModal confirmation dialog pattern
- validateDiagramName utility for all name input validation
- generatePrefixedId for new diagram ID generation
- Existing ArchitectureContext reducer pattern for ADD_DIAGRAM, UPDATE_DIAGRAM, SELECT_DIAGRAM actions

### Scope Boundaries
**In Scope:**
- Frontend-only change (React/TypeScript) within Diagrams view
- Replace DiagramSelector toolbar UI with: Search: [Grouped autocomplete selector] [New] [Copy] [Rename] [Delete]
- 3 modals (New Diagram, Copy Diagram, Rename Diagram) and 1 confirmation dialog (Delete Diagram)
- Grouped, typable autocomplete selector with results grouped by DiagramType
- New DELETE_DIAGRAM reducer action with auto-selection logic
- Button enable/disable rules based on diagram selection state
- Validation using existing validateDiagramName utility

**Out of Scope:**
- Backend / persistence changes
- Diagram content editing behavior
- Changes to period/zoom/export controls outside the diagram selection/action area
- Keyboard shortcuts beyond basic combobox behavior
- Drag-to-reorder diagrams
- Batch operations on diagrams

### Technical Considerations
- Toolbar layout: Row 1 structure is diagramSelectionSection | verticalDivider | periodSection | verticalDivider | zoomSection (pushed right with margin-left: auto)
- Existing ArchitectureContext actions to use: ADD_DIAGRAM, UPDATE_DIAGRAM, SELECT_DIAGRAM
- New reducer action needed: DELETE_DIAGRAM
- DiagramType enum has 7 values: General, ER, Sequence, Activity, State, UI_Workflow, UI_SCREEN
- Follow ApplicationPointPickerCell state pattern: isEditing, searchText, showDropdown, GroupedOption[]
- All modals should follow existing Modal.tsx pattern (overlay, Escape key, overlay click dismiss)
