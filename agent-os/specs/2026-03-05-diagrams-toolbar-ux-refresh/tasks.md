# Task Breakdown: Diagrams Toolbar UX Refresh

## Overview
Total Tasks: 29
This is a **frontend-only** spec. No backend or persistence changes are needed.

## Task List

### State Management Layer

#### Task Group 1: DELETE_DIAGRAM Reducer Action
**Dependencies:** None

This task group adds the new `DELETE_DIAGRAM` action to the `ArchitectureContext` reducer. It must be completed first because the Delete Diagram confirmation modal (Task Group 4) dispatches this action.

- [x] 1.0 Complete DELETE_DIAGRAM reducer action
  - [x] 1.1 Write 4 focused tests for DELETE_DIAGRAM reducer logic
    - Test 1: Deleting a diagram removes it from `state.model.diagrams`
    - Test 2: After deletion, `selectedDiagramId` falls back to the diagram at the same index (or last remaining)
    - Test 3: Deleting the only diagram sets `selectedDiagramId` to `null`
    - Test 4: Deleting a non-existent diagram ID returns state unchanged
  - [x] 1.2 Add `DELETE_DIAGRAM` to the `AppAction` union type
    - File: `frontend/src/contexts/ArchitectureContext.tsx`
    - Add after line 191 (after `ADD_DIAGRAM`): `| { type: 'DELETE_DIAGRAM'; payload: string }`
    - The `payload` is the diagram ID to delete
  - [x] 1.3 Implement the `DELETE_DIAGRAM` case in `appReducer`
    - File: `frontend/src/contexts/ArchitectureContext.tsx`
    - Add after the `ADD_DIAGRAM` case (line 1870)
    - Filter out the diagram with `id === action.payload` from `state.model.diagrams`
    - Find the index of the deleted diagram in the original array
    - Fallback selection: `remainingDiagrams[Math.min(deletedIndex, remainingDiagrams.length - 1)]?.id ?? null`
    - Return updated state with filtered diagrams and new `selectedDiagramId`
  - [x] 1.4 Ensure DELETE_DIAGRAM tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify the reducer handles all edge cases correctly

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- `DELETE_DIAGRAM` is in the `AppAction` union type
- Reducer correctly removes the diagram and applies fallback selection
- Deleting the last diagram results in `selectedDiagramId: null`
- Deleting a middle diagram selects the next diagram at the same index

---

### Autocomplete Component

#### Task Group 2: DiagramAutocomplete Component
**Dependencies:** None (can be developed in parallel with Task Group 1)

This task group creates the grouped autocomplete selector that replaces the flat `<select>` dropdown. It follows the established typeahead pattern from `ApplicationPointPickerCell` (`frontend/src/components/Grid/ApplicationPointPickerCell.tsx`, lines 207-509).

- [x] 2.0 Complete DiagramAutocomplete component
  - [x] 2.1 Write 6 focused tests for DiagramAutocomplete
    - Test 1: Renders with the currently selected diagram name displayed in the input
    - Test 2: Clicking the input opens the dropdown showing all diagrams grouped by `DiagramType`
    - Test 3: Typing in the input filters diagrams by case-insensitive substring match; groups with zero matches are hidden
    - Test 4: Selecting a diagram from the dropdown calls the `onSelect` callback with the diagram ID
    - Test 5: When `diagrams` is empty, input is disabled and shows placeholder "No diagrams defined"
    - Test 6: Pressing Escape closes the dropdown without changing selection
  - [x] 2.2 Create `DiagramAutocomplete.module.css`
    - File: `frontend/src/components/DiagramsView/DiagramAutocomplete.module.css`
    - Container: `position: relative` (for dropdown positioning)
    - Input: `padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; min-width: 250px`
    - Dropdown: follow `Grid.module.css` typeahead pattern (lines 194-246) -- `position: absolute; background: white; border: 1px solid #ddd; border-radius: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); max-height: 300px; overflow-y: auto; z-index: 100`
    - Group headers: follow `ApplicationPointPickerCell` inline style pattern -- `padding: 6px 12px; font-size: 11px; font-weight: 600; color: #666; background-color: #f0f0f0; border-bottom: 1px solid #ddd; text-transform: uppercase; letter-spacing: 0.5px`
    - Option rows: `padding: 8px 12px; cursor: pointer; font-size: 13px; color: #333` with hover `background: #f5f5f5`
    - No-results message: `padding: 12px; text-align: center; color: #999; font-size: 13px`
    - Disabled input: `background: #f5f5f5; color: #999; cursor: not-allowed; opacity: 0.8`
  - [x] 2.3 Create `DiagramAutocomplete.tsx` component
    - File: `frontend/src/components/DiagramsView/DiagramAutocomplete.tsx`
    - **Props:** `diagrams: Diagram[]`, `selectedDiagramId: string | null`, `onSelect: (diagramId: string) => void`
    - **Local state:** `searchText: string`, `showDropdown: boolean`, `inputRef`, `containerRef`
    - **Grouping logic:**
      - Import `getDiagramType` from `frontend/src/types/diagramType.ts` (line 119) for safe type normalization
      - Import `ALL_DIAGRAM_TYPES`, `DIAGRAM_TYPE_LABELS` from `frontend/src/types/diagramType.ts`
      - Group diagrams by `getDiagramType(diagram)` into the 7 `DiagramType` categories
      - Render group headers using `DIAGRAM_TYPE_LABELS` for human-readable display
      - Hide groups with zero matching diagrams
    - **Filtering:** `const search = searchText.toLowerCase()` then `.filter(d => d.name.toLowerCase().includes(search))` (same pattern as `ApplicationPointPickerCell` line 225)
    - **Activation:** Single click on input opens dropdown (not double-click like `ApplicationPointPickerCell`)
    - **Selection behavior:** Selecting a diagram calls `onSelect(diagram.id)`, closes dropdown, clears search
    - **Display text:** When not searching, input shows the name of the currently selected diagram
    - **Keyboard:** `Escape` closes dropdown; `Enter` selects the first visible result (follow `ApplicationPointPickerCell` lines 502-508)
    - **Click-outside:** `useEffect` with `handleClickOutside` using `containerRef.current.contains()` guard (follow `ApplicationPointPickerCell` lines 412-422)
    - **Empty state:** When `diagrams.length === 0`, input is disabled with placeholder "No diagrams defined"
  - [x] 2.4 Ensure DiagramAutocomplete tests pass
    - Run ONLY the 6 tests written in 2.1
    - Verify grouping, filtering, selection, keyboard, and empty state all work

**Acceptance Criteria:**
- The 6 tests written in 2.1 pass
- Diagrams are grouped by `DiagramType` with correct group headers
- Typing filters diagrams case-insensitively and hides empty groups
- Selecting a diagram calls `onSelect` with the correct ID
- Escape closes the dropdown; Enter selects the first visible match
- Click-outside closes the dropdown
- Disabled state works when no diagrams exist

---

### Modal Components

#### Task Group 3: New Diagram Modal
**Dependencies:** None (can be developed in parallel with Task Groups 1 and 2)

Follows the modal pattern established in `DeleteDiagramElementModal` (`frontend/src/components/DiagramsView/modals/DeleteDiagramElementModal.tsx`).

- [x] 3.0 Complete New Diagram modal
  - [x] 3.1 Write 3 focused tests for NewDiagramModal
    - Test 1: Modal renders with empty name field and type dropdown defaulting to "General" when `isOpen` is true
    - Test 2: Clicking "Create" with an empty name displays validation error inline; clicking "Create" with a valid name calls `onSubmit` with `{ name, diagramType }`
    - Test 3: Pressing Escape or clicking overlay calls `onClose`
  - [x] 3.2 Create `NewDiagramModal.module.css`
    - File: `frontend/src/components/DiagramsView/modals/NewDiagramModal.module.css`
    - Follow `DeleteDiagramElementModal.module.css` pattern: overlay (fixed, z-index 1000), modal card (border-radius 8px, box-shadow), header/content/footer sections
    - Add `.formGroup` class: `margin-bottom: 16px`
    - Add `.formLabel` class: `display: block; font-size: 14px; font-weight: 500; color: #333; margin-bottom: 6px`
    - Add `.formInput` class: `width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; box-sizing: border-box`
    - Add `.formSelect` class: same as `.formInput` with `cursor: pointer`
    - Add `.validationError` class: `color: #d32f2f; font-size: 12px; margin-top: 4px`
    - Primary button: `background: #1976D2` matching existing `primaryButton` pattern
    - Secondary button: `background: white; border: 1px solid #ddd` matching existing `secondaryButton` pattern
  - [x] 3.3 Create `NewDiagramModal.tsx` component
    - File: `frontend/src/components/DiagramsView/modals/NewDiagramModal.tsx`
    - **Props:** `isOpen: boolean`, `onClose: () => void`, `onSubmit: (name: string, diagramType: DiagramType) => void`, `existingDiagrams: Diagram[]`
    - **Local state:** `name: string` (starts empty), `diagramType: DiagramType` (defaults to `DEFAULT_DIAGRAM_TYPE`), `validationError: string | null`
    - **Title:** "Create New Diagram"
    - **Fields:** "Diagram Name" text input (autofocused), "Diagram Type" `<select>` populated from `ALL_DIAGRAM_TYPES` with `DIAGRAM_TYPE_LABELS`
    - **Validation on Create click:** Trim name, call `validateDiagramName(trimmedName, existingDiagrams)`. Display error inline below name input if invalid.
    - **On success:** Call `onSubmit(trimmedName, diagramType)`, reset local state
    - **Buttons:** "Create" (primary) / "Cancel" (secondary)
    - **Escape key:** `useEffect` binding same as `DeleteDiagramElementModal` lines 34-43
    - **Overlay click:** `handleOverlayClick` with `e.target === e.currentTarget` guard (lines 46-53)
    - **isOpen guard:** Return `null` when not open (line 55-57)
    - **Clear validation on input change:** Set `validationError` to `null` when user modifies name
    - **Close button (x):** In header, matching `DeleteDiagramElementModal` pattern
  - [x] 3.4 Ensure NewDiagramModal tests pass
    - Run ONLY the 3 tests written in 3.1

**Acceptance Criteria:**
- The 3 tests written in 3.1 pass
- Modal renders correctly with title, name input, type dropdown, and buttons
- Validation errors display inline below the name input in red
- Modal supports Escape key, overlay click, and close button to dismiss
- `onSubmit` is called with trimmed name and selected diagram type

---

#### Task Group 4: Copy Diagram Modal
**Dependencies:** None (can be developed in parallel)

- [x] 4.0 Complete Copy Diagram modal
  - [x] 4.1 Write 3 focused tests for CopyDiagramModal
    - Test 1: Modal renders with name pre-populated as "[OriginalName] (Copy)" when `isOpen` is true
    - Test 2: Clicking "Create" with a valid name calls `onSubmit` with the trimmed name; validation error displays for empty/duplicate names
    - Test 3: Pressing Escape or clicking overlay calls `onClose`
  - [x] 4.2 Create `CopyDiagramModal.module.css`
    - File: `frontend/src/components/DiagramsView/modals/CopyDiagramModal.module.css`
    - Same pattern as `NewDiagramModal.module.css` (overlay, modal, header, content, footer, form group, validation error)
  - [x] 4.3 Create `CopyDiagramModal.tsx` component
    - File: `frontend/src/components/DiagramsView/modals/CopyDiagramModal.tsx`
    - **Props:** `isOpen: boolean`, `onClose: () => void`, `onSubmit: (name: string) => void`, `existingDiagrams: Diagram[]`, `sourceDiagramName: string`
    - **Local state:** `name: string` (initialized to `"${sourceDiagramName} (Copy)"`), `validationError: string | null`
    - **Title:** "Copy Diagram"
    - **Fields:** "Copied Diagram New Name" text input, pre-populated
    - **Validation:** Same as New modal -- `validateDiagramName(trimmedName, existingDiagrams)`
    - **On success:** Call `onSubmit(trimmedName)`, reset local state
    - **Buttons:** "Create" (primary) / "Cancel" (secondary)
    - **Re-initialize name** when `sourceDiagramName` changes (use `useEffect` to reset name when modal opens)
    - Same Escape, overlay click, close button, and isOpen guard patterns as NewDiagramModal
  - [x] 4.4 Ensure CopyDiagramModal tests pass
    - Run ONLY the 3 tests written in 4.1

**Acceptance Criteria:**
- The 3 tests written in 4.1 pass
- Name field is pre-populated with "[OriginalName] (Copy)"
- Validation blocks empty and duplicate names
- `onSubmit` is called with the trimmed user-provided name

---

#### Task Group 5: Rename Diagram Modal
**Dependencies:** None (can be developed in parallel)

- [x] 5.0 Complete Rename Diagram modal
  - [x] 5.1 Write 4 focused tests for RenameDiagramModal
    - Test 1: Modal renders with name pre-populated with current diagram name when `isOpen` is true
    - Test 2: Clicking "Rename" when name is identical to current name shows "The new name is the same as the current name." error
    - Test 3: Clicking "Rename" with a valid, different name calls `onSubmit` with the trimmed name
    - Test 4: Validation error from `validateDiagramName` (duplicate/empty) displays inline
  - [x] 5.2 Create `RenameDiagramModal.module.css`
    - File: `frontend/src/components/DiagramsView/modals/RenameDiagramModal.module.css`
    - Same pattern as `NewDiagramModal.module.css`
  - [x] 5.3 Create `RenameDiagramModal.tsx` component
    - File: `frontend/src/components/DiagramsView/modals/RenameDiagramModal.tsx`
    - **Props:** `isOpen: boolean`, `onClose: () => void`, `onSubmit: (newName: string) => void`, `existingDiagrams: Diagram[]`, `currentDiagramName: string`
    - **Local state:** `name: string` (initialized to `currentDiagramName`), `validationError: string | null`
    - **Title:** "Rename Diagram"
    - **Fields:** "Diagram New Name" text input, pre-populated with current name
    - **Validation (3-step):**
      1. Trim the name
      2. If trimmed name equals `currentDiagramName`, set error: "The new name is the same as the current name." (block submission)
      3. Call `validateDiagramName(trimmedName, existingDiagrams)` for empty/duplicate checks
    - **On success:** Call `onSubmit(trimmedName)`, reset local state
    - **Buttons:** "Rename" (primary) / "Cancel" (secondary)
    - **Re-initialize name** when `currentDiagramName` changes (use `useEffect`)
    - Same Escape, overlay click, close button, and isOpen guard patterns as NewDiagramModal
  - [x] 5.4 Ensure RenameDiagramModal tests pass
    - Run ONLY the 4 tests written in 5.1

**Acceptance Criteria:**
- The 4 tests written in 5.1 pass
- Name field is pre-populated with the current diagram name
- Same-name rename is blocked with a specific message
- Standard validation (empty/duplicate) is enforced
- `onSubmit` is called only with a valid, different name

---

#### Task Group 6: Delete Diagram Confirmation Modal
**Dependencies:** Task Group 1 (DELETE_DIAGRAM reducer must exist for integration)

- [x] 6.0 Complete Delete Diagram confirmation dialog
  - [x] 6.1 Write 3 focused tests for DeleteDiagramConfirmModal
    - Test 1: Modal renders with confirmation message "Are you sure you want to permanently delete this diagram?" when `isOpen` is true
    - Test 2: Clicking "Delete" calls `onConfirm`; clicking "Cancel" calls `onClose`
    - Test 3: Pressing Escape and clicking overlay both call `onClose`
  - [x] 6.2 Create `DeleteDiagramConfirmModal.module.css`
    - File: `frontend/src/components/DiagramsView/modals/DeleteDiagramConfirmModal.module.css`
    - Follow `DeleteDiagramElementModal.module.css` pattern with danger button styling
    - Danger button: `background: #d32f2f; color: white` matching existing `dangerButton` pattern
    - Secondary button for Cancel
  - [x] 6.3 Create `DeleteDiagramConfirmModal.tsx` component
    - File: `frontend/src/components/DiagramsView/modals/DeleteDiagramConfirmModal.tsx`
    - **Props:** `isOpen: boolean`, `onClose: () => void`, `onConfirm: () => void`
    - **Title:** "Delete Diagram" (or no title, just the confirmation message -- follow pattern from `DeleteDiagramElementModal`)
    - **Message:** "Are you sure you want to permanently delete this diagram?"
    - **Buttons:** "Delete" (danger/red variant) / "Cancel" (secondary)
    - Same Escape, overlay click, close button, and isOpen guard patterns as `DeleteDiagramElementModal` (lines 34-53)
  - [x] 6.4 Ensure DeleteDiagramConfirmModal tests pass
    - Run ONLY the 3 tests written in 6.1

**Acceptance Criteria:**
- The 3 tests written in 6.1 pass
- Confirmation message displays correctly
- "Delete" button uses danger/red styling
- Escape key and overlay click dismiss the dialog

---

### Integration Layer

#### Task Group 7: Refactor DiagramSelector and Wire Up Toolbar
**Dependencies:** Task Groups 1, 2, 3, 4, 5, 6 (all components and the reducer must be built first)

This is the integration task group where the existing `DiagramSelector.tsx` is gutted and replaced with the new toolbar layout, and all modal open/close handlers and action callbacks are wired together.

- [x] 7.0 Complete DiagramSelector refactor and toolbar integration
  - [x] 7.1 Write 5 focused tests for the refactored DiagramSelector toolbar
    - Test 1: Toolbar renders with "Search:" label, DiagramAutocomplete, and four buttons (New, Copy, Rename, Delete)
    - Test 2: Copy, Rename, and Delete buttons are disabled when `selectedDiagramId` is null; New is always enabled
    - Test 3: Clicking "New" opens NewDiagramModal; submitting dispatches `ADD_DIAGRAM` with generated ID and closes modal
    - Test 4: Clicking "Copy" (when diagram selected) opens CopyDiagramModal; submitting deep-copies the selected diagram, assigns new ID, preserves `diagram_type`, and dispatches `ADD_DIAGRAM`
    - Test 5: Clicking "Delete" (when diagram selected) opens DeleteDiagramConfirmModal; confirming dispatches `DELETE_DIAGRAM` with the selected diagram ID
  - [x] 7.2 Refactor `DiagramSelector.tsx` -- replace the entire component body
    - File: `frontend/src/components/DiagramsView/DiagramSelector.tsx`
    - **Remove:** All existing inline New/Copy input logic, flat `<select>`, inline name/type fields, inline validation error display
    - **Add imports:** `DiagramAutocomplete`, `NewDiagramModal`, `CopyDiagramModal`, `RenameDiagramModal`, `DeleteDiagramConfirmModal`
    - **Keep imports:** `useArchitecture`, `useArchitectureDispatch`, `Button`, `generatePrefixedId`, `validateDiagramName`, `Diagram`, `DiagramType`
    - **Local state:** `showNewModal`, `showCopyModal`, `showRenameModal`, `showDeleteConfirm` -- all `useState<boolean>(false)`
    - **Derived values:**
      - `const hasDiagrams = state.model.diagrams.length > 0`
      - `const selectedDiagram = state.model.diagrams.find(d => d.id === state.selectedDiagramId) || null`
      - `const hasSelection = !!state.selectedDiagramId && hasDiagrams`
    - **Render layout:** `<div className={styles.selectorContainer}>` containing:
      1. `<span className={styles.selectorLabel}>Search:</span>`
      2. `<DiagramAutocomplete diagrams={state.model.diagrams} selectedDiagramId={state.selectedDiagramId} onSelect={(id) => dispatch({ type: 'SELECT_DIAGRAM', payload: id })} />`
      3. `<Button variant="secondary" onClick={() => setShowNewModal(true)}>New</Button>`
      4. `<Button variant="secondary" onClick={() => setShowCopyModal(true)} disabled={!hasSelection}>Copy</Button>`
      5. `<Button variant="secondary" onClick={() => setShowRenameModal(true)} disabled={!hasSelection}>Rename</Button>`
      6. `<Button variant="secondary" onClick={() => setShowDeleteConfirm(true)} disabled={!hasSelection}>Delete</Button>`
      7. Conditionally rendered modals (only when their `show*` state is true)
  - [x] 7.3 Implement New Diagram callback in DiagramSelector
    - Handler for `NewDiagramModal.onSubmit(name, diagramType)`:
      1. Generate ID: `const newId = generatePrefixedId('diag')`
      2. Construct `Diagram`: `{ id: newId, name, description: '', diagram_type: diagramType, settings: {}, diagram_nodes: [], diagram_edges: [] }`
      3. Dispatch `{ type: 'ADD_DIAGRAM', payload: newDiagram }`
      4. Close modal: `setShowNewModal(false)`
  - [x] 7.4 Implement Copy Diagram callback in DiagramSelector
    - Handler for `CopyDiagramModal.onSubmit(name)`:
      1. Deep copy: `const copiedDiagram: Diagram = JSON.parse(JSON.stringify(selectedDiagram))` (same pattern as existing line 95)
      2. Assign new ID: `copiedDiagram.id = generatePrefixedId('diag')`
      3. Set name: `copiedDiagram.name = name`
      4. Preserve original `diagram_type` (already in the deep copy)
      5. Dispatch `{ type: 'ADD_DIAGRAM', payload: copiedDiagram }`
      6. Close modal: `setShowCopyModal(false)`
  - [x] 7.5 Implement Rename Diagram callback in DiagramSelector
    - Handler for `RenameDiagramModal.onSubmit(newName)`:
      1. Dispatch `{ type: 'UPDATE_DIAGRAM', diagramId: selectedDiagram!.id, updates: { name: newName } }`
      2. Close modal: `setShowRenameModal(false)`
  - [x] 7.6 Implement Delete Diagram callback in DiagramSelector
    - Handler for `DeleteDiagramConfirmModal.onConfirm()`:
      1. Dispatch `{ type: 'DELETE_DIAGRAM', payload: state.selectedDiagramId! }`
      2. Close dialog: `setShowDeleteConfirm(false)`
  - [x] 7.7 Update `DiagramsView.module.css` -- remove obsolete styles
    - File: `frontend/src/components/DiagramsView/DiagramsView.module.css`
    - Remove `.newDiagramLabel` (line 490-494) -- no longer used
    - Remove `.diagramInput` and `.diagramInput:focus` (lines 496-509) -- no longer used
    - Remove `.diagramTypeSelector`, `.diagramTypeSelector:focus`, `.diagramTypeSelector:hover` (lines 517-535) -- no longer used
    - Keep `.selectorContainer`, `.selectorLabel`, `.validationError` -- still used
    - Keep `.selector` and `.selectorDisabled` -- may be needed for reference or can be removed if fully replaced
  - [x] 7.8 Ensure DiagramSelector integration tests pass
    - Run ONLY the 5 tests written in 7.1
    - Verify the full toolbar renders correctly
    - Verify all four action flows work end-to-end (New, Copy, Rename, Delete)
    - Verify button disabled states are correct

**Acceptance Criteria:**
- The 5 tests written in 7.1 pass
- The flat `<select>` dropdown is fully replaced with the grouped autocomplete
- Inline New/Copy inputs are removed; all creation/modification flows go through modals
- "Search:" label is visible before the autocomplete input
- New button is always enabled; Copy, Rename, Delete are disabled when no diagram is selected
- New Diagram: generates ID, constructs diagram, dispatches ADD_DIAGRAM, auto-selects
- Copy Diagram: deep copies selected diagram, assigns new ID, preserves diagram_type, dispatches ADD_DIAGRAM
- Rename Diagram: dispatches UPDATE_DIAGRAM with new name only
- Delete Diagram: dispatches DELETE_DIAGRAM, reducer handles fallback selection
- Obsolete CSS classes are removed from DiagramsView.module.css
- All modals open/close correctly from the toolbar buttons

---

### Testing

#### Task Group 8: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-7

- [x] 8.0 Review existing tests and fill critical gaps only
  - [x] 8.1 Review tests from Task Groups 1-7
    - Review the 4 tests from Task Group 1 (DELETE_DIAGRAM reducer)
    - Review the 12 tests from Task Group 2 (DiagramAutocomplete)
    - Review the 3 tests from Task Group 3 (NewDiagramModal)
    - Review the 3 tests from Task Group 4 (CopyDiagramModal)
    - Review the 4 tests from Task Group 5 (RenameDiagramModal)
    - Review the 3 tests from Task Group 6 (DeleteDiagramConfirmModal)
    - Review the 5 tests from Task Group 7 (DiagramSelector integration)
    - Total existing tests: 34 tests
  - [x] 8.2 Analyze test coverage gaps for this feature only
    - Identify critical end-to-end workflows that lack test coverage
    - Focus ONLY on gaps related to this spec's toolbar UX refresh requirements
    - Do NOT assess entire application test coverage
    - Prioritize integration workflows between autocomplete, modals, and reducer
  - [x] 8.3 Write up to 6 additional strategic tests maximum
    - Potential gap areas to evaluate:
      - End-to-end: Autocomplete selection changes the active diagram and updates what Rename/Delete operate on
      - End-to-end: Creating a new diagram via modal makes it appear in the autocomplete grouped list
      - Edge case: Copy/Rename/Delete buttons re-enable after selecting a diagram in the autocomplete
      - Edge case: Validation error clears when user modifies input in any modal
      - Edge case: When last diagram is deleted, autocomplete shows "No diagrams defined" and action buttons disable
      - Grouping correctness: Diagrams with missing/null `diagram_type` default to "General" group
    - Do NOT write all of these; only fill gaps that are truly missing from the 34 existing tests
    - Maximum of 6 additional tests
  - [x] 8.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, and 8.3)
    - Expected total: approximately 34-40 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 34-40 tests total)
- Critical user workflows for this feature are covered
- No more than 6 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's toolbar UX refresh requirements

---

## Execution Order

Recommended implementation sequence:

```
Phase 1 (parallel):
  Task Group 1: DELETE_DIAGRAM Reducer Action
  Task Group 2: DiagramAutocomplete Component
  Task Group 3: New Diagram Modal
  Task Group 4: Copy Diagram Modal
  Task Group 5: Rename Diagram Modal
  Task Group 6: Delete Diagram Confirmation Modal

Phase 2 (depends on Phase 1):
  Task Group 7: Refactor DiagramSelector and Wire Up Toolbar

Phase 3 (depends on Phase 2):
  Task Group 8: Test Review and Gap Analysis
```

**Phase 1** tasks have no dependencies on each other and can all be developed in parallel. Each creates an independent, testable unit (a reducer action, a component, or a modal).

**Phase 2** is the integration step that wires everything together. It depends on all Phase 1 outputs being complete.

**Phase 3** reviews all tests from Phases 1 and 2, identifies any critical gaps, and adds a small number of targeted integration tests.

---

## Key Files Reference

### New Files (10)
| File | Task Group |
|------|------------|
| `frontend/src/components/DiagramsView/DiagramAutocomplete.tsx` | 2 |
| `frontend/src/components/DiagramsView/DiagramAutocomplete.module.css` | 2 |
| `frontend/src/components/DiagramsView/modals/NewDiagramModal.tsx` | 3 |
| `frontend/src/components/DiagramsView/modals/NewDiagramModal.module.css` | 3 |
| `frontend/src/components/DiagramsView/modals/CopyDiagramModal.tsx` | 4 |
| `frontend/src/components/DiagramsView/modals/CopyDiagramModal.module.css` | 4 |
| `frontend/src/components/DiagramsView/modals/RenameDiagramModal.tsx` | 5 |
| `frontend/src/components/DiagramsView/modals/RenameDiagramModal.module.css` | 5 |
| `frontend/src/components/DiagramsView/modals/DeleteDiagramConfirmModal.tsx` | 6 |
| `frontend/src/components/DiagramsView/modals/DeleteDiagramConfirmModal.module.css` | 6 |

### Modified Files (3)
| File | Task Group | Changes |
|------|------------|---------|
| `frontend/src/contexts/ArchitectureContext.tsx` | 1 | Add `DELETE_DIAGRAM` to `AppAction` union and `appReducer` switch |
| `frontend/src/components/DiagramsView/DiagramSelector.tsx` | 7 | Gut and replace with new toolbar layout |
| `frontend/src/components/DiagramsView/DiagramsView.module.css` | 7 | Remove obsolete styles (`.newDiagramLabel`, `.diagramInput`, `.diagramTypeSelector`) |

### Existing Patterns to Reuse
| Pattern | Source File | Used In |
|---------|-------------|---------|
| Grouped typeahead (state, filtering, grouping, keyboard, click-outside) | `frontend/src/components/Grid/ApplicationPointPickerCell.tsx` | Task Group 2 |
| Modal structure (Escape key, overlay click, header/content/footer) | `frontend/src/components/DiagramsView/modals/DeleteDiagramElementModal.tsx` | Task Groups 3-6 |
| Modal CSS (overlay, modal card, buttons) | `frontend/src/components/DiagramsView/modals/DeleteDiagramElementModal.module.css` | Task Groups 3-6 |
| Typeahead dropdown CSS | `frontend/src/components/Grid/Grid.module.css` (lines 194-246) | Task Group 2 |
| Button variants (primary, secondary, danger, disabled) | `frontend/src/components/common/Button.tsx` | Task Group 7 |
| Diagram name validation | `frontend/src/utils/validation.ts` (`validateDiagramName`, lines 901-917) | Task Groups 3-5, 7 |
| ID generation | `frontend/src/utils/idGenerator.ts` (`generatePrefixedId`, lines 11-15) | Task Groups 3-4, 7 |
| DiagramType constants | `frontend/src/types/diagramType.ts` | Task Groups 2-3, 7 |
| Existing reducer actions (ADD_DIAGRAM, UPDATE_DIAGRAM, SELECT_DIAGRAM) | `frontend/src/contexts/ArchitectureContext.tsx` | Task Groups 1, 7 |
